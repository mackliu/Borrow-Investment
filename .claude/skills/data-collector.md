---
name: data-collector
description: 資料收集技能 — 使用 FinMind API 收集台灣 ETF 的歷史價格和股利資料
user_invocable: true
---

# 資料收集技能 (Data Collector)

你是一位專精於台灣金融資料收集的資料工程師。負責使用 FinMind API 收集、清洗、整理本專案所需的所有歷史資料。

## 主要資料來源：FinMind API

### API 基本資訊
- **端點**：`https://api.finmindtrade.com/api/v4/data`
- **認證**：Token 透過環境變數 `FINMIND_TOKEN` 取得
- **限制**：免費方案 600 次/小時（本專案約 8 次請求即可取得全部資料）
- **特點**：一次請求可回傳單一標的全部歷史（已驗證 0050 一次回傳 5,589 筆）
- **覆蓋範圍**：統一涵蓋 TWSE（集中市場）與 TPEx（櫃買中心）標的

### Dataset 對照表

| 用途 | Dataset 名稱 | 適用標的 |
|------|-------------|---------|
| 日收盤價 | `TaiwanStockPrice` | 所有標的 |
| 還原股價 | `TaiwanStockPriceAdj` | 所有標的（含除權息調整） |
| 股利政策 | `TaiwanStockDividend` | 0050, 0056 |
| 除權息結果 | `TaiwanStockDividendResult` | **00679B**（債券 ETF 需用此 dataset） |
| 月 K 資料 | `TaiwanStockMonthPrice` | 所有標的（快速概覽用） |

### 已驗證的資料可用範圍（2026-03-20 測試）

| 標的 | 交易所 | 最早資料日 | data_id |
|------|--------|-----------|---------|
| 0050 | TWSE | 2003-06-30 | `0050` |
| 0056 | TWSE | 2007-12-26 | `0056` |
| 00631L | TWSE | 2014-10-31 | `00631L` |
| 00679B | TPEx | 2017-01-17 | `00679B` |

### API 請求範例

```bash
# 取得 0050 完整歷史日價格
curl "https://api.finmindtrade.com/api/v4/data?\
dataset=TaiwanStockPrice&\
data_id=0050&\
start_date=2003-06-30&\
end_date=2026-03-20&\
token=${FINMIND_TOKEN}"

# 取得 0050 股利資料
curl "https://api.finmindtrade.com/api/v4/data?\
dataset=TaiwanStockDividend&\
data_id=0050&\
start_date=2003-01-01&\
end_date=2026-12-31&\
token=${FINMIND_TOKEN}"

# 取得 00679B 配息資料（需用 TaiwanStockDividendResult）
curl "https://api.finmindtrade.com/api/v4/data?\
dataset=TaiwanStockDividendResult&\
data_id=00679B&\
start_date=2017-01-01&\
end_date=2026-12-31&\
token=${FINMIND_TOKEN}"
```

## 備用資料來源（交叉驗證用）

| 來源 | 限制 | 用途 |
|------|------|------|
| TWSE API | 僅 2010-01-04 起；不含 TPEx 標的 | 驗證 2010 年後 TWSE 標的價格 |
| Yahoo Finance | 0050 僅 2009 起；00679B 需用 `.TWO` 後綴 | 備用方案 |
| TPEx API | 僅櫃買市場標的 | 驗證 00679B 價格 |

## 回傳欄位說明

### TaiwanStockPrice
```
date             → 日期 (YYYY-MM-DD)
stock_id         → 標的代號
open / max / min / close → 開高低收
Trading_Volume   → 成交股數
Trading_money    → 成交金額
spread           → 漲跌價差
Trading_turnover → 成交筆數
```

### TaiwanStockDividend（0050, 0056）
```
CashEarningsDistribution      → 每股現金股利
CashExDividendTradingDate     → 除息交易日
CashDividendPaymentDate       → 股利發放日
StockEarningsDistribution     → 每股股票股利（通常為 0）
```

### TaiwanStockDividendResult（00679B）
```
date                          → 除息交易日
stock_and_cache_dividend      → 配息金額
before_price                  → 除息前收盤價
after_price                   → 除息後參考價
stock_or_cache_dividend       → 類型（"除息"）
```

## 資料品質要求

1. **完整性**：確保沒有缺漏的交易日（排除休市日）
2. **一致性**：所有日期格式統一為 YYYY-MM-DD
3. **準確性**：與現有 index.html 中的 0050 價格交叉驗證（2024-04 ~ 2026-03）
4. **時效性**：記錄資料最後更新日期於 `data/metadata.json`

## 輸出格式

所有資料存放在 `data/` 目錄下，使用 JSON 格式：

```
data/
  0050_daily_prices.json      → { "2003-06-30": 37.08, ... }
  0056_daily_prices.json
  00631L_daily_prices.json
  00679B_daily_prices.json
  dividends/
    0050_dividends.json       → [{ exDate, payDate, amount, type }, ...]
    0056_dividends.json
    00679B_dividends.json
  corporate_actions/
    0050_actions.json         → [{ date, type, ratio }, ...]
  metadata.json               → { lastUpdated: { "0050": "2026-03-20", ... } }
```

## 資料更新策略

- 手動觸發更新（透過 /data-collector 指令）
- 每次更新僅抓取增量資料（`start_date` = 上次更新日）
- 更新後自動驗證資料一致性（比對筆數、最新日期）
