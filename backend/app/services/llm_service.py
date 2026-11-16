import re
from typing import List, Dict, Any, Optional
from pydantic import SecretStr
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from app.config import OPENAI_API_KEY, CHAT_MODEL
from app.services.vector_service import VectorStoreService


class RAGChatService:
    """Handles Multilingual Retrieval-Augmented Generation (RAG) with strict guardrails."""

    def __init__(self, vector_service: VectorStoreService) -> None:
        self.vector_service = vector_service
        self.llm = ChatOpenAI(
            model=CHAT_MODEL,
            api_key=SecretStr(OPENAI_API_KEY),
            temperature=0.0,  # Zero temperature for strict factual grounding
        )

    @staticmethod
    def _check_input_guardrails(question: str) -> Optional[str]:
        """
        Blocks prompt injection attempts, system prompt leaks, and unsafe inputs
        before spending OpenAI API tokens.
        """
        q_lower = question.lower().strip()

        injection_patterns = [
            "ignore previous instructions",
            "ignore all instructions",
            "disregard above",
            "reveal your system prompt",
            "show system prompt",
            "secret instructions",
            "bypass guardrail",
            "you are now dan",
            "act as an unrestricted",
        ]
        for pattern in injection_patterns:
            if pattern in q_lower:
                return (
                    "🛡️ **Security Guardrail Triggered:** Prompt injection or system-override "
                    "instructions are blocked. Please ask a question related to your saved websites or PDFs."
                )

        if len(question) > 1500:
            return (
                "🛡️ **Input Guardrail Triggered:** Your question exceeds the maximum safe length "
                "(1,500 characters). Please shorten your query."
            )

        return None

    @staticmethod
    def _detect_input_language(question: str, selected_language: str) -> str:
        q_lower = question.lower()

        explicit_map = {
            "in tamil": "Tamil (தமிழ்)",
            "tamil la": "Tamil (தமிழ்)",
            "தமிழில்": "Tamil (தமிழ்)",
            "in malayalam": "Malayalam (മലയാളം)",
            "in hindi": "Hindi (हिन्दी)",
            "in telugu": "Telugu (తెలుగు)",
            "in kannada": "Kannada (ಕನ್ನಡ)",
            "in english": "English",
        }
        for phrase, lang_name in explicit_map.items():
            if phrase in q_lower:
                return lang_name

        if re.search(r"[\u0B80-\u0BFF]", question):
            return "Tamil (தமிழ்)"
        if re.search(r"[\u0D00-\u0D7F]", question):
            return "Malayalam (മലയാളം)"
        if re.search(r"[\u0900-\u097F]", question):
            return "Hindi (हिन्दी)"
        if re.search(r"[\u0C00-\u0C7F]", question):
            return "Telugu (తెలుగు)"
        if re.search(r"[\u0C80-\u0CBF]", question):
            return "Kannada (ಕನ್ನಡ)"

        if selected_language and selected_language not in ("Auto-Detect", "English"):
            return selected_language

        return "English"

    def ask_question(
        self,
        question: str,
        chat_history: Optional[List[Dict[str, str]]] = None,
        source_hash: Optional[str] = None,
        language: str = "Auto-Detect",
        k: int = 8,
    ) -> Dict[str, Any]:
        # 1. Input Security Guardrail
        guardrail_violation = self._check_input_guardrails(question)
        if guardrail_violation:
            return {
                "answer": guardrail_violation,
                "citations": [],
                "chunks_used": 0,
            }

        # 2. Empty Library Guardrail
        all_sources = self.vector_service.registry.list_all_sources()
        if not all_sources:
            return {
                "answer": (
                    "There are no websites or PDFs stored in your library yet. "
                    "Please add a website link or upload a PDF document first!"
                ),
                "citations": [],
                "chunks_used": 0,
            }

        inventory_lines = [
            f"- {s['source_name']} (Type: {s['source_type'].upper()}, Sections: {s['chunk_count']})"
            for s in all_sources
        ]
        inventory_text = "\n".join(inventory_lines)

        retrieved_docs = self.vector_service.search_similar(
            query=question, k=k, source_hash=source_hash
        )

        context_blocks: List[str] = []
        citations_map: Dict[str, Dict[str, Any]] = {}

        for idx, doc in enumerate(retrieved_docs, start=1):
            meta = doc.metadata or {}
            src_name = str(meta.get("source", "Unknown Source"))
            src_type = str(meta.get("source_type", "document"))
            page_no = meta.get("page")

            header = f"[Excerpt {idx} from {src_name} ({src_type})]"
            context_blocks.append(f"{header}\n{doc.page_content}")

            cite_key = f"{src_name}_{src_type}_{page_no or ''}"
            if cite_key not in citations_map:
                citations_map[cite_key] = {
                    "source": src_name,
                    "source_type": src_type,
                    "page": page_no,
                }

        formatted_context = (
            "\n\n---\n\n".join(context_blocks)
            if context_blocks
            else "No specific text excerpts matched."
        )

        target_language = self._detect_input_language(question, language)

        if target_language == "English":
            lang_instruction = (
                "STRICT LANGUAGE RULE: The user asked this question in **English**. "
                "You MUST write your entire response in **English** ONLY."
            )
        else:
            lang_instruction = (
                f"STRICT LANGUAGE RULE: You MUST write your entire response in **{target_language}** "
                f"(using natural {target_language} script)."
            )

        # 3. Strict Anti-Hallucination & Out-of-Scope Guardrail
        system_prompt = (
            "You are Smart AI Assistant, a strictly grounded knowledge assistant.\n"
            "You ONLY answer questions using the facts explicitly present in the user's "
            "SAVED ITEMS IN LIBRARY and RETRIEVED KNOWLEDGE EXCERPTS below.\n\n"
            f"{lang_instruction}\n\n"
            f"=== SAVED ITEMS IN LIBRARY ===\n{inventory_text}\n\n"
            f"=== RETRIEVED KNOWLEDGE EXCERPTS ===\n{formatted_context}\n"
            "====================================\n\n"
            "CRITICAL GUARDRAIL RULES (MUST FOLLOW):\n"
            "1. NEVER use your general pre-trained world knowledge to answer questions about external topics "
            "(such as sports, World Cup winners, geography, capitals, celebrities, history, or general coding) "
            "if those facts are NOT explicitly written inside the RETRIEVED KNOWLEDGE EXCERPTS above.\n"
            "2. If the user's question is unrelated to the saved websites/PDFs or the answer cannot be found "
            "in the excerpts above, you MUST refuse to answer from general knowledge and reply ONLY with:\n"
            "   '🛡️ **Out-of-Scope Guardrail:** I can only answer questions based on the websites and PDF documents saved in your library. This information is not present in your saved sources.' (translated into the target language if applicable).\n"
            "3. When the answer IS in the excerpts, present comparisons, schemes, products, or policies clearly using bullet points or Markdown tables."
        )

        messages: List[Any] = [SystemMessage(content=system_prompt)]

        if chat_history:
            for msg in chat_history[-6:]:
                role = msg.get("role", "")
                content = msg.get("content", "")
                if role == "user" and content:
                    messages.append(HumanMessage(content=content))
                elif role == "assistant" and content:
                    messages.append(AIMessage(content=content))

        messages.append(
            HumanMessage(
                content=(
                    f"User Question: {question}\n\n"
                    f"[System Guardrail Reminder: Answer ONLY if the facts exist in the RETRIEVED KNOWLEDGE EXCERPTS. "
                    f"If the question asks about general world knowledge not in the excerpts, trigger the Out-of-Scope Guardrail refusal immediately. "
                    f"Reply strictly in {target_language}.]"
                )
            )
        )

        response = self.llm.invoke(messages)
        answer_text = str(response.content)

        return {
            "answer": answer_text,
            "citations": list(citations_map.values()),
            "chunks_used": len(retrieved_docs),
            "language_used": target_language,
        }