# 借貸投資策略研究平台 (Loan-to-Invest Strategy Research)

## 專案目標

本專案旨在建立一個「借貸投資策略研究平台」，針對缺乏大額本金但具備穩定還款能力的一般大眾，研究透過信用貸款投入不同性質 ETF 的可行性與風險。有別於傳統「閒錢投資」的討論，本平台聚焦於：

1. **借貸投資的還款可行性** — 在不同市場環境下，能否透過賣股或股利穩定還款？
2. **資產成長潛力** — 還款期滿後，剩餘資產的預期價值與投資報酬率
3. **風險量化** — 最壞情境下的虧損幅度、斷頭風險、現金流斷裂風險
4. **標的比較** — 不同性質 ETF 在借貸投資情境下的表現差異

## 研究標的

| 代號 | 名稱 | 性質 | 研究重點 |
|------|------|------|----------|
| 0050 | 元大台灣50 | 市值型 ETF | 台股大盤代表，長期穩健成長 |
| 0056 | 元大高股息 | 高股息 ETF | 高配息率能否有效支付月還款 |
| 00631L | 元大台灣50正2 | 槓桿型 ETF | 高波動+槓桿+借貸的三重風險 |
| 00679B | 元大美債20年 | 美國長天期債券 ETF | 低相關性資產的避險效果 |

## 網站架構

```
/                          → 首頁：專案介紹、研究動機、快速導覽
/calculator/               → 互動試算工具
  /calculator/0050/        → 0050 借貸投資回測試算（現有功能升級）
  /calculator/0056/        → 0056 借貸投資回測試算
  /calculator/00631L/      → 00631L 借貸投資回測試算
  /calculator/00679B/      → 00679B 借貸投資回測試算
  /calculator/compare/     → 多標的比較試算

/analysis/                 → 深度分析報告
  /analysis/historical/    → 歷史期間分析（不同進場時機的回測）
  /analysis/scenarios/     → 情境模擬（牛市/熊市/盤整/黑天鵝）
  /analysis/repayment/     → 還款能力分析（現金流壓力測試）
  /analysis/risk/          → 風險量化分析（最大回撤、VaR）

/guide/                    → 知識指南
  /guide/basics/           → 借貸投資基礎知識
  /guide/loan-types/       → 貸款方案比較（信貸/房貸增貸/保單借款）
  /guide/tax/              → 稅務與費用試算
  /guide/faq/              → 常見問題

/data/                     → 資料來源與更新說明
```

## 技術架構

- **前端**: 純靜態網站（HTML/CSS/JavaScript），無需後端伺服器
- **圖表**: Chart.js 或 Lightweight Charts 用於互動式圖表
- **資料**: JSON 檔案存放歷史價格與股利資料
- **資料來源 API**: FinMind API（主要，免費方案 600 req/hr，可取得掛牌日起完整資料）
- **部署**: GitHub Pages 或其他靜態網站服務
- **響應式設計**: 支援手機/平板/桌面瀏覽

## 資料來源 — FinMind API

### 已驗證的資料可用性（2026-03-20 測試）

| 標的 | 交易所 | 最早可取得資料 | Dataset |
|------|--------|---------------|---------|
| 0050 | TWSE | **2003-06-30**（掛牌日） | `TaiwanStockPrice` |
| 0056 | TWSE | **2007-12-26**（掛牌日） | `TaiwanStockPrice` |
| 00631L | TWSE | **2014-10-31**（掛牌日） | `TaiwanStockPrice` |
| 00679B | **TPEx（櫃買）** | **2017-01-17** | `TaiwanStockPrice` |

### 股利資料 Dataset 對照

| 標的 | Dataset | 說明 |
|------|---------|------|
| 0050 | `TaiwanStockDividend` | 31 筆（2005~），含除息日、發放日、配息金額 |
| 0056 | `TaiwanStockDividend` | 25 筆（2009~），涵蓋年配→季配轉換 |
| 00631L | 無配息紀錄 | 槓桿 ETF 不配息（符合預期） |
| 00679B | **`TaiwanStockDividendResult`** | 35 筆（2017~），需用不同 dataset |

### API 使用方式
```
GET https://api.finmindtrade.com/api/v4/data
  ?dataset=TaiwanStockPrice
  &data_id=0050
  &start_date=2003-06-30
  &end_date=2026-03-20
  &token={TOKEN}
```

### 其他可用 Dataset
- `TaiwanStockPriceAdj` — 還原股價（含除權息調整）
- `TaiwanStockDividendResult` — 除權息結果（前後參考價、配息金額）
- `TaiwanStockMonthPrice` — 月 K 資料

### API 限制
- 免費 + Token：**600 次/小時**
- 本專案需求約 8 次請求即可取得全部資料，免費方案完全足夠
- Token 存放於環境變數，不進 git

## 核心計算模型

### 借貸投資回測模型
- 輸入參數：貸款金額、利率、期數、標的、買入日期
- 還款策略：每月固定日期賣出持股或使用股利支付月還款
- 計算項目：
  - 逐月持股變化、市值變化、淨資產變化
  - 交易成本（手續費、證交稅）
  - 股利收入與再投入
  - 除權息處理、股票分割處理

### 情境模擬模型
- 歷史回測：以不同年份作為進場點，模擬完整還款週期
- 未來情境：樂觀/基準/悲觀三種市場假設
- 壓力測試：以 2008 金融海嘯、2020 疫情等真實歷史資料進行回測（FinMind 提供完整掛牌日起資料）

## 開發規範

- 使用繁體中文（zh-TW）作為主要語言
- 所有金額以新台幣（NT$）為單位，小數點取整
- 價格資料來源：FinMind API（主要）、TWSE/TPEx API（備用交叉驗證）
- 所有數值計算須包含交易成本（手續費 0.1425%、證交稅 0.1%）
- 程式碼中使用英文命名，註解使用繁體中文
- CSS 使用 CSS Variables 管理主題色彩
- 保持現有 index.html 的設計風格一致性

## 資料目錄結構

```
data/
  0050_daily_prices.json    → 0050 每日收盤價（已存在）
  0056_daily_prices.json    → 0056 每日收盤價
  00631L_daily_prices.json  → 00631L 每日收盤價
  00679B_daily_prices.json  → 00679B 每日收盤價
  dividends/
    0050_dividends.json     → 0050 歷年股利資料
    0056_dividends.json     → 0056 歷年股利資料
    00631L_dividends.json   → 00631L 歷年股利/資本返還資料
    00679B_dividends.json   → 00679B 歷年配息資料
```

## 免責聲明

本平台所有內容僅供學術研究與教育參考用途，不構成任何投資建議。借貸投資具有高度風險，投資人應自行評估風險承受能力。
