/**
 * 比較頁渲染模組
 * 命名空間: Forcast.ComparisonRenderer
 */
(function() {
  var ns = window.Forcast = window.Forcast || {};

  function fmt(n, dec) {
    dec = dec || 0;
    return n.toLocaleString('zh-TW', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  ns.ComparisonRenderer = {
    /**
     * 渲染比較結果
     * @param {Object} results - { ticker: { sim, config } }
     */
    render: function(results) {
      var tickers = ['0050', '0056', '00631L', '00679B'];
      var names = { '0050': '元大台灣50', '0056': '元大高股息', '00631L': '元大台灣50正2', '00679B': '元大美債20年' };

      // 比較摘要表
      var tableHTML = '<table><thead><tr><th>指標</th>';
      for (var t = 0; t < tickers.length; t++) {
        tableHTML += '<th>' + tickers[t] + '<br><small>' + names[tickers[t]] + '</small></th>';
      }
      tableHTML += '</tr></thead><tbody>';

      var rows = [
        { label: '買入價格', key: function(r) { return 'NT$' + fmt(r.sim.summary.buyPrice, 2); } },
        { label: '買入股數', key: function(r) { return fmt(r.sim.summary.initialShares); } },
        { label: '總利息支出', key: function(r) { return 'NT$' + fmt(r.sim.summary.totalInterest); } },
        { label: '總交易成本', key: function(r) { return 'NT$' + fmt(r.sim.summary.totalSellCost + r.sim.summary.totalBuyComm); } },
        { label: '總股利收入', key: function(r) { return 'NT$' + fmt(r.sim.summary.totalDividends); } },
        { label: '最終剩餘股數', key: function(r) { var last = r.sim.periods[r.sim.periods.length - 1]; return fmt(last.shares); } },
        { label: '最終股票市值', key: function(r) { var last = r.sim.periods[r.sim.periods.length - 1]; return 'NT$' + fmt(last.marketValue); } },
        { label: '最終剩餘現金', key: function(r) { var last = r.sim.periods[r.sim.periods.length - 1]; return 'NT$' + fmt(last.cash); } },
        { label: '淨損益', key: function(r) {
          var last = r.sim.periods[r.sim.periods.length - 1];
          var s = r.sim.summary;
          var totalCosts = s.totalInterest + s.totalSellCost + s.totalBuyComm;
          var finalAssets = last.marketValue + last.cash;
          var pl = finalAssets - totalCosts;
          var cls = pl >= 0 ? 'profit' : 'loss';
          return '<span class="' + cls + '">NT$' + fmt(pl) + '</span>';
        }},
        { label: '投資報酬率', key: function(r) {
          var last = r.sim.periods[r.sim.periods.length - 1];
          var s = r.sim.summary;
          var totalCosts = s.totalInterest + s.totalSellCost + s.totalBuyComm;
          var finalAssets = last.marketValue + last.cash;
          var pl = finalAssets - totalCosts;
          var roi = (pl / r.config.loan.amount * 100).toFixed(1);
          var cls = pl >= 0 ? 'profit' : 'loss';
          return '<span class="' + cls + '">' + roi + '%</span>';
        }},
        { label: '推估月報酬率', key: function(r) { return (r.sim.summary.monthlyGrowthRate * 100).toFixed(2) + '%'; } }
      ];

      for (var ri = 0; ri < rows.length; ri++) {
        tableHTML += '<tr><td style="text-align:left;font-weight:600">' + rows[ri].label + '</td>';
        for (var ti = 0; ti < tickers.length; ti++) {
          var res = results[tickers[ti]];
          tableHTML += '<td>' + (res ? rows[ri].key(res) : '-') + '</td>';
        }
        tableHTML += '</tr>';
      }
      tableHTML += '</tbody></table>';
      document.getElementById('compareTable').innerHTML = tableHTML;

      // Chart.js 淨資產走勢圖
      var colors = { '0050': '#1565c0', '0056': '#2e7d32', '00631L': '#d32f2f', '00679B': '#7b1fa2' };
      var datasets = [];
      var labels = null;

      for (var ci = 0; ci < tickers.length; ci++) {
        var ticker = tickers[ci];
        var res = results[ticker];
        if (!res) continue;

        if (!labels) {
          labels = res.sim.periods.map(function(p) { return p.payDate; });
        }
        datasets.push({
          label: ticker + ' ' + names[ticker],
          data: res.sim.periods.map(function(p) { return Math.round(p.netPosition); }),
          borderColor: colors[ticker],
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1
        });
      }

      if (labels && window.Chart) {
        // 銷毀舊圖表，避免 canvas 重複使用錯誤
        if (ns.ComparisonRenderer._chart) {
          ns.ComparisonRenderer._chart.destroy();
        }
        var ctx = document.getElementById('chartCanvas').getContext('2d');
        ns.ComparisonRenderer._chart = new Chart(ctx, {
          type: 'line',
          data: { labels: labels, datasets: datasets },
          options: {
            responsive: true,
            plugins: {
              title: { display: true, text: '淨資產走勢比較', font: { size: 16 } },
              legend: { position: 'bottom' }
            },
            scales: {
              x: {
                ticks: { maxTicksLimit: 12, maxRotation: 45 }
              },
              y: {
                ticks: {
                  callback: function(value) {
                    return 'NT$' + value.toLocaleString();
                  }
                }
              }
            },
            interaction: {
              mode: 'index',
              intersect: false
            }
          }
        });
      }
    }
  };
})();
