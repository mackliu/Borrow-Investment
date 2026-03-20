---
name: backtest-engine
description: 回測引擎技能 — 設計和實作借貸投資回測模擬的計算邏輯與資料處理
user_invocable: true
---

# 回測引擎技能 (Backtest Engine)

你是一位專精於量化回測系統的工程師。負責設計和實作借貸投資的回測模擬引擎。

## 回測引擎架構

### 核心模擬迴圈
```
for each month in loan_period:
  1. 檢查並處理公司行動（除權息、分割）
  2. 計算本期應還款金額（本金 + 利息）
  3. 評估可用現金（股利收入 + 上期結餘）
  4. 若現金不足，計算需賣出股數（依交易單位規則，見下方）
  5. 執行賣出（扣除交易成本）
  6. 支付月還款
  7. 若股利有剩餘，執行再投入
  8. 記錄本期所有數據
```

### 交易單位規則（依時期切換）
台灣零股交易制度隨時間演變，回測引擎需依據賣出日期動態切換：

| 賣出日期 | 交易單位 | 計算邏輯 |
|---------|---------|---------|
| < 2005-03-01 | 整張（1,000 股） | `sharesToSell = Math.ceil(needed / netPerLot) * 1000`，多餘現金留存至下月 |
| >= 2005-03-01 | 零股（1 股） | `sharesToSell = Math.ceil(needed / netPerShare)`，幾乎無閒置現金 |

> 盤後零股 2005-03-01 開放，盤中零股 2020-10-26 開放。本模型使用收盤價且考量 T+2 交割提前賣出，兩者在模型中無差異。
> 僅 0050 在 2003-07 ~ 2005-02 的回測受整張限制影響。

### 輸入參數介面設計
| 參數 | 類型 | 預設值 | 說明 |
|------|------|--------|------|
| loanAmount | number | 1,500,000 | 貸款金額 |
| annualRate | number | 0.0423 | 年利率 |
| periods | number | 84 | 還款期數（月） |
| ticker | string | "0050" | 投資標的代號 |
| buyDate | string | - | 買入日期 |
| sellDay | number | 13 | 每月賣股日 |
| dividendStrategy | enum | "reinvest" | 股利策略：reinvest/repay/mixed |
| projectionRate | number | null | 未來推估年化報酬率（null=用歷史算） |

### 輸出資料結構
每期輸出：
- 期數、日期、賣出價格、賣出股數
- 交易成本、月付金額、本金、利息
- 剩餘貸款、現金餘額、持有股數
- 股價、市值、淨資產
- 是否為推估資料

彙總輸出：
- 總利息、總交易成本、總股利收入
- 最終淨資產、投資報酬率
- 最大回撤、最低淨資產月份

## 未來推估：Bootstrap 歷史模擬法

### 方法論
採用 Non-parametric Bootstrap Monte Carlo Simulation（Efron, 1979）：
- **核心理念**：不預測未來，但假設未來月漲跌幅落在歷史觀測範圍內
- **取代舊方法**：不再使用固定月報酬率（mean）或常態假設（mean ± σ），改用歷史經驗分佈抽樣

### 模擬引擎架構

```
ScenarioEngine.getScenarioRates(prices, corporateActions)
  ├─ calcHistoricalMonthlyReturns() → 從完整價格計算月報酬率陣列
  │     ├─ 按月取最後交易日收盤價
  │     ├─ r[m] = price[m+1] / price[m] - 1
  │     └─ 分割月修正：r[m] = price[m+1] * splitRatio / price[m] - 1
  ├─ calcReturnStats() → 計算 mean、stddev、count
  └─ 回傳: { optimistic, base, pessimistic, stats, returns }

Monte Carlo Worker (Web Worker, 5,000 次模擬)
  ├─ 每次模擬：從 historicalReturns 有放回隨機抽樣 N 個月報酬率
  ├─ 逐月計算：股價變動 → 賣股還款 → 淨資產
  └─ 回傳百分位數：P10, P25, P50, P75, P90
```

### 三情境定義
| 情境 | 百分位數 | 說明 |
|------|---------|------|
| 樂觀 | P75 | 25% 的模擬結果比這個好 |
| 基準 | P50 | 中位數，最可能的結果 |
| 悲觀 | P25 | 25% 的模擬結果比這個差 |

### 技術參數
- 模擬次數：5,000 次（穩定估計 P10~P90）
- 抽樣方式：有放回隨機抽樣（Bootstrap）
- 報酬率：月漲跌百分比（避免股價水位偏差）
- 分割修正：0050 於 2025-06-18 一拆四，該月報酬需 × splitRatio
- 執行環境：Web Worker 非同步，不阻塞 UI

## 資料載入規範

### 價格資料格式 (JSON)
```json
{
  "ticker": "0050",
  "prices": {
    "2024-01-02": 135.50,
    "2024-01-03": 136.20
  }
}
```

### 股利資料格式 (JSON)
```json
{
  "ticker": "0050",
  "dividends": [
    {
      "exDate": "2024-07-16",
      "payDate": "2024-08-09",
      "amount": 1.00,
      "type": "cash"
    }
  ]
}
```

### 公司行動資料格式 (JSON)
```json
{
  "ticker": "0050",
  "actions": [
    {
      "date": "2025-06-18",
      "type": "split",
      "ratio": 4
    }
  ]
}
```

## 程式碼品質要求

- 回測邏輯與 UI 渲染完全分離
- 核心計算函數必須可獨立單元測試
- 浮點數計算注意精度問題（使用整數運算或 Math.round）
- 所有日期處理統一使用 YYYY-MM-DD 字串格式
- 避免 Date 物件的時區陷阱
