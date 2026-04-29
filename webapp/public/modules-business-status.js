(function () {
  const THRESHOLDS = {
    error_rate: { warn: 0.05, critical: 0.15 },
    p99_ms: { warn: 500, critical: 2000 },
    consumer_lag: { warn: 100, critical: 500 },
    mysql_conn_ratio: { warn: 0.7, critical: 0.9 },
    redis_mem_ratio: { warn: 0.7, critical: 0.9 }
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

  function getLevelClass(value, thresholdKey) {
    const conf = THRESHOLDS[thresholdKey];
    const num = Number(value);
    if (!conf || !Number.isFinite(num)) return "normal";
    if (num >= conf.critical) return "critical";
    if (num >= conf.warn) return "warn";
    return "normal";
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
      const mysqlRatio =
        Number(storage.mysql_connections_max) > 0 ? Number(storage.mysql_connections) / Number(storage.mysql_connections_max) : NaN;
      const redisRatio =
        Number(storage.redis_mem_max_mb) > 0 ? Number(storage.redis_mem_used_mb) / Number(storage.redis_mem_max_mb) : NaN;
      const chains = [
        {
          key: "order",
          name: "下单链路",
          statusClass: getLevelClass(order.error_rate, "error_rate") === "critical" || getLevelClass(order.p99_ms, "p99_ms") === "critical" ? "critical" : getLevelClass(order.error_rate, "error_rate") === "warn" || getLevelClass(order.p99_ms, "p99_ms") === "warn" ? "warn" : "normal",
          metrics: [
            ["请求量", `${formatValue(order.requests_per_min)} 次/分钟`, "order.requests_per_min"],
            ["P99 延迟", `${formatValue(order.p99_ms)} ms`, "order.p99_ms"],
            ["错误率", formatPercent(order.error_rate), "order.error_rate"]
          ]
        },
        {
          key: "consumer",
          name: "消息链路",
          statusClass: getLevelClass(consumer.lag, "consumer_lag"),
          metrics: [
            ["Consumer Lag", `${formatValue(consumer.lag)} 条`, "consumer.lag"],
            ["处理耗时", `${formatValue(consumer.avg_process_ms)} ms`, "consumer.avg_process_ms"]
          ]
        },
        {
          key: "storage",
          name: "存储层",
          statusClass:
            getLevelClass(mysqlRatio, "mysql_conn_ratio") === "critical" || getLevelClass(redisRatio, "redis_mem_ratio") === "critical"
              ? "critical"
              : getLevelClass(mysqlRatio, "mysql_conn_ratio") === "warn" || getLevelClass(redisRatio, "redis_mem_ratio") === "warn"
                ? "warn"
                : "normal",
          metrics: [
            ["MySQL 连接数", Number.isFinite(mysqlRatio) ? `${formatValue(storage.mysql_connections)} / ${formatValue(storage.mysql_connections_max)}` : "— —", "storage.mysql_ratio"],
            ["Redis 内存使用率", Number.isFinite(redisRatio) ? formatPercent(redisRatio) : "— —", "storage.redis_ratio"]
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
      detailEl.innerHTML = `<div class="detail-section"><h3 class="detail-title">存储层详情</h3><div class="sparkline-wrap">${renderSparkline(points, "mysql_connections")}</div><div class="detail-meta-grid"><div class="info-item"><div class="info-label">MySQL 活跃查询数</div><div class="info-value">${formatValue(latest.mysql_active_queries)}</div></div><div class="info-item"><div class="info-label">Redis 命中率</div><div class="info-value">${formatPercent(latest.redis_hit_rate)}</div></div><div class="info-item"><div class="info-label">Redis 内存</div><div class="info-value">${formatValue(latest.redis_mem_used_mb)} / ${formatValue(latest.redis_mem_max_mb)} MB</div></div><div class="info-item"><div class="info-label">Redis Key 数量</div><div class="info-value">${formatValue(latest.redis_key_count)}</div></div></div></div>`;
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
