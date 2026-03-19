/**
 * 財務計算模組
 * 命名空間: Forcast.FinancialMath
 */
(function() {
  var ns = window.Forcast = window.Forcast || {};

  ns.FinancialMath = {
    /**
     * 月付金計算 (PMT)
     * @param {number} rate - 月利率
     * @param {number} nper - 期數
     * @param {number} pv - 貸款本金
     * @returns {number} 每月還款金額
     */
    pmt: function(rate, nper, pv) {
      return pv * rate * Math.pow(1 + rate, nper) / (Math.pow(1 + rate, nper) - 1);
    },

    /**
     * 年利率轉月利率
     */
    monthlyRate: function(annualRate) {
      return annualRate / 12;
    },

    /**
     * 買入成本（含手續費）
     * @param {number} price - 每股價格
     * @param {number} shares - 股數
     * @param {number} commRate - 手續費率 (預設 0.001425)
     * @returns {number} 總買入成本
     */
    buyCost: function(price, shares, commRate) {
      commRate = commRate || 0.001425;
      return shares * price * (1 + commRate);
    },

    /**
     * 每股買入成本
     */
    buyCostPerShare: function(price, commRate) {
      commRate = commRate || 0.001425;
      return price * (1 + commRate);
    },

    /**
     * 賣出淨收入
     * @param {number} price - 每股價格
     * @param {number} shares - 股數
     * @param {number} commRate - 手續費率
     * @param {number} taxRate - 證交稅率
     * @returns {number} 淨收入
     */
    sellProceeds: function(price, shares, commRate, taxRate) {
      commRate = commRate || 0.001425;
      taxRate = taxRate || 0.001;
      var gross = shares * price;
      var cost = gross * (commRate + taxRate);
      return gross - cost;
    },

    /**
     * 每股淨收入
     */
    netPerShare: function(price, commRate, taxRate) {
      commRate = commRate || 0.001425;
      taxRate = taxRate || 0.001;
      return price * (1 - commRate - taxRate);
    },

    /**
     * 計算需賣出的股數
     * @param {number} needed - 需要的金額
     * @param {number} price - 每股價格
     * @param {number} commRate - 手續費率
     * @param {number} taxRate - 證交稅率
     * @param {number} maxShares - 最大可賣股數
     * @param {number} lotSize - 交易單位 (1=零股, 1000=整張)
     * @returns {number} 需賣出股數
     */
    sharesToSell: function(needed, price, commRate, taxRate, maxShares, lotSize) {
      commRate = commRate || 0.001425;
      taxRate = taxRate || 0.001;
      lotSize = lotSize || 1;
      var net = this.netPerShare(price, commRate, taxRate);
      var raw = Math.ceil(needed / net);
      if (lotSize > 1) {
        raw = Math.ceil(raw / lotSize) * lotSize;
      }
      if (raw > maxShares) raw = maxShares;
      return raw;
    },

    /**
     * 計算月報酬率（基於實際價格與股利）
     * @param {number} buyPrice - 買入價格（拆前）
     * @param {number} lastPrice - 最後價格（拆後）
     * @param {number} splitRatio - 分割比例
     * @param {number} totalDivPerOrigShare - 每原始股累計股利（含拆前拆後換算）
     * @param {number} months - 月份數
     * @returns {number} 月報酬率
     */
    monthlyGrowthRate: function(buyPrice, lastPrice, splitRatio, totalDivPerOrigShare, months) {
      var lastPriceEquiv = lastPrice * splitRatio;
      var totalReturn = (lastPriceEquiv + totalDivPerOrigShare) / buyPrice;
      return Math.pow(totalReturn, 1 / months) - 1;
    },

    /**
     * 推估未來價格
     * @param {number} basePrice - 基準價格
     * @param {number} monthlyGrowth - 月報酬率
     * @param {number} daysDiff - 天數差
     * @returns {number} 推估價格
     */
    projectPrice: function(basePrice, monthlyGrowth, daysDiff) {
      var dailyRate = Math.pow(1 + monthlyGrowth, 1 / 30) - 1;
      return Math.round(basePrice * Math.pow(1 + dailyRate, daysDiff) * 100) / 100;
    }
  };
})();
