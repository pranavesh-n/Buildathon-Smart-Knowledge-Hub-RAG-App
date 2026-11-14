import asyncio
from typing import List, Dict, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services.vector_service import VectorStoreService
from app.services.llm_service import RAGChatService

router = APIRouter(prefix="/api", tags=["Chat & Vector DB"])

vector_service = VectorStoreService()
chat_service = RAGChatService(vector_service=vector_service)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1)
    chat_history: List[ChatMessage] = []
    source_hash: Optional[str] = None
    language: str = "Auto-Detect"


class BulkDeleteRequest(BaseModel):
    source_hashes: List[str]


@router.get("/sources")
async def get_indexed_sources():
    """Returns all deduplicated websites and PDFs currently stored in the Vector DB."""
    sources = vector_service.registry.list_all_sources()
    return {
        "total_sources": len(sources),
        "sources": sources,
    }


@router.post("/sources/delete")
async def delete_multiple_sources(payload: BulkDeleteRequest):
    """Deletes one or multiple sources from both FAISS and SQLite registry."""
    if not payload.source_hashes:
        raise HTTPException(status_code=400, detail="No sources provided to delete.")
    try:
        result = await asyncio.to_thread(
            vector_service.delete_sources_by_hash, payload.source_hashes
        )
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete sources: {str(e)}"
        )


@router.delete("/sources/{source_hash}")
async def delete_single_source(source_hash: str):
    """Deletes a single source by hash from both FAISS and SQLite registry."""
    try:
        result = await asyncio.to_thread(
            vector_service.delete_sources_by_hash, [source_hash]
        )
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete source: {str(e)}"
        )


@router.post("/chat")
async def chat_with_knowledge_base(payload: ChatRequest):
    """Queries the FAISS Vector DB and generates a grounded answer via OpenAI in the chosen language."""
    try:
        history_dicts: List[Dict[str, str]] = [
            {"role": m.role, "content": m.content} for m in payload.chat_history
        ]
        filter_hash = (
            payload.source_hash
            if payload.source_hash and payload.source_hash != "all"
            else None
        )

        result = await asyncio.to_thread(
            chat_service.ask_question,
            question=payload.question,
            chat_history=history_dicts,
            source_hash=filter_hash,
            language=payload.language,
        )
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Chat generation failed: {str(e)}"
        )