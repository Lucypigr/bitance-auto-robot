import { readFile } from 'node:fs/promises';
import { analyze } from '../src/backtest.js';
const file = process.argv[2];
if (!file) { console.error('Usage: npm run replay -- /path/to/quantlab-report.json'); process.exitCode = 1; }
else {
  try {
    const report = JSON.parse(await readFile(file, 'utf8'));
    if (report.version !== 1 || !report.datasets?.length || !report.options) throw new Error('需要含原始資料的 QuantLab v1 研究報告');
    const result = analyze(report.datasets, report.options);
    const same = result.best.id === report.best.id && Math.abs(result.test.stats.endValue - report.test.stats.endValue) < 1e-8;
    console.log(JSON.stringify({ selectedStrategy: result.best.id, heldOutReturn: result.test.stats.totalReturn, heldOutEndValue: result.test.stats.endValue, matchesSavedResult: same }, null, 2));
    if (!same) process.exitCode = 2;
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
