(function () {
  function mountBasecampModules(options) {
    const {
      basecampId,
      businessContainerEl,
      shellContainerEl,
      shellActionContainerEl,
      shellTerminalContainerEl,
      fetchJson,
      postAction,
      scenarioId,
      shellMode,
      isRunning,
      getBusyAction,
      setBusyAction,
      getFaultState,
      setFaultState
    } = options;

    const api = window.FaultLabModules || {};
    if (!api.mountBusinessStatusModule || !api.mountShellModule) {
      return {
        unmount() {}
      };
    }

    const businessRef = api.mountBusinessStatusModule(businessContainerEl, {
      basecampId,
      fetchJson,
      isRunning
    });

    const actionShellRef =
      shellActionContainerEl && api.mountShellModule
        ? api.mountShellModule(shellActionContainerEl, {
            basecampId,
            fetchJson,
            postAction,
            scenarioId,
            mode: shellMode || "basecamp",
            variant: "actions-only",
            isRunning,
            getBusyAction,
            setBusyAction,
            getFaultState,
            setFaultState
          })
        : null;
    const terminalShellRef =
      shellTerminalContainerEl && api.mountShellModule
        ? api.mountShellModule(shellTerminalContainerEl, {
            basecampId,
            fetchJson,
            postAction,
            scenarioId,
            mode: shellMode || "basecamp",
            variant: "terminal-only",
            isRunning,
            getBusyAction,
            setBusyAction,
            getFaultState,
            setFaultState
          })
        : null;
    const shellRef =
      shellContainerEl && api.mountShellModule
        ? api.mountShellModule(shellContainerEl, {
            basecampId,
            fetchJson,
            postAction,
            scenarioId,
            mode: shellMode || "basecamp",
            isRunning,
            getBusyAction,
            setBusyAction,
            getFaultState,
            setFaultState
          })
        : null;

    return {
      unmount() {
        if (businessRef && typeof businessRef.unmount === "function") businessRef.unmount();
        if (shellRef && typeof shellRef.unmount === "function") shellRef.unmount();
        if (actionShellRef && typeof actionShellRef.unmount === "function") actionShellRef.unmount();
        if (terminalShellRef && typeof terminalShellRef.unmount === "function") terminalShellRef.unmount();
      },
      refresh() {
        if (shellRef && typeof shellRef.refresh === "function") shellRef.refresh();
        if (actionShellRef && typeof actionShellRef.refresh === "function") actionShellRef.refresh();
        if (terminalShellRef && typeof terminalShellRef.refresh === "function") terminalShellRef.refresh();
      },
      refreshContainers() {
        if (shellRef && typeof shellRef.refreshContainers === "function") shellRef.refreshContainers();
        if (terminalShellRef && typeof terminalShellRef.refreshContainers === "function") terminalShellRef.refreshContainers();
      }
    };
  }

  window.FaultLabModuleRuntime = { mountBasecampModules };
})();
