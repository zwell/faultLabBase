let selectedProjectId = null;
let cachedProjects = [];

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

function renderProjects() {
  const projectListEl = document.getElementById("project-list");
  if (!cachedProjects.length) {
    projectListEl.innerHTML = '<p class="muted">没有项目</p>';
    return;
  }

  projectListEl.innerHTML = cachedProjects
    .map((project) => {
      const activeClass = project.id === selectedProjectId ? "active" : "";
      return `
        <div class="project-item ${activeClass}" data-project-id="${escapeHtml(project.id)}">
          <strong>${escapeHtml(project.name || project.id)}</strong>
          <div class="muted">${escapeHtml(project.intro || "")}</div>
        </div>
      `;
    })
    .join("");

  for (const item of projectListEl.querySelectorAll(".project-item")) {
    item.addEventListener("click", () => {
      selectedProjectId = item.dataset.projectId;
      renderProjects();
      renderProjectDetail();
      loadScenarios();
    });
  }
}

function renderProjectDetail() {
  const detailEl = document.getElementById("project-detail");
  const project = cachedProjects.find((item) => item.id === selectedProjectId);
  if (!project) {
    detailEl.innerHTML = '<p class="muted">请选择一个项目</p>';
    return;
  }

  const stack = Array.isArray(project.stack) ? project.stack.join(", ") : "";
  detailEl.innerHTML = `
    <p><strong>ID:</strong> ${escapeHtml(project.id)}</p>
    <p><strong>名称:</strong> ${escapeHtml(project.name || "")}</p>
    <p><strong>介绍:</strong> ${escapeHtml(project.intro || "")}</p>
    <p><strong>场景目录:</strong> <code>${escapeHtml(project.scenario_path || "")}</code></p>
    <p><strong>技术栈:</strong> ${escapeHtml(stack)}</p>
  `;
}

async function loadScenarios() {
  const scenarioListEl = document.getElementById("scenario-list");
  if (!selectedProjectId) {
    scenarioListEl.innerHTML = '<p class="muted">请选择项目后加载</p>';
    return;
  }

  scenarioListEl.innerHTML = '<p class="muted">加载中...</p>';
  try {
    const data = await fetchJson(`/api/projects/${encodeURIComponent(selectedProjectId)}/scenarios`);
    const scenarios = Array.isArray(data.scenarios) ? data.scenarios : [];
    if (!scenarios.length) {
      scenarioListEl.innerHTML = '<p class="muted">该项目下没有找到场景</p>';
      return;
    }

    scenarioListEl.innerHTML = scenarios
      .map((scenario) => {
        const meta = scenario.meta || {};
        return `
          <div class="scenario-item">
            <p><strong>${escapeHtml(meta.title || meta.id || "未命名场景")}</strong></p>
            <p class="muted">目录: <code>${escapeHtml(scenario.dir || "")}</code></p>
            <p>技术: ${escapeHtml(meta.tech || "-")} | 难度: ${escapeHtml(meta.difficulty || "-")}</p>
          </div>
        `;
      })
      .join("");
  } catch (error) {
    scenarioListEl.innerHTML = `<p class="muted">加载失败: ${escapeHtml(error.message)}</p>`;
  }
}

async function boot() {
  try {
    const data = await fetchJson("/api/projects");
    cachedProjects = Array.isArray(data.projects) ? data.projects : [];
    selectedProjectId = cachedProjects[0]?.id || null;
    renderProjects();
    renderProjectDetail();
    await loadScenarios();
  } catch (error) {
    document.getElementById("project-list").innerHTML = `<p class="muted">加载失败: ${escapeHtml(
      error.message
    )}</p>`;
  }
}

boot();
