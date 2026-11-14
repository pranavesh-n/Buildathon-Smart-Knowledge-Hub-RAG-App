import urllib3
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes_ingest import router as ingest_router
from app.api.routes_chat import router as chat_router

# Suppress SSL warnings for older government websites
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = FastAPI(
    title="Universal Web & PDF RAG Assistant API",
    description="Playwright Universal Scraper + PDF Ingestion + FAISS Vector DB + OpenAI RAG",
    version="1.0.0",
)

# Enable CORS for React Frontend (Vite default port 5173 & standard 3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest_router)
app.include_router(chat_router)


@app.get("/")
async def health_check():
    return {
        "status": "online",
        "service": "Universal Web & PDF RAG Backend",
        "docs_url": "http://127.0.0.1:8000/docs",
    }