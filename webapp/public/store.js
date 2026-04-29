(function () {
  function createStore(initialState) {
    let state = initialState;
    const listeners = new Set();

    function getState() {
      return state;
    }

    function setState(patch) {
      const nextPatch = typeof patch === "function" ? patch(state) : patch;
      if (!nextPatch || typeof nextPatch !== "object") return;
      state = { ...state, ...nextPatch };
      for (const listener of listeners) listener(state);
    }

    function subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    return { getState, setState, subscribe };
  }

  window.FaultLabStore = createStore({
    basecampsById: {},
    opsBusyById: {}
  });
})();
