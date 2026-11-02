import { defineConfig } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  // CI has no GPU, so frames crawl under software rendering
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    // The test build keeps a small debug hook, and preview serves production's security headers
    command: `npx vite build --mode test && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
