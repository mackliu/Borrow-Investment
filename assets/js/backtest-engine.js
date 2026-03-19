/**
 * 回測模擬引擎
 * 命名空間: Forcast.BacktestEngine
 * 依賴: Forcast.FinancialMath
 */
(function() {
  var ns = window.Forcast = window.Forcast || {};
  var FM = null; // 延遲取得 FinancialMath 參照

  function getFM() {
    if (!FM) FM = ns.FinancialMath;
    return FM;
  }

  // ===== 工具函數 =====
  function dateStr(y, m, d) {
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function addMonths(ds, n) {
    var d = new Date(ds + 'T00:00:00');
    d.setMonth(d.getMonth() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function findTradingDayOnOrAfter(target, tradingDays) {
    for (var i = 0; i < tradingDays.length; i++) {
      if (tradingDays[i] >= target) return { date: tradingDays[i], projected: false };
    }
    // 超出實際資料，跳過週末
    var d = new Date(target + 'T00:00:00');
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() + 1);
    }
    var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return { date: ds, projected: true };
  }

  /**
   * 計算月報酬率
   */
  function calcMonthlyGrowthRate(config, prices, dividends, corporateActions) {
    var fm = getFM();
    var buyPrice = prices[config.buyDate];
    var tradingDays = Object.keys(prices).sort();
    var lastActualTD = tradingDays[tradingDays.length - 1];
    var lastPrice = prices[lastActualTD];

    // 計算等效分割比例
    var splitRatio = 1;
    for (var i = 0; i < corporateActions.length; i++) {
      var action = corporateActions[i];
      if (action.type === 'split' && action.date <= lastActualTD) {
        splitRatio *= action.ratio;
      }
    }

    // 計算累計股利（以原始股為基準）
    var totalDivPerOrigShare = 0;
    for (var j = 0; j < dividends.length; j++) {
      var div = dividends[j];
      if (div.exDate > config.buyDate && div.exDate <= lastActualTD) {
        // 判斷是否在拆前
        var isPreSplit = false;
        for (var k = 0; k < corporateActions.length; k++) {
          if (corporateActions[k].type === 'split' && div.exDate < corporateActions[k].date) {
            isPreSplit = true;
            break;
          }
        }
        if (isPreSplit) {
          totalDivPerOrigShare += div.amount;
        } else {
          totalDivPerOrigShare += div.amount * splitRatio;
        }
      }
    }

    // 計算月份數
    var startD = new Date(config.buyDate);
    var endD = new Date(lastActualTD);
    var months = (endD.getFullYear() - startD.getFullYear()) * 12 + (endD.getMonth() - startD.getMonth());

    return fm.monthlyGrowthRate(buyPrice, lastPrice, splitRatio, totalDivPerOrigShare, months);
  }

  /**
   * 取得價格（實際或推估）
   */
  function getPrice(dateTarget, prices, tradingDays, projectedPrices, monthlyGrowth) {
    if (prices[dateTarget] !== undefined) return { price: prices[dateTarget], projected: false };
    if (projectedPrices[dateTarget] !== undefined) return { price: projectedPrices[dateTarget], projected: true };

    var fm = getFM();
    var allDates = tradingDays.concat(Object.keys(projectedPrices)).sort();
    var lastKnown = null, lastKnownPrice = null;
    for (var i = 0; i < allDates.length; i++) {
      if (allDates[i] <= dateTarget) {
        lastKnown = allDates[i];
        lastKnownPrice = prices[allDates[i]] || projectedPrices[allDates[i]];
      }
    }

    if (!lastKnown) {
      var lastTD = tradingDays[tradingDays.length - 1];
      return { price: prices[lastTD], projected: true };
    }

    var d1 = new Date(lastKnown);
    var d2 = new Date(dateTarget);
    var daysDiff = (d2 - d1) / (1000 * 60 * 60 * 24);
    var projPrice = fm.projectPrice(lastKnownPrice, monthlyGrowth, daysDiff);
    projectedPrices[dateTarget] = projPrice;
    return { price: projPrice, projected: true };
  }

  /**
   * 核心模擬函數
   *
   * @param {Object} config - 設定
   * @param {Object} config.loan - 貸款設定 {amount, annualRate, periods}
   * @param {Object} config.trading - 交易成本 {buyCommission, sellCommission, sellTax}
   * @param {string} config.buyDate - 買入日期
   * @param {number} config.sellDayOfMonth - 每月賣出日
   * @param {string} config.lastActualDate - 最後實際資料日期（僅供參考）
   * @param {string} config.dividendStrategy - 股利策略 ("mixed")
   * @param {number|null} config.projectionRate - 指定月報酬率（null=自動計算）
   * @param {number} config.futureDivPerShare - 未來推估每股配息
   * @param {Array<number>} config.futureDivMonths - 配息月份 [1, 7]
   * @param {Object} prices - flat 價格物件
   * @param {Array} dividends - 股利陣列
   * @param {Array} corporateActions - 公司行動陣列
   * @returns {Object} 模擬結果
   */
  ns.BacktestEngine = {
    simulate: function(config, prices, dividends, corporateActions) {
      var fm = getFM();
      var loan = config.loan;
      var trading = config.trading;
      var monthlyR = fm.monthlyRate(loan.annualRate);
      var PMT = fm.pmt(monthlyR, loan.periods, loan.amount);

      var tradingDays = Object.keys(prices).sort();
      var projectedPrices = {};
      var monthlyGrowth = config.projectionRate;
      if (monthlyGrowth === null || monthlyGrowth === undefined) {
        monthlyGrowth = calcMonthlyGrowthRate(config, prices, dividends, corporateActions);
      }

      // 初始買入
      var buyPrice = prices[config.buyDate];
      var buyCostPS = fm.buyCostPerShare(buyPrice, trading.buyCommission);
      var shares = Math.floor(loan.amount / buyCostPS);
      var cash = loan.amount - shares * buyCostPS;
      var initialShares = shares;
      var initialBuyComm = shares * buyPrice * trading.buyCommission;

      var remainingLoan = loan.amount;
      var totalInterest = 0;
      var totalSellCost = 0;
      var totalDividends = 0;
      var totalBuyComm = initialBuyComm;
      var lastPayDate = config.buyDate;
      var results = [];
      var divResults = [];
      var processedDivs = {};

      // 追蹤分割狀態（支援多次分割）
      var appliedSplits = {};

      // 未來股利截止日硬編碼（確保回歸一致）
      var futureDivStartDate = '2026-07-01';

      for (var i = 1; i <= loan.periods; i++) {
        // 計算目標日期
        var targetPayDate = addMonths(config.buyDate, i);
        var payMonth = new Date(targetPayDate);
        var targetSellDate = dateStr(payMonth.getFullYear(), payMonth.getMonth() + 1, config.sellDayOfMonth);

        // 找實際交易日
        var sellInfo = findTradingDayOnOrAfter(targetSellDate, tradingDays);
        var payInfo = findTradingDayOnOrAfter(targetPayDate, tradingDays);
        var sellDate = sellInfo.date;
        var payDate = payInfo.date;

        // 確保賣股日在還款日之前或同一天
        if (sellDate > payDate) sellDate = payDate;

        // 檢查公司行動（分割等）
        var events = [];
        for (var ca = 0; ca < corporateActions.length; ca++) {
          var action = corporateActions[ca];
          if (action.type === 'split' && !appliedSplits[action.date] && sellDate >= action.date) {
            shares *= action.ratio;
            appliedSplits[action.date] = true;
            events.push({ type: 'split', ratio: action.ratio, date: action.date });
          }
        }

        // 處理股利事件
        for (var di = 0; di < dividends.length; di++) {
          var div = dividends[di];
          if (processedDivs[div.exDate]) continue;
          if (div.exDate > lastPayDate && div.exDate <= payDate) {
            var divShares = shares;
            var divAmount = divShares * div.amount;
            totalDividends += divAmount;

            // 防禦性處理：若 payDate 為 null，估算為 exDate + 30 天
            var divPayDate = div.payDate;
            if (!divPayDate) {
              var tmpD = new Date(div.exDate + 'T00:00:00');
              tmpD.setDate(tmpD.getDate() + 30);
              divPayDate = tmpD.getFullYear() + '-' + String(tmpD.getMonth() + 1).padStart(2, '0') + '-' + String(tmpD.getDate()).padStart(2, '0');
            }
            var daysToPayment = Math.abs((new Date(payDate) - new Date(divPayDate)) / (1000 * 60 * 60 * 24));
            var divAction, boughtShares = 0, buyPriceDiv = 0;

            if (divPayDate === payDate || daysToPayment <= 1) {
              cash += divAmount;
              divAction = '用於還款';
            } else {
              var buyDateInfo = findTradingDayOnOrAfter(divPayDate, tradingDays);
              var pInfo = getPrice(buyDateInfo.date, prices, tradingDays, projectedPrices, monthlyGrowth);
              buyPriceDiv = pInfo.price;
              var divBuyCost = fm.buyCostPerShare(buyPriceDiv, trading.buyCommission);
              boughtShares = Math.floor(divAmount / divBuyCost);
              var spentOnBuy = boughtShares * divBuyCost;
              var buyCommission = boughtShares * buyPriceDiv * trading.buyCommission;
              totalBuyComm += buyCommission;
              shares += boughtShares;
              cash += (divAmount - spentOnBuy);
              divAction = '再投入買股';
            }
            processedDivs[div.exDate] = true;
            events.push({ type: 'div', exDate: div.exDate });
            divResults.push({
              exDate: div.exDate, payDate: divPayDate,
              amount: div.amount, shares: divShares, total: divAmount,
              action: divAction, boughtShares: boughtShares, buyPrice: buyPriceDiv
            });
          }
        }

        // 未來股利推估
        if (config.futureDivPerShare && config.futureDivMonths && payDate > futureDivStartDate) {
          var payYear = parseInt(payDate.substring(0, 4));
          var payMonthNum = parseInt(payDate.substring(5, 7));
          for (var dm = 0; dm < config.futureDivMonths.length; dm++) {
            var divMonth = config.futureDivMonths[dm];
            var futDivExDate = dateStr(payYear, divMonth, 20);
            if (!processedDivs[futDivExDate] && futDivExDate > lastPayDate && futDivExDate <= payDate) {
              var futDivAmount = shares * config.futureDivPerShare;
              totalDividends += futDivAmount;
              var futBuyDateInfo = findTradingDayOnOrAfter(dateStr(payYear, divMonth === 1 ? 2 : 8, 10), tradingDays);
              var futPInfo = getPrice(futBuyDateInfo.date, prices, tradingDays, projectedPrices, monthlyGrowth);
              var futBuyCost = fm.buyCostPerShare(futPInfo.price, trading.buyCommission);
              var futBoughtShares = Math.floor(futDivAmount / futBuyCost);
              totalBuyComm += futBoughtShares * futPInfo.price * trading.buyCommission;
              shares += futBoughtShares;
              cash += (futDivAmount - futBoughtShares * futBuyCost);
              processedDivs[futDivExDate] = true;
              events.push({ type: 'div', exDate: futDivExDate });
              divResults.push({
                exDate: futDivExDate, payDate: futBuyDateInfo.date,
                amount: config.futureDivPerShare, shares: shares - futBoughtShares, total: futDivAmount,
                action: '再投入買股(推估)', boughtShares: futBoughtShares, buyPrice: futPInfo.price
              });
            }
          }
        }

        // 貸款攤還計算
        var interest = remainingLoan * monthlyR;
        var principal = PMT - interest;
        totalInterest += interest;

        // 取得賣出價格
        var sellPriceInfo = getPrice(sellDate, prices, tradingDays, projectedPrices, monthlyGrowth);
        var sellPrice = sellPriceInfo.price;
        var isProjected = sellPriceInfo.projected;

        // 計算需賣出股數
        var amountNeeded = PMT - cash;
        var sharesToSellCount = 0;
        if (amountNeeded > 0) {
          // 交易單位：2005-03-01 前為 1000 股整張，之後為 1 股零股
          var lotSize = (sellDate < '2005-03-01') ? 1000 : 1;
          sharesToSellCount = fm.sharesToSell(amountNeeded, sellPrice, trading.sellCommission, trading.sellTax, shares, lotSize);
        }

        // 執行賣出
        var sellGross = sharesToSellCount * sellPrice;
        var sellCost = sellGross * (trading.sellCommission + trading.sellTax);
        var netProceeds = sellGross - sellCost;
        totalSellCost += sellCost;
        shares -= sharesToSellCount;
        cash += netProceeds;

        // 還款
        cash -= PMT;
        remainingLoan -= principal;
        if (remainingLoan < 0.01) remainingLoan = 0;

        // 還款日股價和市值
        var payPriceInfo = getPrice(payDate, prices, tradingDays, projectedPrices, monthlyGrowth);
        var payPrice = payPriceInfo.price;
        var marketValue = shares * payPrice;
        var netPosition = marketValue + cash - remainingLoan;

        results.push({
          period: i,
          payDate: payDate, sellDate: sellDate,
          sellPrice: sellPrice, sharesToSell: sharesToSellCount, sellCost: sellCost, netProceeds: netProceeds,
          payment: PMT, principal: principal, interest: interest,
          remainingLoan: remainingLoan, cash: cash, shares: shares,
          payPrice: payPrice, marketValue: marketValue, netPosition: netPosition,
          isProjected: isProjected, events: events,
          splitApplied: Object.keys(appliedSplits).length > 0
        });
        lastPayDate = payDate;
      }

      return {
        periods: results,
        dividendEvents: divResults,
        summary: {
          initialShares: initialShares,
          buyPrice: buyPrice,
          initialBuyComm: initialBuyComm,
          totalInterest: totalInterest,
          totalSellCost: totalSellCost,
          totalBuyComm: totalBuyComm,
          totalDividends: totalDividends,
          monthlyPayment: PMT,
          monthlyGrowthRate: monthlyGrowth
        }
      };
    }
  };
})();
