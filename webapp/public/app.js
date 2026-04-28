let cachedBasecamps = [];
let startInProgress = new Set();
let cachedScenarioPages = new Map();
let cachedBasecampDetails = new Map();
let pollTimer = null;
let basecampActionBusy = new Map();

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

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
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
  const basecamp = cachedBasecamps.find((item) => item.id === basecampId) || cachedBasecampDetails.get(basecampId);
  const basecampName = basecamp?.name || basecampId;
  const statusText = getStatusText(basecamp?.status);
  const resourceLevelText = getResourceLevelText(basecamp?.resource_level);
  const scenarioCount = Number(basecamp?.scenario_count || scenarios.length || 0);
  const isRunning = basecamp?.status === "running";
  const busyAction = basecampActionBusy.get(basecampId) || "";

  mountApp(`
    <div class="route-basecamp">
      <div class="page-nav">
        <button class="ghost-btn" id="back-btn">返回</button>
      </div>

      <section class="panel basecamp-info">
        <div class="basecamp-info-row">
          <div class="basecamp-info-text">
            <h2 class="section-title">${escapeHtml(basecampName)}</h2>
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
              <div class="info-item">
                <div class="info-label">核心组件</div>
                <div class="info-value">${escapeHtml((basecamp?.topology || []).join(" / ") || "-")}</div>
              </div>
            </div>
          </div>

          <div class="basecamp-actions">
            <h2 class="section-title">操作</h2>
            <button class="primary-btn" id="start-btn" ${isRunning || busyAction ? "disabled" : ""}>${escapeHtml(
              busyAction === "start" ? "启动中…" : "启动系统"
            )}</button>
            <button class="ghost-btn" id="restart-btn" ${!isRunning || busyAction ? "disabled" : ""}>${escapeHtml(
              busyAction === "restart" ? "重启中…" : "重启系统"
            )}</button>
            <button class="ghost-btn danger" id="stop-btn" ${!isRunning || busyAction ? "disabled" : ""}>${escapeHtml(
              busyAction === "stop" ? "停止中…" : "停止系统"
            )}</button>
            <button class="ghost-btn danger" id="clean-btn" ${busyAction ? "disabled" : ""}>${escapeHtml(
              busyAction === "clean" ? "清理中…" : "清理数据"
            )}</button>
            <p class="muted action-hint" id="action-hint">启动/重启可能需要几十秒，请等待状态刷新。</p>
          </div>
        </div>
      </section>

      <section class="panel ops-panel">
        <div class="terminal-toolbar">
          <div class="terminal-toolbar-left">
            <span class="filter-label">容器</span>
            <div id="container-tabs" class="container-tabs">加载中…</div>
          </div>
          <div class="terminal-toolbar-right">
            <span class="muted terminal-hint">在容器内输入 <code>exit</code> 可回到本机</span>
          </div>
        </div>

        <select id="container-select" class="hidden-select" aria-hidden="true" tabindex="-1">
          <option value="">加载中…</option>
        </select>

        <div class="terminal-status muted" id="terminal-status">未连接</div>
        <div id="terminal" class="terminal-box"></div>
      </section>

      <section class="panel scenarios-panel">
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
      </section>
    </div>
  `);

  document.getElementById("back-btn").addEventListener("click", () => {
    window.location.hash = "#/";
  });

  async function runAction(action) {
    if (basecampActionBusy.get(basecampId)) return;
    const latestBasecamp =
      cachedBasecamps.find((item) => item.id === basecampId) || cachedBasecampDetails.get(basecampId);
    const running = latestBasecamp?.status === "running";
    if (action === "start" && running) return;
    if ((action === "stop" || action === "restart") && !running) return;

    basecampActionBusy.set(basecampId, action);

    // Optimistic status updates to avoid repeated clicks while Docker state is converging.
    if (latestBasecamp) {
      if (action === "stop" || action === "clean") {
        cachedBasecampDetails.set(basecampId, { ...latestBasecamp, status: "stopped" });
      }
      if (action === "start" || action === "restart") {
        cachedBasecampDetails.set(basecampId, { ...latestBasecamp, status: "unknown" });
      }
    }

    renderScenarioListPage(basecampId, scenarios, filters);
    const hintEl = document.getElementById("action-hint");
    hintEl.textContent = "执行中…";
    try {
      if (action === "start") {
        await postAction(`/api/basecamps/${encodeURIComponent(basecampId)}/start`);
      } else {
        await postAction(`/api/basecamps/${encodeURIComponent(basecampId)}/${action}`);
      }
      hintEl.textContent = "已提交操作，等待状态刷新。";
      cachedBasecampDetails.delete(basecampId);
      await loadBasecampDetail(basecampId);
      await bootTerminal();
    } catch {
      hintEl.textContent = "操作失败，请检查 Docker 是否运行。";
    } finally {
      basecampActionBusy.delete(basecampId);
      // Re-render to update button states.
      const latestScenarios = cachedScenarioPages.get(basecampId) || scenarios;
      const route = parseRoute();
      renderScenarioListPage(basecampId, latestScenarios, route.filters || filters);
    }
  }

  document.getElementById("start-btn").addEventListener("click", () => runAction("start"));
  document.getElementById("restart-btn").addEventListener("click", () => runAction("restart"));
  document.getElementById("stop-btn").addEventListener("click", () => runAction("stop"));
  document.getElementById("clean-btn").addEventListener("click", () => runAction("clean"));

  async function loadContainers() {
    const selectEl = document.getElementById("container-select");
    const tabsEl = document.getElementById("container-tabs");
    try {
      const data = await fetchJson(`/api/basecamps/${encodeURIComponent(basecampId)}/containers`);
      const containers = Array.isArray(data.containers) ? data.containers : [];
      const simplify = (name) => {
        const prefix = `${basecampId}-`;
        return typeof name === "string" && name.startsWith(prefix) ? name.slice(prefix.length) : name;
      };
      const options = [{ value: "host:", label: "本机" }].concat(
        containers.map((c) => ({ value: `container:${c.name}`, label: simplify(c.name) }))
      );

      selectEl.innerHTML = options
        .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
        .join("");

      // Default: do NOT preselect any container; connect to host instead.
      const current = selectEl.value || "host:";
      selectEl.value = current;

      const renderTab = (value, label) => {
        const active = value === current ? "active" : "";
        const isHost = value === "host:";
        const containerName = isHost ? "" : value.replace(/^container:/, "");
        const containerInfo = containers.find((c) => c.name === containerName);
        const status = containerInfo?.status || "";
        const isUp = isHost || status.startsWith("Up");
        const disabled = isUp ? "" : "disabled";
        const cls = `${active} ${isUp ? "" : "disabled"}`.trim();
        return `<button class="container-tab ${cls}" data-value="${escapeHtml(value)}" ${disabled}>${escapeHtml(
          label
        )}</button>`;
      };

      tabsEl.innerHTML = options.map((o) => renderTab(o.value, o.label)).join("");

      for (const btn of tabsEl.querySelectorAll("button.container-tab")) {
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          const value = btn.dataset.value;
          if (!value) return;
          selectEl.value = value;
          selectEl.dispatchEvent(new Event("change"));
          // Update active state
          for (const b of tabsEl.querySelectorAll("button.container-tab")) {
            b.classList.toggle("active", b.dataset.value === value);
          }
        });
      }

      return containers;
    } catch {
      selectEl.innerHTML = '<option value="">加载失败</option>';
      tabsEl.textContent = "加载失败";
      return [];
    }
  }

  let terminalController = null;
  async function bootTerminal() {
    await loadContainers();
    const containerSelectEl = document.getElementById("container-select");
    const terminalMountEl = document.getElementById("terminal");
    const statusEl = document.getElementById("terminal-status");

    if (!containerSelectEl.value) {
      statusEl.textContent = "无可用容器";
      return;
    }

    if (!window.FaultLabTerminal?.mountInteractiveShell) {
      statusEl.textContent = "终端加载失败";
      return;
    }

    if (terminalController) terminalController.close();
    terminalController = window.FaultLabTerminal.mountInteractiveShell({
      basecampId,
      containerSelectEl,
      terminalMountEl,
      statusEl
    });
  }

  bootTerminal();

  const difficultyEl = document.getElementById("difficulty-filter");
  const contextEl = document.getElementById("context-filter");
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
      .map((s, idx) => {
        const title = s.title || "未命名场景";
        const ctx = getBusinessContextText(s.business_context);
        const diff = getDifficultyText(s.difficulty);
        const durationText =
          s.duration_min && s.duration_max ? `${s.duration_min}–${s.duration_max} 分钟` : "时长未知";
        return `
          <article class="scenario-card" data-idx="${idx}">
            <strong class="scenario-title">${escapeHtml(title)}</strong>
            <div class="scenario-meta">${escapeHtml(`${ctx} · ${diff} · ${durationText}`)}</div>
          </article>
        `;
      })
      .join("");
  }

  difficultyEl.addEventListener("change", applyAndRender);
  contextEl.addEventListener("change", applyAndRender);

  applyAndRender();
}

function parseRoute() {
  const hash = window.location.hash || "#/";
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
  if (basecamp) cachedBasecampDetails.set(basecampId, basecamp);
  return basecamp;
}

async function renderRoute() {
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
  }
}

async function boot() {
  async function refreshBasecamps() {
    try {
      const data = await fetchJson("/api/basecamps");
      cachedBasecamps = Array.isArray(data.basecamps) ? data.basecamps : [];
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
