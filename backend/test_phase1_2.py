import urllib3
from app.services.vector_service import VectorStoreService

# Suppress SSL warnings for older government portals
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def run_verification():
    service = VectorStoreService()
    test_url = "https://agritech.tnau.ac.in/agricultural_engineering/agriengg_govt_schemes.html"

    print("\n--- 1. FIRST RUN: Scraping TNAU Agritech Portal & Indexing to FAISS ---")
    res1 = service.ingest_url(test_url)
    print("Result 1:", res1)

    print("\n--- 2. SECOND RUN: Testing Deduplication (Should Skip Scraping!) ---")
    res2 = service.ingest_url(test_url)
    print("Result 2:", res2)

    print("\n--- 3. REGISTERED SOURCES IN SQLITE ---")
    for src in service.registry.list_all_sources():
        print(" ->", src)

    print("\n--- 4. TESTING FAISS VECTOR RETRIEVAL ---")
    query = "What schemes are available for rain water harvesting or land development?"
    docs = service.search_similar(query, k=3)
    print(f"Query: '{query}' | Retrieved {len(docs)} chunks:\n")
    for idx, doc in enumerate(docs, start=1):
        print(f"[Chunk {idx}] (Type: {doc.metadata.get('source_type')})")
        print(doc.page_content[:400], "...\n" + "-" * 60)


if __name__ == "__main__":
    run_verification()