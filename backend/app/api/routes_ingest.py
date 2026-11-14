import asyncio
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel, HttpUrl
from app.services.vector_service import VectorStoreService
from app.services.scraper_service import get_live_state, update_live_state

router = APIRouter(prefix="/api/ingest", tags=["Ingestion Pipeline"])
vector_service = VectorStoreService()


class UrlIngestRequest(BaseModel):
    url: HttpUrl
    force_refresh: bool = False


@router.get("/status")
async def get_ingestion_live_status():
    """Returns real-time Playwright screenshot, step logs, and progress percentage."""
    return get_live_state()


@router.post("/url")
async def ingest_website_url(payload: UrlIngestRequest):
    try:
        url_str = str(payload.url)
        result = await asyncio.to_thread(
            vector_service.ingest_url, url_str, payload.force_refresh
        )
        if result.get("status") == "error":
            update_live_state(
                step="⚠️ Website blocked scraping or requires a login/PDF download.",
                progress=0,
                active=False,
                reset_screenshot=True,
                mode="error",
            )
            raise HTTPException(status_code=400, detail=result.get("message"))
        return result
    except HTTPException:
        raise
    except Exception as e:
        update_live_state(
            step="❌ Could not scan this website. Ready for next link.",
            progress=0,
            active=False,
            reset_screenshot=True,
            mode="error",
        )
        raise HTTPException(
            status_code=500, detail=f"URL Scraping failed: {str(e)}"
        )


@router.post("/pdf")
async def ingest_pdf_file(
    file: UploadFile = File(...),
    force_refresh: bool = Form(False),
):
    filename = file.filename or "uploaded_document.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400, detail="Only .pdf files are supported."
        )

    try:
        pdf_bytes = await file.read()
        if not pdf_bytes:
            raise HTTPException(
                status_code=400, detail="Uploaded PDF file is empty."
            )

        result = await asyncio.to_thread(
            vector_service.ingest_pdf, pdf_bytes, filename, force_refresh
        )
        if result.get("status") == "error":
            raise HTTPException(status_code=400, detail=result.get("message"))
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"PDF Ingestion failed: {str(e)}"
        )