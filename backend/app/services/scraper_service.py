import sys
import asyncio
import base64
import json
import time
import requests
import urllib3
from urllib.parse import urljoin, urlparse
from typing import List, Dict, Any, Optional
from bs4 import BeautifulSoup, Tag
from playwright.sync_api import sync_playwright
from langchain_core.documents import Document
from app.services.pdf_service import PDFProcessor

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Global real-time telemetry state polled by the React UI
LIVE_SCRAPE_STATE: Dict[str, Any] = {
    "active": False,
    "mode": "idle",  # "website", "pdf", or "idle"
    "url": "",
    "step": "Idle · Ready to scan",
    "progress": 0,
    "screenshot": None,  # Base64 data:image/jpeg
    "logs": [],
    "updated_at": 0.0,
}


def update_live_state(
    step: str,
    progress: int,
    screenshot_bytes: Optional[bytes] = None,
    active: bool = True,
    url: Optional[str] = None,
    reset_logs: bool = False,
    reset_screenshot: bool = False,
    mode: Optional[str] = None,
) -> None:
    """Updates the live Playwright progress state and base64 screenshot for the UI."""
    if url is not None:
        LIVE_SCRAPE_STATE["url"] = url
    if mode is not None:
        LIVE_SCRAPE_STATE["mode"] = mode
    if reset_logs:
        LIVE_SCRAPE_STATE["logs"] = []
    if reset_screenshot:
        LIVE_SCRAPE_STATE["screenshot"] = None

    LIVE_SCRAPE_STATE["active"] = active
    LIVE_SCRAPE_STATE["step"] = step
    LIVE_SCRAPE_STATE["progress"] = progress
    LIVE_SCRAPE_STATE["updated_at"] = time.time()

    if step and (
        not LIVE_SCRAPE_STATE["logs"] or LIVE_SCRAPE_STATE["logs"][-1] != step
    ):
        LIVE_SCRAPE_STATE["logs"].append(step)
        LIVE_SCRAPE_STATE["logs"] = LIVE_SCRAPE_STATE["logs"][-6:]

    if screenshot_bytes:
        b64_str = base64.b64encode(screenshot_bytes).decode("utf-8")
        LIVE_SCRAPE_STATE["screenshot"] = f"data:image/jpeg;base64,{b64_str}"


def get_live_state() -> Dict[str, Any]:
    return LIVE_SCRAPE_STATE


class PlaywrightUniversalScraper:
    """
    Universal Scraper with Real-Time Screenshot Telemetry:
    1. E-Commerce Sites (Amazon, Flipkart, etc.) -> Product cards, prices, ratings, specs & JSON-LD
    2. Government / Standard Portals -> HTML Tables to Markdown Tables
    3. Page Text / Headings / Bullet Points
    4. Embedded PDF Links -> Downloaded and parsed via PyMuPDF
    5. Background XHR/Fetch JSON API responses
    """

    @staticmethod
    def _html_table_to_markdown(table_tag: Tag, base_url: str, table_idx: int) -> str:
        rows_md: List[str] = []
        all_rows = table_tag.find_all("tr")

        for tr in all_rows:
            if not isinstance(tr, Tag):
                continue
            cells = tr.find_all(["th", "td"])
            if not cells:
                continue

            row_cells: List[str] = []
            for cell in cells:
                if not isinstance(cell, Tag):
                    continue
                links = cell.find_all("a", href=True)
                cell_text = " ".join(cell.stripped_strings)

                if links:
                    link_strs: List[str] = []
                    for a in links:
                        if isinstance(a, Tag):
                            href_val = str(a.get("href") or "").strip()
                            label = " ".join(a.stripped_strings) or "Link"
                            link_strs.append(f"{label} ({urljoin(base_url, href_val)})")
                    if link_strs:
                        cell_text = f"{cell_text} [Links: {'; '.join(link_strs)}]"

                clean_text = cell_text.replace("|", "/").replace("\n", " ").strip()
                row_cells.append(clean_text if clean_text else "-")

            if any(c != "-" for c in row_cells):
                rows_md.append("| " + " | ".join(row_cells) + " |")
                if len(rows_md) == 1:
                    separator = "| " + " | ".join(["---"] * len(row_cells)) + " |"
                    rows_md.append(separator)

        if len(rows_md) <= 2:
            return ""

        return f"### Extracted Table {table_idx}\n" + "\n".join(rows_md)

    @staticmethod
    def _extract_ecommerce_products(soup: BeautifulSoup, base_url: str) -> str:
        domain = urlparse(base_url).netloc.lower()
        extracted_sections: List[str] = []

        if "amazon." in domain:
            prod_title = soup.select_one("#productTitle")
            if prod_title:
                title_txt = " ".join(prod_title.stripped_strings)
                price_el = soup.select_one(
                    ".a-price .a-offscreen, #priceblock_ourprice, .a-price-whole"
                )
                price_txt = (
                    " ".join(price_el.stripped_strings) if price_el else "Check page"
                )
                rating_el = soup.select_one("#acrPopover, .a-icon-alt")
                rating_txt = (
                    " ".join(rating_el.stripped_strings) if rating_el else "N/A"
                )
                bullets_el = soup.select("#feature-bullets li span.a-list-item")
                bullets = "\n".join(
                    [
                        f"- {' '.join(b.stripped_strings)}"
                        for b in bullets_el
                        if " ".join(b.stripped_strings)
                    ]
                )
                extracted_sections.append(
                    f"### Amazon Product Details\n"
                    f"- **Product Name:** {title_txt}\n"
                    f"- **Price:** {price_txt}\n"
                    f"- **Rating:** {rating_txt}\n"
                    f"#### Key Features:\n{bullets}"
                )

            cards = soup.select('div[data-component-type="s-search-result"]')
            if cards:
                rows = [
                    "| # | Product Name | Price | Rating / Reviews |",
                    "| --- | --- | --- | --- |",
                ]
                count = 0
                for card in cards[:30]:
                    title_el = card.select_one("h2")
                    if not title_el:
                        continue
                    name = " ".join(title_el.stripped_strings).replace("|", "/")
                    price_el = card.select_one(".a-price .a-offscreen, .a-price-whole")
                    price = " ".join(price_el.stripped_strings) if price_el else "N/A"
                    rate_el = card.select_one(".a-icon-alt")
                    rating = " ".join(rate_el.stripped_strings) if rate_el else "N/A"
                    count += 1
                    rows.append(f"| {count} | {name} | {price} | {rating} |")
                if count > 0:
                    extracted_sections.append(
                        "### Amazon Products List\n" + "\n".join(rows)
                    )

        if "flipkart." in domain:
            fk_cards = soup.select("div[data-id]")
            if fk_cards:
                rows = [
                    "| # | Product Details & Specs | Price |",
                    "| --- | --- | --- |",
                ]
                count = 0
                for card in fk_cards[:30]:
                    card_texts = [
                        t.strip() for t in card.stripped_strings if len(t.strip()) > 1
                    ]
                    if not card_texts:
                        continue
                    prices = [t for t in card_texts if "₹" in t]
                    price_str = " / ".join(prices[:2]) if prices else "N/A"
                    details_str = " ; ".join(
                        [
                            t
                            for t in card_texts
                            if "₹" not in t
                            and t.lower() not in ("add to compare", "sponsored")
                        ][:6]
                    ).replace("|", "/")
                    if details_str:
                        count += 1
                        rows.append(f"| {count} | {details_str} | {price_str} |")
                if count > 0:
                    extracted_sections.append(
                        "### Flipkart Products List\n" + "\n".join(rows)
                    )

        ld_scripts = soup.find_all("script", type="application/ld+json")
        for idx, script in enumerate(ld_scripts[:5], start=1):
            raw_json = (script.string or "").strip()
            if raw_json and (
                "Product" in raw_json or "Offer" in raw_json or "ItemList" in raw_json
            ):
                extracted_sections.append(
                    f"### Structured Product Schema {idx}\n{raw_json[:5000]}"
                )

        return "\n\n".join(extracted_sections)

    @classmethod
    def scrape_url(
        cls, url: str, source_hash: str, max_pdfs: int = 5
    ) -> List[Document]:
        documents: List[Document] = []
        captured_json: List[Dict[str, Any]] = []
        html_content = ""
        page_title = url
        rendered_inner_text = ""

        update_live_state(
            step="🚀 Launching headless browser...",
            progress=10,
            active=True,
            url=url,
            reset_logs=True,
            reset_screenshot=True,
            mode="website",
        )

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7",
        }

        try:
            if sys.platform == "win32":
                asyncio.set_event_loop_policy(
                    asyncio.WindowsProactorEventLoopPolicy()
                )

            with sync_playwright() as p:
                browser = p.chromium.launch(
                    headless=True,
                    args=[
                        "--disable-blink-features=AutomationControlled",
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                    ],
                )
                context = browser.new_context(
                    user_agent=headers["User-Agent"],
                    locale="en-IN",
                    viewport={"width": 1280, "height": 720},
                    ignore_https_errors=True,
                    extra_http_headers={"Accept-Language": headers["Accept-Language"]},
                )
                context.add_init_script(
                    "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
                )

                page = context.new_page()

                def handle_response(response: Any) -> None:
                    try:
                        ctype = response.headers.get("content-type", "")
                        if "application/json" in ctype and response.status == 200:
                            data = response.json()
                            if data:
                                captured_json.append(
                                    {"api_url": response.url, "data": data}
                                )
                    except Exception:
                        pass

                page.on("response", handle_response)

                update_live_state(
                    step="🌐 Opening website & rendering layout...",
                    progress=25,
                )

                nav_response = None
                try:
                    nav_response = page.goto(
                        url, wait_until="domcontentloaded", timeout=22000
                    )
                except Exception:
                    nav_response = page.goto(
                        url, wait_until="commit", timeout=15000
                    )

                if nav_response and nav_response.status >= 400:
                    browser.close()
                    update_live_state(
                        step=f"⚠️ Website returned HTTP {nav_response.status} (Blocked or Not Found).",
                        progress=0,
                        active=False,
                        reset_screenshot=True,
                        mode="error",
                    )
                    return []

                page.wait_for_timeout(1500)

                # Snapshot 1: Initial Viewport
                try:
                    snap1 = page.screenshot(type="jpeg", quality=55, timeout=5000)
                    update_live_state(
                        step="📸 Captured live page view! Scanning content...",
                        progress=45,
                        screenshot_bytes=snap1,
                    )
                except Exception:
                    pass

                # Scroll 1 & 2: Trigger lazy-loaded document pages (like Scribd / Flipkart)
                try:
                    page.evaluate("window.scrollBy(0, 900)")
                    page.wait_for_timeout(800)
                    snap2 = page.screenshot(type="jpeg", quality=55, timeout=5000)
                    update_live_state(
                        step="🔍 Scrolling document to capture pages & tables...",
                        progress=62,
                        screenshot_bytes=snap2,
                    )
                    page.evaluate("window.scrollBy(0, 1200)")
                    page.wait_for_timeout(800)
                except Exception:
                    pass

                # Grab visible rendered text directly from Chromium DOM (crucial for Scribd/SPAs!)
                try:
                    rendered_inner_text = page.evaluate(
                        "() => document.body ? document.body.innerText : ''"
                    )
                except Exception:
                    rendered_inner_text = ""

                # Return to top for clean final preview
                try:
                    page.evaluate("window.scrollTo(0, 0)")
                    page.wait_for_timeout(300)
                    snap_top = page.screenshot(type="jpeg", quality=60, timeout=5000)
                    update_live_state(
                        step="📊 Extracting structured text, tables & links...",
                        progress=78,
                        screenshot_bytes=snap_top,
                    )
                except Exception:
                    pass

                page_title = page.title() or url
                html_content = page.content()
                browser.close()

        except Exception as pw_err:
            print(f"[Playwright Info] Using direct HTTP fallback for {url}: {pw_err}")
            update_live_state(
                step="⚡ Using fast direct reader for website...",
                progress=55,
            )
            try:
                resp = requests.get(url, headers=headers, timeout=15, verify=False)
                if resp.status_code >= 400:
                    update_live_state(
                        step=f"⚠️ Website blocked automated access (HTTP {resp.status_code}).",
                        progress=0,
                        active=False,
                        reset_screenshot=True,
                        mode="error",
                    )
                    return []
                html_content = resp.text
            except Exception as req_err:
                print(f"[HTTP Fallback Error] {req_err}")
                update_live_state(
                    step="❌ Website unreachable or blocked automated access.",
                    progress=0,
                    active=False,
                    reset_screenshot=True,
                    mode="error",
                )
                return []

        if not html_content.strip() and not rendered_inner_text.strip():
            update_live_state(
                step="❌ Website returned an empty response.",
                progress=0,
                active=False,
                reset_screenshot=True,
                mode="error",
            )
            return []

        soup = BeautifulSoup(html_content, "lxml")
        if soup.title and soup.title.string:
            page_title = soup.title.string.strip()

        pdf_urls: List[str] = []
        for a_tag in soup.find_all("a", href=True):
            if isinstance(a_tag, Tag):
                raw_href = str(a_tag.get("href") or "").strip()
                full_href = urljoin(url, raw_href)
                if full_href.lower().endswith(".pdf") and full_href not in pdf_urls:
                    pdf_urls.append(full_href)

        ecom_markdown = cls._extract_ecommerce_products(soup, url)
        if ecom_markdown:
            documents.append(
                Document(
                    page_content=f"Source Page: {page_title} ({url})\n{ecom_markdown}",
                    metadata={
                        "source": url,
                        "title": page_title,
                        "source_hash": source_hash,
                        "source_type": "ecommerce_products",
                    },
                )
            )

        # Extract meta descriptions & JSON-LD (captures Scribd document summaries & titles)
        meta_lines: List[str] = []
        for meta in soup.find_all("meta"):
            if isinstance(meta, Tag):
                m_name = str(meta.get("name") or meta.get("property") or "").lower()
                m_content = str(meta.get("content") or "").strip()
                if m_name in ("description", "og:title", "og:description", "twitter:description") and len(m_content) > 10:
                    meta_lines.append(f"- {m_name}: {m_content}")

        for tag in soup(["script", "style", "noscript", "svg", "footer", "nav"]):
            tag.decompose()

        tables = soup.find_all("table")
        for idx, table in enumerate(tables, start=1):
            if isinstance(table, Tag):
                md_table = cls._html_table_to_markdown(table, url, idx)
                if md_table:
                    documents.append(
                        Document(
                            page_content=f"Source Page: {page_title} ({url})\n{md_table}",
                            metadata={
                                "source": url,
                                "title": page_title,
                                "source_hash": source_hash,
                                "source_type": "web_table",
                            },
                        )
                    )
                table.decompose()

        body_lines: List[str] = list(meta_lines)
        seen_lines = set(meta_lines)

        # Combine BeautifulSoup HTML elements + Playwright's rendered innerText (for Scribd/Canvas/SPAs)
        for element in soup.find_all(["h1", "h2", "h3", "h4", "p", "li", "span", "div"]):
            if isinstance(element, Tag):
                text = " ".join(element.stripped_strings)
                if (15 < len(text) < 1200 or "₹" in text) and text not in seen_lines:
                    seen_lines.add(text)
                    body_lines.append(text)

        if rendered_inner_text:
            for raw_line in rendered_inner_text.splitlines():
                clean_line = raw_line.strip()
                if len(clean_line) > 15 and clean_line not in seen_lines:
                    seen_lines.add(clean_line)
                    body_lines.append(clean_line)

        if body_lines:
            clean_body_text = (
                f"### Webpage Content: {page_title} ({url})\n"
                + "\n".join(body_lines[:500])
            )
            documents.append(
                Document(
                    page_content=clean_body_text,
                    metadata={
                        "source": url,
                        "title": page_title,
                        "source_hash": source_hash,
                        "source_type": "web_text",
                    },
                )
            )

        for j_idx, item in enumerate(captured_json[:5], start=1):
            json_str = json.dumps(item["data"], ensure_ascii=False, indent=2)
            documents.append(
                Document(
                    page_content=(
                        f"### Background JSON API Data {j_idx} from {item['api_url']}\n"
                        f"{json_str[:8000]}"
                    ),
                    metadata={
                        "source": url,
                        "title": page_title,
                        "source_hash": source_hash,
                        "source_type": "web_json",
                    },
                )
            )

        if pdf_urls:
            update_live_state(
                step=f"📄 Found {min(len(pdf_urls), max_pdfs)} linked PDF(s) on page. Reading documents...",
                progress=85,
            )
        for pdf_url in pdf_urls[:max_pdfs]:
            try:
                resp = requests.get(
                    pdf_url, headers=headers, timeout=15, verify=False
                )
                if resp.status_code == 200 and b"%PDF" in resp.content[:1024]:
                    pdf_docs = PDFProcessor.extract_documents_from_bytes(
                        pdf_bytes=resp.content,
                        source_name=f"{url} -> {pdf_url.split('/')[-1]}",
                        source_hash=source_hash,
                    )
                    documents.extend(pdf_docs)
            except Exception as e:
                print(f"[Warning] Skipping linked PDF {pdf_url}: {e}")

        if not documents:
            update_live_state(
                step="⚠️ No readable text found on this page.",
                progress=0,
                active=False,
                reset_screenshot=True,
                mode="error",
            )
            return []

        update_live_state(
            step="🧠 Saving extracted knowledge to your library...",
            progress=94,
        )
        return documents
    