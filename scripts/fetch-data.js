#!/usr/bin/env node
/**
 * 從 FinMind API 收集 ETF 歷史資料
 * 使用方式: node scripts/fetch-data.js
 * 需要 .env 檔案中的 FINMIND_TOKEN
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ===== 設定 =====
const DATA_DIR = path.join(__dirname, '..', 'data');
const DIV_DIR = path.join(DATA_DIR, 'dividends');
const ACTIONS_DIR = path.join(DATA_DIR, 'corporate_actions');

const TICKERS = [
  { id: '0050', startDate: '2003-06-30', exchange: 'TWSE' },
  { id: '0056', startDate: '2007-12-26', exchange: 'TWSE' },
  { id: '00631L', startDate: '2014-10-31', exchange: 'TWSE' },
  { id: '00679B', startDate: '2017-01-17', exchange: 'TPEx' },
];

// 股利 dataset 對照
const DIVIDEND_DATASETS = {
  '0050': 'TaiwanStockDividend',
  '0056': 'TaiwanStockDividend',
  '00631L': null, // 不配息
  '00679B': 'TaiwanStockDividendResult',
};

// 0050 公司行動（已知的分割事件）
const CORPORATE_ACTIONS_0050 = [
  { date: '2025-06-18', type: 'split', ratio: 4, description: '1拆4 股票分割' }
];

// ===== 工具函數 =====
function readEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('錯誤：找不到 .env 檔案，請建立 .env 並設定 FINMIND_TOKEN');
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  const match = content.match(/FINMIND_TOKEN=(.+)/);
  if (!match) {
    console.error('錯誤：.env 中找不到 FINMIND_TOKEN');
    process.exit(1);
  }
  return match[1].trim();
}

function fetchAPI(params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const url = `https://api.finmindtrade.com/api/v4/data?${qs}`;
    console.log(`  請求: ${params.dataset} / ${params.data_id} (${params.start_date} ~ ${params.end_date || '最新'})`);

    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status !== 200 && json.msg !== 'success') {
            reject(new Error(`API 錯誤: ${json.msg || JSON.stringify(json)}`));
            return;
          }
          resolve(json.data || []);
        } catch (e) {
          reject(new Error(`JSON 解析錯誤: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function readMetadata() {
  const metaPath = path.join(DATA_DIR, 'metadata.json');
  if (fs.existsSync(metaPath)) {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }
  return { lastUpdated: {} };
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`  寫入: ${path.relative(path.join(__dirname, '..'), filePath)}`);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ===== 價格資料收集 =====
async function fetchPrices(ticker, token, metadata) {
  const lastDate = metadata.lastUpdated[`${ticker.id}_prices`];
  const startDate = lastDate || ticker.startDate;
  const endDate = todayStr();

  const records = await fetchAPI({
    dataset: 'TaiwanStockPrice',
    data_id: ticker.id,
    start_date: startDate,
    end_date: endDate,
    token: token,
  });

  // 轉換為 flat 格式 {date: close}
  const filePath = path.join(DATA_DIR, `${ticker.id}_daily_prices.json`);
  let existing = {};

  // 增量更新：讀取現有資料
  if (lastDate && fs.existsSync(filePath)) {
    existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  for (const r of records) {
    existing[r.date] = r.close;
  }

  writeJSON(filePath, existing);
  console.log(`  ${ticker.id} 價格: ${Object.keys(existing).length} 筆`);

  return { ticker: ticker.id, count: Object.keys(existing).length, lastDate: endDate };
}

// ===== 股利資料收集 =====
async function fetchDividends(tickerId, token) {
  const dataset = DIVIDEND_DATASETS[tickerId];
  if (!dataset) {
    console.log(`  ${tickerId} 不配息，跳過`);
    return;
  }

  const records = await fetchAPI({
    dataset: dataset,
    data_id: tickerId,
    start_date: '2003-01-01',
    end_date: todayStr(),
    token: token,
  });

  let dividends;
  if (dataset === 'TaiwanStockDividend') {
    // 標準股利格式
    // CashExDividendTradingDate = 除息日, CashDividendPaymentDate = 發放日
    // CashEarningsDistribution + CashStatutorySurplus = 每股配息
    dividends = records
      .filter(r => parseFloat(r.CashEarningsDistribution || 0) > 0 || parseFloat(r.CashStatutorySurplus || 0) > 0)
      .map(r => ({
        exDate: r.CashExDividendTradingDate || r.date,
        payDate: r.CashDividendPaymentDate || null,
        amount: parseFloat(r.CashEarningsDistribution || 0) + parseFloat(r.CashStatutorySurplus || 0),
        type: 'cash',
      }));
  } else if (dataset === 'TaiwanStockDividendResult') {
    // 除權息結果格式（00679B 用）
    // stock_and_cache_dividend = 配息金額, stock_or_cache_dividend = "除息"
    dividends = records
      .filter(r => r.stock_or_cache_dividend === '除息' && parseFloat(r.stock_and_cache_dividend || 0) > 0)
      .map(r => ({
        exDate: r.date,
        payDate: null,
        amount: parseFloat(r.stock_and_cache_dividend),
        type: 'cash',
      }));
  }

  const filePath = path.join(DIV_DIR, `${tickerId}_dividends.json`);
  writeJSON(filePath, dividends);
  console.log(`  ${tickerId} 股利: ${dividends.length} 筆`);
}

// ===== 交叉驗證 0050 =====
function crossValidate0050() {
  console.log('\n===== 交叉驗證 0050 =====');
  const filePath = path.join(DATA_DIR, '0050_daily_prices.json');
  const fetched = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // 從 index.html 中已知的幾個價格點做驗證
  const knownPrices = {
    '2024-04-16': 155.65,
    '2024-07-11': 202.75,
    '2025-06-10': 188.65,
    '2025-06-18': 47.57,  // 拆後
    '2026-03-19': 76.00,
  };

  let passed = 0, failed = 0;
  for (const [date, expected] of Object.entries(knownPrices)) {
    const actual = fetched[date];
    if (actual === undefined) {
      console.log(`  ⚠ ${date}: 資料缺失`);
      failed++;
    } else if (Math.abs(actual - expected) > 0.01) {
      console.log(`  ✗ ${date}: 預期 ${expected}, 實際 ${actual}`);
      failed++;
    } else {
      console.log(`  ✓ ${date}: ${actual}`);
      passed++;
    }
  }
  console.log(`  驗證結果: ${passed} 通過, ${failed} 失敗`);
  return failed === 0;
}

// ===== 主流程 =====
async function main() {
  console.log('===== FinMind 資料收集 =====');
  console.log(`日期: ${todayStr()}\n`);

  const token = readEnv();
  const metadata = readMetadata();

  // 確保目錄存在
  for (const dir of [DATA_DIR, DIV_DIR, ACTIONS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // 收集價格資料
  console.log('\n--- 價格資料 ---');
  for (const ticker of TICKERS) {
    try {
      const result = await fetchPrices(ticker, token, metadata);
      metadata.lastUpdated[`${result.ticker}_prices`] = result.lastDate;
    } catch (e) {
      console.error(`  ✗ ${ticker.id} 價格收集失敗: ${e.message}`);
    }
    // 避免 API rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  // 收集股利資料
  console.log('\n--- 股利資料 ---');
  for (const ticker of TICKERS) {
    try {
      await fetchDividends(ticker.id, token);
      metadata.lastUpdated[`${ticker.id}_dividends`] = todayStr();
    } catch (e) {
      console.error(`  ✗ ${ticker.id} 股利收集失敗: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // 寫入公司行動
  console.log('\n--- 公司行動 ---');
  writeJSON(path.join(ACTIONS_DIR, '0050_actions.json'), CORPORATE_ACTIONS_0050);

  // 寫入 metadata
  metadata.fetchDate = todayStr();
  writeJSON(path.join(DATA_DIR, 'metadata.json'), metadata);

  // 交叉驗證
  crossValidate0050();

  console.log('\n===== 完成 =====');
}

main().catch(e => {
  console.error('執行失敗:', e);
  process.exit(1);
});
