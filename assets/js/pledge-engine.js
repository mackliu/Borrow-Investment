/**
 * 質押借貸投資回測引擎
 * 命名空間: Forcast.PledgeEngine
 * 依賴: Forcast.FinancialMath
 *
 * 模擬流程：
 *   Day 0: 信貸買入 → 全數質押 → 借出 40% → 再買入（自由股）
 *   Monthly: 賣自由股還信貸月付金 + 質押利息
 *   End: 清償質押借款，計算最終淨損益
 *
 * 停止條件：
 *   1. 自由股不足以支付月還款 → 策略失敗
 *   2. 維持率 < 133% → 追繳風險，停止模擬
 */
(function() {
  var ns = window.Forcast = window.Forcast || {};
  var FM = null;

  function getFM() {
    if (!FM) FM = ns.FinancialMath;
    return FM;
  }

  // ===== 工具函數（與 BacktestEngine 共用邏輯） =====
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
    var d = new Date(target + 'T00:00:00');
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return { date: ds, projected: true };
  }

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
   * 質押模擬
   *
   * @param {Object} config
   * @param {Object} config.loan - 信貸設定 {amount, annualRate, periods}
   * @param {Object} config.pledge - 質押設定 {ltvRatio, annualRate, maintenanceCallRatio}
   * @param {Object} config.trading - 交易成本
   * @param {string} config.buyDate
   * @param {number} config.sellDayOfMonth
   * @param {number|null} config.projectionRate
   * @param {Array|null} config.projectionRateSequence - Bootstrap 序列
   * @param {number} config.futureDivPerShare
   * @param {Array} config.futureDivMonths
   * @param {Object} prices
   * @param {Array} dividends
   * @param {Array} corporateActions
   * @returns {Object} 模擬結果
   */
  ns.PledgeEngine = {
    simulate: function(config, prices, dividends, corporateActions) {
      var fm = getFM();
      var loan = config.loan;
      var pledge = config.pledge;
      var trading = config.trading;
      var monthlyR = fm.monthlyRate(loan.annualRate);
      var PMT = fm.pmt(monthlyR, loan.periods, loan.amount);
      var pledgeMonthlyR = pledge.annualRate / 12;

      var tradingDays = Object.keys(prices).sort();
      var projectedPrices = {};

      // 處理報酬率
      var rateSequence = config.projectionRateSequence || null;
      var projectionIdx = 0;
      var monthlyGrowth;
      if (rateSequence) {
        var rSum = 0;
        for (var ri = 0; ri < rateSequence.length; ri++) rSum += rateSequence[ri];
        monthlyGrowth = rateSequence.length > 0 ? rSum / rateSequence.length : 0;
      } else if (config.projectionRate !== null && config.projectionRate !== undefined) {
        monthlyGrowth = config.projectionRate;
      } else {
        monthlyGrowth = 0;
      }

      // ===== Day 0: 信貸買入 =====
      var buyPrice = prices[config.buyDate];
      var buyCostPS = fm.buyCostPerShare(buyPrice, trading.buyCommission);
      var initialShares = Math.floor(loan.amount / buyCostPS);
      var cash = loan.amount - initialShares * buyCostPS;
      var initialBuyComm = initialShares * buyPrice * trading.buyCommission;

      // ===== Day 0: 質押 =====
      var pledgedShares = initialShares;
      var pledgeLoan = Math.round(pledgedShares * buyPrice * pledge.ltvRatio);

      // 用質押借款再買入（同日同價）
      var additionalShares = Math.floor(pledgeLoan / buyCostPS);
      var pledgeBuyComm = additionalShares * buyPrice * trading.buyCommission;
      var freeShares = additionalShares;
      cash += (pledgeLoan - additionalShares * buyCostPS);

      var totalBuyComm = initialBuyComm + pledgeBuyComm;
      var remainingLoan = loan.amount;
      var totalInterest = 0;
      var totalPledgeInterest = 0;
      var totalSellCost = 0;
      var totalDividends = 0;
      var lastPayDate = config.buyDate;
      var results = [];
      var divResults = [];
      var processedDivs = {};
      var appliedSplits = {};
      var stopped = null;

      var futureDivStartDate = '2026-07-01';

      for (var i = 1; i <= loan.periods; i++) {
        var targetPayDate = addMonths(config.buyDate, i);
        var payMonth = new Date(targetPayDate);
        var targetSellDate = dateStr(payMonth.getFullYear(), payMonth.getMonth() + 1, config.sellDayOfMonth);

        var sellInfo = findTradingDayOnOrAfter(targetSellDate, tradingDays);
        var payInfo = findTradingDayOnOrAfter(targetPayDate, tradingDays);
        var sellDate = sellInfo.date;
        var payDate = payInfo.date;
        if (sellDate > payDate) sellDate = payDate;

        // Bootstrap 模式
        if (rateSequence && sellInfo.projected && projectionIdx < rateSequence.length) {
          monthlyGrowth = rateSequence[projectionIdx];
          projectionIdx++;
        }

        // 公司行動（分割）— 影響質押股和自由股
        var events = [];
        for (var ca = 0; ca < corporateActions.length; ca++) {
          var action = corporateActions[ca];
          if (action.type === 'split' && !appliedSplits[action.date] && sellDate >= action.date) {
            pledgedShares *= action.ratio;
            freeShares *= action.ratio;
            appliedSplits[action.date] = true;
            events.push({ type: 'split', ratio: action.ratio, date: action.date });
          }
        }

        // 股利事件 — 質押股 + 自由股都配息
        for (var di = 0; di < dividends.length; di++) {
          var div = dividends[di];
          if (processedDivs[div.exDate]) continue;
          if (div.exDate > lastPayDate && div.exDate <= payDate) {
            var totalShares = pledgedShares + freeShares;
            var divAmount = totalShares * div.amount;
            totalDividends += divAmount;

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
              freeShares += boughtShares; // 再投入為自由股
              cash += (divAmount - spentOnBuy);
              divAction = '再投入買股(自由股)';
            }
            processedDivs[div.exDate] = true;
            events.push({ type: 'div', exDate: div.exDate });
            divResults.push({
              exDate: div.exDate, payDate: divPayDate,
              amount: div.amount, shares: totalShares, total: divAmount,
              action: divAction, boughtShares: boughtShares, buyPrice: buyPriceDiv
            });
          }
        }

        // 未來股利推估
        if (config.futureDivPerShare && config.futureDivMonths && payDate > futureDivStartDate) {
          var payYear = parseInt(payDate.substring(0, 4));
          for (var dm = 0; dm < config.futureDivMonths.length; dm++) {
            var divMonth = config.futureDivMonths[dm];
            var futDivExDate = dateStr(payYear, divMonth, 20);
            if (!processedDivs[futDivExDate] && futDivExDate > lastPayDate && futDivExDate <= payDate) {
              var futTotalShares = pledgedShares + freeShares;
              var futDivAmount = futTotalShares * config.futureDivPerShare;
              totalDividends += futDivAmount;
              var futBuyDateInfo = findTradingDayOnOrAfter(dateStr(payYear, divMonth === 1 ? 2 : divMonth + 1, 10), tradingDays);
              var futPInfo = getPrice(futBuyDateInfo.date, prices, tradingDays, projectedPrices, monthlyGrowth);
              var futBuyCost = fm.buyCostPerShare(futPInfo.price, trading.buyCommission);
              var futBoughtShares = Math.floor(futDivAmount / futBuyCost);
              totalBuyComm += futBoughtShares * futPInfo.price * trading.buyCommission;
              freeShares += futBoughtShares;
              cash += (futDivAmount - futBoughtShares * futBuyCost);
              processedDivs[futDivExDate] = true;
              events.push({ type: 'div', exDate: futDivExDate });
              divResults.push({
                exDate: futDivExDate, payDate: futBuyDateInfo.date,
                amount: config.futureDivPerShare, shares: futTotalShares, total: futDivAmount,
                action: '再投入買股(自由股/推估)', boughtShares: futBoughtShares, buyPrice: futPInfo.price
              });
            }
          }
        }

        // 信貸攤還
        var interest = remainingLoan * monthlyR;
        var principal = PMT - interest;
        totalInterest += interest;

        // 質押利息
        var pledgeInterest = pledgeLoan * pledgeMonthlyR;
        totalPledgeInterest += pledgeInterest;

        // 本月總應付金額
        var totalObligation = PMT + pledgeInterest;

        // 取得賣出價格
        var sellPriceInfo = getPrice(sellDate, prices, tradingDays, projectedPrices, monthlyGrowth);
        var sellPrice = sellPriceInfo.price;
        var isProjected = sellPriceInfo.projected;

        // 賣出自由股
        var amountNeeded = totalObligation - cash;
        var sharesToSellCount = 0;
        if (amountNeeded > 0 && freeShares > 0) {
          var lotSize = (sellDate < '2005-03-01') ? 1000 : 1;
          sharesToSellCount = fm.sharesToSell(amountNeeded, sellPrice, trading.sellCommission, trading.sellTax, freeShares, lotSize);
        }

        // 檢查自由股是否足夠
        var insufficientShares = false;
        if (amountNeeded > 0 && sharesToSellCount >= freeShares) {
          // 賣光所有自由股，檢查是否足夠
          sharesToSellCount = freeShares;
          var maxProceeds = fm.sellProceeds(sellPrice, sharesToSellCount, trading.sellCommission, trading.sellTax);
          if (maxProceeds + cash < totalObligation) {
            insufficientShares = true;
          }
        }

        // 執行賣出
        var sellGross = sharesToSellCount * sellPrice;
        var sellCost = sellGross * (trading.sellCommission + trading.sellTax);
        var netProceeds = sellGross - sellCost;
        totalSellCost += sellCost;
        freeShares -= sharesToSellCount;
        cash += netProceeds;

        // 還款
        cash -= totalObligation;
        remainingLoan -= principal;
        if (remainingLoan < 0.01) remainingLoan = 0;

        // 還款日數據
        var payPriceInfo = getPrice(payDate, prices, tradingDays, projectedPrices, monthlyGrowth);
        var payPrice = payPriceInfo.price;
        var freeMarketValue = freeShares * payPrice;
        var pledgedMarketValue = pledgedShares * payPrice;
        var totalMarketValue = freeMarketValue + pledgedMarketValue;
        var maintenanceRatio = pledgeLoan > 0 ? pledgedMarketValue / pledgeLoan : 999;
        var netPosition = totalMarketValue + cash - remainingLoan - pledgeLoan;

        results.push({
          period: i,
          payDate: payDate, sellDate: sellDate,
          sellPrice: sellPrice, sharesToSell: sharesToSellCount, sellCost: sellCost,
          payment: PMT, principal: principal, interest: interest,
          pledgeInterest: pledgeInterest, totalObligation: totalObligation,
          remainingLoan: remainingLoan, pledgeLoan: pledgeLoan,
          cash: cash,
          freeShares: freeShares, pledgedShares: pledgedShares,
          totalShares: freeShares + pledgedShares,
          payPrice: payPrice,
          freeMarketValue: freeMarketValue, pledgedMarketValue: pledgedMarketValue,
          totalMarketValue: totalMarketValue,
          maintenanceRatio: maintenanceRatio,
          netPosition: netPosition,
          isProjected: isProjected, events: events
        });

        // 停止條件判定
        if (insufficientShares) {
          stopped = { period: i, reason: 'insufficient_shares',
            message: '第 ' + i + ' 期自由股不足以支付月還款（信貸月付 + 質押利息），策略失敗' };
          break;
        }

        if (maintenanceRatio < pledge.maintenanceCallRatio) {
          stopped = { period: i, reason: 'margin_call',
            message: '第 ' + i + ' 期維持率 ' + (maintenanceRatio * 100).toFixed(0) + '% 低於 ' + (pledge.maintenanceCallRatio * 100).toFixed(0) + '%，觸發追繳，停止模擬' };
          break;
        }

        lastPayDate = payDate;
      }

      return {
        periods: results,
        dividendEvents: divResults,
        summary: {
          initialShares: initialShares,
          additionalShares: additionalShares,
          pledgedShares: pledgedShares,
          buyPrice: buyPrice,
          initialBuyComm: initialBuyComm,
          pledgeBuyComm: pledgeBuyComm,
          pledgeLoanAmount: pledgeLoan,
          totalInterest: totalInterest,
          totalPledgeInterest: totalPledgeInterest,
          totalSellCost: totalSellCost,
          totalBuyComm: totalBuyComm,
          totalDividends: totalDividends,
          monthlyPayment: PMT,
          monthlyGrowthRate: monthlyGrowth
        },
        stopped: stopped
      };
    }
  };
})();
