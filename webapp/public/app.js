let cachedBasecamps = [];
let startInProgress = new Set();
let cachedScenarioPages = new Map();
let cachedBasecampDetails = new Map();
let cachedScenarioDetails = new Map();
let pollTimer = null;
let moduleRuntimeRef = null;
let scenarioListUnsubscribe = null;

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  return response.json();
}

async function postAction(url) {
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  return response.json();
}

function mountApp(html) {
  document.getElementById("app").innerHTML = html;
}

function getStatusText(status) {
  if (status === "running") return "运行中";
  if (status === "stopped") return "未启动";
  return "未知";
}

function getResourceLevelText(level) {
  if (level === "heavy") return "重量级";
  if (level === "medium") return "中等";
  if (level === "light") return "轻量";
  return "未知";
}

function getDifficultyText(difficulty) {
  const value = Number(difficulty);
  if (!Number.isFinite(value) || value <= 0) return "L? 未知";
  if (value <= 2) return `L${value} 简单`;
  if (value === 3) return "L3 中等";
  if (value === 4) return "L4 困难";
  return `L${value} 很难`;
}

function getBusinessContextText(key) {
  const map = {
    order: "下单链路",
    payment: "支付链路",
    search: "搜索链路",
    inventory: "库存链路"
  };
  return map[key] || "业务链路";
}

function getStackDocUrl(stackKey) {
  const map = {
    "docker-compose": "https://docs.docker.com/compose/",
    "nodejs-http": "https://nodejs.org/api/http.html",
    "mysql-8.0": "https://dev.mysql.com/doc/refman/8.0/en/",
    "redis-7.2": "https://redis.io/docs/latest/",
    "kafka-3.7": "https://kafka.apache.org/documentation/",
    nginx: "https://nginx.org/en/docs/",
    "sh-curl-loader": "https://pubs.opengroup.org/onlinepubs/9699919799/utilities/sh.html"
  };
  return map[stackKey] || null;
}

function renderStackLinks(stackItems) {
  if (!Array.isArray(stackItems) || stackItems.length === 0) return '<span class="muted">-</span>';
  return stackItems
    .map((item) => {
      const url = getStackDocUrl(item);
      if (!url) return `<span class="stack-link disabled">${escapeHtml(item)}</span>`;
      return `<a class="stack-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(item)}</a>`;
    })
    .join("");
}

function renderHome() {
  mountApp(`
    <div class="route-home">
      <section class="hero panel">
        <h1>开始一次故障演练</h1>
        <p class="hero-subtitle">先选择一个业务底座环境。</p>
      </section>

      <section class="panel">
        <h2>选择底座</h2>
        <div id="basecamp-list">加载中...</div>
      </section>
    </div>
  `);

  renderBasecamps();
}

function renderBasecamps() {
  const listEl = document.getElementById("basecamp-list");
  if (!listEl) return;
  if (!cachedBasecamps.length) {
    listEl.innerHTML = '<p class="muted">暂无底座，请先在 project.yaml 中配置 projects</p>';
    return;
  }

  listEl.innerHTML = cachedBasecamps
    .map((basecamp) => {
      const statusText = getStatusText(basecamp.status);
      const resourceLevelText = getResourceLevelText(basecamp.resource_level);
      const countText = `${Number(basecamp.scenario_count || 0)} 个场景 · ${resourceLevelText}`;
      const starting = startInProgress.has(basecamp.id);
      const buttonText =
        basecamp.status === "running" ? "开始演练" : starting ? "启动中…" : "开始演练";
      return `
        <article class="basecamp-card" data-basecamp-id="${escapeHtml(basecamp.id)}">
          <div class="basecamp-header">
            <strong class="basecamp-title">${escapeHtml(basecamp.name || "")}</strong>
            <span class="status-text">${escapeHtml(statusText)}</span>
          </div>
          <p class="basecamp-intro">${escapeHtml(basecamp.intro || "暂无描述")}</p>
          <p class="basecamp-meta">${escapeHtml(countText)}</p>
          <button class="primary-btn" ${starting ? "disabled" : ""}>${escapeHtml(buttonText)}</button>
        </article>
      `;
    })
    .join("");

  for (const card of listEl.querySelectorAll(".basecamp-card")) {
    const basecampId = card.dataset.basecampId;
    const btn = card.querySelector("button.primary-btn");
    if (!btn) continue;

    btn.addEventListener("click", async () => {
      const basecamp = cachedBasecamps.find((item) => item.id === basecampId);
      if (!basecamp) return;

      if (basecamp.status === "running") {
        window.location.hash = `#/basecamps/${encodeURIComponent(basecampId)}`;
        return;
      }

      startInProgress.add(basecampId);
      renderBasecamps();
      try {
        await fetch(`/api/basecamps/${encodeURIComponent(basecampId)}/start`, { method: "POST" });
      } catch {
        // ignore; polling will reflect final status
      } finally {
        startInProgress.delete(basecampId);
      }
    });
  }
}

function renderScenarioListPage(basecampId, scenarios, filters) {
  if (moduleRuntimeRef) moduleRuntimeRef.unmount();
  moduleRuntimeRef = null;
  if (scenarioListUnsubscribe) {
    scenarioListUnsubscribe();
    scenarioListUnsubscribe = null;
  }
  const basecamp = cachedBasecampDetails.get(basecampId) || cachedBasecamps.find((item) => item.id === basecampId);
  const basecampName = basecamp?.name || basecampId;
  const statusText = getStatusText(basecamp?.status);
  const resourceLevelText = getResourceLevelText(basecamp?.resource_level);
  const scenarioCount = Number(basecamp?.scenario_count || scenarios.length || 0);
  const isRunning = basecamp?.status === "running";

  mountApp(`
    <div class="route-basecamp">
      <div class="page-nav">
        <button class="ghost-btn" id="back-btn">返回</button>
      </div>

      <section class="panel basecamp-info">
        <div class="basecamp-info-row">
          <div class="basecamp-info-text">
            <h2 class="section-title">${escapeHtml(basecampName)}</h2>
            <div id="project-action-slot"></div>
            <p class="muted basecamp-statusline">状态：${escapeHtml(statusText)} · ${escapeHtml(scenarioCount)} 个场景 · ${escapeHtml(resourceLevelText)}</p>
            <p class="muted basecamp-intro2">${escapeHtml(basecamp?.intro || "暂无描述")}</p>
            <div class="info-grid">
              <div class="info-item">
                <div class="info-label">用途</div>
                <div class="info-value">${escapeHtml(basecamp?.purpose || "-")}</div>
              </div>
              <div class="info-item">
                <div class="info-label">技术栈</div>
                <div class="info-value stack-links">${renderStackLinks(basecamp?.stack || [])}</div>
              </div>
            </div>
          </div>

        </div>
      </section>

      <div id="business-status-slot"></div>
      <div id="shell-module-slot"></div>

      ${
        isRunning
          ? `<section class="panel scenarios-panel">
        <div class="filters">
          <label class="filter">
            <span class="filter-label">难度</span>
            <select id="difficulty-filter">
              <option value="">全部</option>
              <option value="1">L1</option>
              <option value="2">L2</option>
              <option value="3">L3</option>
              <option value="4">L4</option>
              <option value="5">L5</option>
            </select>
          </label>
          <label class="filter">
            <span class="filter-label">业务链路</span>
            <select id="context-filter">
              <option value="">全部</option>
              <option value="order">下单</option>
              <option value="payment">支付</option>
              <option value="search">搜索</option>
              <option value="inventory">库存</option>
            </select>
          </label>
        </div>

        <div id="scenario-list" class="scenario-grid">加载中...</div>
      </section>`
          : `<section class="panel scenarios-panel"><p class="muted">底座未启动成功，场景列表已隐藏。</p></section>`
      }
    </div>
  `);

  document.getElementById("back-btn").addEventListener("click", () => {
    window.location.hash = "#/";
  });

  const statusSlot = document.getElementById("business-status-slot");
  const projectActionSlot = document.getElementById("project-action-slot");
  const shellSlot = document.getElementById("shell-module-slot");
  const store = window.FaultLabStore;
  const isRunningForBasecamp = () => {
    const item = cachedBasecampDetails.get(basecampId) || cachedBasecamps.find((v) => v.id === basecampId);
    return item?.status === "running";
  };
  moduleRuntimeRef = window.FaultLabModuleRuntime.mountBasecampModules({
    basecampId,
    shellMode: "basecamp",
    businessContainerEl: statusSlot,
    shellActionContainerEl: projectActionSlot,
    shellTerminalContainerEl: shellSlot,
    fetchJson,
    postAction: async (url) => {
      await postAction(url);
      cachedBasecampDetails.delete(basecampId);
      await loadBasecampDetail(basecampId);
      const snapshot = store.getState();
      store.setState({
        basecampsById: {
          ...snapshot.basecampsById,
          [basecampId]: cachedBasecampDetails.get(basecampId) || cachedBasecamps.find((v) => v.id === basecampId) || null
        }
      });
    },
    getBusyAction: () => (store.getState().opsBusyById || {})[basecampId] || "",
    setBusyAction: (action) => {
      const snapshot = store.getState();
      store.setState({
        opsBusyById: {
          ...snapshot.opsBusyById,
          [basecampId]: action || ""
        }
      });
    },
    isRunning: isRunningForBasecamp
  });

  const difficultyEl = document.getElementById("difficulty-filter");
  const contextEl = document.getElementById("context-filter");
  if (!isRunning || !difficultyEl || !contextEl) return;
  difficultyEl.value = filters.difficulty || "";
  contextEl.value = filters.context || "";

  function applyAndRender() {
    const currentFilters = {
      difficulty: difficultyEl.value,
      context: contextEl.value
    };
    const listEl = document.getElementById("scenario-list");
    const filtered = scenarios.filter((s) => {
      const diffOk = !currentFilters.difficulty || String(s.difficulty) === String(currentFilters.difficulty);
      const ctxOk = !currentFilters.context || String(s.business_context) === String(currentFilters.context);
      return diffOk && ctxOk;
    });

    if (!filtered.length) {
      listEl.innerHTML = '<p class="muted">没有符合条件的场景，请调整筛选。</p>';
      return;
    }

    listEl.innerHTML = filtered
      .map((s) => {
        const title = s.title || "未命名场景";
        const scenarioId = s.scenario_id || "";
        const ctx = getBusinessContextText(s.business_context);
        const diff = getDifficultyText(s.difficulty);
        const scenarioKey = `${basecampId}::${scenarioId}`;
        const faultState = (store.getState().faultStateByScenario || {})[scenarioKey] || s.fault_state || "not_injected";
        const injectedTag = faultState === "injected" ? '<span class="scenario-tag injected">已注入</span>' : '<span class="scenario-tag">未注入</span>';
        const durationText =
          s.duration_min && s.duration_max ? `${s.duration_min}–${s.duration_max} 分钟` : "时长未知";
        return `
          <article class="scenario-card" data-scenario-id="${escapeHtml(scenarioId)}">
            <div class="scenario-title-row">
              <strong class="scenario-title">${escapeHtml(title)}</strong>
              ${injectedTag}
            </div>
            <div class="scenario-meta">${escapeHtml(`${ctx} · ${diff} · ${durationText}`)}</div>
          </article>
        `;
      })
      .join("");

    for (const card of listEl.querySelectorAll(".scenario-card")) {
      card.addEventListener("click", () => {
        const scenarioId = card.dataset.scenarioId;
        if (!scenarioId) return;
        window.location.hash = `#/basecamps/${encodeURIComponent(basecampId)}/scenarios/${encodeURIComponent(scenarioId)}`;
      });
    }
  }

  difficultyEl.addEventListener("change", applyAndRender);
  contextEl.addEventListener("change", applyAndRender);
  scenarioListUnsubscribe = store.subscribe(() => {
    applyAndRender();
  });

  applyAndRender();
}

function renderScenarioDetailPage(basecampId, scenario) {
  if (moduleRuntimeRef) moduleRuntimeRef.unmount();
  moduleRuntimeRef = null;
  if (scenarioListUnsubscribe) {
    scenarioListUnsubscribe();
    scenarioListUnsubscribe = null;
  }
  const title = scenario?.title || "未命名场景";
  const brief = String(scenario?.scenario_brief || "");
  const guide = String(scenario?.troubleshooting_guide || "");
  const messages = [];
  const scenarioStateKey = `${basecampId}::${scenario?.scenario_id || ""}`;

  function extractFirstParagraph(markdown) {
    const cleaned = String(markdown || "")
      .replace(/^#.*$/gm, "")
      .replace(/^>.*$/gm, "")
      .trim();
    const blocks = cleaned.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    return blocks[0] || "暂无业务剧本。";
  }

  function extractReferenceLinks(markdown) {
    const links = [];
    const mdLinkRegex = /\[[^\]]+\]\((https?:\/\/[^)]+)\)/g;
    let mdMatch;
    while ((mdMatch = mdLinkRegex.exec(markdown))) {
      links.push(mdMatch[1]);
    }
    const plainUrlRegex = /(https?:\/\/[^\s)]+)/g;
    let urlMatch;
    while ((urlMatch = plainUrlRegex.exec(markdown))) {
      links.push(urlMatch[1]);
    }
    return Array.from(new Set(links)).slice(0, 6);
  }

  function getReferenceLabel(url, idx) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "");
      if (host.includes("mysql.com")) return `MySQL 文档 ${idx + 1}`;
      if (host.includes("redis.io")) return `Redis 文档 ${idx + 1}`;
      if (host.includes("kafka.apache.org")) return `Kafka 文档 ${idx + 1}`;
      return `${host} 参考 ${idx + 1}`;
    } catch {
      return `参考资料 ${idx + 1}`;
    }
  }

  const focusBrief = extractFirstParagraph(brief);
  const references = extractReferenceLinks(guide);
  const durationText =
    scenario?.duration_min && scenario?.duration_max
      ? `${scenario.duration_min}–${scenario.duration_max} 分钟`
      : "时长未知";
  const difficultyText = getDifficultyText(scenario?.difficulty);
  const contextText = getBusinessContextText(scenario?.business_context);

  mountApp(`
    <div class="route-basecamp">
      <div class="page-nav">
        <button class="ghost-btn" id="back-to-list-btn">返回场景列表</button>
      </div>
      <div id="business-status-slot"></div>
      <section class="panel scenario-detail-panel">
        <div class="scenario-head-row">
          <h2>${escapeHtml(title)}</h2>
          <div class="scenario-head-actions">
            <span id="scenario-inject-tag" class="scenario-tag">未注入</span>
            <button id="scenario-inject-btn" class="ghost-btn small">注入故障</button>
          </div>
        </div>
        <div class="scenario-detail-content">
          <div class="scenario-detail-block">
            <div class="info-label">关注信息</div>
            <div class="info-value">${escapeHtml(`${contextText} · ${difficultyText} · ${durationText}`)}</div>
            <pre class="detail-pre">${escapeHtml(focusBrief)}</pre>
          </div>
          <div class="scenario-detail-block">
            <div class="info-label">参考资料</div>
            <div class="reference-list">
              ${
                references.length
                  ? references
                      .map((url, idx) => `<a class="reference-chip" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(getReferenceLabel(url, idx))}</a>`)
                      .join("")
                  : '<span class="muted">暂无参考资料</span>'
              }
            </div>
          </div>
        </div>
      </section>
      <div id="shell-module-slot"></div>
      <section class="panel llm-panel">
        <h2>分析对话</h2>
        <div id="llm-messages" class="llm-messages"></div>
        <div class="llm-input-row">
          <textarea id="llm-input" class="llm-input" placeholder="描述你的判断…"></textarea>
          <button id="llm-send-btn" class="primary-btn">发送</button>
        </div>
      </section>
    </div>
  `);

  document.getElementById("back-to-list-btn").addEventListener("click", () => {
    window.location.hash = `#/basecamps/${encodeURIComponent(basecampId)}`;
  });

  const statusSlot = document.getElementById("business-status-slot");
  const shellSlot = document.getElementById("shell-module-slot");
  const store = window.FaultLabStore;
  const isRunningForBasecamp = () => {
    const item = cachedBasecampDetails.get(basecampId) || cachedBasecamps.find((v) => v.id === basecampId);
    return item?.status === "running";
  };
  moduleRuntimeRef = window.FaultLabModuleRuntime.mountBasecampModules({
    basecampId,
    scenarioId: scenario?.scenario_id || "",
    shellMode: "scenario",
    businessContainerEl: statusSlot,
    shellTerminalContainerEl: shellSlot,
    fetchJson,
    postAction: async (url) => {
      await postAction(url);
      cachedBasecampDetails.delete(basecampId);
      await loadBasecampDetail(basecampId);
      const snapshot = store.getState();
      store.setState({
        basecampsById: {
          ...snapshot.basecampsById,
          [basecampId]: cachedBasecampDetails.get(basecampId) || cachedBasecamps.find((v) => v.id === basecampId) || null
        }
      });
    },
    getBusyAction: () => (store.getState().opsBusyById || {})[scenarioStateKey] || "",
    setBusyAction: (action) => {
      const snapshot = store.getState();
      store.setState({
        opsBusyById: {
          ...snapshot.opsBusyById,
          [scenarioStateKey]: action || ""
        }
      });
    },
    getFaultState: () => (store.getState().faultStateByScenario || {})[scenarioStateKey] || "not_injected",
    setFaultState: (value) => {
      const snapshot = store.getState();
      store.setState({
        faultStateByScenario: {
          ...(snapshot.faultStateByScenario || {}),
          [scenarioStateKey]: value || "not_injected"
        }
      });
    },
    isRunning: isRunningForBasecamp
  });

  const injectTagEl = document.getElementById("scenario-inject-tag");
  const injectBtnEl = document.getElementById("scenario-inject-btn");
  function renderInjectState() {
    const state = (store.getState().faultStateByScenario || {})[scenarioStateKey] || "not_injected";
    const busy = (store.getState().opsBusyById || {})[scenarioStateKey] || "";
    if (state === "injected") {
      injectTagEl.textContent = "已注入";
      injectTagEl.className = "scenario-tag injected";
      injectBtnEl.style.display = "none";
      return;
    }
    if (state === "failed") {
      injectTagEl.textContent = "注入失败";
      injectTagEl.className = "scenario-tag failed";
    } else {
      injectTagEl.textContent = "未注入";
      injectTagEl.className = "scenario-tag";
    }
    injectBtnEl.style.display = "inline-flex";
    injectBtnEl.disabled = !!busy || !isRunningForBasecamp();
    injectBtnEl.textContent = busy === "inject" ? "注入中…" : "注入故障";
  }

  injectBtnEl.addEventListener("click", async () => {
    const snapshot = store.getState();
    store.setState({
      opsBusyById: {
        ...(snapshot.opsBusyById || {}),
        [scenarioStateKey]: "inject"
      }
    });
    renderInjectState();
    try {
      await postAction(
        `/api/basecamps/${encodeURIComponent(basecampId)}/scenarios/${encodeURIComponent(scenario?.scenario_id || "")}/inject`
      );
      const s = store.getState();
      store.setState({
        faultStateByScenario: {
          ...(s.faultStateByScenario || {}),
          [scenarioStateKey]: "injected"
        }
      });
    } catch {
      const s = store.getState();
      store.setState({
        faultStateByScenario: {
          ...(s.faultStateByScenario || {}),
          [scenarioStateKey]: "failed"
        }
      });
    } finally {
      const s = store.getState();
      store.setState({
        opsBusyById: {
          ...(s.opsBusyById || {}),
          [scenarioStateKey]: ""
        }
      });
      renderInjectState();
    }
  });
  renderInjectState();

  const messagesEl = document.getElementById("llm-messages");
  const inputEl = document.getElementById("llm-input");
  const sendBtn = document.getElementById("llm-send-btn");
  function renderMessages() {
    if (!messages.length) {
      messagesEl.innerHTML = '<p class="muted">输入你的排查判断，系统会返回引导建议。</p>';
      return;
    }
    messagesEl.innerHTML = messages
      .map((item) => `<div class="llm-msg ${item.role}"><strong>${item.role === "user" ? "你" : "助手"}：</strong>${escapeHtml(item.text)}</div>`)
      .join("");
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  async function sendMessage() {
    const text = String(inputEl.value || "").trim();
    if (!text) return;
    messages.push({ role: "user", text });
    messages.push({ role: "assistant", text: "已收到你的判断。下一步建议：优先对比业务状态里的异常指标，再在 shell 中验证对应链路。" });
    inputEl.value = "";
    renderMessages();
  }
  sendBtn.addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendMessage();
  });
  renderMessages();
}

function parseRoute() {
  const hash = window.location.hash || "#/";
  const detailMatch = hash.match(/^#\/basecamps\/([^/?#]+)\/scenarios\/([^/?#]+)(?:\?(.*))?$/);
  if (detailMatch) {
    return {
      name: "scenario-detail",
      basecampId: decodeURIComponent(detailMatch[1]),
      scenarioId: decodeURIComponent(detailMatch[2])
    };
  }
  const match = hash.match(/^#\/basecamps\/([^/?#]+)(?:\?(.*))?$/);
  if (match) {
    const basecampId = decodeURIComponent(match[1]);
    const params = new URLSearchParams(match[2] || "");
    return {
      name: "basecamp",
      basecampId,
      filters: {
        difficulty: params.get("difficulty") || "",
        context: params.get("context") || ""
      }
    };
  }
  return { name: "home" };
}

async function loadBasecampScenarios(basecampId) {
  if (cachedScenarioPages.has(basecampId)) return cachedScenarioPages.get(basecampId);
  const data = await fetchJson(`/api/basecamps/${encodeURIComponent(basecampId)}/scenarios`);
  const scenarios = Array.isArray(data.scenarios) ? data.scenarios : [];
  cachedScenarioPages.set(basecampId, scenarios);
  return scenarios;
}

async function loadBasecampDetail(basecampId) {
  if (cachedBasecampDetails.has(basecampId)) return cachedBasecampDetails.get(basecampId);
  const data = await fetchJson(`/api/basecamps/${encodeURIComponent(basecampId)}`);
  const basecamp = data.basecamp || null;
  if (basecamp) {
    cachedBasecampDetails.set(basecampId, basecamp);
    const idx = cachedBasecamps.findIndex((item) => item.id === basecampId);
    if (idx >= 0) {
      cachedBasecamps[idx] = { ...cachedBasecamps[idx], ...basecamp };
    }
  }
  return basecamp;
}

async function loadScenarioDetail(basecampId, scenarioId) {
  const cacheKey = `${basecampId}::${scenarioId}`;
  if (cachedScenarioDetails.has(cacheKey)) return cachedScenarioDetails.get(cacheKey);
  const data = await fetchJson(`/api/basecamps/${encodeURIComponent(basecampId)}/scenarios/${encodeURIComponent(scenarioId)}`);
  const scenario = data.scenario || null;
  if (scenario) {
    cachedScenarioDetails.set(cacheKey, scenario);
    const snapshot = window.FaultLabStore.getState();
    window.FaultLabStore.setState({
      faultStateByScenario: {
        ...(snapshot.faultStateByScenario || {}),
        [cacheKey]: scenario.fault_state || "not_injected"
      }
    });
  }
  return scenario;
}

async function renderRoute() {
  if (moduleRuntimeRef) moduleRuntimeRef.unmount();
  moduleRuntimeRef = null;
  if (scenarioListUnsubscribe) {
    scenarioListUnsubscribe();
    scenarioListUnsubscribe = null;
  }
  const route = parseRoute();
  if (route.name === "home") {
    renderHome();
    return;
  }

  if (route.name === "basecamp") {
    mountApp(`
      <section class="panel">
        <h2>加载中…</h2>
        <p class="muted">正在获取场景列表</p>
      </section>
    `);
    await loadBasecampDetail(route.basecampId);
    const scenarios = await loadBasecampScenarios(route.basecampId);
    renderScenarioListPage(route.basecampId, scenarios, route.filters);
    return;
  }

  if (route.name === "scenario-detail") {
    mountApp(`
      <section class="panel">
        <h2>加载中…</h2>
        <p class="muted">正在获取场景详情</p>
      </section>
    `);
    await loadBasecampDetail(route.basecampId);
    const scenario = await loadScenarioDetail(route.basecampId, route.scenarioId);
    if (!scenario) {
      mountApp(`
        <section class="panel">
          <h2>未找到场景</h2>
          <p class="muted">请返回场景列表重试。</p>
        </section>
      `);
      return;
    }
    renderScenarioDetailPage(route.basecampId, scenario);
  }
}

async function boot() {
  async function refreshBasecamps() {
    try {
      const data = await fetchJson("/api/basecamps");
      cachedBasecamps = Array.isArray(data.basecamps) ? data.basecamps : [];
      const byId = {};
      for (const item of cachedBasecamps) byId[item.id] = item;
      window.FaultLabStore.setState({ basecampsById: byId });
    } catch {
      // ignore; route render handles empty state
    }
  }

  await refreshBasecamps();
  await renderRoute();

  window.addEventListener("hashchange", () => {
    renderRoute();
  });

  pollTimer = setInterval(async () => {
    await refreshBasecamps();
    const route = parseRoute();
    if (route.name === "home") {
      renderBasecamps();
    }
  }, 2000);
}

boot();
