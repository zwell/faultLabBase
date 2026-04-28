(function () {
function createTerminal(el) {
  // global Terminal from xterm.js loaded via CDN
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    theme: {
      background: "#0d1117",
      foreground: "#c9d1d9",
      cursor: "#58a6ff",
      selectionBackground: "rgba(88,166,255,0.25)"
    }
  });
  term.open(el);
  term.focus();
  return term;
}

function openTerminalSocket({ basecampId, target, container, cols, rows, onData, onOpen, onClose }) {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const qs = new URLSearchParams();
  qs.set("basecamp_id", basecampId || "");
  qs.set("target", target || "container");
  if (target === "container") qs.set("container", container || "");
  qs.set("cols", String(cols));
  qs.set("rows", String(rows));
  const url = `${protocol}://${location.host}/api/terminal?${qs.toString()}`;

  const ws = new WebSocket(url);
  ws.addEventListener("open", () => onOpen && onOpen());
  ws.addEventListener("close", () => onClose && onClose());
  ws.addEventListener("message", (ev) => onData && onData(ev.data));
  return ws;
}

function measureTerminalSize(el) {
  const approxCellWidth = 8.3;
  const approxCellHeight = 18;
  const rect = el.getBoundingClientRect();
  const cols = Math.max(40, Math.floor(rect.width / approxCellWidth));
  const rows = Math.max(10, Math.floor(rect.height / approxCellHeight));
  return { cols, rows };
}

function mountInteractiveShell({ basecampId, containerSelectEl, terminalMountEl, statusEl }) {
  let term = null;
  let ws = null;
  let currentTarget = null;
  let currentContainer = null;
  let resizeHandler = null;
  let localLineBuffer = "";
  let switching = false;
  let sessionSeq = 0;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function close() {
    sessionSeq += 1;
    switching = true;
    try {
      if (ws) ws.close();
    } catch {}
    ws = null;
    currentTarget = null;
    currentContainer = null;
    localLineBuffer = "";
    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }
    switching = false;
  }

  function connect(nextValue) {
    if (!nextValue) return;
    close();
    const [nextTarget, ...rest] = String(nextValue).split(":");
    currentTarget = nextTarget === "host" ? "host" : "container";
    currentContainer = currentTarget === "container" ? rest.join(":") : "";
    const mySeq = (sessionSeq += 1);

    terminalMountEl.innerHTML = "";
    term = createTerminal(terminalMountEl);
    const size = measureTerminalSize(terminalMountEl);

    setStatus("连接中…");
    ws = openTerminalSocket({
      basecampId,
      target: currentTarget,
      container: currentContainer,
      cols: size.cols,
      rows: size.rows,
      onOpen: () => {
        if (mySeq !== sessionSeq) return;
        const label =
          containerSelectEl?.options?.[containerSelectEl.selectedIndex]?.text ||
          (currentTarget === "host" ? "本机" : currentContainer);
        setStatus(`已连接：${label}`);
        // Resize once after open to better match layout
        const next = measureTerminalSize(terminalMountEl);
        ws.send(JSON.stringify({ type: "resize", cols: next.cols, rows: next.rows }));
      },
      onClose: () => {
        if (mySeq !== sessionSeq) return;
        setStatus("已断开");
        // If user typed `exit` inside a container, the process ends; auto-return to host.
        if (!switching && currentTarget === "container") {
          setTimeout(() => {
            containerSelectEl.value = "host:";
            containerSelectEl.dispatchEvent(new Event("change"));
          }, 0);
        }
      },
      onData: (data) => term.write(data)
    });

    term.onData((data) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // Local-echo for non-TTY backend: make typed commands visible.
      // We only echo simple printable input + Enter/Backspace.
      if (data === "\r") {
        term.write("\r\n");
        localLineBuffer = "";
      } else if (data === "\u007f") {
        // backspace
        if (localLineBuffer.length > 0) {
          localLineBuffer = localLineBuffer.slice(0, -1);
          term.write("\b \b");
        }
      } else if (data === "\u0003") {
        // Ctrl+C
        term.write("^C\r\n");
        localLineBuffer = "";
      } else if (data.startsWith("\u001b")) {
        // escape sequences (arrows, etc.) - send but don't local-echo
      } else {
        localLineBuffer += data;
        term.write(data);
      }

      ws.send(JSON.stringify({ type: "input", data }));
    });

    resizeHandler = () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const next = measureTerminalSize(terminalMountEl);
      ws.send(JSON.stringify({ type: "resize", cols: next.cols, rows: next.rows }));
    };
    window.addEventListener("resize", resizeHandler);
  }

  containerSelectEl.addEventListener("change", () => {
    connect(containerSelectEl.value);
  });

  // initial connect
  connect(containerSelectEl.value);

  return { connect, close };
}

window.FaultLabTerminal = { mountInteractiveShell };
})();

