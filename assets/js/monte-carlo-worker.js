/**
 * 蒙地卡羅模擬 Web Worker
 * 自包含，不依賴其他模組
 *
 * 接收：{ config, historicalReturns, startPrice, periods, numSimulations }
 * 回傳：percentiles (p10, p25, p50, p75, p90) 的逐月淨資產
 */
self.onmessage = function(e) {
  var data = e.data;
  var config = data.config;
  var returns = data.historicalReturns;
  var startPrice = data.startPrice;
  var periods = data.periods;
  var numSims = data.numSimulations || 1000;

  var loanAmount = config.loanAmount;
  var monthlyRate = config.annualRate / 12;
  var pmt = loanAmount * monthlyRate * Math.pow(1 + monthlyRate, periods) / (Math.pow(1 + monthlyRate, periods) - 1);
  var sellCostRate = config.sellCommission + config.sellTax;
  var buyCostRate = config.buyCommission;

  // 初始買入
  var buyCostPerShare = startPrice * (1 + buyCostRate);
  var initShares = Math.floor(loanAmount / buyCostPerShare);
  var initCash = loanAmount - initShares * buyCostPerShare;

  // 收集所有模擬結果 [simulation][period]
  var allResults = [];
  for (var s = 0; s < numSims; s++) {
    var shares = initShares;
    var cash = initCash;
    var remainingLoan = loanAmount;
    var price = startPrice;
    var netPositions = [];

    for (var p = 0; p < periods; p++) {
      // 隨機抽取歷史月報酬率 (bootstrap)
      var idx = Math.floor(Math.random() * returns.length);
      var monthReturn = returns[idx];
      price = price * (1 + monthReturn);
      if (price < 0.01) price = 0.01; // 防止價格歸零

      // 貸款攤還
      var interest = remainingLoan * monthlyRate;
      var principal = pmt - interest;

      // 賣股還款
      var amountNeeded = pmt - cash;
      var sharesToSell = 0;
      if (amountNeeded > 0) {
        var netPerShare = price * (1 - sellCostRate);
        sharesToSell = Math.ceil(amountNeeded / netPerShare);
        if (sharesToSell > shares) sharesToSell = shares;
      }

      var sellGross = sharesToSell * price;
      var sellCost = sellGross * sellCostRate;
      cash += sellGross - sellCost;
      shares -= sharesToSell;

      cash -= pmt;
      remainingLoan -= principal;
      if (remainingLoan < 0) remainingLoan = 0;

      var marketValue = shares * price;
      var netPosition = marketValue + cash - remainingLoan;
      netPositions.push(netPosition);
    }

    allResults.push(netPositions);

    // 每 100 次回報進度
    if ((s + 1) % 100 === 0) {
      self.postMessage({ type: 'progress', completed: s + 1, total: numSims });
    }
  }

  // 計算百分位數
  var percentiles = { p10: [], p25: [], p50: [], p75: [], p90: [] };

  for (var p = 0; p < periods; p++) {
    var values = [];
    for (var s = 0; s < numSims; s++) {
      values.push(allResults[s][p]);
    }
    values.sort(function(a, b) { return a - b; });

    percentiles.p10.push(Math.round(values[Math.floor(numSims * 0.10)]));
    percentiles.p25.push(Math.round(values[Math.floor(numSims * 0.25)]));
    percentiles.p50.push(Math.round(values[Math.floor(numSims * 0.50)]));
    percentiles.p75.push(Math.round(values[Math.floor(numSims * 0.75)]));
    percentiles.p90.push(Math.round(values[Math.floor(numSims * 0.90)]));
  }

  self.postMessage({ type: 'result', percentiles: percentiles, numSimulations: numSims });
};
