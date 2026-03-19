/**
 * 資料載入模組
 * 命名空間: Forcast.DataLoader
 *
 * 支援 fetch JSON 檔案，並提供 in-memory cache 與 fallback 機制
 */
(function() {
  var ns = window.Forcast = window.Forcast || {};

  // 路徑前綴（子目錄頁面需設定）
  var basePath = '';

  // 內部快取
  var cache = {
    prices: {},
    dividends: {},
    corporateActions: {}
  };

  // 內嵌資料 fallback（當 fetch 失敗時使用）
  var embedded = {
    prices: {},
    dividends: {},
    corporateActions: {}
  };

  /**
   * 通用 fetch JSON，失敗時回傳 fallback
   */
  function fetchJSON(url, fallback) {
    return fetch(url)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .catch(function(err) {
        console.warn('DataLoader: fetch 失敗 (' + url + '), 使用 fallback:', err.message);
        return fallback !== undefined ? fallback : null;
      });
  }

  ns.DataLoader = {
    /**
     * 設定資料路徑前綴（子目錄頁面使用）
     * @param {string} path - 路徑前綴，如 '../../'
     */
    setBasePath: function(path) {
      basePath = path || '';
    },

    /**
     * 載入價格資料
     * @param {string} ticker - 標的代號 (如 '0050')
     * @returns {Promise<Object>} flat 價格物件 {"2024-04-16": 155.65, ...}
     */
    loadPrices: function(ticker) {
      if (cache.prices[ticker]) {
        return Promise.resolve(cache.prices[ticker]);
      }
      var fallback = embedded.prices[ticker] || {};
      return fetchJSON(basePath + 'data/' + ticker + '_daily_prices.json', fallback)
        .then(function(data) {
          cache.prices[ticker] = data || fallback;
          return cache.prices[ticker];
        });
    },

    /**
     * 載入股利資料
     * @param {string} ticker - 標的代號
     * @returns {Promise<Array>} 股利陣列 [{exDate, payDate, amount, type}]
     */
    loadDividends: function(ticker) {
      if (cache.dividends[ticker]) {
        return Promise.resolve(cache.dividends[ticker]);
      }
      // 00631L 不配息
      if (ticker === '00631L') {
        cache.dividends[ticker] = [];
        return Promise.resolve([]);
      }
      var fallback = embedded.dividends[ticker] || [];
      return fetchJSON(basePath + 'data/dividends/' + ticker + '_dividends.json', fallback)
        .then(function(data) {
          var divs = data || fallback;
          // payDate 為 null 時，估算為 exDate + 30 天
          for (var i = 0; i < divs.length; i++) {
            if (!divs[i].payDate) {
              var ex = new Date(divs[i].exDate + 'T00:00:00');
              ex.setDate(ex.getDate() + 30);
              divs[i].payDate = ex.getFullYear() + '-' +
                String(ex.getMonth() + 1).padStart(2, '0') + '-' +
                String(ex.getDate()).padStart(2, '0');
            }
          }
          cache.dividends[ticker] = divs;
          return cache.dividends[ticker];
        });
    },

    /**
     * 載入公司行動資料
     * @param {string} ticker - 標的代號
     * @returns {Promise<Array>} 公司行動陣列 [{date, type, ratio}]
     */
    loadCorporateActions: function(ticker) {
      if (cache.corporateActions[ticker]) {
        return Promise.resolve(cache.corporateActions[ticker]);
      }
      var fallback = embedded.corporateActions[ticker] || [];
      return fetchJSON(basePath + 'data/corporate_actions/' + ticker + '_actions.json', fallback)
        .then(function(data) {
          cache.corporateActions[ticker] = data || fallback;
          return cache.corporateActions[ticker];
        });
    },

    /**
     * 注入內嵌資料作為 fallback
     * @param {string} ticker - 標的代號
     * @param {Object} prices - flat 價格物件
     * @param {Array} dividends - 股利陣列
     * @param {Array} actions - 公司行動陣列
     */
    setEmbeddedData: function(ticker, prices, dividends, actions) {
      if (prices) embedded.prices[ticker] = prices;
      if (dividends) embedded.dividends[ticker] = dividends;
      if (actions) embedded.corporateActions[ticker] = actions;
    },

    /**
     * 清除快取
     */
    clearCache: function() {
      cache = { prices: {}, dividends: {}, corporateActions: {} };
    }
  };
})();
