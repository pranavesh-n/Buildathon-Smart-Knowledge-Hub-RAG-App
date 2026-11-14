import re
from typing import List, Dict, Any, Optional
from pydantic import SecretStr
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from app.config import OPENAI_API_KEY, CHAT_MODEL
from app.services.vector_service import VectorStoreService


class RAGChatService:
    """Handles Multilingual Retrieval-Augmented Generation (RAG) with strict language detection."""

    def __init__(self, vector_service: VectorStoreService) -> None:
        self.vector_service = vector_service
        self.llm = ChatOpenAI(
            model=CHAT_MODEL,
            api_key=SecretStr(OPENAI_API_KEY),
            temperature=0.2,
        )

    @staticmethod
    def _detect_input_language(question: str, selected_language: str) -> str:
        """
        Determines the exact target language for the AI response based on:
        1. Explicit language requests inside the user's prompt (e.g., "explain in tamil")
        2. Unicode script detection on the current question (Tamil, Malayalam, Hindi, Telugu, Kannada)
        3. Dropdown selection fallback
        """
        q_lower = question.lower()

        # 1. Check if the user explicitly asked for a language inside their question text
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

        # 2. Check Unicode script ranges in the user's current question
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

        # 3. If user selected a forced output language in the dropdown, honor it
        if selected_language and selected_language not in ("Auto-Detect", "English"):
            return selected_language

        # 4. Otherwise, the user typed in standard English / Latin characters -> Reply in English!
        return "English"

    def ask_question(
        self,
        question: str,
        chat_history: Optional[List[Dict[str, str]]] = None,
        source_hash: Optional[str] = None,
        language: str = "Auto-Detect",
        k: int = 8,
    ) -> Dict[str, Any]:
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

        # Resolve exact target language for this specific turn
        target_language = self._detect_input_language(question, language)

        if target_language == "English":
            lang_instruction = (
                "STRICT LANGUAGE RULE: The user asked this question in **English**. "
                "You MUST write your entire response in **English** ONLY. "
                "Do NOT reply in Tamil, Hindi, or any other language, even if earlier chat messages "
                "or source excerpts contain regional language text."
            )
        else:
            lang_instruction = (
                f"STRICT LANGUAGE RULE: You MUST write your entire response in **{target_language}** "
                f"(using natural {target_language} script, while keeping product model numbers, "
                f"currency symbols like ₹, and URLs intact)."
            )

        system_prompt = (
            "You are Smart AI Assistant, a friendly, accurate knowledge assistant.\n"
            "You have access to the user's saved websites and uploaded PDF documents listed below.\n\n"
            f"{lang_instruction}\n\n"
            f"=== SAVED ITEMS IN LIBRARY ===\n{inventory_text}\n\n"
            f"=== RETRIEVED KNOWLEDGE EXCERPTS ===\n{formatted_context}\n"
            "====================================\n\n"
            "Guidelines:\n"
            "1. Answer clearly and accurately using the retrieved excerpts and saved items list above.\n"
            "2. Present comparisons, products, schemes, or policies using clean bullet points or Markdown tables.\n"
            "3. Speak naturally like a helpful human expert—never use robotic phrases like 'Based on the retrieved context'."
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

        # Reinforce language instruction on the final human turn so chat_history never overrides it
        messages.append(
            HumanMessage(
                content=f"{question}\n\n[System Note: Reply strictly in {target_language}]"
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