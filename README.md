# ✨ Smart Knowledge Hub — Universal Web & PDF RAG Studio

An enterprise-grade, full-stack **Retrieval-Augmented Generation (RAG)** platform that transforms any website URL or PDF document into an interactive, voice-enabled, multilingual AI knowledge base.

Built with **Playwright (Headless Chromium)**, **FastAPI**, **LangChain**, **FAISS Vector Database (with In-Memory Caching)**, **SQLite Deduplication**, **OpenAI (`gpt-4o-mini` & `text-embedding-3-small`)**, and a **React (Vite)** frontend featuring a real-time browser scanner, an interactive mini-game, CSV table exports, and Indian regional language voice chat (Speech-to-Text & Text-to-Speech).

---

## 🌟 Complete Feature Highlights

### 1. Dual Ingestion Engine (Websites + PDF Documents)

* **Universal Playwright Web Scraper (`scraper_service.py`):**
  * Scrapes static and dynamic JavaScript websites, including government scheme portals (e.g., TNAU Agritech) and e-commerce platforms (**Amazon** & **Flipkart**).
  * **Anti-Bot Stealth & Lazy-Load Scrolling:** Uses realistic Indian locale headers (`en-IN`), masks `navigator.webdriver`, and automatically scrolls pages to trigger lazy-loaded product cards and prices.
  * **HTML Table & E-Commerce Grid Conversion:** Automatically converts HTML `<table>` elements, Amazon search/product blocks, and Flipkart product cards into structured **Markdown tables** so rows, columns, prices (`₹`), and download links stay aligned.
  * **JSON & Schema Capture:** Intercepts background `XHR/Fetch` JSON payloads and parses embedded `<script type="application/ld+json">` product schemas.
  * **Automatic Child PDF Discovery:** Detects direct `.pdf` links embedded on scraped webpages, downloads them in the background, and routes them through the PDF extraction pipeline.
  * **Windows Event-Loop Isolation & HTTP Fallback:** Runs Playwright inside an isolated `WindowsProactorEventLoopPolicy` thread with an automatic `requests + BeautifulSoup` fallback so scraping never fails.

* **Intelligent PDF Processor (`pdf_service.py`):**
  * Powered by **PyMuPDF (`fitz`)** to extract both raw page text and structured Markdown tables from uploaded PDF documents (company policies, brochures, financial reports).

---

### 2. Smart URL Normalization, Deduplication & In-Memory Vector Cache

* **URL Ad-Parameter Normalization & SHA-256 Registry (`registry.py`):**
  * Automatically strips bloated ad-tracking query parameters (`utm_*`, `adgrpid`, `hvadid`, `msclkid`, `gclid`, `fbclid`, `ref`, `tag`, `pf_rd_`, `pd_rd_`) while preserving essential search/product queries (`k`, `q`, `query`, `id`) before hashing.
  * Computes normalized URL hashes and binary PDF content hashes in **SQLite (`registry.db`)** before invoking Playwright or OpenAI—instantly skipping duplicate scrapes or re-uploaded PDF files.

* **In-Memory FAISS Cache & Balanced Retrieval (`vector_service.py`):**
  * Keeps the active FAISS index cached in RAM (`_vectorstore_cache`) for **10x faster chat queries**, syncing to disk (`storage/faiss_index/`) only when sources are added, refreshed, or deleted.
  * **Balanced Multi-Source Retrieval:** Combines global similarity search with per-source top-$k$ boosting and prepended document headers so small PDFs (e.g., 2 chunks) are never drowned out by large websites (e.g., 180+ chunks).

* **Single/Bulk Deletion & One-Click Live Refresh (`🔄`):**
  * Delete a single item via the trash button (`🗑️`) or select multiple items via checkboxes (`Select All` / `Delete Selected`) in **Card 03 (`Your Saved Library`)** to purge vectors from FAISS and metadata from SQLite simultaneously.
  * Click the **Refresh (`🔄`)** button next to any saved website to force a fresh live Playwright re-scrape (`force_refresh: true`), automatically replacing outdated chunks with the latest prices or updates.

---

### 3. Live Browser Monitor & Interactive Mini-Game

* **Real-Time Playwright Telemetry (`/api/ingest/status`):**
  * Streams live base64 JPEG snapshots (`page.screenshot()`), step-by-step progress percentages (`0%` to `100%`), and a glowing **AI Laser Scanner** animation to the right-hand monitor as Playwright scrolls and extracts website content.
  * Automatically resets the monitor view and progress bar whenever a new website scan, PDF upload, refresh, or source deletion begins.

* **Built-In Arcade Mini-Game ("Catch the Data Orbs"):**
  * Includes a toggleable **🎮 Mini-Game** tab right inside the monitor where users can tap floating data orbs and track their high score while waiting for large websites or multi-PDF pages to process.

---

### 4. Fluid UI, Productivity Tools & Multilingual Voice AI

* **Locked Responsive Bento Grid & Smart URL Truncation:**
  * Uses strict CSS Grid containment (`repeat(4, minmax(0, 1fr))`) and a smart UI URL formatter (`formatSourceLabel`) so 500-character e-commerce links display cleanly (e.g., `amazon.in/search: laptop with...`) without stretching cards or breaking the layout.
  * Auto-dismissing status toast notifications (4.5-second auto-hide).

* **Spring-Physics Chatbox with Maximize / Minimize & Persistence:**
  * Smooth `cubic-bezier` transitions when opening/closing from the bottom-right corner icon or toggling between **Corner Mode** and **Centered Maximized Mode (`⤢ Maximize` / `⤡ Minimize`)**.
  * **Chat Persistence (`localStorage`) + Clear Utility (`🧹 Clear`):** Automatically preserves conversation history across browser refreshes (`F5`) with a one-click reset button in the header.

* **One-Click CSV / Excel Table Export (`📥 Download CSV`):**
  * Every Markdown comparison or scheme table rendered by the AI includes a **`📥 Download CSV`** button above the table that exports rows and columns directly into a UTF-8 `.csv` file with BOM support for Microsoft Excel.

* **Deterministic Multilingual Matching, Voice Mic (`🎙️`) & Read-Aloud (`🔊`):**
  * Full support for **Auto-Detect (Match Input), English, Tamil (தமிழ்), Malayalam (മലയാളം), Hindi (हिन्दी), Telugu (తెలుగు), and Kannada (ಕನ್ನಡ)**.
  * **Unicode Script Detector (`llm_service.py`):** Inspects the Unicode character ranges of the user's latest prompt (`\u0B80-\u0BFF` Tamil, `\u0D00-\u0D7F` Malayalam, `\u0900-\u097F` Hindi, `\u0C00-\u0C7F` Telugu, `\u0C80-\u0CBF` Kannada) so English questions always receive English replies even if previous turns or scraped context contain regional scripts.
  * **Two-Way Voice Interaction:** Built-in **Web Speech API Microphone (`🎙️`)** for speech-to-text input and a **Read-Aloud Speaker (`🔊 Listen` / `⏹️ Stop`)** (`window.speechSynthesis`) on every AI answer that automatically selects the matching regional voice (`ta-IN`, `ml-IN`, `hi-IN`, `te-IN`, `kn-IN`, `en-IN`).

---

## 🏗️ System Architecture

```text
+-----------------------------------------------------------------------------------+
|                        REACT FRONTEND (Vite + Glassmorphic UI)                    |
|  [ 01 Add Website ]  [ 02 Upload PDF ]  [ 03 Saved Library (Refresh/Bulk Delete)] |
|  [ Live Playwright Browser Scanner + Laser Animation | 🎮 Catch the Orbs Game ]  |
|  [ Fluid Chatbox (Max/Min, CSV Export, LocalStorage, Mic 🎙️ & Read-Aloud 🔊) ]    |
+-----------------------------------------+-----------------------------------------+
                                          | REST API (Axios)
                                          v
+-----------------------------------------------------------------------------------+
|                              FASTAPI BACKEND SERVER                               |
|                                                                                   |
|  1. URL NORMALIZER & DEDUPLICATION GUARD (SQLite Registry)                        |
|     ├── Strip Ad-Tracking Params -> Normalized URL SHA-256 / PDF Binary SHA-256   |
|     ├── [EXISTS & !FORCE?] ──> Return "Already Saved" immediately (<5ms)          |
|     ├── [FORCE REFRESH?]   ──> Purge Old Vectors -> Re-run Playwright Scraper     |
|     └── [DELETE?]          ──> Purge Vector IDs from FAISS + Delete from SQLite   |
|                                                                                   |
|  2. DUAL INGESTION PIPELINES                                                      |
|     ├── Playwright Scraper: Stealth Chromium + Auto-Scroll + Live Screenshots     |
|     │   + HTML Table & Amazon/Flipkart Extractor + Linked PDF Downloader          |
|     └── PDF Processor: PyMuPDF (fitz) Text + Markdown Table Extractor             |
|                                                                                   |
|  3. IN-MEMORY FAISS CACHE & MULTILINGUAL RAG ENGINE (LangChain + OpenAI)          |
|     ├── Chunking: RecursiveCharacterTextSplitter (Prepends Document Source Header)|
|     ├── Embeddings: OpenAI text-embedding-3-small + RAM-Cached FAISS Index        |
|     ├── Balanced Retrieval: Global Similarity + Per-Source Top-2 Boost            |
|     └── Generation: OpenAI gpt-4o-mini + Deterministic Unicode Script Detector    |
+-----------------------------------------------------------------------------------+
```

---

## 📂 Project Directory Structure

```text
universal-rag-assistant/
├── .vscode/
│   └── settings.json                 # VS Code Pylance interpreter & path configuration
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── routes_chat.py        # /api/chat, /api/sources, & Delete endpoints
│   │   │   └── routes_ingest.py      # /api/ingest/url, /api/ingest/pdf, & /status
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── llm_service.py        # Unicode script detector & multilingual RAG chain
│   │   │   ├── pdf_service.py        # PyMuPDF text & Markdown table extraction
│   │   │   ├── registry.py           # URL cleaner, SQLite SHA-256 deduplication & delete
│   │   │   ├── scraper_service.py    # Playwright scraper, E-commerce & Live snapshots
│   │   │   └── vector_service.py     # In-memory FAISS cache, merge/delete & search
│   │   ├── __init__.py
│   │   ├── config.py                 # Environment & storage path configuration
│   │   └── main.py                   # FastAPI entry point & CORS middleware
│   ├── storage/                      # Auto-generated local FAISS index & SQLite DB
│   │   ├── faiss_index/              # index.faiss & index.pkl (Git-ignored)
│   │   ├── downloads/                # Temporary buffer (Git-ignored)
│   │   └── registry.db               # SQLite deduplication registry (Git-ignored)
│   ├── requirements.txt              # Python dependencies (Python 3.13 compatible)
│   ├── test_phase1_2.py              # CLI verification script for scraper & FAISS
│   └── .env                          # OpenAI API Key (Excluded via .gitignore)
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx                   # Main UI, Live Scanner, CSV Export, Mic & TTS Chat
│   │   ├── index.css                 # Locked Bento Grid, animations & scrollbar styles
│   │   └── main.jsx                  # React DOM entry
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── .gitignore                        # Excludes .env, venv, node_modules, FAISS & DB files
└── README.md                         # Project documentation
```

---

## ⚙️ Prerequisites

* **Operating System:** Windows 10/11, macOS, or Linux
* **Python:** `3.10+` (Fully verified with **Python 3.13.0** pre-built wheels on Windows)
* **Node.js & npm:** `v18+`
* **Browser:** Google Chrome or Microsoft Edge (recommended for Web Speech API voice input & regional TTS voices)
* **OpenAI API Key:** Valid API key with access to `gpt-4o-mini` and `text-embedding-3-small`

---

## 🛠️ Step-by-Step Local Setup (Windows Command Prompt)

### Step 1: Clone the Repository

```cmd
git clone https://github.com/your-username/universal-rag-assistant.git
cd universal-rag-assistant
```

### Step 2: Backend Setup (FastAPI + Playwright + FAISS)

Open your first **Command Prompt (`cmd`)** terminal in VS Code:

```cmd
cd backend
python -m venv venv
venv\Scripts\activate

:: Upgrade pip and install pre-built binary wheels
python -m pip install --upgrade pip wheel setuptools
pip install "numpy>=2.1.0" --only-binary=:all:
pip install -r requirements.txt --only-binary=:all:

:: Install Headless Chromium for Playwright
playwright install chromium
```

Create a **`.env`** file inside the `backend/` folder:

```env
OPENAI_API_KEY=sk-proj-your_actual_openai_api_key_here
```

Start the FastAPI server:

```cmd
python -m uvicorn app.main:app --reload --port 8000
```

* **Health Check:** `http://127.0.0.1:8000`
* **Interactive Swagger UI:** `http://127.0.0.1:8000/docs`

### Step 3: Frontend Setup (React + Vite)

Open a **second Command Prompt (`cmd`)** terminal in VS Code (keep the backend terminal running):

```cmd
cd frontend
npm install
npm run dev
```

* **Frontend Application URL:** `http://localhost:5173`

---

## 🔌 REST API Endpoints Reference

| Method | Endpoint | Payload / Params | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | None | Health check and API status |
| `POST` | `/api/ingest/url` | `{"url": "https://...", "force_refresh": false}` | Normalizes URL, scrapes via Playwright (or refreshes if `force_refresh: true`), and indexes into FAISS |
| `POST` | `/api/ingest/pdf` | `multipart/form-data` (`file`, `force_refresh`) | Extracts text & tables from uploaded PDF and indexes into FAISS |
| `GET` | `/api/ingest/status` | None | Streams real-time Playwright base64 screenshot, step log, and progress % |
| `GET` | `/api/sources` | None | Lists all deduplicated websites and PDFs stored in SQLite & FAISS |
| `POST` | `/api/sources/delete` | `{"source_hashes": ["hash1", "hash2"]}` | Bulk-deletes selected sources from both FAISS and SQLite |
| `DELETE` | `/api/sources/{hash}` | `source_hash` path param | Deletes a single source by hash from both FAISS and SQLite |
| `POST` | `/api/chat` | `{"question": "...", "chat_history": [], "source_hash": "all", "language": "Auto-Detect"}` | Queries RAM-cached FAISS with balanced retrieval and returns language-matched AI answers |

---

## 🧪 Verified Use Cases

1. **Government Scheme Portals (`agritech.tnau.ac.in`):**
   * Scrapes HTML tables and automatically downloads linked policy PDFs to answer questions about agricultural engineering schemes, subsidies, and eligibility criteria, with one-click CSV table downloads.
2. **Corporate Policy Q&A (Multi-PDF):**
   * Upload multiple HR, Leave, Hybrid Work, and Travel Expense policy PDFs and query across all documents simultaneously or filter to a single file.
3. **E-Commerce Product Comparisons (Amazon & Flipkart):**
   * Paste long search result or product URLs (automatically stripped of ad-tracking clutter), refresh prices on demand (`🔄`), and export side-by-side price, rating, and specification comparison tables to Excel/CSV (`📥 Download CSV`).
4. **Two-Way Multilingual Voice & Text Queries:**
   * Ask questions in **English, தமிழ் (Tamil), മലയാളം (Malayalam), हिन्दी (Hindi), తెలుగు (Telugu), or ಕನ್ನಡ (Kannada)** via text or microphone (`🎙️`), receive answers strictly matched to your input language, and listen to responses read aloud (`🔊 Listen`).