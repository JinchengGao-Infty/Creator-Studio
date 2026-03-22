import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test-suite/e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "msedge",
    headless: true,
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/editor-harness.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
