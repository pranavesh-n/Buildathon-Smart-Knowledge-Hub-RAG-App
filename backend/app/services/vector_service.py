import shutil
from typing import List, Dict, Any, Optional
from pydantic import SecretStr
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import FAISS

from app.config import FAISS_INDEX_DIR, OPENAI_API_KEY, EMBEDDING_MODEL
from app.services.registry import SourceRegistry
from app.services.pdf_service import PDFProcessor
from app.services.scraper_service import (
    PlaywrightUniversalScraper,
    update_live_state,
)


class VectorStoreService:
    """Manages document chunking, OpenAI embeddings, in-memory FAISS cache, and deduplication."""

    def __init__(self) -> None:
        if not OPENAI_API_KEY or "your_actual_openai_api_key" in OPENAI_API_KEY:
            raise ValueError(
                "OPENAI_API_KEY is missing or invalid in backend/.env!"
            )

        self.embeddings = OpenAIEmbeddings(
            model=EMBEDDING_MODEL, api_key=SecretStr(OPENAI_API_KEY)
        )
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=1200,
            chunk_overlap=200,
            separators=["\n### ", "\n\n", "\n", " ", ""],
        )
        self.registry = SourceRegistry()
        self.index_file = FAISS_INDEX_DIR / "index.faiss"
        self._vectorstore_cache: Optional[FAISS] = None

    def _get_vectorstore(self) -> Optional[FAISS]:
        """Returns cached FAISS instance from RAM or loads from disk once."""
        if self._vectorstore_cache is not None:
            return self._vectorstore_cache
        if self.index_file.exists():
            self._vectorstore_cache = FAISS.load_local(
                str(FAISS_INDEX_DIR),
                self.embeddings,
                allow_dangerous_deserialization=True,
            )
            return self._vectorstore_cache
        return None

    def _add_chunks_to_faiss(self, chunks: List[Document]) -> int:
        if not chunks:
            return 0

        for chunk in chunks:
            src = chunk.metadata.get("source", "")
            stype = chunk.metadata.get("source_type", "")
            header = f"[Document Source: {src} | Type: {stype}]\n"
            if not chunk.page_content.startswith("[Document Source:"):
                chunk.page_content = header + chunk.page_content

        new_vectorstore = FAISS.from_documents(chunks, self.embeddings)
        existing_vectorstore = self._get_vectorstore()

        if existing_vectorstore is not None:
            existing_vectorstore.merge_from(new_vectorstore)
            existing_vectorstore.save_local(str(FAISS_INDEX_DIR))
            self._vectorstore_cache = existing_vectorstore
        else:
            FAISS_INDEX_DIR.mkdir(parents=True, exist_ok=True)
            new_vectorstore.save_local(str(FAISS_INDEX_DIR))
            self._vectorstore_cache = new_vectorstore

        return len(chunks)

    def ingest_url(self, url: str, force_refresh: bool = False) -> Dict[str, Any]:
        normalized_url = self.registry.normalize_url(url)
        url_hash = self.registry.hash_url(normalized_url)

        existing = self.registry.get_source(url_hash)
        if existing and not force_refresh:
            update_live_state(
                step="⚡ Website already in library! Loaded from cache.",
                progress=100,
                active=False,
                url=normalized_url,
                reset_logs=True,
                reset_screenshot=True,
                mode="website",
            )
            return {
                "status": "cached",
                "message": "Website already scraped and stored in FAISS Vector DB. Skipped re-scraping!",
                "source_info": existing,
            }

        # If force_refresh=True on an existing website, remove old chunks first so we don't duplicate
        if existing and force_refresh:
            self.delete_sources_by_hash([url_hash])

        raw_docs = PlaywrightUniversalScraper.scrape_url(
            normalized_url, source_hash=url_hash
        )
        if not raw_docs:
            update_live_state(
                step="❌ Could not extract content from URL.",
                progress=0,
                active=False,
                reset_screenshot=True,
                mode="idle",
            )
            return {
                "status": "error",
                "message": f"No extractable text, tables, or PDFs found at {normalized_url}",
            }

        chunks = self.splitter.split_documents(raw_docs)
        chunk_count = self._add_chunks_to_faiss(chunks)

        record = self.registry.register_source(
            source_hash=url_hash,
            source_name=normalized_url,
            source_type="website",
            chunk_count=chunk_count,
        )

        update_live_state(
            step=f"✅ Complete! Saved {chunk_count} sections to your library.",
            progress=100,
            active=False,
            mode="website",
        )

        return {
            "status": "indexed",
            "message": f"Successfully scraped and indexed {chunk_count} chunks into FAISS.",
            "source_info": record,
        }

    def ingest_pdf(
        self, pdf_bytes: bytes, filename: str, force_refresh: bool = False
    ) -> Dict[str, Any]:
        file_hash = self.registry.hash_bytes(pdf_bytes)

        existing = self.registry.get_source(file_hash)
        if existing and not force_refresh:
            update_live_state(
                step=f"⚡ PDF '{filename}' is already saved in your library!",
                progress=100,
                active=False,
                url=filename,
                reset_logs=True,
                reset_screenshot=True,
                mode="pdf",
            )
            return {
                "status": "cached",
                "message": f"PDF '{filename}' (identical content) is already stored in FAISS Vector DB!",
                "source_info": existing,
            }

        if existing and force_refresh:
            self.delete_sources_by_hash([file_hash])

        update_live_state(
            step=f"📄 Reading pages & tables from '{filename}'...",
            progress=40,
            active=True,
            url=filename,
            reset_logs=True,
            reset_screenshot=True,
            mode="pdf",
        )

        raw_docs = PDFProcessor.extract_documents_from_bytes(
            pdf_bytes=pdf_bytes, source_name=filename, source_hash=file_hash
        )
        if not raw_docs:
            update_live_state(
                step=f"❌ Could not read text from '{filename}'.",
                progress=0,
                active=False,
                reset_screenshot=True,
                mode="idle",
            )
            return {
                "status": "error",
                "message": f"Could not extract readable text from '{filename}'.",
            }

        update_live_state(
            step=f"🧠 Organizing & saving '{filename}' into library...",
            progress=85,
            active=True,
            mode="pdf",
        )
        chunks = self.splitter.split_documents(raw_docs)
        chunk_count = self._add_chunks_to_faiss(chunks)

        record = self.registry.register_source(
            source_hash=file_hash,
            source_name=filename,
            source_type="pdf",
            chunk_count=chunk_count,
        )

        update_live_state(
            step=f"✅ PDF '{filename}' saved ({chunk_count} sections)!",
            progress=100,
            active=False,
            mode="pdf",
        )

        return {
            "status": "indexed",
            "message": f"Successfully extracted and indexed {chunk_count} chunks from '{filename}'.",
            "source_info": record,
        }

    def delete_sources_by_hash(self, source_hashes: List[str]) -> Dict[str, Any]:
        target_set = set(source_hashes)
        if not target_set:
            return {"status": "error", "message": "No sources selected for deletion."}

        chunks_removed = 0
        vectorstore = self._get_vectorstore()

        if vectorstore is not None:
            docstore_dict: Dict[str, Document] = getattr(
                vectorstore.docstore, "_dict", {}
            )

            ids_to_delete: List[str] = [
                doc_id
                for doc_id, doc in docstore_dict.items()
                if doc.metadata.get("source_hash") in target_set
            ]

            chunks_removed = len(ids_to_delete)

            if ids_to_delete:
                if len(ids_to_delete) >= len(docstore_dict):
                    shutil.rmtree(FAISS_INDEX_DIR, ignore_errors=True)
                    self._vectorstore_cache = None
                else:
                    vectorstore.delete(ids_to_delete)
                    vectorstore.save_local(str(FAISS_INDEX_DIR))
                    self._vectorstore_cache = vectorstore

        sources_removed = self.registry.delete_sources(list(target_set))

        if len(self.registry.list_all_sources()) == 0 and FAISS_INDEX_DIR.exists():
            shutil.rmtree(FAISS_INDEX_DIR, ignore_errors=True)
            self._vectorstore_cache = None

        update_live_state(
            step="Idle · Ready to scan",
            progress=0,
            active=False,
            url="",
            reset_logs=True,
            reset_screenshot=True,
            mode="idle",
        )

        return {
            "status": "deleted",
            "sources_removed": sources_removed,
            "chunks_removed": chunks_removed,
            "message": f"Removed {sources_removed} item(s) ({chunks_removed} knowledge chunks) from your library.",
        }

    def search_similar(
        self, query: str, k: int = 8, source_hash: Optional[str] = None
    ) -> List[Document]:
        vectorstore = self._get_vectorstore()
        if vectorstore is None:
            return []

        if source_hash:
            return vectorstore.similarity_search(
                query, k=k, filter={"source_hash": source_hash}
            )

        combined_docs: List[Document] = []
        seen_contents = set()

        global_docs = vectorstore.similarity_search(query, k=k)
        for doc in global_docs:
            sig = doc.page_content[:200]
            if sig not in seen_contents:
                seen_contents.add(sig)
                combined_docs.append(doc)

        all_sources = self.registry.list_all_sources()
        for src in all_sources:
            shash = src.get("source_hash")
            if shash:
                try:
                    src_docs = vectorstore.similarity_search(
                        query, k=2, filter={"source_hash": shash}
                    )
                    for doc in src_docs:
                        sig = doc.page_content[:200]
                        if sig not in seen_contents:
                            seen_contents.add(sig)
                            combined_docs.append(doc)
                except Exception:
                    pass

        return combined_docs[:14]