import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir: './tests/browser-pages', timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173/bitance-auto-robot/', viewport: { width: 1280, height: 900 }, launchOptions: { executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] } },
  webServer: { command: 'node scripts/serve-pages.js', url: 'http://127.0.0.1:4173/bitance-auto-robot/', reuseExistingServer: true, timeout: 15000 },
});
