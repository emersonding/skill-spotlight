export default {
  testDir: './e2e',
  testMatch: '**/*.e2e.js',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:1420',
  },
  webServer: {
    command: 'npm run dev:frontend',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
};
