let cachedBasecamps = [];
let startInProgress = new Set();

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

function renderBasecamps() {
  const listEl = document.getElementById("basecamp-list");
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

async function boot() {
  const listEl = document.getElementById("basecamp-list");
  async function refresh() {
    try {
      const data = await fetchJson("/api/basecamps");
      cachedBasecamps = Array.isArray(data.basecamps) ? data.basecamps : [];
      renderBasecamps();
    } catch {
      listEl.innerHTML = '<p class="muted">加载失败：请检查服务是否启动</p>';
    }
  }

  await refresh();
  setInterval(refresh, 2000);
}

boot();
