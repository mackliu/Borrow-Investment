/**
 * 共用試算器渲染模組
 * 命名空間: Forcast.CalculatorRenderer
 *
 * 從各 ETF 試算頁面呼叫 render(sim, pageConfig) 產生畫面
 */
(function() {
  var ns = window.Forcast = window.Forcast || {};

  /**
   * 數字格式化
   */
  function fmt(n, dec) {
    dec = dec || 0;
    return n.toLocaleString('zh-TW', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  ns.CalculatorRenderer = {
    fmt: fmt,

    /**
     * 渲染試算結果
     * @param {Object} sim - BacktestEngine.simulate() 回傳的結果
     * @param {Object} pageConfig - 頁面設定
     * @param {string} pageConfig.ticker - 標的代號
     * @param {string} pageConfig.name - 標的名稱
     * @param {Object} pageConfig.loan - 貸款設定 {amount, annualRate, periods}
     * @param {string} pageConfig.buyDate - 買入日期
     * @param {Array} pageConfig.corporateActions - 公司行動（用於推導 splitRatio）
     * @param {boolean} pageConfig.hasDividends - 是否顯示股利明細表
     * @param {Array} pageConfig.notes - ETF 特定備註
     * @param {Array} pageConfig.warnings - 風險警告
     */
    render: function(sim, pageConfig) {
      var r = sim.periods;
      var last = r[r.length - 1];
      var s = sim.summary;
      var LOAN = pageConfig.loan.amount;
      var PERIODS = pageConfig.loan.periods;
      var ANNUAL_RATE = pageConfig.loan.annualRate;
      var actions = pageConfig.corporateActions || [];

      // 計算分割比例
      var splitRatio = 1;
      for (var i = 0; i < actions.length; i++) {
        if (actions[i].type === 'split') splitRatio *= actions[i].ratio;
      }

      // 總成本與損益
      var totalCosts = s.totalInterest + s.totalSellCost + s.totalBuyComm;
      var finalAssets = last.marketValue + last.cash;
      var profitLoss = finalAssets - totalCosts;
      var isProfit = profitLoss >= 0;

      var splitNote = splitRatio > 1
        ? ' (拆後 ' + (s.initialShares * splitRatio) + ' 股)'
        : '';

      // 參數區
      document.getElementById('params').innerHTML =
        '<div class="param-card"><div class="label">貸款金額</div><div class="value">NT$' + fmt(LOAN) + '</div></div>' +
        '<div class="param-card"><div class="label">年利率</div><div class="value">' + (ANNUAL_RATE * 100).toFixed(2) + '%</div></div>' +
        '<div class="param-card"><div class="label">期數</div><div class="value">' + PERIODS + ' 期</div></div>' +
        '<div class="param-card"><div class="label">每月還款</div><div class="value">NT$' + fmt(s.monthlyPayment, 0) + '</div></div>' +
        '<div class="param-card"><div class="label">買入日期</div><div class="value">' + pageConfig.buyDate + '</div></div>' +
        '<div class="param-card"><div class="label">買入價格</div><div class="value">NT$' + fmt(s.buyPrice, 2) + '</div></div>' +
        '<div class="param-card"><div class="label">買入股數</div><div class="value">' + fmt(s.initialShares) + ' 股' + splitNote + '</div></div>' +
        '<div class="param-card"><div class="label">買入手續費</div><div class="value">NT$' + fmt(s.initialBuyComm, 0) + '</div></div>';

      // 判定
      var verdictEl = document.getElementById('verdict');
      verdictEl.className = 'verdict ' + (isProfit ? 'profit' : 'loss');
      verdictEl.innerHTML = isProfit
        ? '策略結果：獲利 NT$' + fmt(profitLoss) + ' (投資報酬率 ' + (profitLoss / LOAN * 100).toFixed(1) + '%)'
        : '策略結果：虧損 NT$' + fmt(Math.abs(profitLoss)) + ' (投資報酬率 ' + (profitLoss / LOAN * 100).toFixed(1) + '%)';

      // 摘要
      document.getElementById('summary').innerHTML =
        '<div class="summary-card"><div class="label">總還款金額</div><div class="value">NT$' + fmt(s.monthlyPayment * PERIODS) + '</div></div>' +
        '<div class="summary-card"><div class="label">總利息支出</div><div class="value loss">NT$' + fmt(s.totalInterest) + '</div></div>' +
        '<div class="summary-card"><div class="label">總賣出交易成本</div><div class="value loss">NT$' + fmt(s.totalSellCost) + '</div></div>' +
        '<div class="summary-card"><div class="label">總買入手續費</div><div class="value loss">NT$' + fmt(s.totalBuyComm) + '</div></div>' +
        '<div class="summary-card"><div class="label">總股利收入</div><div class="value profit">NT$' + fmt(s.totalDividends) + '</div></div>' +
        '<div class="summary-card"><div class="label">最終剩餘股數</div><div class="value">' + fmt(last.shares) + ' 股</div></div>' +
        '<div class="summary-card"><div class="label">最終股票市值</div><div class="value">NT$' + fmt(last.marketValue) + '</div></div>' +
        '<div class="summary-card"><div class="label">最終剩餘現金</div><div class="value">NT$' + fmt(last.cash) + '</div></div>' +
        '<div class="summary-card"><div class="label">總成本(利息+交易)</div><div class="value loss">NT$' + fmt(totalCosts) + '</div></div>' +
        '<div class="summary-card"><div class="label">最終淨資產</div><div class="value ' + (isProfit ? 'profit' : 'loss') + '">NT$' + fmt(finalAssets) + '</div></div>' +
        '<div class="summary-card"><div class="label">淨損益</div><div class="value ' + (isProfit ? 'profit' : 'loss') + '">NT$' + fmt(profitLoss) + '</div></div>';

      // 計算實際資料最後一期
      var lastActualPeriod = 0;
      for (var j = 0; j < r.length; j++) {
        if (!r[j].isProjected) lastActualPeriod = r[j].period;
      }

      // 截至實際資料的淨損益
      var laRow = r[lastActualPeriod - 1];
      var laInterest = 0, laSellCost = 0;
      for (var k = 0; k < lastActualPeriod; k++) {
        laInterest += r[k].interest;
        laSellCost += r[k].sellCost;
      }
      var laActualPL = laRow.marketValue + laRow.cash - laRow.remainingLoan - laInterest - laSellCost - s.initialBuyComm;

      var growthRate = s.monthlyGrowthRate;
      var annualRate = (Math.pow(1 + growthRate, 12) - 1) * 100;

      // 備註區
      var noteHTML = '<strong>說明：</strong><br>';
      noteHTML += '1. 第 1~' + lastActualPeriod + ' 期使用實際交易價格（未調整），第 ' + (lastActualPeriod + 1) + '~' + PERIODS + ' 期使用歷史報酬率推估<br>';

      // ETF 特定備註
      if (pageConfig.notes) {
        for (var ni = 0; ni < pageConfig.notes.length; ni++) {
          noteHTML += (ni + 2) + '. ' + pageConfig.notes[ni] + '<br>';
        }
      }

      var noteIdx = (pageConfig.notes ? pageConfig.notes.length : 0) + 2;
      noteHTML += noteIdx++ + '. 賣出成本 = 手續費 0.1425% + 證交稅 0.1%；買入成本 = 手續費 0.1425%<br>';
      noteHTML += noteIdx++ + '. 股利發放日離還款日超過2天，一律再投入購買 ' + pageConfig.ticker + '<br>';
      noteHTML += noteIdx++ + '. 推估月報酬率 = ' + (growthRate * 100).toFixed(2) + '%（年化 ' + annualRate.toFixed(1) + '%），基於前 ' + lastActualPeriod + ' 個月實際總報酬<br>';
      noteHTML += noteIdx++ + '. <span style="color:#888;font-style:italic">斜體灰色</span> 列為推估資料<br>';

      noteHTML += '<br><strong>截至實際資料 (第 ' + lastActualPeriod + ' 期, ' + laRow.payDate + ')：</strong><br>';
      noteHTML += '剩餘貸款 NT$' + fmt(laRow.remainingLoan) + ' ｜ 持有 ' + fmt(laRow.shares) + ' 股 ｜ 市值 NT$' + fmt(laRow.marketValue) + ' ｜ 淨資產 NT$' + fmt(laRow.netPosition) + '<br>';
      noteHTML += '<span style="color:var(--green);font-weight:600">以實際資料計算，目前淨損益 = NT$' + fmt(laActualPL) + '（含已付利息與交易成本）</span><br>';

      noteHTML += '<br><strong style="color:var(--red)">注意：</strong>';
      noteHTML += '推估年化報酬率 ' + annualRate.toFixed(1) + '% 是基於歷史表現，不代表未來報酬。此試算僅供參考，不構成投資建議。';

      // 風險警告
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
        '<th>交易成本</th><th>月付金額</th><th>本金</th><th>利息</th>' +
        '<th>剩餘貸款</th><th>留存現金</th><th>持有股數</th>' +
        '<th>還款日股價</th><th>股票市值</th><th>淨資產</th>' +
        '</tr>';

      // 表格內容
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

        var eventTags = '';
        for (var e = 0; e < row.events.length; e++) {
          var ev = row.events[e];
          if (ev.type === 'split') eventTags += '<span class="event-tag split">1:' + (ev.ratio || splitRatio) + ' 分割</span>';
          if (ev.type === 'div') eventTags += '<span class="event-tag div">配息</span>';
        }
        if (row.isProjected && row.period === firstProjected) {
          eventTags += '<span class="event-tag proj">推估</span>';
        }

        tr.innerHTML =
          '<td>' + row.period + eventTags + '</td>' +
          '<td>' + row.payDate + '</td>' +
          '<td>' + row.sellDate + '</td>' +
          '<td>' + fmt(row.sellPrice, 2) + '</td>' +
          '<td>' + fmt(row.sharesToSell) + '</td>' +
          '<td>' + fmt(row.sellCost, 0) + '</td>' +
          '<td>' + fmt(row.payment, 0) + '</td>' +
          '<td>' + fmt(row.principal, 0) + '</td>' +
          '<td>' + fmt(row.interest, 0) + '</td>' +
          '<td>' + fmt(row.remainingLoan, 0) + '</td>' +
          '<td>' + fmt(row.cash, 0) + '</td>' +
          '<td>' + fmt(row.shares) + '</td>' +
          '<td>' + fmt(row.payPrice, 2) + '</td>' +
          '<td>' + fmt(row.marketValue, 0) + '</td>' +
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
