# 04 — 資料需求與收集計畫

## 資料來源：FinMind API

經過 2026-03-20 的實際測試，確認以 **FinMind API** 作為主要資料來源，可取得所有標的從掛牌日起的完整歷史資料。

### API 基本資訊
- 端點：`https://api.finmindtrade.com/api/v4/data`
- 認證：免費帳號 + Token（600 次/小時）
- 特點：一次 request 即可取得單一標的全部歷史資料（已驗證 0050 一次回傳 5,589 筆）

### 其他資料來源（備用 / 交叉驗證）

| 來源 | 限制 | 用途 |
|------|------|------|
| TWSE API | 僅支援 **2010-01-04 起**；00679B 不在 TWSE | 交叉驗證 2010 年後的價格 |
| Yahoo Finance | 0050 僅有 2009 起；需用 `.TWO` 後綴查 OTC 標的 | 備用方案 |
| TPEx API | 僅查詢櫃買市場標的（00679B） | 交叉驗證 00679B |

> **重要發現**：TWSE API 有硬性下限（民國 99 年 = 2010），無法取得 2003~2009 的 0050 資料，也無法查詢 00679B（在櫃買中心掛牌）。FinMind 統一覆蓋 TWSE 與 TPEx，完美解決這兩個問題。

---

## 必要資料清單

### 1. 歷史日收盤價

| 標的 | 交易所 | 掛牌日 | FinMind 最早資料 | 預估筆數 | Dataset |
|------|--------|--------|-----------------|---------|---------|
| 0050 | TWSE | 2003-06-30 | **2003-06-30** | ~5,589 | `TaiwanStockPrice` |
| 0056 | TWSE | 2007-12-26 | **2007-12-26** | ~4,400+ | `TaiwanStockPrice` |
| 00631L | TWSE | 2014-10-31 | **2014-10-31** | ~2,700+ | `TaiwanStockPrice` |
| 00679B | TPEx | 2017-01-11 | **2017-01-17** | ~2,200+ | `TaiwanStockPrice` |

**現有資料**：0050 已有 2024-04 至 2026-03 的日價格（內嵌在 index.html），可作為驗證基準

**FinMind 回傳欄位**：
```json
{
  "date": "2003-06-30",
  "stock_id": "0050",
  "Trading_Volume": 9930000,
  "Trading_money": 367884760,
  "open": 37.1,
  "max": 37.4,
  "min": 36.92,
  "close": 37.08,
  "spread": 0.12,
  "Trading_turnover": 2047
}
```

**轉換為專案格式**（僅保留日期與收盤價）：
```json
{
  "2003-06-30": 37.08,
  "2003-07-01": 37.36,
  ...
}
```

### 2. 股利發放紀錄

#### 使用的 Dataset 與對照

| 標的 | Dataset | 筆數 | 說明 |
|------|---------|------|------|
| 0050 | `TaiwanStockDividend` | 31 筆 | 2005-05 起，含 `CashExDividendTradingDate`（除息日）、`CashDividendPaymentDate`（發放日）、`CashEarningsDistribution`（配息金額） |
| 0056 | `TaiwanStockDividend` | 25 筆 | 2009-10 起，含年配→季配（2023 起）轉換 |
| 00631L | 無 | 0 筆 | 槓桿 ETF 不配息（已確認） |
| 00679B | **`TaiwanStockDividendResult`** | 35 筆 | 2017-08 起，使用 `stock_and_cache_dividend` 欄位取得配息金額 |

> **注意**：00679B 的股利資料需使用 `TaiwanStockDividendResult` 而非 `TaiwanStockDividend`（後者回傳 0 筆）。這可能是因為債券 ETF 在 FinMind 的分類方式不同。

#### 0050 股利歷史重點
- 2005 年起每年配息（年配）
- 2023 年起改為半年配（1月、7月除息）
- 2025-06-18 一拆四（配息金額需注意拆股前後的差異）

#### 0056 股利歷史重點
- 2009 年起每年配息
- 2022 年起改為季配（1月、4月、7月、10月）
- 以高殖利率著稱，年配息率通常 5~8%

#### 00631L
- 槓桿型 ETF，確認無配息紀錄
- 所有收益反映在淨值上

#### 00679B 股利歷史重點
- 季配息（約每年 2月、5月、8月、11月除息）
- `TaiwanStockDividendResult` 提供除息前/後參考價，可交叉驗證
- 配息率受美國公債殖利率影響，2020-2022 低利率期間配息偏低

#### FinMind 股利資料關鍵欄位對照

**`TaiwanStockDividend`**（0050, 0056 使用）：
```
CashEarningsDistribution   → 每股現金股利
CashExDividendTradingDate  → 除息交易日
CashDividendPaymentDate    → 股利發放日
StockEarningsDistribution  → 每股股票股利
```

**`TaiwanStockDividendResult`**（00679B 使用）：
```
stock_and_cache_dividend   → 配息金額
before_price               → 除息前收盤價
after_price                → 除息後參考價
date                       → 除息交易日
```

### 3. 公司行動紀錄

- 0050：2025-06-18 一拆四（需在回測引擎中處理）
- 其他標的：目前無分割/合併紀錄

### 4. 台灣央行基準利率歷史

- 用於分析不同利率環境下的借貸成本
- 期間：2003 年至今
- 來源：中央銀行網站（手動整理即可，變動次數有限）

---

## 資料收集實作方式

### 收集腳本設計

```javascript
// fetch-data.js — Node.js 資料收集腳本
const FINMIND_TOKEN = process.env.FINMIND_TOKEN;
const BASE_URL = 'https://api.finmindtrade.com/api/v4/data';

const TARGETS = [
  { id: '0050',   start: '2003-06-30' },
  { id: '0056',   start: '2007-12-26' },
  { id: '00631L', start: '2014-10-31' },
  { id: '00679B', start: '2017-01-11' },
];

// 價格資料：TaiwanStockPrice（所有標的通用）
// 股利資料：TaiwanStockDividend（0050, 0056）
//          TaiwanStockDividendResult（00679B）
```

### 執行步驟

#### Step 1：一次性全量收集（約 8 次 API 請求）
1. 四個標的的歷史日價格 × 4 = 4 次請求
2. 0050 + 0056 股利（`TaiwanStockDividend`）× 2 = 2 次請求
3. 00679B 股利（`TaiwanStockDividendResult`）× 1 = 1 次請求
4. 額外：`TaiwanStockPriceAdj`（還原股價）視需要追加

#### Step 2：資料轉換
- 將 FinMind 回傳格式轉換為專案 JSON 格式
- 價格：`{ "YYYY-MM-DD": close_price, ... }`
- 股利：統一格式包含 exDate、payDate、amount

#### Step 3：交叉驗證
- 比對現有 index.html 中的 0050 價格（2024-04 ~ 2026-03）
- 對 2010 年後的資料，可用 TWSE API 抽樣驗證

#### Step 4：增量更新
- 記錄各檔案最後更新日期於 `data/metadata.json`
- 後續更新僅需指定 `start_date` 為上次更新日

---

## 資料目錄結構

```
data/
  0050_daily_prices.json     → 0050 每日收盤價（2003-06-30 起）
  0056_daily_prices.json     → 0056 每日收盤價（2007-12-26 起）
  00631L_daily_prices.json   → 00631L 每日收盤價（2014-10-31 起）
  00679B_daily_prices.json   → 00679B 每日收盤價（2017-01-17 起）
  dividends/
    0050_dividends.json      → 0050 歷年股利（2005 起，31 筆）
    0056_dividends.json      → 0056 歷年股利（2009 起，25 筆）
    00679B_dividends.json    → 00679B 歷年配息（2017 起，35 筆）
  corporate_actions/
    0050_actions.json        → 0050 分割紀錄（2025-06-18 一拆四）
  metadata.json              → 各檔案最後更新時間
```

> 注意：00631L 無股利檔案（不配息）

---

## 資料儲存估算

- 0050: ~5,589 筆 × ~30 bytes = ~168 KB
- 0056: ~4,400 筆 × ~30 bytes = ~132 KB
- 00631L: ~2,700 筆 × ~30 bytes = ~81 KB
- 00679B: ~2,200 筆 × ~30 bytes = ~66 KB
- 股利資料：< 10 KB
- **合計：約 460 KB** — 完全可接受的靜態網站資源大小

---

## 歷史回測可覆蓋範圍

有了 FinMind 的完整資料，各標的可回測的時間範圍：

| 標的 | 最早可回測進場日 | 可覆蓋的重大事件 |
|------|-----------------|-----------------|
| 0050 | **2003-07** | 2008 金融海嘯、2011 歐債危機、2015 中國股災、2018 中美貿易戰、2020 COVID-19、2022 升息熊市 |
| 0056 | **2008-01** | 2008 金融海嘯（部分）、2011 歐債、2015 中國股災、2018 貿易戰、2020 COVID-19、2022 升息 |
| 00631L | **2014-11** | 2015 中國股災、2018 貿易戰、2020 COVID-19、2022 升息 |
| 00679B | **2017-02** | 2018 貿易戰、2020 COVID-19、2022 升息（債券大跌） |

以 7 年（84 期）貸款為例，0050 最早可從 2003-07 進場、2010-07 還清，完整覆蓋 2008 金融海嘯。
