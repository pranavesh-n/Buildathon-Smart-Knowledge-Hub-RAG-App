import fitz  # PyMuPDF
from typing import List, Any
from langchain_core.documents import Document


class PDFProcessor:
    """Extracts text and structured Markdown tables from PDF bytes."""

    @staticmethod
    def extract_documents_from_bytes(
        pdf_bytes: bytes, source_name: str, source_hash: str
    ) -> List[Document]:
        documents: List[Document] = []

        # Open PDF directly from memory stream
        pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")

        for page_index in range(len(pdf_doc)):
            page: Any = pdf_doc[page_index]
            page_number = page_index + 1
            page_parts: List[str] = []

            # 1. Extract structured tables if present on the page
            try:
                table_finder: Any = page.find_tables()
                if table_finder and getattr(table_finder, "tables", None):
                    for t_idx, table in enumerate(table_finder.tables, start=1):
                        md_table = str(table.to_markdown() or "").strip()
                        if md_table:
                            page_parts.append(
                                f"### Structured Table {t_idx} (Page {page_number})\n{md_table}"
                            )
            except Exception:
                # Fallback gracefully if table layout detection fails on complex graphics
                pass

            # 2. Extract page text (cast to str for Pylance strict type safety)
            raw_text = str(page.get_text("text") or "").strip()
            if raw_text:
                page_parts.append(f"### Page {page_number} Content\n{raw_text}")

            combined_content = "\n\n".join(page_parts).strip()
            if combined_content:
                documents.append(
                    Document(
                        page_content=combined_content,
                        metadata={
                            "source": source_name,
                            "source_hash": source_hash,
                            "source_type": "pdf",
                            "page": page_number,
                        },
                    )
                )

        pdf_doc.close()
        return documents