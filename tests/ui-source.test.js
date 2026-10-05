import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('result tab toggles use a multi-element selector in public and Pages builds', () => {
  for (const path of ['../public/app.js', '../docs/app.js']) {
    const app = read(path);
    const line = app.split('\n').find(text => text.includes('[data-tab="walk"], [data-tab="indicators"]'));
    assert.ok(line, `${path} is missing the result-tab toggle`);
    assert.match(line, /^\s*document\.querySelectorAll\(/, `${path} must select all result tabs before forEach`);
  }
});


test('beginner terminology help is shared by public and Pages builds', () => {
  for (const path of ['../public/app.js', '../docs/app.js']) {
    const app = read(path);
    assert.match(app, /const beginnerGlossary = \{/);
    assert.match(app, /function installBeginnerHelp\(\)/);
    assert.match(app, /data-term-help/);
    for (const term of ['Sharpe 比率', 'Sortino 比率', 'Profit Factor', '最大回撤', '槓桿', '資金費率', '維持保證金率', 'RSI', 'MACD', '看漲吞噬']) {
      assert.ok(app.includes(term), `${path} is missing beginner help for ${term}`);
    }
  }
});
