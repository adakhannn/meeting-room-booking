import { afterEach, expect, test, vi } from "vitest";

const { start, createRoot, render } = vi.hoisted(() => ({
    start: vi.fn(),
    createRoot: vi.fn(),
    render: vi.fn(),
}));

vi.mock("../src/mocks/browser.ts", () => ({ worker: { start } }));
vi.mock("react-dom/client", () => ({ createRoot }));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
    vi.resetModules();
});

test.each(["development", "production"])("waits for MSW before rendering React in %s", async (mode) => {
    vi.stubEnv("MODE", mode);
    vi.stubEnv("DEV", mode === "development");
    vi.stubEnv("PROD", mode === "production");
    vi.stubEnv("VITE_ENABLE_MOCKS", undefined);

    const root = {};
    vi.stubGlobal("document", { getElementById: vi.fn(() => root) });
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
