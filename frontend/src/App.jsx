import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API_BASE = "http://127.0.0.1:8000/api";
const CHAT_STORAGE_KEY = "smart_knowledge_hub_chat_v1";

// Clearer Language Selector: "Auto-Detect" matches your input language automatically!
const SUPPORTED_LANGUAGES = [
  {
    value: "Auto-Detect",
    label: "🌐 Auto (Match Input)",
    speechCode: "en-IN",
  },
  { value: "English", label: "🇬🇧 Reply in English", speechCode: "en-IN" },
  {
    value: "Tamil (தமிழ்)",
    label: "🇮🇳 Reply in தமிழ்",
    speechCode: "ta-IN",
  },
  {
    value: "Malayalam (മലയാളം)",
    label: "🇮🇳 Reply in മലയാളം",
    speechCode: "ml-IN",
  },
  {
    value: "Hindi (हिन्दी)",
    label: "🇮🇳 Reply in हिन्दी",
    speechCode: "hi-IN",
  },
  {
    value: "Telugu (తెలుగు)",
    label: "🇮🇳 Reply in తెలుగు",
    speechCode: "te-IN",
  },
  {
    value: "Kannada (ಕನ್ನಡ)",
    label: "🇮🇳 Reply in ಕನ್ನಡ",
    speechCode: "kn-IN",
  },
];

const INITIAL_WELCOME_MSG = {
  role: "assistant",
  content:
    "Hi there! 👋 I'm your **Smart AI Assistant**. Add any website link or upload multiple PDF documents, then type or **click the microphone 🎙️** to ask in **English, Tamil, Malayalam, Hindi, Telugu, or Kannada**!",
  citations: [],
};

// Cleans long e-commerce tracking URLs into readable labels (max ~28 chars) so Card 03 never stretches
function formatSourceLabel(rawName) {
  if (!rawName) return "Saved Item";
  if (!rawName.startsWith("http")) {
    return rawName.length > 28 ? rawName.slice(0, 25) + "..." : rawName;
  }
  try {
    const parsed = new URL(rawName);
    const host = parsed.hostname.replace(/^www\./, "");
    const searchQ =
      parsed.searchParams.get("k") ||
      parsed.searchParams.get("q") ||
      parsed.searchParams.get("query");

    if (searchQ) {
      const cleanQ = searchQ.slice(0, 14);
      return `${host}/search: ${cleanQ}${searchQ.length > 14 ? "..." : ""}`;
    }

    const cleanPath = parsed.pathname.replace(/\/$/, "");
    const combined = `${host}${cleanPath}`;
    return combined.length > 28 ? combined.slice(0, 25) + "..." : combined;
  } catch {
    const stripped = rawName.replace(/^https?:\/\/(www\.)?/, "");
    return stripped.length > 28 ? stripped.slice(0, 25) + "..." : stripped;
  }
}

// Custom Table Renderer with One-Click "Download CSV" Button
function ExportableTable({ children }) {
  const tableRef = useRef(null);

  const handleDownloadCsv = () => {
    if (!tableRef.current) return;
    const rows = Array.from(tableRef.current.querySelectorAll("tr"));
    const csvLines = rows.map((row) => {
      const cells = Array.from(row.querySelectorAll("th, td"));
      return cells
        .map((cell) => {
          const text = (cell.innerText || "").replace(/"/g, '""').trim();
          return `"${text}"`;
        })
        .join(",");
    });

    const csvContent = "\uFEFF" + csvLines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `knowledge_table_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ margin: "12px 0 8px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: "4px",
        }}
      >
        <button
          type="button"
          onClick={handleDownloadCsv}
          style={{
            background: "rgba(94, 234, 212, 0.14)",
            border: "1px solid rgba(94, 234, 212, 0.4)",
            color: "#5eead4",
            borderRadius: "6px",
            padding: "3px 9px",
            fontSize: "0.7rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
          title="Download this table as an Excel-compatible CSV file"
        >
          📥 Download CSV
        </button>
      </div>
      <div className="table-scroll-wrapper" style={{ marginTop: 0 }}>
        <table ref={tableRef}>{children}</table>
      </div>
    </div>
  );
}

export default function App() {
  const [urlInput, setUrlInput] = useState("");
  // Multi-PDF batch state
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [pdfBatchStatus, setPdfBatchStatus] = useState("");
  const fileInputRef = useRef(null);

  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestStatus, setIngestStatus] = useState(null);

  // Saved Knowledge Library & Multi-Delete Selection States
  const [sources, setSources] = useState([]);
  const [selectedSourceHash, setSelectedSourceHash] = useState("all");
  const [checkedHashes, setCheckedHashes] = useState([]);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Right Stage Mode: "scanner" (Live Playwright View) or "game" (Mini-Game)
  const [stageTab, setStageTab] = useState("scanner");
  const [liveState, setLiveState] = useState({
    active: false,
    mode: "idle",
    url: "",
    step: "Idle · Ready to scan",
    progress: 0,
    screenshot: null,
    logs: [],
  });

  // Mini-Game ("Catch the Data Orbs") States
  const [gameScore, setGameScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [orbPos, setOrbPos] = useState({ top: 45, left: 45, color: "#5eead4" });
  const [orbCombo, setOrbCombo] = useState("");

  // Fluid Chat open + Maximize/Minimize + Indian Language + Voice Mic + TTS States
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("Auto-Detect");
  const [isListening, setIsListening] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState(null);
  const recognitionRef = useRef(null);

  // Load persisted chat history from localStorage
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback to default welcome message
    }
    return [INITIAL_WELCOME_MSG];
  });

  const [question, setQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Ignore storage quota errors
    }
  }, [messages]);

  // Auto-remove notification popup after 4.5 seconds
  useEffect(() => {
    if (!ingestStatus) return;
    const timer = setTimeout(() => {
      setIngestStatus(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [ingestStatus]);

  // Clean up speech recognition & synthesis on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Text-to-Speech (Read Aloud) Handler
  const handleSpeakMessage = (text, idx) => {
    if (!("speechSynthesis" in window)) {
      alert("Text-to-speech is not supported in this browser.");
      return;
    }

    if (speakingIdx === idx) {
      window.speechSynthesis.cancel();
      setSpeakingIdx(null);
      return;
    }

    window.speechSynthesis.cancel();
    const cleanText = text
      .replace(/[#*|>`_~-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);

    if (/[\u0B80-\u0BFF]/.test(cleanText)) utterance.lang = "ta-IN";
    else if (/[\u0D00-\u0D7F]/.test(cleanText)) utterance.lang = "ml-IN";
    else if (/[\u0900-\u097F]/.test(cleanText)) utterance.lang = "hi-IN";
    else if (/[\u0C00-\u0C7F]/.test(cleanText)) utterance.lang = "te-IN";
    else if (/[\u0C80-\u0CBF]/.test(cleanText)) utterance.lang = "kn-IN";
    else utterance.lang = "en-IN";

    utterance.onend = () => setSpeakingIdx(null);
    utterance.onerror = () => setSpeakingIdx(null);

    setSpeakingIdx(idx);
    window.speechSynthesis.speak(utterance);
  };

  // Clear Chat History Handler
  const handleClearChat = () => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setSpeakingIdx(null);
    }
    setMessages([INITIAL_WELCOME_MSG]);
    localStorage.removeItem(CHAT_STORAGE_KEY);
  };

  // Voice Input Toggle Handler (Web Speech API)
  const handleToggleMic = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert(
        "Voice recognition is supported in Google Chrome and Microsoft Edge. Please use Chrome or Edge to use the microphone."
      );
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const langObj =
      SUPPORTED_LANGUAGES.find((l) => l.value === selectedLanguage) ||
      SUPPORTED_LANGUAGES[0];

    const recognition = new SpeechRecognition();
    recognition.lang = langObj.speechCode;
    recognition.interimResults = true;
    recognition.continuous = false;

    const baseQuestion = question ? question.trim() + " " : "";

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setQuestion(baseQuestion + transcript);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const resetLiveMonitor = (
    initialStep = "Starting operation...",
    mode = "idle",
    targetName = ""
  ) => {
    setLiveState({
      active: true,
      mode,
      url: targetName,
      step: initialStep,
      progress: 8,
      screenshot: null,
      logs: [initialStep],
    });
  };

  const fetchSources = async () => {
    try {
      const res = await axios.get(`${API_BASE}/sources`);
      const fetched = res.data.sources || [];
      setSources(fetched);
      const validSet = new Set(fetched.map((s) => s.source_hash));
      setCheckedHashes((prev) => prev.filter((h) => validSet.has(h)));
      if (selectedSourceHash !== "all" && !validSet.has(selectedSourceHash)) {
        setSelectedSourceHash("all");
      }
    } catch (err) {
      console.error("Error loading saved items:", err);
    }
  };

  const fetchLiveStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/ingest/status`);
      if (res.data) {
        setLiveState(res.data);
      }
    } catch {
      // Ignore transient poll errors
    }
  };

  useEffect(() => {
    fetchSources();
    fetchLiveStatus();
  }, []);

  useEffect(() => {
    if (!ingestLoading) return;
    const timer = setInterval(fetchLiveStatus, 650);
    return () => clearInterval(timer);
  }, [ingestLoading]);

  useEffect(() => {
    if (stageTab !== "game") return;
    const colors = ["#5eead4", "#818cf8", "#c084fc", "#f472b6", "#38bdf8"];
    const interval = setInterval(() => {
      setOrbPos({
        top: Math.floor(Math.random() * 68) + 12,
        left: Math.floor(Math.random() * 74) + 10,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }, 1350);
    return () => clearInterval(interval);
  }, [stageTab]);

  const handleCatchOrb = () => {
    const colors = ["#5eead4", "#818cf8", "#c084fc", "#f472b6", "#38bdf8"];
    const phrases = ["+10⚡", "Nice!", "Fast!", "Data Caught!", "Super!"];
    setGameScore((prev) => {
      const next = prev + 10;
      if (next > highScore) setHighScore(next);
      return next;
    });
    setOrbCombo(phrases[Math.floor(Math.random() * phrases.length)]);
    setOrbPos({
      top: Math.floor(Math.random() * 68) + 12,
      left: Math.floor(Math.random() * 74) + 10,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  };

  useEffect(() => {
    if (isChatOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, chatLoading, isChatOpen, isMaximized]);

  // Step 1A: Add Website Link (With 40s Timeout & Clean Error Recovery)
  const handleUrlScrape = async (e) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    const targetUrl = urlInput.trim();
    setIngestLoading(true);
    setIngestStatus(null);
    setStageTab("scanner");
    resetLiveMonitor(
      "🚀 Launching live browser scanner...",
      "website",
      targetUrl
    );

    try {
      const res = await axios.post(
        `${API_BASE}/ingest/url`,
        {
          url: targetUrl,
          force_refresh: false,
        },
        { timeout: 40000 }
      );

      const isCached = res.data.status === "cached";
      setIngestStatus({
        type: res.data.status,
        message: isCached
          ? "This website is already in your library and ready for chat!"
          : "Website content saved successfully! You can now ask questions about it.",
      });
      setUrlInput("");
      await fetchSources();
      await fetchLiveStatus();
    } catch (err) {
      const errMsg =
        err.code === "ECONNABORTED"
          ? "This website took too long to respond (protected or login-only page). Try downloading the PDF and uploading it in Card 02!"
          : err.response?.data?.detail ||
            "Could not read this website (it may require a login or block automated readers).";

      setIngestStatus({
        type: "error",
        message: errMsg,
      });

      setLiveState({
        active: false,
        mode: "error",
        url: targetUrl,
        step: "⚠️ Scan stopped · Website blocked automated access",
        progress: 0,
        screenshot: null,
        logs: [errMsg],
      });
    } finally {
      setIngestLoading(false);
    }
  };

  // Force Re-Scrape (Refresh) an existing website in Card 03
  const handleRefreshWebsite = async (url, e) => {
    e.stopPropagation();
    if (ingestLoading || deleteLoading) return;

    setIngestLoading(true);
    setIngestStatus(null);
    setStageTab("scanner");
    resetLiveMonitor("🔄 Refreshing website live data...", "website", url);

    try {
      await axios.post(
        `${API_BASE}/ingest/url`,
        {
          url,
          force_refresh: true,
        },
        { timeout: 40000 }
      );
      setIngestStatus({
        type: "indexed",
        message: `Refreshed latest content from '${formatSourceLabel(url)}'!`,
      });
      await fetchSources();
      await fetchLiveStatus();
    } catch (err) {
      const errMsg =
        err.response?.data?.detail || "Could not refresh this website.";
      setIngestStatus({
        type: "error",
        message: errMsg,
      });
      setLiveState({
        active: false,
        mode: "error",
        url,
        step: "⚠️ Could not refresh website",
        progress: 0,
        screenshot: null,
        logs: [errMsg],
      });
    } finally {
      setIngestLoading(false);
    }
  };

  // Step 1B: Multi-PDF Batch Upload Handler
  const handlePdfUpload = async (e) => {
    e.preventDefault();
    if (!selectedFiles.length) return;

    const total = selectedFiles.length;
    setIngestLoading(true);
    setIngestStatus(null);
    setStageTab("scanner");

    let indexedCount = 0;
    let cachedCount = 0;
    let failedFiles = [];

    for (let i = 0; i < total; i++) {
      const file = selectedFiles[i];
      const stepLabel =
        total > 1
          ? `📄 Reading PDF (${i + 1} of ${total}): '${file.name}'...`
          : `📄 Reading PDF '${file.name}'...`;

      setPdfBatchStatus(
        total > 1 ? `Uploading ${i + 1}/${total}...` : "Reading PDF..."
      );
      resetLiveMonitor(stepLabel, "pdf", file.name);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("force_refresh", "false");

      try {
        const res = await axios.post(`${API_BASE}/ingest/pdf`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });

        if (res.data.status === "cached") {
          cachedCount += 1;
        } else {
          indexedCount += 1;
        }
      } catch {
        failedFiles.push(file.name);
      }
    }

    // Clear selection & file input
    setSelectedFiles([]);
    setPdfBatchStatus("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    await fetchSources();
    await fetchLiveStatus();

    // Build summary toast message for single or multiple PDFs
    if (failedFiles.length === total) {
      setIngestStatus({
        type: "error",
        message: `Could not process ${
          total === 1 ? `'${failedFiles[0]}'` : `the selected PDF files`
        }. Please check that they contain readable text.`,
      });
      setLiveState({
        active: false,
        mode: "error",
        url: failedFiles[0],
        step: "⚠️ Could not read PDF content",
        progress: 0,
        screenshot: null,
        logs: [],
      });
    } else if (total === 1) {
      setIngestStatus({
        type: cachedCount === 1 ? "cached" : "indexed",
        message:
          cachedCount === 1
            ? `The file '${selectedFiles[0].name}' is already saved in your library!`
            : `PDF '${selectedFiles[0].name}' uploaded and ready for your questions!`,
      });
    } else {
      const parts = [];
      if (indexedCount > 0) parts.push(`${indexedCount} new PDF(s) saved`);
      if (cachedCount > 0) parts.push(`${cachedCount} already in library`);
      if (failedFiles.length > 0) parts.push(`${failedFiles.length} skipped`);

      setIngestStatus({
        type: indexedCount > 0 ? "indexed" : "cached",
        message: `Batch complete (${total} files): ${parts.join(", ")}!`,
      });
    }

    setIngestLoading(false);
  };

  const toggleCheckbox = (hash, e) => {
    e.stopPropagation();
    setCheckedHashes((prev) =>
      prev.includes(hash) ? prev.filter((h) => h !== hash) : [...prev, hash]
    );
  };

  const handleSelectAll = () => {
    if (checkedHashes.length === sources.length) {
      setCheckedHashes([]);
    } else {
      setCheckedHashes(sources.map((s) => s.source_hash));
    }
  };

  const handleDeleteSingle = async (hash, name, e) => {
    e.stopPropagation();
    if (deleteLoading) return;

    setDeleteLoading(true);
    setIngestStatus(null);
    try {
      const res = await axios.post(`${API_BASE}/sources/delete`, {
        source_hashes: [hash],
      });
      setIngestStatus({
        type: "indexed",
        message: res.data.message || `Removed '${name}' from your library.`,
      });
      await fetchSources();
      await fetchLiveStatus();
    } catch (err) {
      setIngestStatus({
        type: "error",
        message:
          err.response?.data?.detail || "Could not delete the selected item.",
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (!checkedHashes.length || deleteLoading) return;

    setDeleteLoading(true);
    setIngestStatus(null);
    try {
      const res = await axios.post(`${API_BASE}/sources/delete`, {
        source_hashes: checkedHashes,
      });
      setIngestStatus({
        type: "indexed",
        message:
          res.data.message ||
          `Removed ${checkedHashes.length} item(s) from your library.`,
      });
      setCheckedHashes([]);
      await fetchSources();
      await fetchLiveStatus();
    } catch (err) {
      setIngestStatus({
        type: "error",
        message:
          err.response?.data?.detail || "Could not delete selected items.",
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!question.trim() || chatLoading) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    const userQ = question.trim();
    setMessages((prev) => [...prev, { role: "user", content: userQ }]);
    setQuestion("");
    setChatLoading(true);

    try {
      const res = await axios.post(`${API_BASE}/chat`, {
        question: userQ,
        chat_history: messages.slice(-6).map((m) => ({
          role: m.role,
          content: m.content,
        })),
        source_hash: selectedSourceHash,
        language: selectedLanguage,
      });

      const cleanAnswer = (res.data.answer || "").replace(
        /<br\s*\/?>/gi,
        " • "
      );

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: cleanAnswer,
          citations: res.data.citations || [],
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "⚠️ Unable to connect to the assistant right now. Please make sure the server is running.",
          citations: [],
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const activeScopeLabel =
    selectedSourceHash === "all"
      ? "Everything"
      : formatSourceLabel(
          sources.find((s) => s.source_hash === selectedSourceHash)?.source_name
        );

  const websiteCount = sources.filter(
    (s) => s.source_type === "website"
  ).length;
  const pdfCount = sources.filter((s) => s.source_type === "pdf").length;

  const currentLangObj =
    SUPPORTED_LANGUAGES.find((l) => l.value === selectedLanguage) ||
    SUPPORTED_LANGUAGES[0];

  const basePopupStyle = {
    position: "fixed",
    borderRadius: "28px",
    background:
      "radial-gradient(circle at 18% 18%, rgba(45, 212, 191, 0.22) 0%, transparent 48%), radial-gradient(circle at 88% 35%, rgba(168, 85, 247, 0.25) 0%, transparent 52%), linear-gradient(160deg, #16222a 0%, #1d192b 52%, #13111c 100%)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    zIndex: 1001,
    overflow: "hidden",
    transition:
      "all 0.38s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.26s ease, transform 0.38s cubic-bezier(0.22, 1, 0.36, 1)",
  };

  const dynamicChatStyle = !isChatOpen
    ? {
        ...basePopupStyle,
        top: "calc(100vh - 90px)",
        left: "calc(100vw - 90px)",
        width: "420px",
        height: "620px",
        padding: "20px",
        opacity: 0,
        pointerEvents: "none",
        transform: "translate(-100%, -100%) scale(0.15)",
        transformOrigin: "bottom right",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        boxShadow: "none",
      }
    : isMaximized
    ? {
        ...basePopupStyle,
        top: "50%",
        left: "50%",
        width: "min(920px, 92vw)",
        height: "min(760px, 84vh)",
        padding: "24px",
        opacity: 1,
        pointerEvents: "auto",
        transform: "translate(-50%, -50%) scale(1)",
        transformOrigin: "center center",
        border: "1px solid rgba(94, 234, 212, 0.38)",
        boxShadow: "0 30px 90px rgba(0, 0, 0, 0.85)",
      }
    : {
        ...basePopupStyle,
        top: "calc(100vh - 104px)",
        left: "calc(100vw - 32px)",
        width: "445px",
        height: "min(650px, calc(100vh - 130px))",
        padding: "20px",
        opacity: 1,
        pointerEvents: "auto",
        transform: "translate(-100%, -100%) scale(1)",
        transformOrigin: "bottom right",
        border: "1px solid rgba(255, 255, 255, 0.16)",
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.65)",
      };

  const headerBtnStyle = {
    background: "rgba(94, 234, 212, 0.14)",
    border: "1px solid rgba(94, 234, 212, 0.45)",
    color: "#5eead4",
    padding: "5px 10px",
    borderRadius: "999px",
    cursor: "pointer",
    fontSize: "0.73rem",
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    transition: "all 0.2s ease",
  };

  const langSelectStyle = {
    background: "rgba(15, 23, 42, 0.85)",
    border: "1px solid rgba(192, 132, 252, 0.45)",
    color: "#e9d5ff",
    padding: "5px 9px",
    borderRadius: "999px",
    fontSize: "0.72rem",
    fontWeight: 600,
    outline: "none",
    cursor: "pointer",
  };

  const closeBtnStyle = {
    background: "rgba(255, 255, 255, 0.08)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    color: "#f8fafc",
    width: "30px",
    height: "30px",
    borderRadius: "50%",
    cursor: "pointer",
    fontSize: "0.85rem",
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  // Label shown inside Card 02's dashed file selector
  const filePickerLabel =
    selectedFiles.length === 0
      ? "Click here to choose .PDF file(s)"
      : selectedFiles.length === 1
      ? `📄 ${selectedFiles[0].name}`
      : `📚 ${selectedFiles.length} PDF files selected`;

  return (
    <div className="page-wrapper">
      {/* 1. CLEAN HEADER */}
      <header className="top-nav">
        <div className="brand-box">
          <div className="orb-logo" />
          <span className="brand-name">Smart Knowledge Hub</span>
        </div>
      </header>

      {/* 2. HERO SECTION WITH INTERACTIVE RIGHT STAGE */}
      <section className="hero-section">
        <div className="hero-left">
          <div className="tech-pill">AI Website & Document Assistant</div>

          <h1 className="hero-title">
            Ask anything about
            <br />
            your <span className="gradient-text">websites and</span>
            <br />
            <span className="gradient-text">PDFs</span>
          </h1>

          <p className="hero-desc">
            Add any website link or upload multiple PDF files in seconds. Type
            or speak your questions in English or Indian regional languages and
            get instant, accurate answers from your saved content.
          </p>

          <div className="hero-actions">
            <button
              className="btn-gradient-pill"
              onClick={() => setIsChatOpen(true)}
            >
              Chat with AI Now
            </button>
          </div>
        </div>

        {/* RIGHT INTERACTIVE STAGE: LIVE PLAYWRIGHT SCANNER + MINI-GAME */}
        <div
          style={{
            background: "rgba(17, 24, 39, 0.72)",
            backdropFilter: "blur(18px)",
            border: "1px solid rgba(94, 234, 212, 0.28)",
            borderRadius: "24px",
            padding: "16px",
            boxShadow: "0 20px 55px rgba(0, 0, 0, 0.55)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            minHeight: "340px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
              paddingBottom: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#ef4444",
                }}
              />
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#f59e0b",
                }}
              />
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#10b981",
                }}
              />
              <span
                style={{
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  color: "#cbd5e1",
                  marginLeft: "6px",
                }}
              >
                {ingestLoading ? "🔴 LIVE SCANNER ACTIVE" : "🟢 Live Monitor"}
              </span>
            </div>

            <div style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                onClick={() => setStageTab("scanner")}
                style={{
                  padding: "5px 12px",
                  borderRadius: "999px",
                  fontSize: "0.74rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  border:
                    stageTab === "scanner"
                      ? "1px solid #5eead4"
                      : "1px solid rgba(255,255,255,0.12)",
                  background:
                    stageTab === "scanner"
                      ? "rgba(94, 234, 212, 0.2)"
                      : "rgba(255,255,255,0.04)",
                  color: stageTab === "scanner" ? "#5eead4" : "#94a3b8",
                }}
              >
                🖥️ Live Scanner
              </button>
              <button
                type="button"
                onClick={() => setStageTab("game")}
                style={{
                  padding: "5px 12px",
                  borderRadius: "999px",
                  fontSize: "0.74rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  border:
                    stageTab === "game"
                      ? "1px solid #c084fc"
                      : "1px solid rgba(255,255,255,0.12)",
                  background:
                    stageTab === "game"
                      ? "rgba(192, 132, 252, 0.22)"
                      : "rgba(255,255,255,0.04)",
                  color: stageTab === "game" ? "#e9d5ff" : "#94a3b8",
                }}
              >
                🎮 Mini-Game
              </button>
            </div>
          </div>

          {stageTab === "scanner" ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                flex: 1,
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  position: "relative",
                  height: "185px",
                  borderRadius: "14px",
                  overflow: "hidden",
                  background: "rgba(11, 15, 25, 0.85)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {ingestLoading && <div className="laser-scan-bar" />}

                {liveState.screenshot ? (
                  <img
                    src={liveState.screenshot}
                    alt="Live Playwright Browser Preview"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      objectPosition: "top",
                      opacity: ingestLoading ? 0.88 : 0.95,
                    }}
                  />
                ) : liveState.mode === "pdf" && liveState.url ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "20px",
                      color: "#e2e8f0",
                      fontSize: "0.84rem",
                    }}
                  >
                    <div style={{ fontSize: "2.2rem", marginBottom: "8px" }}>
                      📄
                    </div>
                    <div style={{ fontWeight: 700, color: "#5eead4" }}>
                      {liveState.url}
                    </div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "#94a3b8",
                        marginTop: "4px",
                      }}
                    >
                      {liveState.step}
                    </div>
                  </div>
                ) : liveState.mode === "error" ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "20px",
                      color: "#fecaca",
                      fontSize: "0.82rem",
                    }}
                  >
                    <div style={{ fontSize: "2rem", marginBottom: "6px" }}>
                      ⚠️
                    </div>
                    <div style={{ fontWeight: 700, color: "#fca5a5" }}>
                      Could Not Scan Website
                    </div>
                    <div
                      style={{
                        fontSize: "0.74rem",
                        color: "#cbd5e1",
                        marginTop: "4px",
                      }}
                    >
                      This page blocks automated browsers or requires a login
                      (like Scribd). If it is a document, download the PDF and
                      upload it in <strong>Card 02</strong>!
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "20px",
                      color: "#94a3b8",
                      fontSize: "0.82rem",
                    }}
                  >
                    <div style={{ fontSize: "1.8rem", marginBottom: "6px" }}>
                      🌐
                    </div>
                    <div>
                      Paste any website link in <strong>Card 01</strong> or
                      upload PDFs in <strong>Card 02</strong> to watch the live
                      progress here!
                    </div>
                  </div>
                )}

                {liveState.url && liveState.screenshot && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: "8px",
                      left: "8px",
                      right: "8px",
                      background: "rgba(15, 23, 42, 0.86)",
                      backdropFilter: "blur(8px)",
                      padding: "5px 10px",
                      borderRadius: "8px",
                      fontSize: "0.72rem",
                      color: "#5eead4",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      border: "1px solid rgba(94, 234, 212, 0.3)",
                    }}
                  >
                    {liveState.step}
                  </div>
                )}
              </div>

              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.73rem",
                    color: "#cbd5e1",
                    marginBottom: "5px",
                  }}
                >
                  <span
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "82%",
                    }}
                  >
                    {ingestLoading
                      ? liveState.step || "Processing..."
                      : liveState.progress === 100
                      ? liveState.step
                      : "Monitor Ready"}
                  </span>
                  <span style={{ color: "#5eead4", fontWeight: 700 }}>
                    {ingestLoading
                      ? `${liveState.progress || 10}%`
                      : `${liveState.progress || 0}%`}
                  </span>
                </div>
                <div
                  style={{
                    height: "7px",
                    width: "100%",
                    background: "rgba(255,255,255,0.08)",
                    borderRadius: "999px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${
                        ingestLoading
                          ? Math.max(liveState.progress, 10)
                          : liveState.progress || 0
                      }%`,
                      background:
                        "linear-gradient(90deg, #5eead4 0%, #818cf8 55%, #c084fc 100%)",
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "8px",
                }}
              >
                <div
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "10px",
                    padding: "8px 10px",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: "1rem",
                      fontWeight: 800,
                      color: "#5eead4",
                    }}
                  >
                    {websiteCount}
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>
                    Websites
                  </div>
                </div>

                <div
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "10px",
                    padding: "8px 10px",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: "1rem",
                      fontWeight: 800,
                      color: "#818cf8",
                    }}
                  >
                    {pdfCount}
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>
                    PDF Files
                  </div>
                </div>

                <div
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "10px",
                    padding: "8px 10px",
                    textAlign: "center",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.76rem",
                      fontWeight: 700,
                      color: "#c084fc",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {activeScopeLabel}
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>
                    Active Scope
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                flex: 1,
                gap: "10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "0.78rem",
                  color: "#cbd5e1",
                }}
              >
                <span>🎯 Tap the glowing data orb before it moves!</span>
                <div style={{ display: "flex", gap: "12px", fontWeight: 700 }}>
                  <span style={{ color: "#5eead4" }}>Score: {gameScore}</span>
                  <span style={{ color: "#c084fc" }}>Best: {highScore}</span>
                </div>
              </div>

              <div
                style={{
                  position: "relative",
                  height: "215px",
                  borderRadius: "14px",
                  background:
                    "radial-gradient(circle at 50% 50%, rgba(94, 234, 212, 0.1), rgba(11, 15, 25, 0.9))",
                  border: "1px solid rgba(192, 132, 252, 0.3)",
                  overflow: "hidden",
                  userSelect: "none",
                }}
              >
                <button
                  type="button"
                  onClick={handleCatchOrb}
                  style={{
                    position: "absolute",
                    top: `${orbPos.top}%`,
                    left: `${orbPos.left}%`,
                    width: "44px",
                    height: "44px",
                    borderRadius: "50%",
                    border: "2px solid #ffffff",
                    background: `radial-gradient(circle, #ffffff 10%, ${orbPos.color} 70%)`,
                    boxShadow: `0 0 24px ${orbPos.color}`,
                    cursor: "pointer",
                    transition: "top 0.25s ease, left 0.25s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1rem",
                  }}
                  title="Click me!"
                >
                  ⚡
                </button>

                {orbCombo && (
                  <div
                    style={{
                      position: "absolute",
                      top: "10px",
                      right: "12px",
                      fontSize: "0.76rem",
                      fontWeight: 800,
                      color: "#5eead4",
                    }}
                  >
                    {orbCombo}
                  </div>
                )}

                {ingestLoading && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: "8px",
                      left: "10px",
                      right: "10px",
                      fontSize: "0.72rem",
                      color: "#fde68a",
                      background: "rgba(15, 23, 42, 0.85)",
                      padding: "4px 10px",
                      borderRadius: "8px",
                    }}
                  >
                    ⏳ Background Scan ({liveState.progress}%): {liveState.step}
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "0.72rem",
                  color: "#94a3b8",
                }}
              >
                <span>Play anytime or while large websites are loading!</span>
                <button
                  type="button"
                  onClick={() => {
                    setGameScore(0);
                    setOrbCombo("");
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#5eead4",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "0.72rem",
                  }}
                >
                  Reset Score
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Auto-Dismissing Notification Banner */}
      {ingestStatus && (
        <div
          className={`toast-banner toast-${ingestStatus.type}`}
          style={{ animation: "fadeIn 0.25s ease" }}
        >
          <span>
            <strong>
              {ingestStatus.type === "cached"
                ? "⚡ Already Saved: "
                : ingestStatus.type === "indexed"
                ? "✅ Done: "
                : "❌ Notice: "}
            </strong>
            {ingestStatus.message}
          </span>
          <button
            onClick={() => setIngestStatus(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 3. USER-FRIENDLY 4-COLUMN GRID */}
      <section className="bento-grid">
        {/* CARD 01 */}
        <div className="bento-card">
          <div>
            <div className="card-num">01</div>
            <div className="card-heading">Add a Website</div>
            <p className="card-subtext">
              Paste any website link below to automatically read its pages,
              tables, products, and information.
            </p>
          </div>

          <form className="card-controls" onSubmit={handleUrlScrape}>
            <input
              type="url"
              className="compact-input"
              placeholder="Paste website link (e.g., https://www.example.com)"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              required
            />
            <button
              type="submit"
              className="compact-btn"
              disabled={ingestLoading || !urlInput.trim()}
            >
              {ingestLoading ? "Scanning Live..." : "Save Website"}
            </button>
          </form>
        </div>

        {/* CARD 02: Multi-PDF Batch Upload */}
        <div className="bento-card">
          <div>
            <div className="card-num">02</div>
            <div className="card-heading">Upload PDF Documents</div>
            <p className="card-subtext">
              Select one or multiple PDF files from your computer (policies,
              brochures, or reports) at once.
            </p>
          </div>

          <form className="card-controls" onSubmit={handlePdfUpload}>
            <label
              className="compact-file-label"
              title={
                selectedFiles.length > 0
                  ? selectedFiles.map((f) => f.name).join(", ")
                  : "Select one or more PDF files"
              }
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                multiple
                style={{ display: "none" }}
                onChange={(e) =>
                  setSelectedFiles(Array.from(e.target.files || []))
                }
              />
              {filePickerLabel}
            </label>
            <button
              type="submit"
              className="compact-btn"
              disabled={!selectedFiles.length || ingestLoading}
            >
              {ingestLoading && pdfBatchStatus
                ? pdfBatchStatus
                : selectedFiles.length > 1
                ? `Save ${selectedFiles.length} PDFs`
                : "Save PDF"}
            </button>
          </form>
        </div>

        {/* CARD 03: Saved Library with Truncated Labels, Refresh & Delete */}
        <div className="bento-card">
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div className="card-num">03</div>
              {sources.length > 0 && (
                <button
                  type="button"
                  onClick={handleSelectAll}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#5eead4",
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {checkedHashes.length === sources.length
                    ? "Deselect All"
                    : "Select All"}
                </button>
              )}
            </div>
            <div className="card-heading">Your Saved Library</div>
            <p className="card-subtext">
              Click an item to focus your chat, refresh websites, or delete
              items.
            </p>
          </div>

          <div
            className="compact-source-list"
            style={{ maxHeight: "125px", overflowY: "auto" }}
          >
            <div
              className={`compact-source-chip ${
                selectedSourceHash === "all" ? "active" : ""
              }`}
              onClick={() => setSelectedSourceHash("all")}
            >
              <span className="chip-title">🌐 Search Everything</span>
              <span>{sources.length} saved</span>
            </div>

            {sources.map((src) => {
              const isChecked = checkedHashes.includes(src.source_hash);
              const shortName = formatSourceLabel(src.source_name);
              return (
                <div
                  key={src.source_hash}
                  className={`compact-source-chip ${
                    selectedSourceHash === src.source_hash ? "active" : ""
                  }`}
                  onClick={() => setSelectedSourceHash(src.source_hash)}
                  title={src.source_name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "5px",
                    minWidth: 0,
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "7px",
                      overflow: "hidden",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => toggleCheckbox(src.source_hash, e)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        cursor: "pointer",
                        accentColor: "#5eead4",
                        flexShrink: 0,
                      }}
                    />
                    <span className="chip-title">
                      {src.source_type === "pdf" ? "📄 " : "🔗 "}
                      {shortName}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      flexShrink: 0,
                    }}
                  >
                    {src.source_type === "website" && (
                      <button
                        type="button"
                        onClick={(e) =>
                          handleRefreshWebsite(src.source_name, e)
                        }
                        disabled={ingestLoading || deleteLoading}
                        title="Re-scan website for latest updates"
                        style={{
                          background: "rgba(94, 234, 212, 0.14)",
                          border: "1px solid rgba(94, 234, 212, 0.35)",
                          color: "#5eead4",
                          borderRadius: "6px",
                          padding: "2px 5px",
                          fontSize: "0.68rem",
                          cursor: "pointer",
                        }}
                      >
                        🔄
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={(e) =>
                        handleDeleteSingle(src.source_hash, shortName, e)
                      }
                      disabled={deleteLoading}
                      title="Delete this item from library"
                      style={{
                        background: "rgba(239, 68, 68, 0.14)",
                        border: "1px solid rgba(239, 68, 68, 0.35)",
                        color: "#fca5a5",
                        borderRadius: "6px",
                        padding: "2px 5px",
                        fontSize: "0.68rem",
                        cursor: "pointer",
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {checkedHashes.length > 0 && (
            <button
              type="button"
              onClick={handleDeleteSelected}
              disabled={deleteLoading}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: "10px",
                border: "1px solid rgba(239, 68, 68, 0.5)",
                background: "rgba(239, 68, 68, 0.2)",
                color: "#fecaca",
                fontSize: "0.76rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {deleteLoading
                ? "Deleting..."
                : `🗑️ Delete Selected (${checkedHashes.length})`}
            </button>
          )}
        </div>

        {/* CARD 04 */}
        <div
          className="bento-card"
          style={{ cursor: "pointer" }}
          onClick={() => setIsChatOpen(true)}
        >
          <div>
            <div className="card-num">04</div>
            <div className="card-heading">Ask Your AI Assistant</div>
            <p className="card-subtext">
              Supports Voice Mic 🎙️, Read-Aloud 🔊, CSV Table Export 📥, &
              Indian Regional Languages!
            </p>
          </div>
        </div>
      </section>

      {/* 4. FLOATING BOTTOM-RIGHT CHAT ICON */}
      <button
        className="chat-fab"
        onClick={() => setIsChatOpen((prev) => !prev)}
        title="Chat with AI Assistant"
        aria-label="Toggle AI Chat Popup"
        style={{
          transform: isChatOpen
            ? "scale(0.9) rotate(90deg)"
            : "scale(1) rotate(0deg)",
          transition: "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0f172a"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <line x1="12" y1="7" x2="12" y2="13" />
          <line x1="9" y1="10" x2="15" y2="10" />
        </svg>
      </button>

      {/* 5. FLUID ANIMATED CHATBOX POPUP */}
      <div
        onClick={() => setIsMaximized(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(7, 10, 18, 0.72)",
          backdropFilter: "blur(6px)",
          zIndex: 1000,
          opacity: isChatOpen && isMaximized ? 1 : 0,
          pointerEvents: isChatOpen && isMaximized ? "auto" : "none",
          transition: "opacity 0.32s ease",
        }}
      />

      <div style={dynamicChatStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingBottom: "12px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            flexShrink: 0,
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div className="fluid-avatar-orb" />
            <div>
              <div className="fluid-bot-title">Smart AI Assistant</div>
              <div className="fluid-bot-status">
                {isListening
                  ? `🔴 Listening (${currentLangObj.speechCode})...`
                  : "Online · Smart Language Match"}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              flexWrap: "wrap",
            }}
          >
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              style={langSelectStyle}
              title="Auto-Detect replies in the same language you type. Or select a language to force translation."
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option
                  key={lang.value}
                  value={lang.value}
                  style={{ background: "#0f172a", color: "#f8fafc" }}
                >
                  {lang.label}
                </option>
              ))}
            </select>

            {messages.length > 1 && (
              <button
                type="button"
                style={{
                  ...headerBtnStyle,
                  background: "rgba(255,255,255,0.06)",
                  borderColor: "rgba(255,255,255,0.16)",
                  color: "#cbd5e1",
                }}
                onClick={handleClearChat}
                title="Clear conversation history"
              >
                🧹 Clear
              </button>
            )}

            <button
              type="button"
              style={headerBtnStyle}
              onClick={() => setIsMaximized((prev) => !prev)}
              title={
                isMaximized
                  ? "Return to bottom-right corner"
                  : "Expand to center of screen"
              }
            >
              {isMaximized ? "⤡ Minimize" : "⤢ Maximize"}
            </button>

            <button
              type="button"
              style={closeBtnStyle}
              onClick={() => {
                setIsMaximized(false);
                setIsChatOpen(false);
              }}
              title="Close chat"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable Messages Area */}
        <div className="fluid-messages-area">
          {messages.map((msg, idx) =>
            msg.role === "user" ? (
              <div key={idx} className="fluid-msg-user">
                {msg.content}
              </div>
            ) : (
              <div key={idx} className="fluid-msg-assistant">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    table: ({ children }) => (
                      <ExportableTable>{children}</ExportableTable>
                    ),
                  }}
                >
                  {msg.content}
                </ReactMarkdown>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginTop: "8px",
                    paddingTop: "6px",
                    borderTop: "1px solid rgba(255, 255, 255, 0.06)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleSpeakMessage(msg.content, idx)}
                    style={{
                      background:
                        speakingIdx === idx
                          ? "rgba(239, 68, 68, 0.2)"
                          : "rgba(255, 255, 255, 0.06)",
                      border:
                        speakingIdx === idx
                          ? "1px solid rgba(239, 68, 68, 0.45)"
                          : "1px solid rgba(255, 255, 255, 0.12)",
                      color: speakingIdx === idx ? "#fca5a5" : "#94a3b8",
                      borderRadius: "999px",
                      padding: "3px 10px",
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    title="Listen to this answer aloud"
                  >
                    {speakingIdx === idx ? "⏹️ Stop" : "🔊 Listen"}
                  </button>
                </div>
              </div>
            )
          )}

          {chatLoading && (
            <div className="fluid-typing-bubble">
              <span className="typing-dot cyan" />
              <span className="typing-dot purple" />
              <span className="typing-dot pink" />
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Bottom Input Bar with Multilingual Voice Microphone + Send Button */}
        <form className="fluid-input-bar" onSubmit={handleSendChat}>
          <input
            type="text"
            className="fluid-text-input"
            placeholder={
              isListening
                ? `Listening... Speak now!`
                : "Ask in English, தமிழ், മലയാളം, हिन्दी..."
            }
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />

          <button
            type="button"
            onClick={handleToggleMic}
            className={`fluid-mic-circle ${isListening ? "listening" : ""}`}
            title={
              isListening
                ? "Click to stop listening"
                : `Voice Input (${currentLangObj.speechCode})`
            }
            aria-label="Voice Input Microphone"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </button>

          <button
            type="submit"
            className="fluid-send-circle"
            disabled={chatLoading || !question.trim()}
            aria-label="Send message"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0f172a"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}