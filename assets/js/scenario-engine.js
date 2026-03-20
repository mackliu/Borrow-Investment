/**
 * 情境模擬引擎
 * 命名空間: Forcast.ScenarioEngine
 *
 * 採用 Non-parametric Bootstrap Monte Carlo Simulation (Efron, 1979)
 * 從完整歷史月報酬率中有放回隨機抽樣，產生 5,000 條模擬路徑
 * 以 P25/P50/P75 定義悲觀/基準/樂觀三情境
 */
(function() {
  var ns = window.Forcast = window.Forcast || {};

  /**
   * 從完整價格資料計算月報酬率陣列
   * @param {Object} prices - flat 價格物件 {"2024-04-16": 155.65, ...}
   * @param {Array} corporateActions - 公司行動陣列 [{date, type, ratio}]
   * @returns {Array<number>} 月報酬率陣列
   */
  function calcHistoricalMonthlyReturns(prices, corporateActions) {
    var tradingDays = Object.keys(prices).sort();
    if (tradingDays.length < 2) return [];

    // 按月分組，取每月最後一個交易日的收盤價
    var monthlyPrices = {};
    for (var i = 0; i < tradingDays.length; i++) {
      var d = tradingDays[i];
      var ym = d.substring(0, 7); // "YYYY-MM"
      monthlyPrices[ym] = { date: d, price: prices[d] };
    }

    var months = Object.keys(monthlyPrices).sort();
    if (months.length < 2) return [];

    // 建立分割事件的快速查找（按月份）
    var splitsByMonth = {};
    for (var si = 0; si < (corporateActions || []).length; si++) {
      var action = corporateActions[si];
      if (action.type === 'split') {
        var splitYM = action.date.substring(0, 7);
        splitsByMonth[splitYM] = action.ratio;
      }
    }

    var returns = [];
    for (var m = 1; m < months.length; m++) {
      var prevPrice = monthlyPrices[months[m - 1]].price;
      var curPrice = monthlyPrices[months[m]].price;

      // 若本月有分割事件，修正報酬率
      var splitRatio = splitsByMonth[months[m]];
      if (splitRatio) {
        curPrice = curPrice * splitRatio;
      }

      var monthReturn = curPrice / prevPrice - 1;
      returns.push(monthReturn);
    }

    return returns;
  }

  /**
   * 計算報酬率統計
   * @param {Array<number>} returns - 月報酬率陣列
   * @returns {Object} { mean, stddev, count }
   */
  function calcReturnStats(returns) {
    if (!returns || returns.length === 0) return { mean: 0, stddev: 0, count: 0 };

    var sum = 0;
    for (var i = 0; i < returns.length; i++) sum += returns[i];
    var mean = sum / returns.length;

    var sumSqDiff = 0;
    for (var j = 0; j < returns.length; j++) {
      var diff = returns[j] - mean;
      sumSqDiff += diff * diff;
    }
    var stddev = Math.sqrt(sumSqDiff / returns.length);

    return { mean: mean, stddev: stddev, count: returns.length };
  }

  ns.ScenarioEngine = {
    calcHistoricalMonthlyReturns: calcHistoricalMonthlyReturns,
    calcReturnStats: calcReturnStats,

    /**
     * 取得全歷史 mean 作為單一推估報酬率（compare 頁面使用）
     * @param {Object} prices - flat 價格物件
     * @param {Array} corporateActions - 公司行動陣列
     * @returns {Object} { optimistic, base, pessimistic, stats, returns }
     */
    getScenarioRates: function(prices, corporateActions) {
      var returns = calcHistoricalMonthlyReturns(prices, corporateActions);
      var stats = calcReturnStats(returns);

      return {
        optimistic: stats.mean + stats.stddev,
        base: stats.mean,
        pessimistic: stats.mean - stats.stddev,
        stats: stats,
        returns: returns
      };
    },

    /**
     * Bootstrap 模擬：產生樂觀/基準/悲觀三條月報酬率路徑
     *
     * @param {Object} opts
     * @param {Array<number>} opts.historicalReturns - 歷史月報酬率陣列
     * @param {number} opts.projectedMonths - 需推估的月數
     * @param {Object} opts.startState - 推估起點狀態
     *   { shares, cash, remainingLoan, lastPrice }
     * @param {number} opts.pmt - 每月還款金額
     * @param {number} opts.monthlyLoanRate - 月貸款利率
     * @param {number} opts.sellCostRate - 賣出成本率
     * @param {number} opts.numSimulations - 模擬次數（預設 5000）
     * @returns {Object} { scenarios, stats }
     *   scenarios: { optimistic: [rates], base: [rates], pessimistic: [rates] }
     */
    runBootstrap: function(opts) {
      var returns = opts.historicalReturns;
      var projMonths = opts.projectedMonths;
      var numSims = opts.numSimulations || 5000;
      var stats = calcReturnStats(returns);

      if (!returns || returns.length === 0 || projMonths <= 0) {
        // 無歷史資料或無需推估時，回傳空序列
        var empty = [];
        for (var e = 0; e < projMonths; e++) empty.push(stats.mean || 0);
        return {
          scenarios: { optimistic: empty, base: empty, pessimistic: empty },
          stats: stats
        };
      }

      // 起始狀態
      var initShares = opts.startState.shares;
      var initCash = opts.startState.cash;
      var initLoan = opts.startState.remainingLoan;
      var startPrice = opts.startState.lastPrice;
      var pmt = opts.pmt;
      var monthlyLoanRate = opts.monthlyLoanRate;
      var sellCostRate = opts.sellCostRate;

      // 5,000 次 Bootstrap 模擬
      var simResults = new Array(numSims);

      for (var s = 0; s < numSims; s++) {
        var sequence = new Array(projMonths);
        var shares = initShares;
        var cash = initCash;
        var remainingLoan = initLoan;
        var price = startPrice;

        for (var p = 0; p < projMonths; p++) {
          // 有放回隨機抽樣
          var idx = Math.floor(Math.random() * returns.length);
          var r = returns[idx];
          sequence[p] = r;

          // 簡化模擬：追蹤股價、持股、現金、貸款
          price = price * (1 + r);
          if (price < 0.01) price = 0.01;

          var interest = remainingLoan * monthlyLoanRate;
          var principal = pmt - interest;

          var amountNeeded = pmt - cash;
          if (amountNeeded > 0 && shares > 0) {
            var netPerShare = price * (1 - sellCostRate);
            if (netPerShare > 0) {
              var toSell = Math.ceil(amountNeeded / netPerShare);
              if (toSell > shares) toSell = shares;
              cash += toSell * price * (1 - sellCostRate);
              shares -= toSell;
            }
          }

          cash -= pmt;
          remainingLoan -= principal;
          if (remainingLoan < 0) remainingLoan = 0;
        }

        var finalNet = shares * price + cash - remainingLoan;
        simResults[s] = { finalNet: finalNet, sequence: sequence };
      }

      // 依最終淨資產排序
      simResults.sort(function(a, b) { return a.finalNet - b.finalNet; });

      var p25Idx = Math.floor(numSims * 0.25);
      var p50Idx = Math.floor(numSims * 0.50);
      var p75Idx = Math.floor(numSims * 0.75);

      return {
        scenarios: {
          pessimistic: simResults[p25Idx].sequence,
          base: simResults[p50Idx].sequence,
          optimistic: simResults[p75Idx].sequence
        },
        stats: stats,
        // 三情境的最終淨資產（簡化模擬值，供顯示參考）
        finalNetPositions: {
          pessimistic: Math.round(simResults[p25Idx].finalNet),
          base: Math.round(simResults[p50Idx].finalNet),
          optimistic: Math.round(simResults[p75Idx].finalNet)
        }
      };
    }
  };
})();
