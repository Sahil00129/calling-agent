/**
 * ElevenLabs agent — local test harness
 * No build step. The SDK is loaded as an ES module from esm.sh.
 */

// Tells index.html's watchdog that this module actually executed.
window.__EL_TEST_BOOTED = true;

const SDK_URL = "https://esm.sh/@elevenlabs/client@1.36.0";
const WIDGET_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed";

const $ = (id) => document.getElementById(id);
const agentInput = $("agentId");
const logEl = $("log");
const statusEl = $("status");
const statusDot = $("statusDot");

let conversation = null; // active SDK conversation
let sdkPromise = null; // lazily loaded SDK module
let widgetScriptRequested = false;

// localStorage can throw when site data is blocked — never let that break the page.
const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* blocked, ignore */ }
  },
};

/* ------------------------------------------------------------------ log */
function stamp() {
  return new Date().toLocaleTimeString([], { hour12: false });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function log(kind, text) {
  const line = document.createElement("div");
  line.className = kind;
  line.innerHTML = `<span class="t">${stamp()}</span>  ` + escapeHtml(text);
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

/* --------------------------------------------------------------- status */
function setStatus(status) {
  statusEl.textContent = status;
  statusDot.className = "dot";
  if (status === "connected") statusDot.classList.add("ok");
  else if (status === "connecting") statusDot.classList.add("wait");
  else if (status === "error") statusDot.classList.add("bad");
  $("startBtn").disabled = status === "connecting" || status === "connected";
  $("endBtn").disabled = status !== "connected" && status !== "connecting";
}

/* ---------------------------------------------------------------- setup */
function readAgentId() {
  const id = agentInput.value.trim();
  if (id) storage.set("el_test_agent_id", id);
  return id;
}

agentInput.addEventListener("change", readAgentId);

async function checkKeyState() {
  try {
    const res = await fetch("api/token.php?ping=1", { cache: "no-store" });
    const data = await res.json();

    // Session gone (logged out in another tab, or expired) — back to the login screen.
    if (data.reauth) {
      $("keyState").innerHTML = '<span class="dot bad"></span>Session ended — redirecting to sign in…';
      setTimeout(() => location.replace("/login?next=%2Ftest"), 700);
      return;
    }

    // If .env.local has a default agent id, prefill the box once.
    if (data.agent_default && !agentInput.value.trim()) {
      agentInput.value = data.agent_default;
      log("in", `Agent ID loaded from .env.local: ${data.agent_default}`);
    }

    if (data.configured) {
      $("keyState").innerHTML =
        '<span class="dot ok"></span>API key configured — private agent test is ready.';
    } else {
      $("keyState").innerHTML =
        '<span class="dot wait"></span>API key not set — only the <code>public</code> agent test will work. ' +
        'Paste the key in <code>.env.local</code>.';
    }
  } catch (err) {
    $("keyState").innerHTML =
      '<span class="dot bad"></span>PHP endpoint unreachable — is XAMPP Apache running? (' +
      escapeHtml(err.message) + ")";
  }
}

/* --------------------------------------------------------------- widget */
function loadWidget() {
  const agentId = readAgentId();
  if (!agentId) return log("er", "Enter an Agent ID first.");

  document.querySelectorAll("elevenlabs-convai").forEach((n) => n.remove());

  const el = document.createElement("elevenlabs-convai");
  el.setAttribute("agent-id", agentId);
  document.body.appendChild(el);
  $("widgetRemoveBtn").disabled = false;
  log("out", `widget <elevenlabs-convai agent-id="${agentId}"> injected`);

  if (widgetScriptRequested) return;
  widgetScriptRequested = true;

  const script = document.createElement("script");
  script.src = WIDGET_SRC;
  script.async = true;
  script.type = "text/javascript";
  script.onload = () => log("in", "widget script loaded (unpkg)");
  script.onerror = () => log("er", "widget script failed to load — check network or allowlist");
  document.head.appendChild(script);
}

function removeWidget() {
  document.querySelectorAll("elevenlabs-convai").forEach((n) => n.remove());
  $("widgetRemoveBtn").disabled = true;
  log("out", "widget removed (a page refresh also clears it)");
}

/* ------------------------------------------------------------------ sdk */
async function loadSdk() {
  if (!sdkPromise) {
    log("out", `loading SDK from ${SDK_URL} …`);
    sdkPromise = import(SDK_URL)
      .then((mod) => {
        if (!mod.Conversation) throw new Error("Conversation export not found in SDK");
        log("in", "SDK loaded");
        return mod.Conversation;
      })
      .catch((err) => {
        sdkPromise = null;
        throw err;
      });
  }
  return sdkPromise;
}

async function fetchConversationToken(agentId) {
  log("out", "GET api/token.php (server-side token)");
  const res = await fetch(
    `api/token.php?agent_id=${encodeURIComponent(agentId)}&mode=webrtc`,
    { cache: "no-store" }
  );
  const data = await res.json().catch(() => ({}));
  if (data.reauth) {
    location.replace("/login?next=%2Ftest");
    throw new Error("Session ended — please sign in again.");
  }
  if (!res.ok) {
    throw new Error(
      data.error
        ? `${data.error}${data.status ? ` (${data.status})` : ""}`
        : `token endpoint returned ${res.status}`
    );
  }
  if (!data.token) throw new Error("token endpoint did not return a token");
  log("in", "conversation token received");
  return data.token;
}

async function startCall() {
  const agentId = readAgentId();
  if (!agentId) return log("er", "Enter an Agent ID first.");

  const mode = document.querySelector('input[name="authMode"]:checked').value;

  try {
    setStatus("connecting");
    const Conversation = await loadSdk();

    log("out", "requesting microphone permission");
    await navigator.mediaDevices.getUserMedia({ audio: true });
    log("in", "microphone permission granted");

    const options = {
      onConnect: ({ conversationId }) => {
        setStatus("connected");
        log("in", `connected · conversation ${conversationId}`);
      },
      onDisconnect: (details) => {
        setStatus("disconnected");
        conversation = null;
        log("out", `disconnected${details?.reason ? " · " + details.reason : ""}`);
      },
      onStatusChange: ({ status }) => {
        log("out", `status → ${status}`);
      },
      onModeChange: ({ mode: m }) => {
        log("out", `mode → ${m}`);
      },
      onMessage: (msg) => {
        const who = msg.source === "user" ? "you" : "agent";
        log(msg.source === "user" ? "out" : "in", `${who}: ${msg.message}`);
      },
      onError: (err) => {
        setStatus("error");
        log("er", `error: ${typeof err === "string" ? err : JSON.stringify(err)}`);
      },
      // Agent dashboard → Tools → Client tool: getPageInfo / openUrl
      clientTools: {
        getPageInfo: () => {
          log("er", "client tool → getPageInfo()");
          return `Page: ${document.title} · URL: ${location.href}`;
        },
        openUrl: ({ url }) => {
          log("er", `client tool → openUrl(${url})`);
          window.open(url, "_blank", "noopener,noreferrer");
          return "Opened in a new tab";
        },
      },
    };

    if (mode === "private") {
      options.conversationToken = await fetchConversationToken(agentId);
    } else {
      options.agentId = agentId;
      log("out", `startSession({ agentId: "${agentId}" })`);
    }

    conversation = await Conversation.startSession(options);
    setStatus("connected");
    log("in", "session started");
  } catch (err) {
    setStatus("error");
    log("er", `start failed: ${err?.message || err}`);
    console.error(err);
  }
}

async function endCall() {
  if (!conversation) return;
  try {
    await conversation.endSession();
    log("out", "endSession() called");
  } catch (err) {
    log("er", `end failed: ${err?.message || err}`);
  } finally {
    conversation = null;
    setStatus("disconnected");
  }
}

/* --------------------------------------------------------------- wiring */
$("widgetBtn").addEventListener("click", loadWidget);
$("widgetRemoveBtn").addEventListener("click", removeWidget);
$("startBtn").addEventListener("click", startCall);
$("endBtn").addEventListener("click", endCall);

// Any uncaught script error goes into the log, so a blank-looking page still explains itself.
window.addEventListener("error", (e) => log("er", `script error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => log("er", `unhandled: ${e.reason?.message || e.reason}`));

const savedId = storage.get("el_test_agent_id");
if (savedId) agentInput.value = savedId;

setStatus("disconnected");
checkKeyState();
log("out", "ready — enter an Agent ID, then run any test");
