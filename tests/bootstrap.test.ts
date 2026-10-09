// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { start, createRoot, render } = vi.hoisted(() => ({
    start: vi.fn(),
    createRoot: vi.fn(),
    render: vi.fn(),
}));

vi.mock("react-dom/client", () => ({ createRoot }));

beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.doMock("../src/mocks/browser.ts", () => ({ worker: { start } }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
    vi.resetModules();
    vi.doUnmock("../src/mocks/browser.ts");
    document.body.replaceChildren();
});

test.each(["development", "production"])("waits for MSW before rendering React in %s", async (mode) => {
    vi.stubEnv("MODE", mode);
    vi.stubEnv("DEV", mode === "development");
    vi.stubEnv("PROD", mode === "production");
    vi.stubEnv("VITE_ENABLE_MOCKS", undefined);

    const root = document.getElementById("root");
    createRoot.mockReturnValue({ render });

    let ready!: () => void;
    start.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve; }));
    await import("../src/main.tsx");

    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    expect(createRoot).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();

    ready();
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    expect(createRoot).toHaveBeenCalledWith(root);
});

test.each([
    ["development", "import"],
    ["development", "start"],
    ["production", "import"],
    ["production", "start"],
])("shows a reload button without starting React after MSW %s %s failure", async (mode, failure) => {
    vi.stubEnv("MODE", mode);
    vi.stubEnv("DEV", mode === "development");
    vi.stubEnv("PROD", mode === "production");
    const error = new Error("MSW unavailable");
    if (failure === "import") {
        vi.doMock("../src/mocks/browser.ts", () => { throw error; });
    } else {
        start.mockRejectedValue(error);
    }

    await import("../src/main.tsx");

    await vi.waitFor(() => {
        expect(document.querySelector('[role="alert"] h1')?.textContent).toBe("Не удалось запустить приложение");
    });
    expect(createRoot).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(failure === "import" ? 0 : 1);
    const button = document.querySelector("button")!;
    expect(button.textContent).toBe("Перезагрузить");
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload } });
    button.click();
    expect(reload).toHaveBeenCalledOnce();
});
