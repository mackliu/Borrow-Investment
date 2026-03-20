/**
 * 蒙地卡羅模擬渲染模組
 * 命名空間: Forcast.MonteCarloRenderer
 *
 * 啟動 Web Worker 執行模擬，完成後畫信心區間圖表
 */
(function() {
  var ns = window.Forcast = window.Forcast || {};

  var _worker = null;
  var _chart = null;

  ns.MonteCarloRenderer = {
    /**
     * 執行蒙地卡羅模擬並渲染圖表
     * @param {string} canvasId - canvas 元素 ID
     * @param {Object} config - { loanAmount, annualRate, buyCommission, sellCommission, sellTax }
     * @param {Array<number>} historicalReturns - 歷史月報酬率陣列
     * @param {number} startPrice - 買入價格
     * @param {Array<string>} labels - 期數標籤陣列
     * @param {string} workerPath - Worker JS 路徑
     */
    run: function(canvasId, config, historicalReturns, startPrice, labels, workerPath) {
      var progressEl = document.getElementById('mcProgress');
      var btnEl = document.getElementById('runMonteCarlo');
      var noteEl = document.getElementById('mcNote');

      if (btnEl) { btnEl.disabled = true; btnEl.textContent = '模擬中...'; }
      if (progressEl) progressEl.textContent = '0%';

      // 終止舊 Worker
      if (_worker) { _worker.terminate(); _worker = null; }

      var numSims = 5000;
      _worker = new Worker(workerPath);

      _worker.onmessage = function(e) {
        var msg = e.data;

        if (msg.type === 'progress') {
          var pct = Math.round(msg.completed / msg.total * 100);
          if (progressEl) progressEl.textContent = pct + '%';
        }

        if (msg.type === 'result') {
          if (progressEl) progressEl.textContent = '完成';
          if (btnEl) { btnEl.disabled = false; btnEl.textContent = '重新模擬 (' + numSims + ' 次)'; }

          renderChart(canvasId, msg.percentiles, labels);

          if (noteEl) {
            noteEl.style.display = 'block';
            var last = labels.length - 1;
            noteEl.innerHTML =
              '<strong>蒙地卡羅模擬說明：</strong><br>' +
              '從全歷史月報酬率中隨機抽樣（bootstrap），模擬 ' + numSims + ' 次完整還款週期。<br>' +
              '深色帶 = P25~P75（50% 信心區間），淺色帶 = P10~P90（80% 信心區間），實線 = P50（中位數）。<br>' +
              '最終淨資產中位數 (P50)：NT$' + msg.percentiles.p50[last].toLocaleString() +
              '，P10：NT$' + msg.percentiles.p10[last].toLocaleString() +
              '，P90：NT$' + msg.percentiles.p90[last].toLocaleString() + '<br>' +
              '<span style="color:var(--red)">注意：此模擬假設月報酬率獨立同分佈，未考慮動態相關性與尾部風險。簡化模型不含股利再投入。</span>';
          }

          _worker.terminate();
          _worker = null;
        }
      };

      _worker.postMessage({
        config: config,
        historicalReturns: historicalReturns,
        startPrice: startPrice,
        periods: labels.length,
        numSimulations: numSims
      });
    }
  };

  function renderChart(canvasId, percentiles, labels) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;

    if (_chart) { _chart.destroy(); _chart = null; }

    var ctx = canvas.getContext('2d');
    _chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'P90',
            data: percentiles.p90,
            borderColor: 'transparent',
            backgroundColor: 'rgba(21,101,192,0.08)',
            fill: '+4',
            pointRadius: 0
          },
          {
            label: 'P75',
            data: percentiles.p75,
            borderColor: 'transparent',
            backgroundColor: 'rgba(21,101,192,0.15)',
            fill: '+2',
            pointRadius: 0
          },
          {
            label: 'P50 (中位數)',
            data: percentiles.p50,
            borderColor: '#1565c0',
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            pointRadius: 0,
            tension: 0.1
          },
          {
            label: 'P25',
            data: percentiles.p25,
            borderColor: 'transparent',
            backgroundColor: 'transparent',
            pointRadius: 0
          },
          {
            label: 'P10',
            data: percentiles.p10,
            borderColor: 'transparent',
            backgroundColor: 'transparent',
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: '蒙地卡羅模擬 — 淨資產信心區間', font: { size: 14 } },
          legend: {
            position: 'bottom',
            labels: {
              filter: function(item) {
                return item.text === 'P50 (中位數)' || item.text === 'P90' || item.text === 'P10';
              }
            }
          }
        },
        scales: {
          x: { ticks: { maxTicksLimit: 12, maxRotation: 45 } },
          y: { ticks: { callback: function(v) { return 'NT$' + v.toLocaleString(); } } }
        },
        interaction: { mode: 'index', intersect: false }
      }
    });
  }
})();
