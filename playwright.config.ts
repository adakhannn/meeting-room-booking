import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: 0,
    workers: 2,
    reporter: [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: "http://127.0.0.1:4175",
        browserName: "chromium",
        channel: "chromium",
        locale: "ru-RU",
        timezoneId: "Asia/Bishkek",
        serviceWorkers: "allow",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [
        { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
        { name: "mobile-375", use: { viewport: { width: 375, height: 812 } } },
    ],
    webServer: {
        command: "pnpm build && pnpm preview --host 127.0.0.1 --port 4175 --strictPort",
        url: "http://127.0.0.1:4175",
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
