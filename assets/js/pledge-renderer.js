/**
 * 質押版試算器渲染模組
 * 命名空間: Forcast.PledgeRenderer
 *
 * 從質押試算頁面呼叫 render(sim, pageConfig) 產生畫面
 */
(function() {
  var ns = window.Forcast = window.Forcast || {};
  var fmt = ns.CalculatorRenderer ? ns.CalculatorRenderer.fmt : function(n, dec) {
    dec = dec || 0;
    return n.toLocaleString('zh-TW', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  };

  ns.PledgeRenderer = {
    _scenarioChart: null,

    renderScenarioInfo: function(bootstrapInfo, activeScenario) {
      var el = document.getElementById('scenarioInfo');
      if (!el) return;
      var stats = bootstrapInfo.stats;
      var finals = bootstrapInfo.finalNetPositions;
      var numSims = bootstrapInfo.numSimulations || 5000;
      var labels = { optimistic: '樂觀 P75', base: '基準 P50', pessimistic: '悲觀 P25' };
      var keys = ['optimistic', 'base', 'pessimistic'];
      var html = '';
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var bold = k === activeScenario ? 'font-weight:600' : '';
        var netStr = finals ? 'NT$' + fmt(finals[k]) : '';
        html += '<span style="margin:0 10px;' + bold + '">' + labels[k] + (netStr ? '：' + netStr : '') + '</span>';
      }
      html += '<br><small>Bootstrap 模擬 ' + fmt(numSims) + ' 次 ｜ 歷史月數 ' + stats.count + ' 個月 ｜ 歷史月均報酬 ' + (stats.mean * 100).toFixed(2) + '%</small>';
      el.innerHTML = html;
    },

    renderScenarioChart: function(allSims) {
      var canvas = document.getElementById('scenarioChart');
      if (!canvas || !window.Chart) return;
      if (this._scenarioChart) { this._scenarioChart.destroy(); this._scenarioChart = null; }

      // 找最長的有效期數（各情境可能因停止而長度不同）
      var basePeriods = allSims.base.periods;
      var labels = basePeriods.map(function(p) { return p.payDate; });

      function getData(sim) {
        var data = sim.periods.map(function(p) { return Math.round(p.netPosition); });
        // 如果比 base 短，補 null
        while (data.length < labels.length) data.push(null);
        return data;
      }

      var datasets = [
        { label: '樂觀 (P75)', data: getData(allSims.optimistic), borderColor: '#2e7d32', backgroundColor: 'transparent', borderWidth: 2, borderDash: [6, 3], pointRadius: 0, tension: 0.1, spanGaps: false },
        { label: '基準 (P50)', data: getData(allSims.base), borderColor: '#1565c0', backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0.1, spanGaps: false },
        { label: '悲觀 (P25)', data: getData(allSims.pessimistic), borderColor: '#d32f2f', backgroundColor: 'transparent', borderWidth: 2, borderDash: [6, 3], pointRadius: 0, tension: 0.1, spanGaps: false }
      ];

      this._scenarioChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          plugins: { title: { display: true, text: '淨資產走勢（三情境・質押版）', font: { size: 14 } }, legend: { position: 'bottom' } },
          scales: { x: { ticks: { maxTicksLimit: 12, maxRotation: 45 } }, y: { ticks: { callback: function(v) { return 'NT$' + v.toLocaleString(); } } } },
          interaction: { mode: 'index', intersect: false }
        }
      });
    },

    renderScenario: function(allSims, activeScenario, pageConfig) {
      this.render(allSims[activeScenario], pageConfig);
      this.renderScenarioChart(allSims);
      this.renderScenarioInfo(pageConfig._bootstrapInfo, activeScenario);
    },

    render: function(sim, pageConfig) {
      var r = sim.periods;
      if (!r || r.length === 0) return;
      var last = r[r.length - 1];
      var s = sim.summary;
      var LOAN = pageConfig.loan.amount;
      var PERIODS = pageConfig.loan.periods;
      var ANNUAL_RATE = pageConfig.loan.annualRate;
      var pledge = pageConfig.pledge;
      var actions = pageConfig.corporateActions || [];

      var splitRatio = 1;
      for (var i = 0; i < actions.length; i++) {
        if (actions[i].type === 'split') splitRatio *= actions[i].ratio;
      }

      // 總成本（含質押利息）
      var totalCosts = s.totalInterest + s.totalPledgeInterest + s.totalSellCost + s.totalBuyComm;
      var finalAssets = last.totalMarketValue + last.cash;
      var finalDebt = last.remainingLoan + last.pledgeLoan;
      var profitLoss = finalAssets - finalDebt - totalCosts;
      var isProfit = profitLoss >= 0;

      var splitNote = splitRatio > 1 ? ' (拆後 ' + (s.initialShares * splitRatio) + ' 股)' : '';

      // 參數區
      document.getElementById('params').innerHTML =
        '<div class="param-card"><div class="label">貸款金額</div><div class="value">NT$' + fmt(LOAN) + '</div></div>' +
        '<div class="param-card"><div class="label">年利率</div><div class="value">' + (ANNUAL_RATE * 100).toFixed(2) + '%</div></div>' +
        '<div class="param-card"><div class="label">期數</div><div class="value">' + PERIODS + ' 期</div></div>' +
        '<div class="param-card"><div class="label">信貸月付</div><div class="value">NT$' + fmt(s.monthlyPayment, 0) + '</div></div>' +
        '<div class="param-card"><div class="label">買入日期</div><div class="value">' + pageConfig.buyDate + '</div></div>' +
        '<div class="param-card"><div class="label">買入價格</div><div class="value">NT$' + fmt(s.buyPrice, 2) + '</div></div>' +
        '<div class="param-card"><div class="label">信貸買入股數</div><div class="value">' + fmt(s.initialShares) + ' 股' + splitNote + '</div></div>' +
        '<div class="param-card"><div class="label">質押借出</div><div class="value">NT$' + fmt(s.pledgeLoanAmount) + '</div></div>' +
        '<div class="param-card"><div class="label">質押利率</div><div class="value">' + (pledge.annualRate * 100).toFixed(2) + '%</div></div>' +
        '<div class="param-card"><div class="label">質押再買入</div><div class="value">' + fmt(s.additionalShares) + ' 股</div></div>' +
        '<div class="param-card"><div class="label">質押股(鎖定)</div><div class="value">' + fmt(s.initialShares) + ' 股' + splitNote + '</div></div>' +
        '<div class="param-card"><div class="label">初始自由股</div><div class="value">' + fmt(s.additionalShares) + ' 股</div></div>';

      // 停止警告
      var stoppedEl = document.getElementById('stoppedWarning');
      if (stoppedEl) {
        if (sim.stopped) {
          stoppedEl.style.display = 'block';
          stoppedEl.innerHTML = '<strong>⚠ 模擬提前終止：</strong>' + sim.stopped.message;
        } else {
          stoppedEl.style.display = 'none';
        }
      }

      // 判定
      var verdictEl = document.getElementById('verdict');
      var verdictText;
      if (sim.stopped) {
        verdictEl.className = 'verdict loss';
        verdictText = '策略失敗（第 ' + sim.stopped.period + ' 期終止）｜ 終止時淨資產 NT$' + fmt(last.netPosition);
      } else {
        verdictEl.className = 'verdict ' + (isProfit ? 'profit' : 'loss');
        verdictText = isProfit
          ? '策略結果：獲利 NT$' + fmt(profitLoss) + ' (ROI ' + (profitLoss / LOAN * 100).toFixed(1) + '%)'
          : '策略結果：虧損 NT$' + fmt(Math.abs(profitLoss)) + ' (ROI ' + (profitLoss / LOAN * 100).toFixed(1) + '%)';
      }
      verdictEl.innerHTML = verdictText;

      // 摘要
      var completedPeriods = r.length;
      document.getElementById('summary').innerHTML =
        '<div class="summary-card"><div class="label">完成期數</div><div class="value">' + completedPeriods + ' / ' + PERIODS + '</div></div>' +
        '<div class="summary-card"><div class="label">信貸總利息</div><div class="value loss">NT$' + fmt(s.totalInterest) + '</div></div>' +
        '<div class="summary-card"><div class="label">質押總利息</div><div class="value loss">NT$' + fmt(s.totalPledgeInterest) + '</div></div>' +
        '<div class="summary-card"><div class="label">總交易成本</div><div class="value loss">NT$' + fmt(s.totalSellCost + s.totalBuyComm) + '</div></div>' +
        '<div class="summary-card"><div class="label">總股利收入</div><div class="value profit">NT$' + fmt(s.totalDividends) + '</div></div>' +
        '<div class="summary-card"><div class="label">最終自由股</div><div class="value">' + fmt(last.freeShares) + ' 股</div></div>' +
        '<div class="summary-card"><div class="label">最終質押股</div><div class="value">' + fmt(last.pledgedShares) + ' 股</div></div>' +
        '<div class="summary-card"><div class="label">最終總市值</div><div class="value">NT$' + fmt(last.totalMarketValue) + '</div></div>' +
        '<div class="summary-card"><div class="label">剩餘信貸</div><div class="value loss">NT$' + fmt(last.remainingLoan) + '</div></div>' +
        '<div class="summary-card"><div class="label">質押借款</div><div class="value loss">NT$' + fmt(last.pledgeLoan) + '</div></div>' +
        '<div class="summary-card"><div class="label">最終淨資產</div><div class="value ' + (last.netPosition >= 0 ? 'profit' : 'loss') + '">NT$' + fmt(last.netPosition) + '</div></div>' +
        '<div class="summary-card"><div class="label">最低維持率</div><div class="value ' + (Math.min.apply(null, r.map(function(p){return p.maintenanceRatio;})) < 1.5 ? 'loss' : '') + '">' + (Math.min.apply(null, r.map(function(p){return p.maintenanceRatio;})) * 100).toFixed(0) + '%</div></div>';

      // 計算實際資料最後一期
      var lastActualPeriod = 0;
      for (var j = 0; j < r.length; j++) {
        if (!r[j].isProjected) lastActualPeriod = r[j].period;
      }

      var growthRate = s.monthlyGrowthRate;
      var annualRate = (Math.pow(1 + growthRate, 12) - 1) * 100;

      // 備註區
      var noteHTML = '<strong>說明（質押版）：</strong><br>';
      noteHTML += '1. Day 0 以信貸全額買入 → 全數質押（鎖定）→ 借出市值 ' + (pageConfig.pledge.ltvRatio * 100) + '% → 再買入同標的（自由股）<br>';
      noteHTML += '2. 每月賣出自由股支付信貸月付金 + 質押利息（年利率 ' + (pageConfig.pledge.annualRate * 100).toFixed(2) + '%）<br>';
      noteHTML += '3. 質押股不可賣出，直到還清質押借款<br>';
      noteHTML += '4. 追繳線：維持率 ' + (pageConfig.pledge.maintenanceCallRatio * 100).toFixed(0) + '%（質押市值 / 質押借款）<br>';
      if (pageConfig.notes) {
        for (var ni = 0; ni < pageConfig.notes.length; ni++) {
          noteHTML += (ni + 5) + '. ' + pageConfig.notes[ni] + '<br>';
        }
      }
      var noteIdx = (pageConfig.notes ? pageConfig.notes.length : 0) + 5;
      if (pageConfig.scenarioLabel) {
        noteHTML += noteIdx++ + '. ' + pageConfig.scenarioLabel + '<br>';
      }
      noteHTML += noteIdx++ + '. <span style="color:#888;font-style:italic">斜體灰色</span> 列為推估資料<br>';

      if (!sim.stopped && lastActualPeriod > 0) {
        var laRow = r[lastActualPeriod - 1];
        noteHTML += '<br><strong>截至實際資料 (第 ' + lastActualPeriod + ' 期)：</strong><br>';
        noteHTML += '自由股 ' + fmt(laRow.freeShares) + ' ｜ 質押股 ' + fmt(laRow.pledgedShares) + ' ｜ 總市值 NT$' + fmt(laRow.totalMarketValue) + ' ｜ 維持率 ' + (laRow.maintenanceRatio * 100).toFixed(0) + '%<br>';
      }

      noteHTML += '<br><strong style="color:var(--red)">注意：</strong>';
      noteHTML += '質押投資在原有借貸風險上疊加融資風險，波動時可能觸發追繳。此試算僅供研究參考，不構成投資建議。';

      if (pageConfig.warnings) {
        noteHTML += '<br><br>';
        for (var wi = 0; wi < pageConfig.warnings.length; wi++) {
          noteHTML += '<strong style="color:var(--red)">' + pageConfig.warnings[wi] + '</strong><br>';
        }
      }
      document.getElementById('noteArea').innerHTML = noteHTML;

      // 表頭
      document.getElementById('thead').innerHTML = '<tr>' +
        '<th>期數</th><th>還款日</th><th>賣股日</th><th>賣出價</th><th>賣出股數</th>' +
        '<th>交易成本</th><th>信貸月付</th><th>質押利息</th><th>月付總額</th>' +
        '<th>剩餘信貸</th><th>現金</th><th>自由股</th><th>質押股</th>' +
        '<th>股價</th><th>總市值</th><th>維持率</th><th>淨資產</th>' +
        '</tr>';

      // 表格
      var tbody = document.getElementById('tbody');
      tbody.innerHTML = '';
      var firstProjected = null;
      for (var m = 0; m < r.length; m++) {
        if (r[m].isProjected && firstProjected === null) firstProjected = r[m].period;
      }

      for (var n = 0; n < r.length; n++) {
        var row = r[n];
        var tr = document.createElement('tr');
        if (row.isProjected) tr.className = 'projected';

        // 維持率低於 170% 標紅
        var mrColor = row.maintenanceRatio < 1.7 ? 'color:var(--red);font-weight:600' : '';

        var eventTags = '';
        for (var e = 0; e < row.events.length; e++) {
          var ev = row.events[e];
          if (ev.type === 'split') eventTags += '<span class="event-tag split">1:' + (ev.ratio || splitRatio) + ' 分割</span>';
          if (ev.type === 'div') eventTags += '<span class="event-tag div">配息</span>';
        }
        if (row.isProjected && row.period === firstProjected) eventTags += '<span class="event-tag proj">推估</span>';

        tr.innerHTML =
          '<td>' + row.period + eventTags + '</td>' +
          '<td>' + row.payDate + '</td>' +
          '<td>' + row.sellDate + '</td>' +
          '<td>' + fmt(row.sellPrice, 2) + '</td>' +
          '<td>' + fmt(row.sharesToSell) + '</td>' +
          '<td>' + fmt(row.sellCost, 0) + '</td>' +
          '<td>' + fmt(row.payment, 0) + '</td>' +
          '<td>' + fmt(row.pledgeInterest, 0) + '</td>' +
          '<td>' + fmt(row.totalObligation, 0) + '</td>' +
          '<td>' + fmt(row.remainingLoan, 0) + '</td>' +
          '<td>' + fmt(row.cash, 0) + '</td>' +
          '<td>' + fmt(row.freeShares) + '</td>' +
          '<td>' + fmt(row.pledgedShares) + '</td>' +
          '<td>' + fmt(row.payPrice, 2) + '</td>' +
          '<td>' + fmt(row.totalMarketValue, 0) + '</td>' +
          '<td style="' + mrColor + '">' + (row.maintenanceRatio * 100).toFixed(0) + '%</td>' +
          '<td style="color: ' + (row.netPosition >= 0 ? 'var(--green)' : 'var(--red)') + '; font-weight:600">' + fmt(row.netPosition, 0) + '</td>';
        tbody.appendChild(tr);
      }

      // 股利明細
      var divSection = document.getElementById('divSection');
      if (pageConfig.hasDividends === false && divSection) {
        divSection.style.display = 'none';
      } else if (divSection) {
        var divBody = document.getElementById('divBody');
        divBody.innerHTML = '';
        var divEvents = sim.dividendEvents;
        for (var p = 0; p < divEvents.length; p++) {
          var d = divEvents[p];
          var dtr = document.createElement('tr');
          dtr.innerHTML =
            '<td style="text-align:center">' + d.exDate + '</td>' +
            '<td style="text-align:center">' + d.payDate + '</td>' +
            '<td>' + fmt(d.amount, 2) + '</td>' +
            '<td>' + fmt(d.shares) + '</td>' +
            '<td>' + fmt(d.total, 0) + '</td>' +
            '<td style="text-align:center">' + d.action + '</td>' +
            '<td>' + (d.boughtShares > 0 ? fmt(d.boughtShares) : '-') + '</td>' +
            '<td>' + (d.buyPrice > 0 ? fmt(d.buyPrice, 2) : '-') + '</td>';
          divBody.appendChild(dtr);
        }
      }
    }
  };
})();
