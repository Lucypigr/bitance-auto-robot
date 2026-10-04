import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const condition = (page, interval, type) => page.locator(`[data-combo-interval="${interval}"][data-combo-type="${type}"]`);
async function ready(page) {
  await page.goto('./');
  await expect(page.locator('#progress')).toContainText('已完成', { timeout: 30000 });
  await page.locator('#strategy').selectOption('combination');
}
async function report(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-report').click();
  const download = await downloadPromise;
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}
test('multi-coin AND combination, full-period metrics, save/load and offline report', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  await page.locator('#open-symbol-picker').click();
  await page.getByRole('checkbox', { name: '勾選 ETHUSDT', exact: true }).check();
  await page.locator('#done-symbol-picker').click();
  await condition(page, '4h', 'rsiOversold').uncheck();
  await condition(page, '1h', 'rsiOversold').check();
  await condition(page, '4h', 'rsiOversold').check();
  await page.locator('#combo-oversold').fill('100');
  await page.locator('#save-config').click();
  await page.locator('#combo-oversold').fill('0');
  await page.locator('#load-config').click();
  await expect(page.locator('#combo-oversold')).toHaveValue('100');
  await expect(condition(page, '4h', 'rsiOversold')).toBeChecked();
  await page.locator('#run-button').click();
  await expect(page.locator('#combination-assets tr')).toHaveCount(2, { timeout: 30000 });
  await expect(page.locator('#progress')).toContainText('已完成');
  await expect(page.locator('#range-selector')).toBeHidden();
  await expect(page.locator('.ranking-panel')).toBeHidden();
  await expect(page.locator('#equity-chart svg')).toBeVisible();
  const saved = await report(page);
  expect(saved.options.combination.conditions).toHaveLength(2);
  expect(Object.keys(saved.datasets[0].timeframes)).toContain('4h');
  expect(saved.full.trades.length).toBeGreaterThan(0);
  expect(saved.full.assets.every(a => Number.isFinite(a.winRate) && a.trades > 0 && a.maxDrawdown <= 0)).toBe(true);
  const all = saved.full.assets.every(a => a.totalReturn > 0 && a.trades > 0);
  expect(saved.full.allPositive).toBe(all);
  await expect(page.locator('#all-positive')).toContainText(all ? '是，全部正報酬' : '否，並非全部正報酬');
  await page.locator('[data-tab="trades"]').click();
  await expect(page.locator('#detail-content')).toContainText('多');
  expect(errors).toEqual([]);
});
test('candlestick reversal controls and annotated K-line chart work after backtest', async ({ page }) => {
  await ready(page);
  const fourHour = page.locator('.combo-timeframe').filter({ hasText: '4h 4 小時' });
  await fourHour.locator('summary').click();
  await expect(condition(page, '4h', 'hammer')).toBeVisible();
  await expect(condition(page, '4h', 'shootingStar')).toBeVisible();
  await expect(condition(page, '4h', 'bullishEngulfing')).toBeVisible();
  await page.locator('#combo-oversold').fill('100');
  await page.locator('#run-button').click();
  await expect(page.locator('#candlestick-chart svg')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#candle-symbol')).toHaveValue('BTCUSDT');
  await expect(page.locator('#candle-marker-count')).not.toHaveText('0 個標記');
  await expect(page.locator('#candle-period')).toContainText('UTC');
  await page.locator('#candle-older').click();
  await expect(page.locator('#candlestick-chart svg')).toBeVisible();
});
test('all four timeframes and contradictory crosses yield explicit no-trade results', async ({ page }) => {
  await ready(page);
  await condition(page, '4h', 'rsiOversold').uncheck();
  for (const interval of ['15m', '1h', '4h', '1d']) await condition(page, interval, 'rsiOversold').check();
  await condition(page, '4h', 'emaGolden').check();
  await condition(page, '4h', 'emaDeath').check();
  await page.locator('#combo-oversold').fill('100');
  await page.locator('#run-button').click();
  await expect(page.locator('#combination-assets tr')).toHaveCount(1, { timeout: 45000 });
  await expect(page.locator('#combination-assets')).toContainText('無交易');
  await expect(page.locator('#all-positive')).toContainText('否，並非全部正報酬（0 / 1）');
  const saved = await report(page);
  expect(saved.options.interval).toBe('15m'); expect(saved.full.stats.trades).toBe(0);
  expect(Object.keys(saved.datasets[0].timeframes).sort()).toEqual(['1d', '1h', '4h']);
  expect(saved.full.stats.totalReturn).toBe(0);
});
test('futures shorts accept daily conditions but execute at 1h with stop/target costs', async ({ page }) => {
  await ready(page);
  await page.locator('[data-market="futures"]').click();
  await expect(page.locator('#market-count')).toContainText('永續合約');
  await page.locator('#combination-side').selectOption('short');
  await condition(page, '4h', 'rsiOversold').uncheck();
  await condition(page, '1d', 'rsiOverbought').check();
  await page.locator('#combo-overbought').fill('0');
  await page.locator('#combo-stop').fill('2'); await page.locator('#combo-target').fill('1');
  await page.locator('#run-button').click();
  await expect(page.locator('#combination-assets tr')).toHaveCount(1, { timeout: 30000 });
  const saved = await report(page);
  expect(saved.options.interval).toBe('1h');
  expect(saved.full.trades.length).toBeGreaterThan(0);
  expect(saved.full.trades.every(t => t.side === 'short' && t.fees > 0)).toBe(true);
  expect(saved.full.trades.some(t => ['stop', 'target'].includes(t.reason))).toBe(true);
  expect(saved.options.stopLoss).toBe(.02); expect(saved.options.takeProfit).toBe(.01);
});
test('no conditions and spot short fail without showing a successful report', async ({ page }) => {
  await ready(page);
  await condition(page, '4h', 'rsiOversold').uncheck();
  await page.locator('#run-button').click(); await expect(page.locator('#notice')).toContainText('請勾選');
  await condition(page, '4h', 'rsiOversold').check();
  await page.locator('#combination-side').selectOption('short');
  await page.locator('#run-button').click(); await expect(page.locator('#notice')).toContainText('永續合約');
  await expect(page.locator('#combination-results')).toBeHidden();
});
test('mobile can select coins and conditions without document overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await ready(page);
  await page.locator('#open-symbol-picker').click();
  await page.getByRole('checkbox', { name: '勾選 SOLUSDT', exact: true }).check();
  await page.locator('#done-symbol-picker').click();
  await condition(page, '4h', 'macdDeath').check();
  await page.locator('#run-button').click();
  await expect(page.locator('#combination-assets tr')).toHaveCount(2, { timeout: 30000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/combination-mobile.png', fullPage: true });
});
test('live multi-timeframe loading uses Binance endpoints directly and propagates frame errors', async ({ page }) => {
  const requests = [];
  await page.route('https://data-api.binance.vision/**', async route => {
    const url = new URL(route.request().url()); let body;
    if (url.pathname.endsWith('exchangeInfo')) body = { symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING' }] };
    else if (url.pathname.endsWith('ticker/24hr')) body = [{ symbol: 'BTCUSDT', lastPrice: '100' }];
    else if (url.pathname.endsWith('klines')) {
      const interval = url.searchParams.get('interval'); requests.push(interval);
      if (interval === '1d') return route.fulfill({ status: 451, body: '{}' });
      const step = { '15m': 900000, '1h': 3600000, '4h': 14400000 }[interval];
      const start = Number(url.searchParams.get('startTime')), end = Number(url.searchParams.get('endTime'));
      body = []; for (let time = start; time <= end && body.length < 1000; time += step) body.push([time, '100', '101', '99', '100', '100', time + step - 1]);
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.routeWebSocket('wss://data-stream.binance.vision/**', () => {});
  await ready(page); await page.locator('#source').selectOption('live');
  await expect(page.locator('#market-count')).toContainText('Binance');
  await condition(page, '4h', 'rsiOversold').uncheck();
  await condition(page, '1h', 'rsiOversold').check(); await condition(page, '4h', 'rsiOversold').check();
  await page.locator('#combo-oversold').fill('100'); await page.locator('#run-button').click();
  await expect(page.locator('#combination-assets tr')).toHaveCount(1, { timeout: 45000 });
  await expect(page.locator('#report-state')).toContainText('幣安資料');
  expect(requests).toContain('1h'); expect(requests).toContain('4h');
  await condition(page, '1d', 'rsiOversold').check(); await page.locator('#run-button').click();
  await expect(page.locator('#notice')).toContainText('HTTP 451', { timeout: 30000 });
  await expect(page.locator('#progress')).toContainText('回測未完成');
});
