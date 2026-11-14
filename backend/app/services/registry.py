import sqlite3
import hashlib
from urllib.parse import urlparse, urlunparse
from datetime import datetime
from typing import Optional, Dict, List, Any
from app.config import REGISTRY_DB_PATH


class SourceRegistry:
    """SQLite-backed deduplication registry for URLs and PDF files."""

    def __init__(self) -> None:
        self.db_path = str(REGISTRY_DB_PATH)
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS ingested_sources (
                    source_hash TEXT PRIMARY KEY,
                    source_name TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    chunk_count INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

    @staticmethod
    def normalize_url(url: str) -> str:
        """Normalize URL and strip noisy ad-tracking query parameters."""
        from urllib.parse import parse_qsl, urlencode

        parsed = urlparse(url.strip())
        scheme = parsed.scheme.lower() or "https"
        netloc = parsed.netloc.lower()
        path = parsed.path.rstrip("/")

        # Keep essential search/product params (like k, q, id, page) and drop ad-tracking noise
        blocked_prefixes = ("utm_", "hv", "adgrp", "msclkid", "gclid", "fbclid", "ref", "tag", "pf_rd_", "pd_rd_")
        clean_params = [
            (k, v)
            for k, v in parse_qsl(parsed.query)
            if not k.lower().startswith(blocked_prefixes)
        ]
        clean_query = urlencode(clean_params)
        return urlunparse((scheme, netloc, path, "", clean_query, ""))

    @classmethod
    def hash_url(cls, url: str) -> str:
        normalized = cls.normalize_url(url)
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    @staticmethod
    def hash_bytes(file_bytes: bytes) -> str:
        """Hash raw binary bytes of a PDF file to catch duplicate content."""
        return hashlib.sha256(file_bytes).hexdigest()

    def get_source(self, source_hash: str) -> Optional[Dict[str, Any]]:
        """Check if a URL or PDF hash already exists in the database."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM ingested_sources WHERE source_hash = ?",
                (source_hash,),
            )
            row = cursor.fetchone()
            return dict(row) if row else None

    def register_source(
        self, source_hash: str, source_name: str, source_type: str, chunk_count: int
    ) -> Dict[str, Any]:
        """Record a newly vectorized URL or PDF into SQLite."""
        created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT OR REPLACE INTO ingested_sources
                (source_hash, source_name, source_type, chunk_count, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (source_hash, source_name, source_type, chunk_count, created_at),
            )
            conn.commit()

        return {
            "source_hash": source_hash,
            "source_name": source_name,
            "source_type": source_type,
            "chunk_count": chunk_count,
            "created_at": created_at,
        }

    def list_all_sources(self) -> List[Dict[str, Any]]:
        """Fetch all indexed sources to display on the React UI."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM ingested_sources ORDER BY created_at DESC"
            )
            return [dict(row) for row in cursor.fetchall()]

    def delete_sources(self, source_hashes: List[str]) -> int:
        """Delete one or multiple sources by hash from SQLite."""
        if not source_hashes:
            return 0
        placeholders = ",".join(["?"] * len(source_hashes))
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                f"DELETE FROM ingested_sources WHERE source_hash IN ({placeholders})",
                tuple(source_hashes),
            )
            deleted_rows = cursor.rowcount
            conn.commit()
            return deleted_rows

    def clear_all_sources(self) -> int:
        """Delete all registered sources from SQLite."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM ingested_sources")
            deleted_rows = cursor.rowcount
            conn.commit()
            return deleted_rows