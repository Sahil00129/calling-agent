/**
 * Voice portal — quick calls, spreadsheet campaigns, recordings.
 * No build step: plain ES module + the ElevenLabs client SDK from esm.sh.
 */

const SDK_URL = "https://esm.sh/@elevenlabs/client@1.36.0";

const $ = (id) => document.getElementById(id);
const bannerEl = $("banner");

const state = {
  view: "quick",
  settings: null,
  phoneNumbers: [],
  recipients: null,
  campaigns: [],
  cursor: null,
  calls: [],
  selectedId: null,
  conversation: null,
  sdk: null,
  activeRow: null,
  recent: [],
  filters: { q: "", status: "" },
  autoRefresh: true,
  transcript: [],
  audioId: null,
  ready: false,
};

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem("vp:" + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("vp:" + key, JSON.stringify(value));
    } catch {
      /* private mode — ignore */
    }
  },
};

/* ------------------------------------------------------------- utilities */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

let bannerTimer = null;

function banner(message, kind = "err") {
  clearTimeout(bannerTimer);
  if (!message) {
    bannerEl.className = "banner";
    bannerEl.textContent = "";
    return;
  }
  bannerEl.className = `banner show ${kind}`;
  bannerEl.innerHTML = escapeHtml(message);
  if (kind === "ok") bannerTimer = setTimeout(() => banner(""), 7000);
}

function formatDate(unix) {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(secs) {
  const total = Number(secs) || 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: { ...(options.body instanceof FormData ? {} : options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
  });

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 300) }; }

  // Session expired or signed out in another tab — go back to the login screen.
  if (response.status === 401 && data.reauth) {
    goToLogin();
    throw new Error("Session ended — please sign in again.");
  }

  if (!response.ok) {
    const message = data.error || `Request failed (${response.status})`;
    let detail = data.detail;
    if (detail && typeof detail === "object") detail = detail.message || detail.msg || JSON.stringify(detail);
    const status = data.status ? ` [${data.status}]` : "";
    throw new Error(`${message}${status}${detail ? ` — ${detail}` : ""}`);
  }
  return data;
}

function goToLogin() {
  if (window.__EL_GOING_TO_LOGIN) return;
  window.__EL_GOING_TO_LOGIN = true;
  location.replace("/login?next=" + encodeURIComponent("/"));
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span>';
  } else {
    button.disabled = false;
    button.textContent = label || button.dataset.label || button.textContent;
  }
}

function parseVariables(text) {
  const out = {};
  String(text || "").split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Za-z0-9_.\-]+)\s*[=:]\s*(.*)$/);
    if (match && match[2] !== "") out[match[1]] = match[2].trim();
  });
  return out;
}

function scheduleUnix(text) {
  const value = String(text || "").trim();
  if (!value) return { ok: true, unix: null };
  const parsed = new Date(value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return { ok: false, unix: null };
  return { ok: true, unix: Math.floor(parsed.getTime() / 1000) };
}

/* ------------------------------------------------------------- views */

function showView(name) {
  const tab = document.querySelector(`.tab[data-view="${name}"]`);
  const view = name ? $(`view-${name}`) : null;
  if (!tab || !view) return showView("quick");

  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  tab.classList.add("active");
  view.classList.add("active");
  state.view = name;
  if (location.hash.replace("#", "") !== name) history.replaceState(null, "", "#" + name);

  if (!state.ready) return; // boot loads everything once, after settings arrive
  if (name === "calls" && !state.calls.length) loadCalls(true);
  if (name === "dialer") loadCampaigns(true);
}

function updateAutoRefresh() {
  state.autoRefresh = $("autoRefresh").checked;
  store.set("autoRefresh", state.autoRefresh);
}

/* ---------------------------------------------------------- settings */

async function loadSettings() {
  try {
    const data = await api("api/settings.php");
    state.settings = data;
    $("agentId").value = data.agent_id || "";

    if (!data.key_configured) {
      $("keyState").innerHTML = '<span class="chip bad">API key missing</span> — add it in <code>.env.local</code>';
    } else if (!data.key_valid) {
      $("keyState").innerHTML = '<span class="chip warn">API key set, but it does not look like a real key</span> — ElevenLabs keys start with <code>sk_</code>.';
    } else {
      $("keyState").innerHTML = '<span class="chip ok">API key configured</span>';
    }
  } catch (error) {
    banner(error.message);
  }
}

async function loadPhoneNumbers() {
  const select = $("phoneNumberSetting");
  const dialerSelect = $("phoneNumber");
  try {
    const data = await api("api/phone-numbers.php");
    state.phoneNumbers = data.phone_numbers || [];

    const options = state.phoneNumbers.map((number) =>
      `<option value="${escapeHtml(number.phone_number_id)}">${escapeHtml(
        [number.label, number.phone_number, number.provider, number.assigned_agent].filter(Boolean).join(" · ")
      )}</option>`
    ).join("");

    select.innerHTML = '<option value="">— none —</option>' + options;
    dialerSelect.innerHTML = '<option value="">— select number —</option>' + options;

    const saved = state.settings?.phone_number_id;
    if (saved) {
      select.value = saved;
      dialerSelect.value = saved;
    }

    if (!state.phoneNumbers.length) {
      banner("No outbound number in ElevenLabs — browser calls work; real phone calls need a number (Twilio or SIP trunk).", "warn");
    }
  } catch (error) {
    select.innerHTML = '<option value="">— could not load —</option>';
    dialerSelect.innerHTML = '<option value="">— could not load —</option>';
    banner(`Phone numbers: ${error.message}`);
  }
}

$("saveSettings").addEventListener("click", async (event) => {
  setBusy(event.currentTarget, true);
  try {
    await api("api/settings.php", {
      method: "POST",
      body: JSON.stringify({
        agent_id: $("agentId").value.trim(),
        phone_number_id: $("phoneNumberSetting").value,
      }),
    });
    banner("Settings saved.", "ok");
    await loadSettings();
  } catch (error) {
    banner(error.message);
  } finally {
    setBusy(event.currentTarget, false, "Save");
  }
});

$("reloadNumbers").addEventListener("click", () => loadPhoneNumbers());

$("testConnection").addEventListener("click", async (event) => {
  const result = $("testResult");
  const button = event.currentTarget;
  result.style.display = "none";
  setBusy(button, true);
  try {
    const agentId = $("agentId").value.trim() || state.settings?.agent_id || "";
    const data = await api(`api/test-connection.php?agent_id=${encodeURIComponent(agentId)}`);
    result.className = "result ok";
    result.style.display = "block";
    result.textContent =
      `Connected.\nAgent: ${data.agent.name || "(no name)"} — ${data.agent.id}\n` +
      `Outbound numbers: ${data.phone_numbers}\nKey: ${data.key_hint}`;
  } catch (error) {
    result.className = "result err";
    result.style.display = "block";
    result.textContent = error.message;
  } finally {
    setBusy(button, false, "Test connection");
  }
});

/* ------------------------------------------------------------ recent */

async function loadRecent() {
  try {
    const data = await api("api/recent.php");
    state.recent = data.numbers || [];
    renderRecent();
  } catch (error) {
    console.warn(error);
  }
}

function renderRecent() {
  const list = $("recentList");
  if (!state.recent.length) {
    list.innerHTML = '<div class="recent-empty">Nothing yet — the first call you make here will show up.</div>';
    return;
  }

  list.innerHTML = state.recent.map((item, index) => `
    <div class="recent-item">
      <div class="who" data-use="${index}" title="Reuse this number">
        <div class="num">${escapeHtml(item.phone)}</div>
        <div class="lbl">${escapeHtml(item.label || "no label")}${item.at ? ` · ${escapeHtml(timeAgo(item.at))}` : ""}</div>
      </div>
      <button class="small secondary" data-browser="${index}">Browser</button>
      <button class="small" data-phone="${index}">Phone</button>
    </div>
  `).join("");

  list.querySelectorAll("[data-use]").forEach((el) => el.addEventListener("click", () => {
    const item = state.recent[Number(el.dataset.use)];
    $("quickPhone").value = item.phone;
    $("quickLabel").value = item.label || "";
    $("quickPhone").focus();
  }));

  list.querySelectorAll("[data-browser]").forEach((el) => el.addEventListener("click", () => {
    const item = state.recent[Number(el.dataset.browser)];
    $("quickPhone").value = item.phone;
    testInBrowser(el);
  }));

  list.querySelectorAll("[data-phone]").forEach((el) => el.addEventListener("click", () => {
    const item = state.recent[Number(el.dataset.phone)];
    $("quickPhone").value = item.phone;
    $("quickLabel").value = item.label || "";
    callOnPhone(el);
  }));
}

async function rememberNumber(phone, label) {
  try {
    const data = await api("api/recent.php", {
      method: "POST",
      body: JSON.stringify({ phone, label: label || "" }),
    });
    state.recent = data.numbers || [];
    renderRecent();
  } catch (error) {
    console.warn(error);
  }
}

async function clearRecent() {
  try {
    await api("api/recent.php", { method: "DELETE" });
    state.recent = [];
    renderRecent();
    banner("Recent numbers cleared.", "ok");
  } catch (error) {
    banner(error.message);
  }
}

$("clearRecent").addEventListener("click", clearRecent);
$("clearRecentFromSettings").addEventListener("click", clearRecent);

/* -------------------------------------------------------------- calls */

function statusChip(conversation) {
  const map = {
    done: ["ok", "done"],
    failed: ["bad", "failed"],
    processing: ["warn", "processing"],
    "in-progress": ["warn", "live"],
    initiated: ["warn", "initiated"],
  };
  const [cls, label] = map[conversation.status] || ["", conversation.status || "—"];
  return `<span class="chip ${cls}">${escapeHtml(label)}</span>`;
}

async function loadCalls(reset = false, silent = false) {
  if (reset) {
    state.cursor = null;
    state.calls = [];
    if (!silent) $("callsBody").innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';
  }

  if (!silent) setBusy($("refreshCalls"), true);
  try {
    const params = new URLSearchParams({ page_size: "30" });
    if (state.cursor) params.set("cursor", state.cursor);
    if (state.settings?.agent_id) params.set("agent_id", state.settings.agent_id);

    const data = await api(`api/conversations.php?${params}`);
    state.calls = state.calls.concat(data.conversations || []);
    state.cursor = data.next_cursor || null;

    renderCalls();
    $("callsMeta").textContent = `${state.calls.length} call${state.calls.length === 1 ? "" : "s"} loaded`;
    $("loadMore").disabled = !state.cursor;
  } catch (error) {
    if (!silent) {
      $("callsBody").innerHTML =
        '<tr><td colspan="5" class="muted">Could not load calls — check the API key in .env.local, then hit Refresh.</td></tr>';
    }
    banner(`Calls: ${error.message}`);
  } finally {
    if (!silent) setBusy($("refreshCalls"), false, "Refresh");
  }
}

function filteredCalls() {
  const query = state.filters.q.trim().toLowerCase();
  const status = state.filters.status;
  return state.calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => {
      if (status && call.status !== status) return false;
      if (!query) return true;
      return [call.summary, call.conversation_id, call.agent_name, call.sentiment]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
}

function renderCalls() {
  const rows = filteredCalls();

  if (!rows.length) {
    $("callsBody").innerHTML = state.calls.length
      ? '<tr><td colspan="5" class="muted">No call matches this filter.</td></tr>'
      : '<tr><td colspan="5" class="muted">No conversations yet.</td></tr>';
    return;
  }

  $("callsBody").innerHTML = rows.map(({ call, index }) => `
    <tr data-index="${index}" class="${call.conversation_id === state.selectedId ? "selected" : ""}">
      <td class="nowrap">${escapeHtml(formatDate(call.start_time_unix_secs))}</td>
      <td><span class="chip dir">${escapeHtml(call.direction === "outbound" ? "out" : "in")}</span></td>
      <td class="nowrap">${escapeHtml(formatDuration(call.call_duration_secs))}</td>
      <td>${statusChip(call)}</td>
      <td class="muted" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${escapeHtml(call.summary || call.agent_name || "—")}
      </td>
    </tr>
  `).join("");

  $("callsBody").querySelectorAll("tr[data-index]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedId = state.calls[Number(row.dataset.index)].conversation_id;
      $("callsBody").querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
      row.classList.add("selected");
      openConversation(state.selectedId);
    });
  });
}

async function openConversation(id) {
  $("detailEmpty").style.display = "none";
  $("detailBody").style.display = "block";
  $("detailId").textContent = id;
  $("detailStatus").textContent = "…";
  $("detailMeta").textContent = "";
  $("transcript").innerHTML = '<div class="muted">Loading transcript…</div>';
  $("audioWrap").style.display = "none";
  $("audioMissing").style.display = "none";
  $("copyTranscript").disabled = true;
  $("downloadTranscript").disabled = true;
  state.transcript = [];

  try {
    const data = await api(`api/conversation.php?id=${encodeURIComponent(id)}`);
    $("detailStatus").textContent = data.status || "—";
    $("detailStatus").className = `chip ${data.status === "done" ? "ok" : "warn"}`;

    const meta = data.metadata || {};
    const analysis = data.analysis || {};
    $("detailMeta").textContent = [
      meta.start_time_unix_secs ? `Started ${formatDate(meta.start_time_unix_secs)}` : null,
      meta.call_duration_secs ? `Duration ${formatDuration(meta.call_duration_secs)}` : null,
      analysis.transcript_summary || null,
    ].filter(Boolean).join(" · ");

    if (data.has_audio || data.has_user_audio) {
      state.audioId = id;
      $("audioPlayer").src = `api/audio.php?id=${encodeURIComponent(id)}`;
      $("audioWrap").style.display = "block";
    } else {
      state.audioId = null;
      $("audioMissing").style.display = "block";
    }

    state.transcript = data.transcript || [];
    $("copyTranscript").disabled = !state.transcript.length;
    $("downloadTranscript").disabled = !state.transcript.length;

    $("transcript").innerHTML = state.transcript.length
      ? state.transcript.map((turn) => `
          <div class="turn ${turn.role === "user" ? "user" : "agent"}">
            <span class="who">${turn.role === "user" ? "Caller" : "Agent"}${turn.time !== null && turn.time !== undefined ? ` · ${formatDuration(turn.time)}` : ""}</span>
            <span class="msg">${escapeHtml(turn.message)}</span>
          </div>
        `).join("")
      : '<div class="muted">No transcript stored for this call.</div>';
  } catch (error) {
    $("transcript").innerHTML = "";
    $("detailMeta").textContent = error.message;
  }
}

function transcriptText() {
  const header = `Conversation ${state.selectedId || ""}\n${new Date().toISOString()}\n\n`;
  return header + state.transcript.map((turn) =>
    `${turn.role === "user" ? "Caller" : "Agent"}${turn.time !== null && turn.time !== undefined ? ` (${formatDuration(turn.time)})` : ""}: ${turn.message}`
  ).join("\n\n");
}

$("copyTranscript").addEventListener("click", async () => {
  const text = transcriptText();
  try {
    await navigator.clipboard.writeText(text);
    banner("Transcript copied.", "ok");
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    box.remove();
    banner("Transcript copied.", "ok");
  }
});

$("downloadTranscript").addEventListener("click", () => {
  const blob = new Blob([transcriptText()], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `call-${state.selectedId || "transcript"}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
});

$("refreshCalls").addEventListener("click", () => loadCalls(true));
$("loadMore").addEventListener("click", () => loadCalls(false));

$("callSearch").addEventListener("input", (event) => {
  state.filters.q = event.target.value;
  renderCalls();
});

$("callStatus").addEventListener("change", (event) => {
  state.filters.status = event.target.value;
  renderCalls();
});

$("autoRefresh").addEventListener("change", updateAutoRefresh);

/* ------------------------------------------------------------- dialer */

$("fileInput").addEventListener("change", (event) => {
  if (event.target.files.length) uploadFile(event.target.files[0]);
});

["dragover", "dragenter"].forEach((type) => $("dropzone").addEventListener(type, (event) => {
  event.preventDefault();
  $("dropzone").classList.add("drag");
}));

["dragleave", "drop"].forEach((type) => $("dropzone").addEventListener(type, (event) => {
  event.preventDefault();
  $("dropzone").classList.remove("drag");
}));

$("dropzone").addEventListener("drop", (event) => {
  if (event.dataTransfer.files.length) uploadFile(event.dataTransfer.files[0]);
});

async function uploadFile(file) {
  banner("");
  $("fileInfo").textContent = `Reading ${file.name}…`;
  const form = new FormData();
  form.append("file", file);

  try {
    const data = await api("api/upload.php", { method: "POST", body: form });
    const firstProblem = data.problems && data.problems.length ? data.problems[0] : null;
    const skippedNote = data.skipped
      ? ` · ${data.skipped} row(s) skipped${firstProblem ? ` (line ${firstProblem.line}: "${firstProblem.value}")` : ""}`
      : "";
    banner(`Imported ${data.valid} numbers from ${data.file}${skippedNote}`, data.skipped ? "warn" : "ok");
    $("fileInfo").textContent = file.name;
    await loadRecipients();
  } catch (error) {
    banner(error.message);
    $("fileInfo").textContent = "";
  }
}

async function loadRecipients() {
  try {
    const data = await api("api/recipients.php");
    state.recipients = data;

    if (!data.rows || !data.rows.length) {
      $("recipientsCard").style.display = "none";
      $("uploadStats").style.display = "none";
      return;
    }

    $("uploadStats").style.display = "flex";
    $("statValid").textContent = data.valid;
    $("statSkipped").textContent = data.skipped || 0;
    $("statFile").textContent = data.file || "—";

    renderRecipients();
  } catch (error) {
    banner(error.message);
  }
}

function renderRecipients() {
  const data = state.recipients;
  const rows = data.rows || [];
  const columns = data.headers || [];
  const browserMode = $("mode").value === "browser";

  $("recipientsCard").style.display = "block";
  $("recipientsCount").textContent = `${rows.length} numbers · phone column: ${data.phone_column}`;

  $("recipientsHead").innerHTML =
    columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("") +
    (browserMode ? "<th>Call</th>" : "");

  $("recipientsBody").innerHTML = rows.map((row, index) => {
    const cells = columns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join("");
    const callButton = browserMode
      ? `<td><button class="small secondary" data-call="${index}">Call</button></td>`
      : "";
    return `<tr data-row="${index}">${cells}${callButton}</tr>`;
  }).join("");

  if (browserMode) {
    $("recipientsBody").querySelectorAll("[data-call]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (button.dataset.state === "active") {
          if (state.conversation) await state.conversation.endSession();
          return;
        }
        callRecipientRow(Number(button.dataset.call), button);
      });
    });
  }
}

$("mode").addEventListener("change", () => {
  const phoneMode = $("mode").value === "phone";
  $("phoneOptions").style.display = phoneMode ? "grid" : "none";
  $("startBatch").style.display = phoneMode ? "inline-block" : "none";
  $("dialerHint").textContent = phoneMode
    ? "Submits every row (or the first N) to ElevenLabs at once."
    : "Use the Call button on each row — one call at a time from this tab.";
  store.set("mode", $("mode").value);
  if (state.recipients?.rows?.length) renderRecipients();
});

$("callName").addEventListener("input", () => store.set("callName", $("callName").value));
$("batchLimit").addEventListener("input", () => store.set("batchLimit", $("batchLimit").value));

async function clearRecipientList() {
  try {
    await api("api/recipients.php", { method: "DELETE" });
    state.recipients = null;
    $("recipientsCard").style.display = "none";
    $("uploadStats").style.display = "none";
    $("fileInfo").textContent = "";
    banner("Recipient list cleared.", "ok");
  } catch (error) {
    banner(error.message);
  }
}

$("clearRecipients").addEventListener("click", clearRecipientList);
$("clearRecipientsFromSettings").addEventListener("click", clearRecipientList);

function callRecipientRow(index, button) {
  const data = state.recipients;
  if (!data?.rows?.[index]) return;

  const row = data.rows[index];
  const phoneColumn = data.phone_column;
  const phone = row[phoneColumn];
  const variables = {};
  Object.entries(row).forEach(([key, value]) => {
    if (key !== phoneColumn) variables[key] = value;
  });

  startBrowserCall(phone, variables, {
    active: () => {
      button.dataset.state = "active";
      button.textContent = "End";
    },
    end: () => {
      delete button.dataset.state;
      button.textContent = "Call";
    },
  });
}

/* ----------------------------------------------------------- batches */

async function loadCampaigns(refresh = false) {
  try {
    const data = await api(`api/campaigns.php${refresh ? "?refresh=1" : ""}`);
    state.campaigns = data.campaigns || [];
    renderCampaigns();
  } catch (error) {
    console.warn(error);
  }
}

function renderCampaigns() {
  const rows = state.campaigns || [];
  if (!rows.length) {
    $("campaignsCard").style.display = "none";
    return;
  }

  $("campaignsCard").style.display = "block";

  $("campaignsBody").innerHTML = rows.map((campaign, index) => {
    const scheduled = Number(campaign.scheduled || campaign.recipients || 0);
    const finished = Number(campaign.finished || 0);
    const pct = scheduled ? Math.min(100, Math.round((finished / scheduled) * 100)) : 0;
    const status = String(campaign.status || "—");
    const final = ["completed", "failed", "cancelled"].includes(status);
    const chipClass = status === "completed" ? "ok" : final ? "bad" : "warn";
    const phones = (campaign.phones || []).join(", ");

    return `
      <tr>
        <td>
          <div>${escapeHtml(campaign.call_name || "—")}</div>
          <div class="muted small">${escapeHtml(phones || campaign.source_file || "")}</div>
        </td>
        <td class="nowrap">${escapeHtml(campaign.recipients)}</td>
        <td>
          <div class="progress ${status === "completed" ? "done" : ""}"><i style="width:${pct}%"></i></div>
          <div class="muted small">${finished}/${scheduled}</div>
        </td>
        <td><span class="chip ${chipClass}">${escapeHtml(status)}</span></td>
        <td class="nowrap muted small">${escapeHtml(new Date(campaign.created_at).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }))}</td>
        <td class="actions">
          <button class="small secondary" data-rerun="${index}" ${campaign.has_snapshot ? "" : "disabled title=\"Numbers were not saved for this batch\""}>Run again</button>
          ${final ? "" : `<button class="small ghost" data-cancel="${index}">Cancel</button>`}
        </td>
      </tr>
    `;
  }).join("");

  $("campaignsBody").querySelectorAll("[data-rerun]").forEach((button) => {
    button.addEventListener("click", () => rerunCampaign(Number(button.dataset.rerun), button));
  });

  $("campaignsBody").querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", () => cancelCampaign(Number(button.dataset.cancel), button));
  });
}

async function rerunCampaign(index, button) {
  const campaign = state.campaigns[index];
  if (!campaign) return;
  if (!confirm(`Run "${campaign.call_name}" again?\nThis creates a new batch and calls the same ${campaign.recipients} numbers.`)) return;

  setBusy(button, true);
  try {
    const data = await api("api/batch-action.php", {
      method: "POST",
      body: JSON.stringify({ batch_id: campaign.batch_id, action: "rerun" }),
    });
    banner(`New batch started: ${data.campaign.call_name} (${data.campaign.recipients} numbers).`, "ok");
    await loadCampaigns(true);
    setTimeout(() => loadCalls(true, true), 6000);
  } catch (error) {
    banner(error.message);
  } finally {
    setBusy(button, false, "Run again");
  }
}

async function cancelCampaign(index, button) {
  const campaign = state.campaigns[index];
  if (!campaign) return;
  if (!confirm(`Cancel the remaining calls in "${campaign.call_name}"?\nCalls already in progress will finish.`)) return;

  setBusy(button, true);
  try {
    await api("api/batch-action.php", {
      method: "POST",
      body: JSON.stringify({ batch_id: campaign.batch_id, action: "cancel" }),
    });
    banner("Batch cancelled.", "ok");
    await loadCampaigns(true);
  } catch (error) {
    banner(error.message);
  } finally {
    setBusy(button, false, "Cancel");
  }
}

$("refreshBatches").addEventListener("click", async (event) => {
  setBusy(event.currentTarget, true);
  await loadCampaigns(true);
  setBusy(event.currentTarget, false, "Refresh status");
});

$("startBatch").addEventListener("click", async (event) => {
  const rows = state.recipients?.rows?.length || 0;
  if (!rows) {
    banner("Upload a recipient list first.");
    return;
  }

  const numberId = $("phoneNumber").value || state.settings?.phone_number_id || "";
  if (!numberId) {
    banner("Pick an outbound number first (Settings → reload numbers).");
    return;
  }

  const limitRaw = $("batchLimit").value.trim();
  const limit = limitRaw ? Math.max(1, Math.min(rows, parseInt(limitRaw, 10) || 0)) : 0;
  const toCall = limit || rows;

  const schedule = scheduleUnix($("scheduleAt").value);
  if (!schedule.ok) {
    banner('Start time is not readable — use "2026-11-13 10:00".');
    return;
  }

  if (!confirm(`Start ${toCall} real phone call${toCall === 1 ? "" : "s"}${schedule.unix ? " (scheduled)" : " now"}?\nBilled per minute.`)) {
    return;
  }

  setBusy(event.currentTarget, true);
  try {
    const data = await api("api/start-batch.php", {
      method: "POST",
      body: JSON.stringify({
        call_name: $("callName").value.trim(),
        agent_id: state.settings?.agent_id,
        phone_number_id: numberId,
        limit,
        scheduled_time_unix: schedule.unix,
      }),
    });
    banner(`Batch started: ${data.campaign.call_name} — ${data.campaign.recipients} numbers, status ${data.campaign.status}.`, "ok");
    await loadCampaigns(true);
    setTimeout(() => loadCalls(true, true), 6000);
  } catch (error) {
    banner(error.message);
  } finally {
    setBusy(event.currentTarget, false, "Start phone batch");
  }
});

/* ------------------------------------------------------- browser calls */

async function loadSdk() {
  if (!state.sdk) {
    state.sdk = await import(SDK_URL);
  }
  return state.sdk.Conversation;
}

async function sessionOptions(agentId) {
  if (state.settings?.key_configured) {
    const res = await fetch(`api/token.php?agent_id=${encodeURIComponent(agentId)}&mode=webrtc`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (data.reauth) {
      goToLogin();
      throw new Error("Session ended — please sign in again.");
    }
    if (res.ok && data.token) return { conversationToken: data.token };
  }
  return { agentId };
}

function setQuickState(running) {
  $("quickState").textContent = running ? "live" : "ready";
  $("quickState").className = `pill ${running ? "live" : ""}`;
  $("quickEnd").style.display = running ? "inline-block" : "none";
  $("quickBrowser").disabled = running;
  $("quickPhoneBtn").disabled = running;
}

async function startBrowserCall(phone, variables, hooks = {}) {
  if (state.conversation) {
    banner("A call is already running — end it first.");
    return;
  }

  const agentId = state.settings?.agent_id;
  if (!agentId) {
    banner("Set the Agent ID in Settings first.");
    return;
  }
  if (!phone) {
    banner("Enter a phone number first.");
    return;
  }

  try {
    const Conversation = await loadSdk();
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const options = await sessionOptions(agentId);

    banner(`Calling ${phone} — speak when the agent greets you.`, "ok");
    state.conversation = await Conversation.startSession({
      ...options,
      userId: phone,
      dynamicVariables: variables || {},
      onDisconnect: () => {
        state.conversation = null;
        setQuickState(false);
        hooks.end?.();
        banner("Call ended — it will appear under Calls & recordings.", "ok");
        setTimeout(() => loadCalls(true, true), 2500);
      },
      onError: (error) => {
        banner(`Call error: ${typeof error === "string" ? error : JSON.stringify(error)}`);
      },
    });

    hooks.active?.();
    setQuickState(true);
  } catch (error) {
    state.conversation = null;
    setQuickState(false);
    hooks.end?.();
    banner(`Could not start the call: ${error.message}`);
  }
}

/* ----------------------------------------------------------- quick call */

function quickInputs() {
  return {
    phone: $("quickPhone").value.trim(),
    label: $("quickLabel").value.trim(),
    variables: parseVariables($("quickVars").value),
  };
}

function testInBrowser(button) {
  const { phone, label, variables } = quickInputs();
  if (!phone) {
    banner("Enter a phone number first.");
    $("quickPhone").focus();
    return;
  }
  if (state.conversation) {
    banner("A call is already running — press End call.");
    return;
  }

  setBusy(button, true);
  startBrowserCall(phone, variables, {
    active: () => {
      setBusy(button, false);
      rememberNumber(phone, label);
    },
    end: () => setBusy(button, false),
  }).finally(() => setBusy(button, false));
}

async function callOnPhone(button) {
  const { phone, label, variables } = quickInputs();
  if (!phone) {
    banner("Enter a phone number first.");
    $("quickPhone").focus();
    return;
  }

  const numberId = $("phoneNumberSetting").value || state.settings?.phone_number_id || "";
  if (!numberId) {
    banner("Real phone calls need an outbound number — add one in ElevenLabs, then pick it in Settings.");
    return;
  }

  if (!confirm(`Place a real call to ${phone} now?\nIt is billed per minute.`)) return;

  setBusy(button, true);
  try {
    const data = await api("api/start-batch.php", {
      method: "POST",
      body: JSON.stringify({
        phone,
        variables,
        call_name: label ? `Quick call · ${label}` : "",
      }),
    });
    banner(`Call queued to ${data.phone} — status ${data.campaign.status}. Watch it under Excel → calls.`, "ok");
    await rememberNumber(data.phone, label);
    await loadCampaigns(true);
    setTimeout(() => loadCalls(true, true), 6000);
  } catch (error) {
    banner(error.message);
  } finally {
    setBusy(button, false);
  }
}

$("quickBrowser").addEventListener("click", (event) => testInBrowser(event.currentTarget));
$("quickPhoneBtn").addEventListener("click", (event) => callOnPhone(event.currentTarget));

$("quickEnd").addEventListener("click", async () => {
  if (state.conversation) await state.conversation.endSession();
});

$("quickPhone").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    testInBrowser($("quickBrowser"));
  }
});

$("quickVars").addEventListener("input", () => store.set("quickVars", $("quickVars").value));

/* ---------------------------------------------------------------- boot */

function bindTabs() {
  document.querySelectorAll(".tab[data-view]").forEach((tab) => {
    tab.addEventListener("click", () => showView(tab.dataset.view));
  });

  // Deep links (#dialer) and back/forward should land on the matching view.
  window.addEventListener("hashchange", () => {
    const name = location.hash.replace("#", "");
    if (name && name !== state.view) showView(name);
  });

  // Safari/Chrome restore the page from bfcache with the old DOM.
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    const name = location.hash.replace("#", "") || "quick";
    if (name !== state.view) showView(name);
  });
}

function restoreInputs() {
  $("mode").value = store.get("mode", "browser");
  $("callName").value = store.get("callName", "");
  $("batchLimit").value = store.get("batchLimit", "");
  $("quickVars").value = store.get("quickVars", "");
  $("autoRefresh").checked = store.get("autoRefresh", true);
  updateAutoRefresh();
}

function autoTick() {
  if (document.hidden || !state.autoRefresh) return;
  if (state.view === "calls") loadCalls(true, true);
  if (state.view === "dialer") loadCampaigns(true);
}

(async function boot() {
  bindTabs();
  restoreInputs();
  setQuickState(false);
  showView(location.hash.replace("#", "") || "quick"); // paint the right tab immediately

  await loadSettings();
  await loadPhoneNumbers();
  await loadRecent();
  await loadRecipients();
  $("mode").dispatchEvent(new Event("change"));

  state.ready = true;
  loadCampaigns(false);
  loadCalls(true);

  setInterval(autoTick, 20000);
})();
