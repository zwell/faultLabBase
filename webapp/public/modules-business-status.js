(function () {
  const THRESHOLDS = {
    order_success_rate: { warn: 0.95, critical: 0.85 },
    order_p99_ms: { warn: 500, critical: 2000 },
    consumer_lag: { warn: 100, critical: 500 },
    consumer_p99_ms: { warn: 500, critical: 2000 },
    write_success_rate: { warn: 0.95, critical: 0.85 },
    read_success_rate: { warn: 0.95, critical: 0.85 },
    storage_p99_ms: { warn: 200, critical: 1000 }
  };

  function formatValue(value, digits = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "— —";
    return num.toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatPercent(value, digits = 1) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "— —";
    return `${(num * 100).toFixed(digits)}%`;
  }

  function getLevelClassHigh(value, thresholdKey) {
    const conf = THRESHOLDS[thresholdKey];
    const num = Number(value);
    if (!conf || !Number.isFinite(num)) return "normal";
    if (num >= conf.critical) return "critical";
    if (num >= conf.warn) return "warn";
    return "normal";
  }

  function getLevelClassLow(value, thresholdKey) {
    const conf = THRESHOLDS[thresholdKey];
    const num = Number(value);
    if (!conf || !Number.isFinite(num)) return "normal";
    if (num <= conf.critical) return "critical";
    if (num <= conf.warn) return "warn";
    return "normal";
  }

  function mergeLevel(a, b) {
    const order = { normal: 0, warn: 1, critical: 2 };
    return (order[a] || 0) >= (order[b] || 0) ? a : b;
  }

  function formatMetricWithBadge(valueText, level) {
    if (level === "critical") return `🔴 ${valueText}`;
    if (level === "warn") return `🟡 ${valueText}`;
    return valueText;
  }

  function renderSparkline(points, valueKey) {
    if (!Array.isArray(points) || points.length < 2) return '<div class="sparkline-empty muted">暂无趋势数据</div>';
    const values = points.map((item) => Number(item[valueKey])).filter((v) => Number.isFinite(v));
    if (!values.length) return '<div class="sparkline-empty muted">暂无趋势数据</div>';
    const width = 640;
    const height = 120;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const step = width / Math.max(values.length - 1, 1);
    const polyline = values
      .map((value, idx) => {
        const x = idx * step;
        const y = height - ((value - min) / range) * height;
        return `${x},${y}`;
      })
      .join(" ");
    return `<svg class="sparkline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><polyline points="${polyline}" /></svg>`;
  }

  function mountBusinessStatusModule(containerEl, options) {
    const { basecampId, isRunning, fetchJson } = options;
    containerEl.innerHTML = `
      <section class="panel business-panel" id="business-panel">
        <div class="business-header">
          <h2 class="section-title">业务状态</h2>
          <span class="muted" data-refresh-status>最后更新时间：--:--:--</span>
        </div>
        <div class="business-cards" data-cards></div>
        <div class="business-detail" data-detail></div>
      </section>
    `;

    const cardsEl = containerEl.querySelector("[data-cards]");
    const detailEl = containerEl.querySelector("[data-detail]");
    const statusEl = containerEl.querySelector("[data-refresh-status]");
    let timer = null;
    let expanded = "";
    let summary = null;
    let detailPoints = { order: [], consumer: [], storage: [] };
    const previousValues = new Map();

    function drawCards() {
      const order = summary?.order || {};
      const consumer = summary?.consumer || {};
      const storage = summary?.storage || {};
      const orderSuccessRate = Number.isFinite(Number(order.error_rate)) ? 1 - Number(order.error_rate) : NaN;
      const orderSuccessLevel = getLevelClassLow(orderSuccessRate, "order_success_rate");
      const orderP99Level = getLevelClassHigh(order.p99_ms, "order_p99_ms");
      const consumerLagLevel = getLevelClassHigh(consumer.lag, "consumer_lag");
      const consumerProcLevel = getLevelClassHigh(consumer.avg_process_ms, "consumer_p99_ms");
      const writeLevel = getLevelClassLow(storage.write_success_rate, "write_success_rate");
      const readLevel = getLevelClassLow(storage.read_success_rate, "read_success_rate");
      const storageP99Level = getLevelClassHigh(storage.p99_ms, "storage_p99_ms");
      const chains = [
        {
          key: "order",
          name: "下单链路",
          statusClass: mergeLevel(orderSuccessLevel, orderP99Level),
          metrics: [
            ["成功率", formatMetricWithBadge(formatPercent(orderSuccessRate, 0), orderSuccessLevel), "order.success_rate"],
            ["P99 延迟", formatMetricWithBadge(`${formatValue(order.p99_ms)} ms`, orderP99Level), "order.p99_ms"],
            ["请求量", `${formatValue(order.requests_per_min)} 次/分钟`, "order.requests_per_min"]
          ]
        },
        {
          key: "consumer",
          name: "消息链路",
          statusClass: mergeLevel(consumerLagLevel, consumerProcLevel),
          metrics: [
            ["消息积压", formatMetricWithBadge(`${formatValue(consumer.lag)} 条`, consumerLagLevel), "consumer.lag"],
            ["处理耗时", formatMetricWithBadge(`${formatValue(consumer.avg_process_ms)} ms`, consumerProcLevel), "consumer.avg_process_ms"]
          ]
        },
        {
          key: "storage",
          name: "存储层",
          statusClass: mergeLevel(mergeLevel(writeLevel, readLevel), storageP99Level),
          metrics: [
            ["写入成功率", formatMetricWithBadge(formatPercent(storage.write_success_rate, 0), writeLevel), "storage.write_success_rate"],
            ["读取成功率", formatMetricWithBadge(formatPercent(storage.read_success_rate, 0), readLevel), "storage.read_success_rate"],
            ["存储响应 P99", formatMetricWithBadge(`${formatValue(storage.p99_ms)} ms`, storageP99Level), "storage.p99_ms"]
          ]
        }
      ];

      cardsEl.innerHTML = chains
        .map((chain) => {
          const active = expanded === chain.key ? "active" : "";
          return `
            <article class="business-card ${chain.statusClass} ${active}" data-chain="${chain.key}">
              <strong class="business-card-title">${chain.name}</strong>
              <div class="business-card-metrics">
                ${chain.metrics
                  .map(([label, value, id]) => {
                    const prev = previousValues.get(id);
                    const next = String(value);
                    const changed = prev !== undefined && prev !== next ? "flash" : "";
                    previousValues.set(id, next);
                    return `<div class="business-metric ${changed}"><span class="metric-label">${label}</span><span class="metric-value">${value}</span></div>`;
                  })
                  .join("")}
              </div>
            </article>
          `;
        })
        .join("");

      for (const card of cardsEl.querySelectorAll(".business-card")) {
        card.addEventListener("click", async () => {
          const chain = card.dataset.chain || "";
          expanded = expanded === chain ? "" : chain;
          drawCards();
          await drawDetail();
        });
      }
    }

    async function pullDetail(chain) {
      try {
        const data = await fetchJson(`/api/basecamps/${encodeURIComponent(basecampId)}/metrics/detail?chain=${chain}&limit=40`);
        detailPoints[chain] = Array.isArray(data.points) ? data.points : [];
      } catch {
        detailPoints[chain] = [];
      }
    }

    async function drawDetail() {
      if (!expanded) {
        detailEl.classList.remove("open");
        detailEl.innerHTML = "";
        return;
      }
      detailEl.classList.add("open");
      await pullDetail(expanded);
      const points = detailPoints[expanded] || [];
      if (expanded === "order") {
        const latest = points[points.length - 1] || {};
        detailEl.innerHTML = `<div class="detail-section"><h3 class="detail-title">下单链路详情</h3><div class="sparkline-wrap">${renderSparkline(points, "p99_ms")}</div><div class="detail-meta-grid"><div class="info-item"><div class="info-label">P99 / P95 / P50</div><div class="info-value">${formatValue(latest.p99_ms)} / ${formatValue(latest.p95_ms)} / ${formatValue(latest.p50_ms)} ms</div></div><div class="info-item"><div class="info-label">2xx / 4xx / 5xx</div><div class="info-value">${formatValue(latest.status_2xx)} / ${formatValue(latest.status_4xx)} / ${formatValue(latest.status_5xx)}</div></div></div></div>`;
        return;
      }
      if (expanded === "consumer") {
        const latest = points[points.length - 1] || {};
        const records = points.slice(-10).reverse().map((point) => `<div class="list-row"><span>offset ${formatValue(point.offset)}</span><span>${formatValue(point.took_ms)} ms</span></div>`).join("");
        detailEl.innerHTML = `<div class="detail-section"><h3 class="detail-title">消息链路详情</h3><div class="sparkline-wrap">${renderSparkline(points, "lag")}</div><div class="detail-meta-grid"><div class="info-item"><div class="info-label">当前 Lag</div><div class="info-value">${formatValue(latest.lag)}</div></div><div class="info-item"><div class="info-label">平均处理耗时</div><div class="info-value">${formatValue(latest.avg_process_ms)} ms</div></div></div><div class="detail-list">${records || '<div class="muted">暂无消费记录</div>'}</div></div>`;
        return;
      }
      const latest = points[points.length - 1] || {};
      detailEl.innerHTML = `<div class="detail-section"><h3 class="detail-title">存储层详情</h3><div class="sparkline-wrap">${renderSparkline(points, "p99_ms")}</div><div class="detail-meta-grid"><div class="info-item"><div class="info-label">写入成功率</div><div class="info-value">${formatPercent(latest.write_success_rate, 0)}</div></div><div class="info-item"><div class="info-label">读取成功率</div><div class="info-value">${formatPercent(latest.read_success_rate, 0)}</div></div><div class="info-item"><div class="info-label">存储响应 P99</div><div class="info-value">${formatValue(latest.p99_ms)} ms</div></div></div></div>`;
    }

    async function refreshSummary() {
      if (!isRunning()) {
        summary = null;
        statusEl.textContent = "最后更新时间：底座未运行";
        drawCards();
        await drawDetail();
        return;
      }
      try {
        const data = await fetchJson(`/api/basecamps/${encodeURIComponent(basecampId)}/metrics/summary`);
        summary = data;
        const timeText = data.collected_at ? new Date(data.collected_at).toLocaleTimeString("zh-CN", { hour12: false }) : "--:--:--";
        statusEl.textContent = `最后更新时间：${timeText}`;
        drawCards();
        await drawDetail();
      } catch {
        statusEl.textContent = "最后更新时间：刷新失败";
      }
    }
    refreshSummary();
    timer = setInterval(refreshSummary, 3000);
    return {
      unmount() {
        if (timer) clearInterval(timer);
        timer = null;
        containerEl.innerHTML = "";
      }
    };
  }

  window.FaultLabModules = window.FaultLabModules || {};
  window.FaultLabModules.mountBusinessStatusModule = mountBusinessStatusModule;
})();
