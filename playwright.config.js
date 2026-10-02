import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir: './tests/browser', timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000', viewport: { width: 1440, height: 1000 }, launchOptions: { executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] } },
  webServer: { command: 'npm start', url: 'http://127.0.0.1:3000/api/health', reuseExistingServer: true, timeout: 15000 },
});
