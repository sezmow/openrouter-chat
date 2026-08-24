(function () {
  "use strict";

  const API_BASE = "https://openrouter.ai/api/v1";
  const DEFAULT_MODEL = "openai/gpt-4o-mini";
  const STORAGE_KEYS = {
    apiKey: "claudechat_api_key",
    systemPrompt: "claudechat_system_prompt",
    model: "claudechat_model",
    conversations: "claudechat_conversations",
    activeId: "claudechat_active_id",
    webSearch: "claudechat_web_search",
  };
  const DEFAULT_REASONING_EFFORTS = ["high", "medium", "low"];
  const THINKING_PHASES = {
    connecting: { icon: "\u{1F4AD}", label: "Thinking" },
    searching: { icon: "\u{1F310}", label: "Searching the web" },
    reasoning: { icon: "\u{1F9E0}", label: "Reasoning" },
    generatingImage: { icon: "\u{1F3A8}", label: "Generating image" },
  };

  // ---------- State ----------
  let state = {
    apiKey: localStorage.getItem(STORAGE_KEYS.apiKey) || "",
    systemPrompt: localStorage.getItem(STORAGE_KEYS.systemPrompt) || "",
    model: localStorage.getItem(STORAGE_KEYS.model) || DEFAULT_MODEL,
    conversations: [],
    activeId: null,
    isStreaming: false,
    modelsById: {},
    allModels: [],
    modelFilters: { pricing: "all", imageGen: false, thinking: false },
    webSearchEnabled: localStorage.getItem(STORAGE_KEYS.webSearch) === "1",
  };

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
    systemPromptInput: document.getElementById("system-prompt-input"),
    settingsCancelBtn: document.getElementById("settings-cancel-btn"),
    settingsSaveBtn: document.getElementById("settings-save-btn"),
    pricingFilter: document.getElementById("pricing-filter"),
    filterImageGen: document.getElementById("filter-image-gen"),
    filterThinking: document.getElementById("filter-thinking"),
    effortSelect: document.getElementById("effort-select"),
    webToggle: document.getElementById("web-toggle"),
    filtersBtn: document.getElementById("filters-btn"),
    filtersPopover: document.getElementById("filters-popover"),
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
  // Minimal markdown: fenced code blocks, inline code, bold
  function renderMarkdown(text) {
    const parts = text.split(/```/g);
    let html = "";
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        let block = parts[i];
        const firstNewline = block.indexOf("\n");
        if (firstNewline !== -1 && /^[a-zA-Z0-9_+-]*$/.test(block.slice(0, firstNewline).trim())) {
          block = block.slice(firstNewline + 1);
        }
        html += "<pre><code>" + escapeHtml(block.replace(/\n$/, "")) + "</code></pre>";
      } else {
        let seg = escapeHtml(parts[i]);
        seg = seg.replace(/`([^`]+)`/g, "<code>$1</code>");
        seg = seg.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        html += seg;
      }
    }
    return html;
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
  function authHeaders() {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + state.apiKey,
    };
  }

  // ---------- Conversations ----------
  function getActiveConversation() {
    return state.conversations.find((c) => c.id === state.activeId) || null;
  }
  function createConversation() {
    const startModel = el.modelInput.value.trim() || state.model || DEFAULT_MODEL;
    const conv = { id: uid(), title: "New chat", messages: [], createdAt: Date.now(), model: startModel };
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
  function applyActiveConversationModel() {
    const conv = getActiveConversation();
    const model = (conv && conv.model) || state.model || DEFAULT_MODEL;
    el.modelInput.value = model;
    setModel(model);
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

  // ---------- Rendering: messages ----------
  function renderMessages() {
    const conv = getActiveConversation();
    el.messages.innerHTML = "";
    if (!conv || conv.messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = '<div>What can I help with?</div><div class="hint">Set your API key in settings, fetch or type a model, then start chatting.</div>';
      el.messages.appendChild(empty);
      return;
    }
    conv.messages.forEach((m) => appendMessageEl(m.role, m.content, m.citations, m.images));
    el.messages.scrollTop = el.messages.scrollHeight;
  }
  function appendMessageEl(role, content, citations, images) {
    const row = document.createElement("div");
    row.className = "msg-row " + role;
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.innerHTML = renderMarkdown(content || "") + renderImages(images) + renderCitations(citations);
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
  function getModelInfo(modelId) {
    return state.modelsById[modelId] || null;
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
    if (f.pricing === "free" && !isFreeModel(info)) return false;
    if (f.pricing === "paid" && isFreeModel(info)) return false;
    if (f.imageGen && !hasImageOutput(info)) return false;
    if (f.thinking && !getReasoningCapability(info)) return false;
    return true;
  }

  // ---------- Models ----------
  function updateFiltersBadge() {
    const f = state.modelFilters;
    const active = f.pricing !== "all" || f.imageGen || f.thinking;
    el.filtersBtn.classList.toggle("has-active", active);
  }
  function rebuildModelsDatalist() {
    const filtered = state.allModels.filter(passesModelFilters);
    el.modelsDatalist.innerHTML = "";
    filtered.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.label = m.name ? (m.name + " (" + m.id + ")") : m.id;
      el.modelsDatalist.appendChild(opt);
    });
    if (state.allModels.length) {
      el.topbarStatus.textContent = filtered.length === state.allModels.length
        ? (filtered.length + " models available")
        : (filtered.length + " of " + state.allModels.length + " models");
    }
    if (!el.modelInput.value && filtered.length) {
      el.modelInput.value = filtered[0].id;
      setModel(filtered[0].id);
      const conv = getActiveConversation();
      if (conv) { conv.model = filtered[0].id; saveConversations(); }
    }
    updateFiltersBadge();
    refreshEffortSelect();
  }
  async function fetchModels() {
    if (!state.apiKey) {
      openSettings();
      showError("Add your API key first, then fetch models.");
      return;
    }
    el.fetchModelsBtn.disabled = true;
    el.fetchModelsBtn.textContent = "Fetching...";
    clearError();
    try {
      const res = await fetch(API_BASE + "/models", { headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body.error && body.error.message) || ("HTTP " + res.status));
      }
      const data = await res.json();
      state.allModels = (data.data || []).slice().sort((a, b) => a.id.localeCompare(b.id));
      state.modelsById = {};
      state.allModels.forEach((m) => { state.modelsById[m.id] = m; });
      rebuildModelsDatalist();
    } catch (err) {
      showError("Couldn't fetch models: " + err.message);
    } finally {
      el.fetchModelsBtn.disabled = false;
      el.fetchModelsBtn.textContent = "Fetch models";
    }
  }
  function setModel(m) {
    state.model = m;
    localStorage.setItem(STORAGE_KEYS.model, m);
  }
  function refreshEffortSelect() {
    const modelId = el.modelInput.value.trim() || DEFAULT_MODEL;
    const info = getModelInfo(modelId);
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
  async function sendMessage() {
    const text = el.composerInput.value.trim();
    if (!text || state.isStreaming) return;
    if (!state.apiKey) {
      openSettings();
      showError("Add your API key first.");
      return;
    }
    const model = el.modelInput.value.trim() || DEFAULT_MODEL;
    setModel(model);

    let conv = getActiveConversation();
    if (!conv) conv = createConversation();
    conv.model = model;

    conv.messages.push({ role: "user", content: text });
    if (conv.messages.filter((m) => m.role === "user").length === 1) autoTitle(conv);
    saveConversations();
    renderSidebar();
    renderMessages();

    el.composerInput.value = "";
    autoResizeComposer();
    clearError();

    const modelInfo = getModelInfo(model);
    const canGenerateImages = !!(modelInfo && hasImageOutput(modelInfo));
    const idlePhase = canGenerateImages ? "generatingImage" : (state.webSearchEnabled ? "searching" : "connecting");

    const assistantBubble = appendMessageEl("assistant", "");
    setThinkingPhase(assistantBubble, idlePhase);
    el.messages.scrollTop = el.messages.scrollHeight;

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
    if (state.webSearchEnabled) {
      payload.plugins = [{ id: "web" }];
    }
    if (canGenerateImages) {
      payload.modalities = ["text", "image"];
    }

    let assistantText = "";
    let citations = [];
    let images = [];
    try {
      const res = await fetch(API_BASE + "/chat/completions", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
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
            assistantBubble.innerHTML = renderMarkdown(assistantText) + renderImages(images) + renderCitations(citations);
            el.messages.scrollTop = el.messages.scrollHeight;
          } else if (!assistantText) {
            const hasReasoning = delta.reasoning || (delta.reasoning_details && delta.reasoning_details.length);
            setThinkingPhase(assistantBubble, hasReasoning ? "reasoning" : idlePhase);
          }
        }
      }

      if (!assistantText && !images.length) assistantBubble.innerHTML = "<em>(empty response)</em>";
      conv.messages.push({ role: "assistant", content: assistantText, citations: citations, images: images });
      saveConversations();
    } catch (err) {
      assistantBubble.innerHTML = renderMarkdown(assistantText) + renderImages(images) + renderCitations(citations);
      showError("Request failed: " + err.message);
      if (assistantText || images.length) {
        conv.messages.push({ role: "assistant", content: assistantText, citations: citations, images: images });
        saveConversations();
      } else {
        const row = assistantBubble.closest(".msg-row");
        if (row) row.remove();
      }
    } finally {
      state.isStreaming = false;
      updateSendButton();
    }
  }

  function updateSendButton() {
    el.sendBtn.disabled = state.isStreaming || !el.composerInput.value.trim();
  }

  function autoResizeComposer() {
    el.composerInput.style.height = "auto";
    el.composerInput.style.height = Math.min(el.composerInput.scrollHeight, 200) + "px";
  }

  // ---------- Settings modal ----------
  function openSettings() {
    el.apiKeyInput.value = state.apiKey;
    el.apiKeyInput.type = "password";
    el.toggleKeyVisibility.textContent = "Show";
    el.systemPromptInput.value = state.systemPrompt;
    el.settingsModal.classList.remove("hidden");
  }
  function closeSettings() {
    el.settingsModal.classList.add("hidden");
  }
  function saveSettings() {
    state.apiKey = el.apiKeyInput.value.trim();
    state.systemPrompt = el.systemPromptInput.value;
    localStorage.setItem(STORAGE_KEYS.apiKey, state.apiKey);
    localStorage.setItem(STORAGE_KEYS.systemPrompt, state.systemPrompt);
    closeSettings();
    clearError();
    if (state.apiKey) fetchModels();
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
  el.settingsModal.addEventListener("click", (e) => {
    if (e.target === el.settingsModal) closeSettings();
  });
  el.fetchModelsBtn.addEventListener("click", fetchModels);
  el.modelInput.addEventListener("change", () => {
    const model = el.modelInput.value.trim();
    setModel(model);
    const conv = getActiveConversation();
    if (conv) { conv.model = model; saveConversations(); }
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
  el.sendBtn.addEventListener("click", sendMessage);
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
    if (!state.apiKey) {
      openSettings();
    } else {
      fetchModels();
    }
  }
  init();
})();
