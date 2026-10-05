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
