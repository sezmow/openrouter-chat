(function () {
  "use strict";

  const DEFAULT_MODEL = "openai/gpt-4o-mini";
  const DEFAULT_PROVIDER = "openrouter";
  const STORAGE_KEYS = {
    apiKey: "claudechat_api_key",
    nvidiaApiKey: "claudechat_nvidia_api_key",
    nvidiaProxyUrl: "claudechat_nvidia_proxy_url",
    systemPrompt: "claudechat_system_prompt",
    model: "claudechat_model",
    provider: "claudechat_provider",
    conversations: "claudechat_conversations",
    activeId: "claudechat_active_id",
    webSearch: "claudechat_web_search",
  };
  const DEFAULT_REASONING_EFFORTS = ["high", "medium", "low"];

  // NVIDIA's own model-listing endpoint (integrate.api.nvidia.com/v1/models)
  // returns bare ids only — no pricing, context length, or capability flags.
  // This is a hand-curated best-effort supplement built from NVIDIA's public
  // catalog and model documentation, so the existing filters have something
  // to work with. It may be incomplete or go stale as NVIDIA adds models —
  // anything not listed here is just treated as an untagged general chat model.
  // All NVIDIA NIM catalog models are free to use with a personal API key.
  const NVIDIA_NON_CHAT = new Set([
    "baai/bge-m3", "google/deplot", "meta/llama-guard-4-12b",
    "nvidia/ai-synthetic-video-detector", "nvidia/embed-qa-4",
    "nvidia/ising-calibration-1.5-31b",
    "nvidia/llama-3.1-nemoguard-8b-content-safety",
    "nvidia/llama-3.1-nemoguard-8b-topic-control",
    "nvidia/llama-3.1-nemotron-safety-guard-8b-v3",
    "nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1",
    "nvidia/llama-3.2-nv-embedqa-1b-v1",
    "nvidia/llama-nemotron-embed-1b-v2",
    "nvidia/llama-nemotron-embed-vl-1b-v2",
    "nvidia/nemoretriever-parse",
    "nvidia/nemotron-3-embed-1b",
    "nvidia/nemotron-3.5-content-safety",
    "nvidia/nemotron-4-340b-reward",
    "nvidia/nemotron-parse",
    "nvidia/nv-embed-v1", "nvidia/nv-embedcode-7b-v1",
    "nvidia/nv-embedqa-e5-v5", "nvidia/nv-embedqa-mistral-7b-v2",
    "nvidia/nvclip",
    "nvidia/riva-translate-4b-instruct", "nvidia/riva-translate-4b-instruct-v1.1",
    "nvidia/riva-translate-4b-instruct-v2",
    "snowflake/arctic-embed-l",
  ]);
  const NVIDIA_THINKING = new Set([
    "minimaxai/minimax-m3", "moonshotai/kimi-k2.6", "moonshotai/kimi-k3",
    "nvidia/cosmos-reason2-8b", "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    "nvidia/llama-3.3-nemotron-super-49b-v1", "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nvidia-nemotron-nano-9b-v2",
    "openai/gpt-oss-120b", "openai/gpt-oss-20b",
  ]);
  const PROVIDERS = {
    openrouter: {
      label: "OpenRouter",
      apiBase: "https://openrouter.ai/api/v1",
    },
    nvidia: {
      label: "NVIDIA",
      apiBase: null, // resolved from state.providers.nvidia.proxyUrl at call time
    },
  };
  const THINKING_PHASES = {
    connecting: { icon: "\u{1F4AD}", label: "Thinking" },
    searching: { icon: "\u{1F310}", label: "Searching the web" },
    reasoning: { icon: "\u{1F9E0}", label: "Reasoning" },
    generatingImage: { icon: "\u{1F3A8}", label: "Generating image" },
  };
  const ICON_SVG = {
    copy: '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    check: '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    edit: '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    regenerate: '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>',
  };

  // ---------- State ----------
  let state = {
    providers: {
      openrouter: { apiKey: localStorage.getItem(STORAGE_KEYS.apiKey) || "" },
      nvidia: {
        apiKey: localStorage.getItem(STORAGE_KEYS.nvidiaApiKey) || "",
        proxyUrl: (localStorage.getItem(STORAGE_KEYS.nvidiaProxyUrl) || "").replace(/\/+$/, ""),
      },
    },
    systemPrompt: localStorage.getItem(STORAGE_KEYS.systemPrompt) || "",
    model: localStorage.getItem(STORAGE_KEYS.model) || DEFAULT_MODEL,
    provider: localStorage.getItem(STORAGE_KEYS.provider) || DEFAULT_PROVIDER,
    conversations: [],
    activeId: null,
    isStreaming: false,
    abortController: null,
    // Per-provider model maps, e.g. modelsByProviderAndId.openrouter["gpt-4o"].
    modelsByProviderAndId: { openrouter: {}, nvidia: {} },
    modelFilters: { pricing: "all", imageGen: false, thinking: false, provider: "all" },
    webSearchEnabled: localStorage.getItem(STORAGE_KEYS.webSearch) === "1",
  };
  function hasAnyApiKey() {
    return !!(state.providers.openrouter.apiKey || state.providers.nvidia.apiKey);
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEYS.conversations);
    state.conversations = raw ? JSON.parse(raw) : [];
  } catch (e) {
    state.conversations = [];
  }
  state.activeId = localStorage.getItem(STORAGE_KEYS.activeId) || null;

  // ---------- DOM refs ----------
  const el = {
    sidebar: document.getElementById("sidebar"),
    collapseBtn: document.getElementById("collapse-btn"),
    expandBtn: document.getElementById("expand-btn"),
    newChatBtn: document.getElementById("new-chat-btn"),
    convList: document.getElementById("conversation-list"),
    settingsBtn: document.getElementById("settings-btn"),
    modelInput: document.getElementById("model-input"),
    modelsDatalist: document.getElementById("models-datalist"),
    fetchModelsBtn: document.getElementById("fetch-models-btn"),
    topbarStatus: document.getElementById("topbar-status"),
    messages: document.getElementById("messages"),
    composerInput: document.getElementById("composer-input"),
    sendBtn: document.getElementById("send-btn"),
    errorContainer: document.getElementById("error-container"),
    settingsModal: document.getElementById("settings-modal"),
    apiKeyInput: document.getElementById("api-key-input"),
    toggleKeyVisibility: document.getElementById("toggle-key-visibility"),
    nvidiaKeyInput: document.getElementById("nvidia-key-input"),
    toggleNvidiaKeyVisibility: document.getElementById("toggle-nvidia-key-visibility"),
    nvidiaProxyInput: document.getElementById("nvidia-proxy-input"),
    systemPromptInput: document.getElementById("system-prompt-input"),
    settingsCancelBtn: document.getElementById("settings-cancel-btn"),
    settingsSaveBtn: document.getElementById("settings-save-btn"),
    pricingFilter: document.getElementById("pricing-filter"),
    filterImageGen: document.getElementById("filter-image-gen"),
    filterThinking: document.getElementById("filter-thinking"),
    providerFilter: document.getElementById("provider-filter"),
    effortSelect: document.getElementById("effort-select"),
    webToggle: document.getElementById("web-toggle"),
    filtersBtn: document.getElementById("filters-btn"),
    filtersPopover: document.getElementById("filters-popover"),
    composerCost: document.getElementById("composer-cost"),
    providerBadge: document.getElementById("provider-badge"),
  };

  el.webToggle.classList.toggle("active", state.webSearchEnabled);
  el.webToggle.setAttribute("aria-pressed", String(state.webSearchEnabled));

  // ---------- Persistence helpers ----------
  function saveConversations() {
    try {
      localStorage.setItem(STORAGE_KEYS.conversations, JSON.stringify(state.conversations));
    } catch (e) {
      showError("Couldn't save this conversation locally (browser storage is full — generated images can be large). The reply is still shown, but it won't persist after reload.");
    }
  }
  function saveActiveId() {
    if (state.activeId) localStorage.setItem(STORAGE_KEYS.activeId, state.activeId);
  }

  // ---------- Utilities ----------
  function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  // Minimal markdown: fenced code blocks, headers, lists, links, bold/italic/inline code
  function renderInline(text) {
    let seg = escapeHtml(text);
    seg = seg.replace(/`([^`]+)`/g, "<code>$1</code>");
    seg = seg.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    seg = seg.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    seg = seg.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    seg = seg.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
    return seg;
  }
  function splitTableRow(line) {
    let cells = line.split("|");
    if (cells.length && cells[0].trim() === "") cells.shift();
    if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
    return cells.map((c) => c.trim());
  }
  function isTableSeparatorRow(line) {
    const cells = splitTableRow(line);
    if (!cells.length) return false;
    return cells.every((c) => /^:?-+:?$/.test(c));
  }
  function renderMarkdownBlock(text) {
    const lines = text.split("\n");
    let html = "";
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.includes("|") && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1])) {
        const headerCells = splitTableRow(line);
        const aligns = splitTableRow(lines[i + 1]).map((c) => {
          const left = c.startsWith(":");
          const right = c.endsWith(":");
          if (left && right) return "center";
          if (right) return "right";
          if (left) return "left";
          return "";
        });
        i += 2;
        const bodyRows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
          bodyRows.push(splitTableRow(lines[i]));
          i++;
        }
        const alignAttr = (idx) => (aligns[idx] ? ' style="text-align:' + aligns[idx] + '"' : "");
        html += "<table><thead><tr>";
        headerCells.forEach((c, ci) => { html += "<th" + alignAttr(ci) + ">" + renderInline(c) + "</th>"; });
        html += "</tr></thead><tbody>";
        bodyRows.forEach((row) => {
          html += "<tr>";
          row.forEach((c, ci) => { html += "<td" + alignAttr(ci) + ">" + renderInline(c) + "</td>"; });
          html += "</tr>";
        });
        html += "</tbody></table>";
        continue;
      }
      const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headerMatch) {
        const level = headerMatch[1].length;
        html += "<h" + level + ">" + renderInline(headerMatch[2]) + "</h" + level + ">";
        i++;
        continue;
      }
      if (/^[-*]\s+/.test(line)) {
        let items = "";
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
          items += "<li>" + renderInline(lines[i].replace(/^[-*]\s+/, "")) + "</li>";
          i++;
        }
        html += "<ul>" + items + "</ul>";
        continue;
      }
      if (/^\d+\.\s+/.test(line)) {
        let items = "";
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          items += "<li>" + renderInline(lines[i].replace(/^\d+\.\s+/, "")) + "</li>";
          i++;
        }
        html += "<ol>" + items + "</ol>";
        continue;
      }
      html += renderInline(line) + (i < lines.length - 1 ? "\n" : "");
      i++;
    }
    return html;
  }
  // Tokenize into code fences, math spans (left untouched so KaTeX can find them
  // and our own bold/italic regexes can't corrupt LaTeX source), and plain text.
  function tokenizeMarkdown(text) {
    const re = /```[\s\S]*?```|\$\$[\s\S]+?\$\$|\$[^\n$]+?\$/g;
    const tokens = [];
    let lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > lastIndex) tokens.push({ type: "text", content: text.slice(lastIndex, m.index) });
      const matched = m[0];
      if (matched.startsWith("```")) {
        tokens.push({ type: "code", content: matched });
      } else {
        const inner = matched.startsWith("$$") ? matched.slice(2, -2) : matched.slice(1, -1);
        const looksLikeBareCurrency = /^\s*\d[\d,]*(\.\d+)?\s*$/.test(inner);
        // Two dollar amounts in one sentence ("$5 and $10") can look like a math
        // span too; back off if the content reads like prose (consecutive plain words).
        const looksLikeProse = /([a-zA-Z]{3,}\s+){1,}[a-zA-Z]{3,}/.test(inner);
        tokens.push({ type: (looksLikeBareCurrency || looksLikeProse) ? "text" : "math", content: matched });
      }
      lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) tokens.push({ type: "text", content: text.slice(lastIndex) });
    return tokens;
  }
  // Renders markdown to {html, mathSpans}. Math placeholders are empty elements
  // by id; renderMathSpans() fills them in afterward via katex.render() directly
  // on those exact ids — never a blanket text scan, so a span our own tokenizer
  // ruled out as prose/currency can never get caught by a second-pass scanner.
  function renderMarkdown(text) {
    const tokens = tokenizeMarkdown(text);
    let html = "";
    const mathSpans = [];
    for (const tok of tokens) {
      if (tok.type === "code") {
        let block = tok.content.slice(3, -3);
        const firstNewline = block.indexOf("\n");
        if (firstNewline !== -1 && /^[a-zA-Z0-9_+-]*$/.test(block.slice(0, firstNewline).trim())) {
          block = block.slice(firstNewline + 1);
        }
        html += "<pre><code>" + escapeHtml(block.replace(/\n$/, "")) + "</code></pre>";
      } else if (tok.type === "math") {
        const isDisplay = tok.content.startsWith("$$");
        const latex = isDisplay ? tok.content.slice(2, -2) : tok.content.slice(1, -1);
        const id = "katex-" + uid();
        mathSpans.push({ id: id, latex: latex, display: isDisplay });
        html += isDisplay
          ? '<div class="katex-block" id="' + id + '"></div>'
          : '<span id="' + id + '"></span>';
      } else {
        html += renderMarkdownBlock(tok.content);
      }
    }
    return { html: html, mathSpans: mathSpans };
  }
  function renderMathSpans(container, mathSpans) {
    if (!window.katex || !mathSpans.length) return;
    mathSpans.forEach((s) => {
      const target = container.querySelector("#" + s.id);
      if (!target) return;
      try {
        window.katex.render(s.latex, target, { throwOnError: false, displayMode: s.display });
      } catch (e) {
        target.textContent = s.display ? ("$$" + s.latex + "$$") : ("$" + s.latex + "$");
      }
    });
  }
  function formatApiError(errObj) {
    if (!errObj) return "Unknown error";
    let msg = errObj.message || "Unknown error";
    const meta = errObj.metadata;
    if (meta) {
      if (meta.raw) {
        const raw = typeof meta.raw === "string" ? meta.raw : JSON.stringify(meta.raw);
        msg += " — " + raw;
      }
      if (meta.provider_name) msg += " [via " + meta.provider_name + "]";
    }
    return msg;
  }
  function showError(message) {
    el.errorContainer.innerHTML = "";
    const div = document.createElement("div");
    div.className = "error-banner";
    div.textContent = message;
    el.errorContainer.appendChild(div);
  }
  function clearError() {
    el.errorContainer.innerHTML = "";
  }
  function authHeaders(providerId) {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + state.providers[providerId].apiKey,
    };
  }
  function apiBaseFor(providerId) {
    if (providerId === "nvidia") return state.providers.nvidia.proxyUrl;
    return PROVIDERS[providerId].apiBase;
  }
  function isProviderUsable(providerId) {
    if (!state.providers[providerId].apiKey) return false;
    if (providerId === "nvidia" && !state.providers.nvidia.proxyUrl) return false;
    return true;
  }

  // ---------- Conversations ----------
  function getActiveConversation() {
    return state.conversations.find((c) => c.id === state.activeId) || null;
  }
  function createConversation() {
    const startModel = el.modelInput.value.trim() || state.model || DEFAULT_MODEL;
    const startProvider = state.provider || DEFAULT_PROVIDER;
    const conv = { id: uid(), title: "New chat", messages: [], createdAt: Date.now(), model: startModel, provider: startProvider };
    state.conversations.unshift(conv);
    state.activeId = conv.id;
    saveConversations();
    saveActiveId();
    applyActiveConversationModel();
    return conv;
  }
  function deleteConversation(id) {
    state.conversations = state.conversations.filter((c) => c.id !== id);
    if (state.activeId === id) {
      state.activeId = state.conversations.length ? state.conversations[0].id : null;
      saveActiveId();
      applyActiveConversationModel();
    }
    saveConversations();
    renderSidebar();
    renderMessages();
  }
  function selectConversation(id) {
    state.activeId = id;
    saveActiveId();
    clearError();
    applyActiveConversationModel();
    renderSidebar();
    renderMessages();
  }
  function setModelAndProvider(model, providerId) {
    state.model = model;
    state.provider = providerId;
    localStorage.setItem(STORAGE_KEYS.model, model);
    localStorage.setItem(STORAGE_KEYS.provider, providerId);
    const conv = getActiveConversation();
    if (conv) { conv.model = model; conv.provider = providerId; saveConversations(); }
    updateProviderBadge(providerId);
  }
  function updateProviderBadge(providerId) {
    const p = PROVIDERS[providerId];
    el.providerBadge.textContent = p ? p.label : "";
  }
  function applyActiveConversationModel() {
    const conv = getActiveConversation();
    const model = (conv && conv.model) || state.model || DEFAULT_MODEL;
    const providerId = (conv && conv.provider) || state.provider || DEFAULT_PROVIDER;
    el.modelInput.value = model;
    state.model = model;
    state.provider = providerId;
    localStorage.setItem(STORAGE_KEYS.model, model);
    localStorage.setItem(STORAGE_KEYS.provider, providerId);
    updateProviderBadge(providerId);
    refreshEffortSelect();
  }

  // ---------- Rendering: sidebar ----------
  function renderSidebar() {
    el.convList.innerHTML = "";
    state.conversations.forEach((conv) => {
      const item = document.createElement("div");
      item.className = "conv-item" + (conv.id === state.activeId ? " active" : "");
      const title = document.createElement("span");
      title.className = "conv-title";
      title.textContent = conv.title || "New chat";
      title.title = "Double-click to rename";
      title.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        startRenameConversation(item, conv);
      });
      const del = document.createElement("button");
      del.className = "conv-delete";
      del.innerHTML = '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';
      del.title = "Delete";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteConversation(conv.id);
      });
      item.appendChild(title);
      item.appendChild(del);
      item.addEventListener("click", () => selectConversation(conv.id));
      el.convList.appendChild(item);
    });
  }
  function startRenameConversation(item, conv) {
    const titleEl = item.querySelector(".conv-title");
    const input = document.createElement("input");
    input.className = "conv-rename-input";
    input.value = conv.title || "";
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const val = input.value.trim();
      conv.title = val || conv.title || "New chat";
      saveConversations();
      renderSidebar();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); renderSidebar(); }
    });
    input.addEventListener("blur", commit);
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  // ---------- Rendering: messages ----------
  function renderMessages(preserveScroll) {
    const conv = getActiveConversation();
    const shouldStickToBottom = !preserveScroll || isNearBottom();
    el.messages.innerHTML = "";
    if (!conv || conv.messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = '<div>What can I help with?</div><div class="hint">Set your API key in settings, fetch or type a model, then start chatting.</div>';
      el.messages.appendChild(empty);
      updateCostSummary(null);
      return;
    }
    conv.messages.forEach((m, idx) => appendMessageEl(conv, idx, idx === conv.messages.length - 1));
    if (shouldStickToBottom) el.messages.scrollTop = el.messages.scrollHeight;
    updateCostSummary(conv);
  }
  function makeActionBtn(iconHtml, title, onClick) {
    const btn = document.createElement("button");
    btn.className = "msg-action-btn";
    btn.type = "button";
    btn.innerHTML = iconHtml;
    btn.title = title;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(btn);
    });
    return btn;
  }
  function copyMessageText(text, btn) {
    navigator.clipboard.writeText(text || "").then(() => {
      const original = btn.innerHTML;
      btn.innerHTML = ICON_SVG.check;
      setTimeout(() => { btn.innerHTML = original; }, 1200);
    }).catch(() => {
      showError("Couldn't copy to clipboard.");
    });
  }
  function formatUsage(usage) {
    const parts = [];
    if (typeof usage.completionTokens === "number") parts.push(usage.completionTokens.toLocaleString() + " tokens");
    if (typeof usage.cost === "number" && usage.cost > 0) parts.push("$" + usage.cost.toFixed(usage.cost < 0.01 ? 5 : 4));
    return parts.join(" · ");
  }
  function updateCostSummary(conv) {
    if (!conv) { el.composerCost.textContent = ""; return; }
    const total = conv.messages.reduce((sum, m) => sum + ((m.usage && m.usage.cost) || 0), 0);
    el.composerCost.textContent = total > 0 ? ("This chat: $" + total.toFixed(total < 0.01 ? 5 : 4)) : "";
  }
  function appendMessageEl(conv, idx, isLast) {
    const m = conv.messages[idx];
    const row = document.createElement("div");
    row.className = "msg-row " + m.role;
    const col = document.createElement("div");
    col.className = "msg-col";
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    const rendered = renderMarkdown(m.content || "");
    bubble.innerHTML = rendered.html + renderImages(m.images) + renderCitations(m.citations);
    renderMathSpans(bubble, rendered.mathSpans);
    if (m.role === "assistant" && m.usage) {
      const usageEl = document.createElement("div");
      usageEl.className = "msg-usage";
      usageEl.textContent = formatUsage(m.usage);
      bubble.appendChild(usageEl);
    }
    col.appendChild(bubble);

    const actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.appendChild(makeActionBtn(ICON_SVG.copy, "Copy", (btn) => copyMessageText(m.content, btn)));
    if (m.role === "user") {
      actions.appendChild(makeActionBtn(ICON_SVG.edit, "Edit & resend", () => startEditMessage(conv, idx)));
    } else if (m.role === "assistant" && isLast) {
      actions.appendChild(makeActionBtn(ICON_SVG.regenerate, "Regenerate", () => regenerateLastResponse()));
    }
    col.appendChild(actions);
    row.appendChild(col);

    el.messages.appendChild(row);
    return bubble;
  }
  function createBareAssistantBubble() {
    const row = document.createElement("div");
    row.className = "msg-row assistant";
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    row.appendChild(bubble);
    el.messages.appendChild(row);
    return bubble;
  }
  function renderImages(images) {
    if (!images || !images.length) return "";
    return images.map((img) => {
      const url = img.image_url && img.image_url.url;
      if (!url) return "";
      return '<img class="msg-image" src="' + url.replace(/"/g, "&quot;") + '" alt="Generated image">';
    }).join("");
  }
  function renderCitations(citations) {
    if (!citations || !citations.length) return "";
    const items = citations.map((c) => {
      const label = escapeHtml(c.title || c.url);
      const href = escapeHtml(c.url);
      return '<a href="' + href + '" target="_blank" rel="noopener noreferrer" title="' + href + '">' + label + "</a>";
    }).join("");
    return '<div class="citations"><span class="citations-label">Sources:</span>' + items + "</div>";
  }

  // ---------- Thinking indicator ----------
  function ensureThinkingIndicator(bubble) {
    if (bubble.querySelector(".thinking-indicator")) return;
    bubble.innerHTML =
      '<div class="thinking-indicator">' +
        '<span class="thinking-icon"></span>' +
        '<span class="thinking-label"></span>' +
        '<span class="thinking-ellipsis"><span></span><span></span><span></span></span>' +
      "</div>";
  }
  function setThinkingPhase(bubble, phaseKey) {
    ensureThinkingIndicator(bubble);
    const phase = THINKING_PHASES[phaseKey];
    const labelEl = bubble.querySelector(".thinking-label");
    const iconEl = bubble.querySelector(".thinking-icon");
    if (labelEl.textContent === phase.label) return;
    labelEl.classList.add("swapping");
    setTimeout(() => {
      iconEl.textContent = phase.icon;
      labelEl.textContent = phase.label;
      labelEl.classList.remove("swapping");
    }, 150);
  }

  function autoTitle(conv) {
    const firstUser = conv.messages.find((m) => m.role === "user");
    if (firstUser) {
      let t = firstUser.content.trim().replace(/\s+/g, " ");
      conv.title = t.length > 40 ? t.slice(0, 40) + "..." : (t || "New chat");
    }
  }

  // ---------- Model capabilities ----------
  function providerPriorityOrder() {
    return state.modelFilters.provider === "nvidia" ? ["nvidia", "openrouter"] : ["openrouter", "nvidia"];
  }
  function findModelAcrossProviders(modelId) {
    const order = providerPriorityOrder();
    for (const p of order) {
      const hit = state.modelsByProviderAndId[p][modelId];
      if (hit) return hit;
    }
    return null;
  }
  function getModelInfo(modelId, providerHint) {
    if (providerHint && state.modelsByProviderAndId[providerHint] && state.modelsByProviderAndId[providerHint][modelId]) {
      return state.modelsByProviderAndId[providerHint][modelId];
    }
    return findModelAcrossProviders(modelId);
  }
  function getReasoningCapability(info) {
    if (!info) return null;
    const sp = info.supported_parameters || [];
    const capable = sp.includes("reasoning") || sp.includes("reasoning_effort") || sp.includes("include_reasoning");
    if (!capable) return null;
    const mandatory = !!(info.reasoning && info.reasoning.mandatory);
    const efforts = (info.reasoning && info.reasoning.supported_efforts) || DEFAULT_REASONING_EFFORTS;
    const defaultEffort = info.reasoning && info.reasoning.default_effort;
    return { mandatory, efforts, defaultEffort };
  }
  // Whether a model can be pointed at "thinking" mode at all, for the filter.
  // OpenRouter exposes this via real metadata; NVIDIA doesn't, so this falls
  // back to the hand-curated NVIDIA_THINKING set instead.
  function isThinkingModel(info) {
    if (!info) return false;
    if (info.provider === "nvidia") return !!info._thinking;
    return !!getReasoningCapability(info);
  }
  function isFreeModel(info) {
    const p = info.pricing || {};
    const prompt = parseFloat(p.prompt || "0") || 0;
    const completion = parseFloat(p.completion || "0") || 0;
    return prompt === 0 && completion === 0;
  }
  function hasImageOutput(info) {
    const om = (info.architecture && info.architecture.output_modalities) || [];
    return om.includes("image");
  }
  function passesModelFilters(info) {
    const f = state.modelFilters;
    if (f.provider !== "all" && info.provider !== f.provider) return false;
    if (f.pricing === "free" && !isFreeModel(info)) return false;
    if (f.pricing === "paid" && isFreeModel(info)) return false;
    if (f.imageGen && !hasImageOutput(info)) return false;
    if (f.thinking && !isThinkingModel(info)) return false;
    return true;
  }

  // ---------- Models ----------
  function updateFiltersBadge() {
    const f = state.modelFilters;
    const active = f.pricing !== "all" || f.imageGen || f.thinking || f.provider !== "all";
    el.filtersBtn.classList.toggle("has-active", active);
  }
  function rebuildModelsDatalist() {
    const order = providerPriorityOrder();
    const seen = new Set();
    const filtered = [];
    let totalChatModels = 0;
    order.forEach((p) => {
      Object.values(state.modelsByProviderAndId[p]).forEach((info) => {
        if (info.isChatModel === false) return;
        totalChatModels++;
        if (seen.has(info.id)) return; // id collision across providers: first in priority order wins
        if (!passesModelFilters(info)) return;
        seen.add(info.id);
        filtered.push(info);
      });
    });
    filtered.sort((a, b) => a.id.localeCompare(b.id));
    el.modelsDatalist.innerHTML = "";
    filtered.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      const displayName = m.name && m.name !== m.id ? (m.name + " (" + m.id + ")") : m.id;
      opt.label = displayName + " — " + PROVIDERS[m.provider].label;
      el.modelsDatalist.appendChild(opt);
    });
    el.topbarStatus.textContent = totalChatModels
      ? (filtered.length === totalChatModels ? (filtered.length + " models available") : (filtered.length + " of " + totalChatModels + " models"))
      : "";
    if (filtered.length) {
      const current = el.modelInput.value.trim();
      const stillAvailable = current && (state.modelsByProviderAndId.openrouter[current] || state.modelsByProviderAndId.nvidia[current]);
      if (!stillAvailable) {
        el.modelInput.value = filtered[0].id;
        setModelAndProvider(filtered[0].id, filtered[0].provider);
      }
    }
    updateFiltersBadge();
    refreshEffortSelect();
  }
  async function fetchOpenRouterModels() {
    if (!isProviderUsable("openrouter")) { state.modelsByProviderAndId.openrouter = {}; return; }
    const res = await fetch(apiBaseFor("openrouter") + "/models", { headers: authHeaders("openrouter") });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error("OpenRouter: " + ((body.error && body.error.message) || ("HTTP " + res.status)));
    }
    const data = await res.json();
    const map = {};
    (data.data || []).forEach((m) => {
      m.provider = "openrouter";
      m.isChatModel = true;
      map[m.id] = m;
    });
    state.modelsByProviderAndId.openrouter = map;
  }
  async function fetchNvidiaModels() {
    if (!isProviderUsable("nvidia")) { state.modelsByProviderAndId.nvidia = {}; return; }
    const res = await fetch(apiBaseFor("nvidia") + "/models", { headers: authHeaders("nvidia") });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error("NVIDIA: " + ((body.error && body.error.message) || ("HTTP " + res.status)));
    }
    const data = await res.json();
    const map = {};
    (data.data || []).forEach((raw) => {
      map[raw.id] = {
        id: raw.id,
        name: raw.id,
        provider: "nvidia",
        isChatModel: !NVIDIA_NON_CHAT.has(raw.id),
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["text"] },
        supported_parameters: [],
        _thinking: NVIDIA_THINKING.has(raw.id),
      };
    });
    state.modelsByProviderAndId.nvidia = map;
  }
  async function fetchModels() {
    if (!hasAnyApiKey()) {
      openSettings();
      showError("Add an API key first, then fetch models.");
      return;
    }
    el.fetchModelsBtn.disabled = true;
    el.fetchModelsBtn.textContent = "Fetching...";
    clearError();
    const errors = [];
    await Promise.all([
      fetchOpenRouterModels().catch((e) => errors.push(e.message)),
      fetchNvidiaModels().catch((e) => errors.push(e.message)),
    ]);
    rebuildModelsDatalist();
    if (errors.length) showError("Couldn't fetch some models: " + errors.join(" / "));
    el.fetchModelsBtn.disabled = false;
    el.fetchModelsBtn.textContent = "Fetch models";
  }
  function refreshEffortSelect() {
    const modelId = el.modelInput.value.trim() || DEFAULT_MODEL;
    const conv = getActiveConversation();
    const providerHint = (conv && conv.provider) || state.provider;
    const info = getModelInfo(modelId, providerHint);
    const cap = getReasoningCapability(info);
    const prevValue = el.effortSelect.value;

    el.effortSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Effort";
    el.effortSelect.appendChild(placeholder);

    if (!cap) {
      el.effortSelect.disabled = true;
      el.effortSelect.title = info ? "This model has no reasoning/effort options." : "Fetch models to see effort options.";
      return;
    }
    if (!cap.mandatory) {
      const offOpt = document.createElement("option");
      offOpt.value = "off";
      offOpt.textContent = "Off";
      el.effortSelect.appendChild(offOpt);
    }
    cap.efforts.forEach((eff) => {
      const opt = document.createElement("option");
      opt.value = eff;
      opt.textContent = eff.charAt(0).toUpperCase() + eff.slice(1);
      el.effortSelect.appendChild(opt);
    });
    el.effortSelect.disabled = false;
    el.effortSelect.title = cap.mandatory
      ? "This model always reasons" + (cap.defaultEffort ? " (default: " + cap.defaultEffort + ")" : "") + "."
      : "Enable extended thinking at a chosen effort level.";

    const validValues = Array.from(el.effortSelect.options).map((o) => o.value);
    el.effortSelect.value = validValues.includes(prevValue) ? prevValue : "";
  }

  // ---------- Sending messages ----------
  function isNearBottom() {
    return el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight < 80;
  }
  async function sendMessage() {
    const text = el.composerInput.value.trim();
    if (!text || state.isStreaming) return;
    if (!hasAnyApiKey()) {
      openSettings();
      showError("Add an API key first.");
      return;
    }
    const model = el.modelInput.value.trim() || DEFAULT_MODEL;
    const providerId = state.provider || DEFAULT_PROVIDER;
    if (!isProviderUsable(providerId)) {
      openSettings();
      showError((PROVIDERS[providerId] ? PROVIDERS[providerId].label : providerId) + " isn't set up yet — add its API key" + (providerId === "nvidia" ? " and proxy URL" : "") + " in settings.");
      return;
    }
    setModelAndProvider(model, providerId);

    let conv = getActiveConversation();
    if (!conv) conv = createConversation();
    conv.model = model;
    conv.provider = providerId;

    conv.messages.push({ role: "user", content: text });
    if (conv.messages.filter((m) => m.role === "user").length === 1) autoTitle(conv);
    saveConversations();
    renderSidebar();
    renderMessages();

    el.composerInput.value = "";
    autoResizeComposer();
    clearError();

    await generateAssistantReply(conv);
  }
  function regenerateLastResponse() {
    if (state.isStreaming) return;
    const conv = getActiveConversation();
    if (!conv || !conv.messages.length) return;
    const last = conv.messages[conv.messages.length - 1];
    if (last.role !== "assistant") return;
    conv.messages.pop();
    saveConversations();
    renderMessages();
    generateAssistantReply(conv);
  }
  function startEditMessage(conv, idx) {
    if (state.isStreaming) return;
    const msg = conv.messages[idx];
    if (!msg || msg.role !== "user") return;
    conv.messages = conv.messages.slice(0, idx);
    saveConversations();
    renderSidebar();
    renderMessages();
    el.composerInput.value = msg.content;
    autoResizeComposer();
    updateSendButton();
    clearError();
    el.composerInput.focus();
  }
  async function generateAssistantReply(conv) {
    const model = conv.model || el.modelInput.value.trim() || DEFAULT_MODEL;
    const providerId = conv.provider || state.provider || DEFAULT_PROVIDER;
    const modelInfo = getModelInfo(model, providerId);
    const canGenerateImages = !!(modelInfo && hasImageOutput(modelInfo));
    const idlePhase = canGenerateImages ? "generatingImage" : (state.webSearchEnabled && providerId === "openrouter" ? "searching" : "connecting");

    const assistantBubble = createBareAssistantBubble();
    setThinkingPhase(assistantBubble, idlePhase);
    if (isNearBottom()) el.messages.scrollTop = el.messages.scrollHeight;

    const controller = new AbortController();
    state.abortController = controller;
    state.isStreaming = true;
    updateSendButton();

    const chatMessages = conv.messages.map((m) => ({ role: m.role, content: m.content }));
    if (state.systemPrompt.trim()) chatMessages.unshift({ role: "system", content: state.systemPrompt.trim() });
    const payload = {
      model: model,
      stream: true,
      messages: chatMessages,
    };

    const reasoningCap = getReasoningCapability(modelInfo);
    const effortVal = el.effortSelect.value;
    if (reasoningCap && effortVal) {
      if (effortVal === "off") {
        payload.reasoning = { enabled: false };
      } else {
        payload.reasoning = reasoningCap.mandatory ? { effort: effortVal } : { enabled: true, effort: effortVal };
      }
    }
    if (state.webSearchEnabled && providerId === "openrouter") {
      payload.plugins = [{ id: "web" }];
    }
    if (canGenerateImages) {
      payload.modalities = ["text", "image"];
    }

    let assistantText = "";
    let citations = [];
    let images = [];
    let usageInfo = null;
    try {
      const res = await fetch(apiBaseFor(providerId) + "/chat/completions", {
        method: "POST",
        headers: authHeaders(providerId),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ? formatApiError(body.error) : ("HTTP " + res.status));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop();
        for (const evt of events) {
          const lines = evt.split("\n");
          let dataLine = null;
          for (const line of lines) {
            if (line.startsWith("data:")) dataLine = line.slice(5).trim();
          }
          if (!dataLine || dataLine === "[DONE]") continue;
          let parsed;
          try { parsed = JSON.parse(dataLine); } catch (e) { continue; }
          if (parsed.error) {
            throw new Error(formatApiError(parsed.error));
          }
          if (parsed.usage) {
            usageInfo = {
              promptTokens: parsed.usage.prompt_tokens,
              completionTokens: parsed.usage.completion_tokens,
              cost: parsed.usage.cost,
            };
          }
          const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
          if (!delta) continue;
          if (delta.annotations && delta.annotations.length) {
            delta.annotations.forEach((a) => {
              if (a.type === "url_citation" && a.url_citation && !citations.some((c) => c.url === a.url_citation.url)) {
                citations.push(a.url_citation);
              }
            });
          }
          if (delta.images && delta.images.length) {
            images = delta.images;
          }
          if (delta.content || images.length) {
            if (delta.content) assistantText += delta.content;
            const rendered = renderMarkdown(assistantText);
            assistantBubble.innerHTML = rendered.html + renderImages(images) + renderCitations(citations);
            renderMathSpans(assistantBubble, rendered.mathSpans);
            if (isNearBottom()) el.messages.scrollTop = el.messages.scrollHeight;
          } else if (!assistantText) {
            const hasReasoning = delta.reasoning || (delta.reasoning_details && delta.reasoning_details.length);
            setThinkingPhase(assistantBubble, hasReasoning ? "reasoning" : idlePhase);
          }
        }
      }

      conv.messages.push({ role: "assistant", content: assistantText, citations: citations, images: images, usage: usageInfo });
      saveConversations();
      renderSidebar();
      renderMessages(true);
    } catch (err) {
      const wasStopped = err.name === "AbortError";
      if (!wasStopped) showError("Request failed: " + err.message);
      if (assistantText || images.length) {
        conv.messages.push({ role: "assistant", content: assistantText, citations: citations, images: images, usage: usageInfo });
        saveConversations();
      }
      renderSidebar();
      renderMessages(true);
    } finally {
      state.isStreaming = false;
      state.abortController = null;
      updateSendButton();
    }
  }

  function stopStreaming() {
    if (state.abortController) state.abortController.abort();
  }

  function updateSendButton() {
    el.sendBtn.classList.toggle("stop-mode", state.isStreaming);
    el.sendBtn.title = state.isStreaming ? "Stop generating" : "Send";
    el.sendBtn.disabled = state.isStreaming ? false : !el.composerInput.value.trim();
  }

  function autoResizeComposer() {
    el.composerInput.style.height = "auto";
    el.composerInput.style.height = Math.min(el.composerInput.scrollHeight, 200) + "px";
  }

  // ---------- Settings modal ----------
  function openSettings() {
    el.apiKeyInput.value = state.providers.openrouter.apiKey;
    el.apiKeyInput.type = "password";
    el.toggleKeyVisibility.textContent = "Show";
    el.nvidiaKeyInput.value = state.providers.nvidia.apiKey;
    el.nvidiaKeyInput.type = "password";
    el.toggleNvidiaKeyVisibility.textContent = "Show";
    el.nvidiaProxyInput.value = state.providers.nvidia.proxyUrl;
    el.systemPromptInput.value = state.systemPrompt;
    el.settingsModal.classList.remove("hidden");
  }
  function closeSettings() {
    el.settingsModal.classList.add("hidden");
  }
  function saveSettings() {
    state.providers.openrouter.apiKey = el.apiKeyInput.value.trim();
    state.providers.nvidia.apiKey = el.nvidiaKeyInput.value.trim();
    state.providers.nvidia.proxyUrl = el.nvidiaProxyInput.value.trim().replace(/\/+$/, "");
    state.systemPrompt = el.systemPromptInput.value;
    localStorage.setItem(STORAGE_KEYS.apiKey, state.providers.openrouter.apiKey);
    localStorage.setItem(STORAGE_KEYS.nvidiaApiKey, state.providers.nvidia.apiKey);
    localStorage.setItem(STORAGE_KEYS.nvidiaProxyUrl, state.providers.nvidia.proxyUrl);
    localStorage.setItem(STORAGE_KEYS.systemPrompt, state.systemPrompt);
    closeSettings();
    clearError();
    if (hasAnyApiKey()) fetchModels();
  }

  // ---------- Event listeners ----------
  el.newChatBtn.addEventListener("click", () => {
    createConversation();
    clearError();
    renderSidebar();
    renderMessages();
    el.composerInput.focus();
  });
  el.collapseBtn.addEventListener("click", () => {
    el.sidebar.classList.add("collapsed");
    el.expandBtn.style.display = "flex";
  });
  el.expandBtn.addEventListener("click", () => {
    el.sidebar.classList.remove("collapsed");
    el.expandBtn.style.display = "none";
  });
  el.settingsBtn.addEventListener("click", openSettings);
  el.settingsCancelBtn.addEventListener("click", closeSettings);
  el.settingsSaveBtn.addEventListener("click", saveSettings);
  el.toggleKeyVisibility.addEventListener("click", () => {
    const show = el.apiKeyInput.type === "password";
    el.apiKeyInput.type = show ? "text" : "password";
    el.toggleKeyVisibility.textContent = show ? "Hide" : "Show";
  });
  el.toggleNvidiaKeyVisibility.addEventListener("click", () => {
    const show = el.nvidiaKeyInput.type === "password";
    el.nvidiaKeyInput.type = show ? "text" : "password";
    el.toggleNvidiaKeyVisibility.textContent = show ? "Hide" : "Show";
  });
  el.settingsModal.addEventListener("click", (e) => {
    if (e.target === el.settingsModal) closeSettings();
  });
  el.fetchModelsBtn.addEventListener("click", fetchModels);
  el.modelInput.addEventListener("change", () => {
    const model = el.modelInput.value.trim();
    const resolved = findModelAcrossProviders(model);
    const providerId = resolved ? resolved.provider : ((getActiveConversation() && getActiveConversation().provider) || state.provider || DEFAULT_PROVIDER);
    setModelAndProvider(model, providerId);
    refreshEffortSelect();
  });
  el.pricingFilter.addEventListener("change", () => {
    state.modelFilters.pricing = el.pricingFilter.value;
    rebuildModelsDatalist();
  });
  el.filterImageGen.addEventListener("change", () => {
    state.modelFilters.imageGen = el.filterImageGen.checked;
    rebuildModelsDatalist();
  });
  el.filterThinking.addEventListener("change", () => {
    state.modelFilters.thinking = el.filterThinking.checked;
    rebuildModelsDatalist();
  });
  el.providerFilter.addEventListener("change", () => {
    state.modelFilters.provider = el.providerFilter.value;
    rebuildModelsDatalist();
  });
  el.filtersBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = el.filtersPopover.classList.contains("hidden");
    el.filtersPopover.classList.toggle("hidden", !opening);
    el.filtersBtn.setAttribute("aria-expanded", String(opening));
  });
  el.filtersPopover.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => {
    el.filtersPopover.classList.add("hidden");
    el.filtersBtn.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      el.filtersPopover.classList.add("hidden");
      el.filtersBtn.setAttribute("aria-expanded", "false");
    }
  });
  el.webToggle.addEventListener("click", () => {
    state.webSearchEnabled = !state.webSearchEnabled;
    localStorage.setItem(STORAGE_KEYS.webSearch, state.webSearchEnabled ? "1" : "0");
    el.webToggle.classList.toggle("active", state.webSearchEnabled);
    el.webToggle.setAttribute("aria-pressed", String(state.webSearchEnabled));
  });
  el.sendBtn.addEventListener("click", () => {
    if (state.isStreaming) stopStreaming();
    else sendMessage();
  });
  el.composerInput.addEventListener("input", () => {
    autoResizeComposer();
    updateSendButton();
  });
  el.composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ---------- Init ----------
  function init() {
    if (!state.activeId || !getActiveConversation()) {
      if (state.conversations.length) {
        state.activeId = state.conversations[0].id;
      }
    }
    applyActiveConversationModel();
    updateFiltersBadge();
    renderSidebar();
    renderMessages();
    updateSendButton();
    if (!hasAnyApiKey()) {
      openSettings();
    } else {
      fetchModels();
    }
  }
  init();
})();
