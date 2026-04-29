(function () {
  function mountTerminalModule(containerEl, options) {
    const { basecampId, fetchJson } = options;
    containerEl.innerHTML = `
      <section class="panel shell-panel">
        <div class="terminal-toolbar">
          <div class="terminal-toolbar-left">
            <span class="filter-label">容器</span>
            <div data-container-tabs class="container-tabs">加载中…</div>
          </div>
          <div class="terminal-toolbar-right">
            <span class="muted terminal-hint">在容器内输入 <code>exit</code> 可回到本机</span>
          </div>
        </div>
        <select data-container-select class="hidden-select" aria-hidden="true" tabindex="-1"><option value="">加载中…</option></select>
        <div class="terminal-status muted" data-terminal-status>未连接</div>
        <div data-terminal class="terminal-box"></div>
      </section>
    `;

    const statusEl = containerEl.querySelector("[data-terminal-status]");
    const selectEl = containerEl.querySelector("[data-container-select]");
    const tabsEl = containerEl.querySelector("[data-container-tabs]");
    const terminalMountEl = containerEl.querySelector("[data-terminal]");
    let terminalController = null;

    async function loadContainers() {
      try {
        const data = await fetchJson(`/api/basecamps/${encodeURIComponent(basecampId)}/containers`);
        const containers = Array.isArray(data.containers) ? data.containers : [];
        const simplify = (name) => (String(name || "").startsWith(`${basecampId}-`) ? String(name).slice(basecampId.length + 1) : name);
        const options = [{ value: "host:", label: "本机" }].concat(
          containers.map((c) => ({ value: `container:${c.name}`, label: simplify(c.name) }))
        );
        selectEl.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
        selectEl.value = selectEl.value || "host:";
        const current = selectEl.value;
        tabsEl.innerHTML = options
          .map((o) => {
            const isHost = o.value === "host:";
            const containerName = isHost ? "" : o.value.replace(/^container:/, "");
            const info = containers.find((c) => c.name === containerName);
            const up = isHost || String(info?.status || "").startsWith("Up");
            return `<button class="container-tab ${current === o.value ? "active" : ""} ${up ? "" : "disabled"}" data-value="${o.value}" ${up ? "" : "disabled"}>${o.label}</button>`;
          })
          .join("");
        for (const btn of tabsEl.querySelectorAll("button.container-tab")) {
          btn.addEventListener("click", () => {
            if (btn.disabled) return;
            selectEl.value = btn.dataset.value || "host:";
            selectEl.dispatchEvent(new Event("change"));
            for (const b of tabsEl.querySelectorAll("button.container-tab")) b.classList.toggle("active", b === btn);
          });
        }
      } catch {
        tabsEl.textContent = "加载失败";
      }
    }

    function bootTerminal() {
      if (!window.FaultLabTerminal?.mountInteractiveShell) {
        statusEl.textContent = "终端加载失败";
        return;
      }
      if (!selectEl.value) {
        statusEl.textContent = "无可用容器";
        return;
      }
      if (terminalController) terminalController.close();
      terminalController = window.FaultLabTerminal.mountInteractiveShell({
        basecampId,
        containerSelectEl: selectEl,
        terminalMountEl,
        statusEl
      });
    }
    selectEl.addEventListener("change", () => bootTerminal());
    loadContainers().then(() => bootTerminal());

    return {
      async refreshContainers() {
        await loadContainers();
      },
      unmount() {
        if (terminalController) terminalController.close();
        terminalController = null;
        containerEl.innerHTML = "";
      }
    };
  }

  function mountActionBarModule(containerEl, options) {
    const { actions, getBusyAction, setBusyAction, runAction, actionHintDefault, getActionState } = options;
    containerEl.innerHTML = `
      <section class="panel ops-panel">
        <div class="ops-actions">
          <div class="op-buttons">
            ${actions
              .map(
                (item) =>
                  `<button class="${item.buttonClass}" data-action="${item.key}">${item.label}</button>`
              )
              .join("")}
          </div>
        </div>
        <p class="muted action-hint" data-action-hint>${actionHintDefault || ""}</p>
      </section>
    `;
    const hintEl = containerEl.querySelector("[data-action-hint]");

    function renderButtons() {
      const busy = getBusyAction() || "";
      for (const btn of containerEl.querySelectorAll("button[data-action]")) {
        const key = btn.dataset.action || "";
        const actionDef = actions.find((item) => item.key === key);
        const state = getActionState ? getActionState(key) : { disabled: false };
        btn.disabled = !!busy || !!state.disabled;
        if (busy && busy === key && actionDef?.busyLabel) btn.textContent = actionDef.busyLabel;
        else btn.textContent = actionDef?.label || key;
      }
    }

    async function onClick(action) {
      if (getBusyAction()) return;
      setBusyAction(action);
      renderButtons();
      hintEl.textContent = "执行中…";
      try {
        await runAction(action);
        hintEl.textContent = "已提交操作，等待状态刷新。";
      } catch {
        hintEl.textContent = "操作失败，请检查 Docker 或脚本状态。";
      } finally {
        setBusyAction("");
        renderButtons();
      }
    }

    for (const btn of containerEl.querySelectorAll("button[data-action]")) {
      btn.addEventListener("click", () => onClick(btn.dataset.action || ""));
    }
    renderButtons();
    return {
      refresh() {
        renderButtons();
      },
      unmount() {
        containerEl.innerHTML = "";
      }
    };
  }

  function mountShellModule(containerEl, options) {
    const {
      mode,
      basecampId,
      scenarioId,
      fetchJson,
      postAction,
      getBusyAction,
      setBusyAction,
      isRunning,
      getFaultState,
      setFaultState,
      variant
    } = options;
    const shellVariant = variant || "full";
    containerEl.innerHTML =
      shellVariant === "actions-only"
        ? '<div data-action-slot></div>'
        : shellVariant === "terminal-only"
          ? '<div data-terminal-slot></div>'
          : '<div class="shell-stack"><div data-action-slot></div><div data-terminal-slot></div></div>';
    const actionSlot = containerEl.querySelector("[data-action-slot]");
    const terminalSlot = containerEl.querySelector("[data-terminal-slot]");

    const terminalRef =
      terminalSlot && shellVariant !== "actions-only"
        ? mountTerminalModule(terminalSlot, { basecampId, fetchJson })
        : { refreshContainers: async () => {}, unmount() {} };
    const scenarioMode = mode === "scenario";
    const actionRef =
      actionSlot && shellVariant !== "terminal-only" && mode === "scenario"
        ? mountActionBarModule(actionSlot, {
            actions: [
              { key: "inject", label: "注入故障", busyLabel: "注入中…", buttonClass: "primary-btn small" },
              { key: "reinject", label: "重新注入", busyLabel: "注入中…", buttonClass: "ghost-btn small" },
              { key: "clear", label: "清除故障", busyLabel: "清除中…", buttonClass: "ghost-btn danger small" }
            ],
            getBusyAction,
            setBusyAction,
            getActionState: (action) => {
              const running = isRunning();
              const faultState = (getFaultState && getFaultState()) || "not_injected";
              if (!running) return { disabled: true };
              if (action === "inject") return { disabled: faultState === "injected" };
              if (action === "reinject") return { disabled: faultState !== "injected" };
              if (action === "clear") return { disabled: faultState !== "injected" };
              return { disabled: false };
            },
            runAction: async (action) => {
              if (action === "inject" || action === "reinject") {
                await postAction(
                  `/api/basecamps/${encodeURIComponent(basecampId)}/scenarios/${encodeURIComponent(scenarioId)}/inject`
                );
                if (setFaultState) setFaultState("injected");
                return;
              }
              if (action === "clear") {
                await postAction(
                  `/api/basecamps/${encodeURIComponent(basecampId)}/scenarios/${encodeURIComponent(scenarioId)}/clear`
                );
                if (setFaultState) setFaultState("not_injected");
              }
            }
          })
        : actionSlot && shellVariant !== "terminal-only"
          ? mountActionBarModule(actionSlot, {
            actions: [
              { key: "start", label: "启动", busyLabel: "启动中…", buttonClass: "primary-btn small" },
              { key: "restart", label: "重启", busyLabel: "重启中…", buttonClass: "ghost-btn small" },
              { key: "stop", label: "停止", busyLabel: "停止中…", buttonClass: "ghost-btn danger small" },
              { key: "clean", label: "清理", busyLabel: "清理中…", buttonClass: "ghost-btn danger small" }
            ],
            getBusyAction,
            setBusyAction,
            getActionState: (action) => ({
              disabled: (action === "start" && isRunning()) || ((action === "stop" || action === "restart") && !isRunning())
            }),
            runAction: async (action) => {
              const url =
                action === "start"
                  ? `/api/basecamps/${encodeURIComponent(basecampId)}/start`
                  : `/api/basecamps/${encodeURIComponent(basecampId)}/${action}`;
              await postAction(url);
            }
            })
          : { refresh() {}, unmount() {} };

    if (scenarioMode) {
      const faultState = (getFaultState && getFaultState()) || "not_injected";
      if (isRunning() && faultState !== "injected" && !getBusyAction()) {
        setBusyAction("inject");
        if (actionRef && typeof actionRef.refresh === "function") actionRef.refresh();
        postAction(`/api/basecamps/${encodeURIComponent(basecampId)}/scenarios/${encodeURIComponent(scenarioId)}/inject`)
          .then(() => {
            if (setFaultState) setFaultState("injected");
          })
          .catch(() => {
            if (setFaultState) setFaultState("failed");
          })
          .finally(() => {
            setBusyAction("");
            if (actionRef && typeof actionRef.refresh === "function") actionRef.refresh();
          });
      }
    }

    return {
      refresh() {
        actionRef.refresh();
      },
      async refreshContainers() {
        await terminalRef.refreshContainers();
      },
      unmount() {
        actionRef.unmount();
        terminalRef.unmount();
        containerEl.innerHTML = "";
      }
    };
  }

  window.FaultLabModules = window.FaultLabModules || {};
  window.FaultLabModules.mountShellModule = mountShellModule;
})();
