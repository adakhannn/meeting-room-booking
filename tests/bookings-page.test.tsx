// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { BookingsPage } from "../src/features/bookings/BookingsPage.tsx";
import { BookingApiError, createBooking, deleteBooking, getBookings, updateBooking } from "../src/features/bookings/api.ts";
import type { BookingInput } from "../src/features/bookings/types.ts";
import { createBookingHandlers } from "../src/mocks/handlers.ts";
import { createBookingStore } from "../src/mocks/bookings-store.ts";
import { demoScenarios } from "../src/demo/scenarios.ts";

const endpoint = "http://localhost/api/bookings";
const now = new Date(2026, 9, 9, 0, 30);
const early = { id: "early", date: "2026-10-09", start: "09:00", end: "10:00", title: "Планирование" };
const late = { id: "late", date: "2026-10-09", start: "14:00", end: "15:00" };
const tomorrow = { id: "tomorrow", date: "2026-10-10", start: "11:00", end: "12:00", title: "Другая встреча" };
const yesterday = { id: "yesterday", date: "2026-10-08", start: "15:00", end: "16:00", title: "Прошедшая встреча" };
const server = setupServer();
let client: QueryClient;
let writeRequests: string[];
let readDates: (string | null)[];
let store: ReturnType<typeof createBookingStore>;

beforeAll(() => {
    server.events.on("request:start", ({ request }) => {
        if (request.method !== "GET") writeRequests.push(request.method);
        else readDates.push(new URL(request.url).searchParams.get("date"));
    });
    server.listen({ onUnhandledRequest: "error" });
});
beforeEach(() => {
    demoScenarios.setConflictOnNextSave(false);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    writeRequests = [];
    readDates = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    store = createBookingStore();
    store.save(late);
    store.save(early);
    store.save(tomorrow);
    store.save(yesterday);
    server.resetHandlers(...createBookingHandlers({ store, now: () => now, baseUrl: "http://localhost", scenarios: demoScenarios }));
});
afterEach(() => {
    cleanup();
    client.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
});
afterAll(() => server.close());

function showPage() {
    return render(<QueryClientProvider client={client}><BookingsPage /></QueryClientProvider>);
}

test("form follows the selected date without losing entered title and times", async () => {
    showPage();
    await screen.findByText("Планирование");
    const form = screen.getByRole("form", { name: "Новое бронирование" }) as HTMLFormElement;
    expect(new FormData(form).get("date")).toBe("2026-10-09");
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: "Встреча команды" } });
    fireEvent.change(screen.getByLabelText("Время начала"), { target: { value: "10:15" } });
    fireEvent.change(screen.getByLabelText("Время окончания"), { target: { value: "11:15" } });
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: tomorrow.date } });
    await screen.findByText("Другая встреча");
    expect(Object.fromEntries(new FormData(form))).toEqual({
        date: tomorrow.date, title: "Встреча команды", start: "10:15", end: "11:15",
    });
    await act(async () => { expect(fireEvent.submit(form)).toBe(false); });
});

test("selects the local current date and displays bookings in time order", async () => {
    showPage();
    expect((screen.getByLabelText("Дата") as HTMLInputElement).value).toBe("2026-10-09");
    await screen.findByText("Планирование");
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
        "09:00 — 10:00ПланированиеРедактироватьУдалить", "14:00 — 15:00Без названияРедактироватьУдалить",
    ]);
    expect(screen.queryByText("Другая встреча")).toBeNull();
});

test("shows loading until the API responds", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    server.use(http.get(endpoint, async () => {
        await pending;
        return HttpResponse.json([]);
    }));
    showPage();
    expect(screen.getByRole("status").textContent).toBe("Загрузка бронирований…");
    expect((screen.getByRole("button", { name: "Забронировать" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.submit(screen.getByRole("form", { name: "Новое бронирование" })); });
    expect(screen.queryByRole("alert")).toBeNull();
    resolve();
    await screen.findByText("На выбранную дату бронирований нет.");
    await waitFor(() => expect((screen.getByRole("button", { name: "Забронировать" }) as HTMLButtonElement).disabled).toBe(false));
});

test("switches dates without displaying bookings from the previous day", async () => {
    showPage();
    await screen.findByText("Планирование");
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: "2026-10-10" } });
    expect(screen.queryByText("Планирование")).toBeNull();
    await screen.findByText("Другая встреча");
    expect(client.getQueryData(["bookings", "2026-10-09"])).toEqual([early, late]);
    expect(client.getQueryData(["bookings", "2026-10-10"])).toEqual([tomorrow]);
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: "2026-10-11" } });
    await screen.findByText("На выбранную дату бронирований нет.");
});

test("allows viewing bookings on past dates", async () => {
    showPage();
    await screen.findByText("Планирование");
    const dateInput = screen.getByLabelText("Дата") as HTMLInputElement;
    expect(dateInput.min).toBe("");
    fireEvent.change(dateInput, { target: { value: yesterday.date } });
    await screen.findByText("Прошедшая встреча");
    expect((screen.getByRole("button", { name: "Забронировать" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("На прошедшую дату нельзя создать бронирование.")).toBeDefined();
    expect(screen.queryByText("Планирование")).toBeNull();
    expect(screen.getAllByRole("listitem").map((row) => row.textContent))
        .toEqual(["15:00 — 16:00Прошедшая встречаРедактироватьУдалить"]);
});

test("hides the previous day's bookings while the new date loads and if that request fails", async () => {
    showPage();
    await screen.findByText("Планирование");

    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    server.use(http.get(endpoint, async () => {
        await pending;
        return new HttpResponse(null, { status: 503 });
    }));

    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: tomorrow.date } });
    expect(screen.getByRole("status").textContent).toBe("Загрузка бронирований…");
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText("Планирование")).toBeNull();

    resolve();
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Повторить" })).toBeDefined();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText("На выбранную дату бронирований нет.")).toBeNull();
});

test("does not request bookings with an empty date", async () => {
    const dates: (string | null)[] = [];
    server.use(http.get(endpoint, ({ request }) => {
        dates.push(new URL(request.url).searchParams.get("date"));
        return HttpResponse.json([]);
    }));
    showPage();
    await screen.findByText("На выбранную дату бронирований нет.");
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: "" } });
    expect(screen.getByRole("status").textContent).toBe("Выберите дату, чтобы посмотреть бронирования.");
    expect((screen.getByRole("button", { name: "Забронировать" }) as HTMLButtonElement).disabled).toBe(true);
    expect(dates).toEqual(["2026-10-09"]);
});

test("shows a request error and loads bookings after retry", async () => {
    server.use(http.get(endpoint, () => new HttpResponse("Unavailable", { status: 503 })));
    showPage();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Не удалось загрузить бронирования.");
    expect((screen.getByRole("button", { name: "Забронировать" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.submit(screen.getByRole("form", { name: "Новое бронирование" })); });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    server.use(http.get(endpoint, () => HttpResponse.json([late, early])));
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await screen.findByText("Планирование");
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect((screen.getByRole("button", { name: "Забронировать" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("09:00");
});

test("preserves API error status, code and field", async () => {
    const result = getBookings("not-a-date");
    await expect(result).rejects.toBeInstanceOf(BookingApiError);
    await expect(result).rejects.toMatchObject({ status: 400, code: "invalid_date", field: "date" });
});

test("a delayed old-date response cannot overwrite the newly selected date", async () => {
    let resolve!: () => void;
    let oldRequestStarted = false;
    let oldRequestFinished = false;
    const pending = new Promise<void>((done) => { resolve = done; });
    server.use(http.get(endpoint, async ({ request }) => {
        if (new URL(request.url).searchParams.get("date") === early.date) {
            oldRequestStarted = true;
            await pending;
            oldRequestFinished = true;
            return HttpResponse.json([early]);
        }
        return HttpResponse.json([tomorrow]);
    }));
    showPage();
    await waitFor(() => expect(oldRequestStarted).toBe(true));
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: tomorrow.date } });
    await screen.findByText("Другая встреча");
    await act(async () => { resolve(); });
    await waitFor(() => expect(oldRequestFinished).toBe(true));
    expect(screen.queryByText("Планирование")).toBeNull();
    expect(screen.getByText("Другая встреча")).toBeDefined();
});

function fillForm(start: string, end: string, title = "Встреча команды") {
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: title } });
    fireEvent.change(screen.getByLabelText("Время начала"), { target: { value: start } });
    fireEvent.change(screen.getByLabelText("Время окончания"), { target: { value: end } });
}

async function submitForm() {
    await act(async () => {
        fireEvent.submit(screen.getByRole("form"));
    });
}

test.each([
    ["", "11:00", "Время начала", "Укажите время в формате ЧЧ:ММ."],
    ["10:00", "", "Время окончания", "Укажите время в формате ЧЧ:ММ."],
    ["08:59", "10:00", "Время начала", "Время бронирования должно быть в пределах 09:00–18:00."],
    ["10:00", "10:00", "Время окончания", "Время окончания должно быть позже времени начала."],
    ["10:00", "10:29", "Время окончания", "Минимальная длительность бронирования — 30 минут."],
    ["10:00", "12:01", "Время окончания", "Максимальная длительность бронирования — 2 часа."],
    ["09:15", "09:45", "Время начала", "Это время пересекается с другим бронированием."],
])("validates %s–%s on submit and associates the error with %s", async (start, end, label, message) => {
    showPage();
    await screen.findByText("Планирование");
    fillForm(start, end);
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Забронировать" })); });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(message);
    const field = screen.getByLabelText(label);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
    expect(document.activeElement).toBe(field);
    const form = screen.getByRole("form", { name: "Новое бронирование" }) as HTMLFormElement;
    expect(Object.fromEntries(new FormData(form))).toEqual({ date: early.date, title: "Встреча команды", start, end });
    expect(writeRequests).toEqual([]);
});

test("uses the current submission time, including seconds, instead of the mount time", async () => {
    showPage();
    await screen.findByText("Планирование");
    fillForm("10:15", "10:45");
    vi.setSystemTime(new Date(2026, 9, 9, 10, 15, 20));
    await submitForm();
    expect((await screen.findByRole("alert")).textContent).toBe("Нельзя бронировать прошедшее время.");
    expect((screen.getByLabelText("Время начала") as HTMLInputElement).value).toBe("10:15");
});

test("revalidates against the selected day's bookings and clears the previous error", async () => {
    showPage();
    await screen.findByText("Планирование");
    fillForm("09:15", "09:45", "");
    await submitForm();
    await screen.findByText("Это время пересекается с другим бронированием.");
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: tomorrow.date } });
    await screen.findByText("Другая встреча");
    await submitForm();
    await screen.findByText("09:15");
    await waitFor(() => expect((screen.getByLabelText("Время начала") as HTMLInputElement).value).toBe(""));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(store.list()).toContainEqual(expect.objectContaining({ date: tomorrow.date, start: "09:15", end: "09:45", title: "" }));
    expect(readDates).toEqual([early.date, tomorrow.date, tomorrow.date]);
    expect(writeRequests).toEqual(["POST"]);
});

test("creates a booking after correcting validation errors, resets the form and refreshes the sorted list", async () => {
    showPage();
    await screen.findByText("Планирование");
    fillForm("10:00", "10:29");
    await submitForm();
    await screen.findByText("Минимальная длительность бронирования — 30 минут.");
    fireEvent.change(screen.getByLabelText("Время окончания"), { target: { value: "10:30" } });
    await submitForm();
    await screen.findByText("Встреча команды");
    await waitFor(() => expect((screen.getByLabelText(/Название/) as HTMLInputElement).value).toBe(""));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Время окончания").getAttribute("aria-invalid")).toBe("false");
    expect(Object.fromEntries(new FormData(screen.getByRole("form") as HTMLFormElement)))
        .toEqual({ date: early.date, title: "", start: "", end: "" });
    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
        "09:00 — 10:00ПланированиеРедактироватьУдалить", "10:00 — 10:30Встреча командыРедактироватьУдалить", "14:00 — 15:00Без названияРедактироватьУдалить",
    ]);
    expect(readDates).toEqual([early.date, early.date]);
    expect(writeRequests).toEqual(["POST"]);
});

test("blocks submission during a background refresh and after a refresh error with cached bookings", async () => {
    showPage();
    await screen.findByText("Планирование");
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    server.use(http.get(endpoint, async () => {
        await pending;
        return new HttpResponse(null, { status: 503 });
    }));
    let refresh!: Promise<void>;
    await act(async () => { refresh = client.invalidateQueries({ queryKey: ["bookings", early.date] }); });
    await screen.findByText("Обновление бронирований…");
    expect((screen.getByRole("button", { name: "Забронировать" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await submitForm();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => { resolve(); await refresh; });
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Забронировать" }) as HTMLButtonElement).disabled).toBe(true);
    await submitForm();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(writeRequests).toEqual([]);
});

test("guards against midnight passing between rendering and submission", async () => {
    showPage();
    await screen.findByText("Планирование");
    fillForm("10:15", "10:45");
    vi.setSystemTime(new Date(2026, 9, 10, 0, 0, 5));
    await submitForm();
    expect((await screen.findByRole("alert")).textContent).toBe("На прошедшую дату нельзя создать бронирование.");
    expect((screen.getByRole("button", { name: "Забронировать" }) as HTMLButtonElement).disabled).toBe(true);
    expect(writeRequests).toEqual([]);
});

test("POST sends JSON and preserves structured HTTP errors", async () => {
    const input = { date: early.date, start: "10:15", end: "10:45", title: "Встреча" };
    let received: unknown;
    let contentType: string | null = null;
    server.use(http.post(endpoint, async ({ request }) => {
        received = await request.json();
        contentType = request.headers.get("Content-Type");
        return HttpResponse.json({ code: "conflict", field: "start", message: "Время занято." }, { status: 409 });
    }));
    await expect(createBooking(input)).rejects.toMatchObject({
        name: "BookingApiError", status: 409, code: "conflict", field: "start", message: "Время занято.",
    });
    expect(received).toEqual(input);
    expect(contentType).toBe("application/json");
});

test("locks the form and date while saving and ignores duplicate submissions", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    server.use(http.post(endpoint, async ({ request }) => {
        const input = await request.json() as { date: string; start: string; end: string; title: string };
        await pending;
        const booking = { ...input, id: "created" };
        store.save(booking);
        return HttpResponse.json(booking, { status: 201 });
    }));
    showPage();
    await screen.findByText("Планирование");
    fillForm("10:15", "10:45");
    // Two submits in the same turn must still produce just one POST.
    await act(async () => {
        fireEvent.submit(screen.getByRole("form"));
        fireEvent.submit(screen.getByRole("form"));
    });
    const saving = await screen.findByRole("button", { name: "Сохранение…" }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    for (const button of screen.getAllByRole("button", { name: "Редактировать" })) {
        expect((button as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(button);
    }
    expect(screen.getByRole("form", { name: "Новое бронирование" })).toBeDefined();
    for (const label of [/Название/, "Время начала", "Время окончания", "Дата"]) {
        expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
    }
    expect((screen.getByLabelText(/Название/) as HTMLInputElement).value).toBe("Встреча команды");
    expect((screen.getByLabelText("Время начала") as HTMLInputElement).value).toBe("10:15");
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: tomorrow.date } });
    expect((screen.getByLabelText("Дата") as HTMLInputElement).value).toBe(early.date);
    await submitForm();
    await waitFor(() => expect(writeRequests).toEqual(["POST"]));
    resolve();
    await screen.findByText("Встреча команды");
    await waitFor(() => expect((screen.getByLabelText(/Название/) as HTMLInputElement).value).toBe(""));
    for (const label of [/Название/, "Время начала", "Время окончания", "Дата"]) {
        expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(false);
    }
    expect((screen.getByRole("button", { name: "Забронировать" }) as HTMLButtonElement).disabled).toBe(false);
    expect(writeRequests).toEqual(["POST"]);
    expect(readDates).toEqual([early.date, early.date]);
});

test.each([
    ["400 field error", () => HttpResponse.json({ code: "invalid_input", field: "title", message: "Проверьте название." }, { status: 400 }), "Проверьте название."],
    ["500 JSON error", () => HttpResponse.json({ message: "Сервис временно недоступен." }, { status: 500 }), "Сервис временно недоступен."],
    ["503 non-JSON error", () => new HttpResponse("Unavailable", { status: 503 }), "Не удалось сохранить бронирование. Попробуйте ещё раз."],
    ["network error", () => HttpResponse.error(), "Не удалось сохранить бронирование. Проверьте соединение и попробуйте ещё раз."],
] as const)("preserves all fields on %s and allows retry", async (_name, response, message) => {
    server.use(http.post(endpoint, response));
    showPage();
    await screen.findByText("Планирование");
    fillForm("10:15", "10:45");
    await submitForm();
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(Object.fromEntries(new FormData(screen.getByRole("form") as HTMLFormElement)))
        .toEqual({ date: early.date, title: "Встреча команды", start: "10:15", end: "10:45" });
    for (const label of [/Название/, "Время начала", "Время окончания", "Дата"]) {
        expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(false);
    }
    expect((screen.getByRole("button", { name: "Забронировать" }) as HTMLButtonElement).disabled).toBe(false);
    expect(writeRequests).toEqual(["POST"]);
    expect(readDates).toEqual([early.date]);
    expect(store.list()).toHaveLength(4);
    if (_name === "400 field error") {
        expect(screen.getByLabelText(/Название/).getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    }
    server.resetHandlers(...createBookingHandlers({ store, now: () => now, baseUrl: "http://localhost" }));
    await submitForm();
    await screen.findByText("Встреча команды");
    await waitFor(() => expect((screen.getByLabelText(/Название/) as HTMLInputElement).value).toBe(""));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(writeRequests).toEqual(["POST", "POST"]);
    expect(store.list()).toHaveLength(5);
});

test("refreshes the selected date on 409, preserves the form and uses fresh bookings on resubmission", async () => {
    showPage();
    await screen.findByText("Планирование");
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: tomorrow.date } });
    await screen.findByText("Другая встреча");
    fillForm("09:15", "09:45");
    // Another client reserves the slot after this page has loaded its list.
    store.save({ id: "concurrent", date: tomorrow.date, start: "09:00", end: "10:00", title: "Занято другим участником" });
    await submitForm();
    await screen.findByText("Занято другим участником");
    expect((await screen.findByRole("alert")).textContent).toBe("Это время уже заняли. Список обновлён — выберите другой интервал");
    expect(Object.fromEntries(new FormData(screen.getByRole("form") as HTMLFormElement)))
        .toEqual({ date: tomorrow.date, title: "Встреча команды", start: "09:15", end: "09:45" });
    expect((screen.getByLabelText("Дата") as HTMLInputElement).disabled).toBe(false);
    expect(readDates).toEqual([early.date, tomorrow.date, tomorrow.date]);
    expect(client.getQueryData(["bookings", early.date])).toEqual([early, late]);
    expect(writeRequests).toEqual(["POST"]);
    await submitForm();
    expect(writeRequests).toEqual(["POST"]);
    fillForm("10:00", "10:30");
    await submitForm();
    await screen.findByText("Встреча команды");
    await waitFor(() => expect((screen.getByLabelText("Время начала") as HTMLInputElement).value).toBe(""));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("alert")).toBeNull();
});

test("a failed list refresh after successful POST does not report a save failure or retain submitted fields", async () => {
    showPage();
    await screen.findByText("Планирование");
    server.use(http.get(endpoint, () => new HttpResponse(null, { status: 503 })));
    fillForm("10:15", "10:45");
    await submitForm();
    expect((await screen.findByRole("alert")).textContent).toContain("Не удалось обновить список бронирований.");
    await waitFor(() => expect((screen.getByLabelText(/Название/) as HTMLInputElement).value).toBe(""));
    expect((screen.getByLabelText("Время начала") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Время окончания") as HTMLInputElement).value).toBe("");
    expect(store.list()).toHaveLength(5);
    expect(writeRequests).toEqual(["POST"]);
    expect((screen.getByLabelText("Дата") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Забронировать" }) as HTMLButtonElement).disabled).toBe(true);
    const created = store.list().find((booking) => booking.title === "Встреча команды")!;
    expect(client.getQueryData(["bookings", early.date])).toEqual([early, created, late]);
    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
        "09:00 — 10:00ПланированиеРедактироватьУдалить",
        "10:15 — 10:45Встреча командыРедактироватьУдалить",
        "14:00 — 15:00Без названияРедактироватьУдалить",
    ]);
    editBooking("Встреча команды");
    expect(formValues()).toEqual({ date: early.date, title: created.title, start: created.start, end: created.end });
    expect(screen.getByRole("alert").textContent).toContain("Не удалось обновить список бронирований.");
    expect(readDates).toEqual([early.date, early.date]);
    server.resetHandlers(...createBookingHandlers({ store, now: () => now, baseUrl: "http://localhost" }));
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(client.getQueryData(["bookings", early.date])).toEqual([early, created, late]);
    expect(writeRequests).toEqual(["POST"]);
});

test("POST uses the server response without duplicating an ID already cached before confirmation, even if GET fails", async () => {
    let resolveSave!: () => void;
    const pendingSave = new Promise<void>((done) => { resolveSave = done; });
    const confirmed = { id: "created", date: early.date, start: "10:15", end: "11:15", title: "Название с сервера" };
    server.use(http.post(endpoint, async () => {
        await pendingSave;
        store.save(confirmed);
        return HttpResponse.json(confirmed, { status: 201 });
    }));
    showPage();
    await screen.findByText("Планирование");
    fillForm("10:15", "10:45", "Отправленное название");
    await submitForm();
    await waitFor(() => expect(writeRequests).toEqual(["POST"]));
    // A concurrent cache refresh may have already included the created ID.
    act(() => {
        client.setQueryData(["bookings", early.date], [early, { ...confirmed, title: "Старая версия", end: "10:45" }, late]);
    });
    server.use(http.get(endpoint, () => new HttpResponse(null, { status: 503 })));
    resolveSave();
    await screen.findByRole("alert");
    await waitFor(() => expect(formValues().title).toBe(""));
    expect(client.getQueryData(["bookings", early.date])).toEqual([early, confirmed, late]);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText("Старая версия")).toBeNull();
    editBooking(confirmed.title);
    expect(formValues()).toEqual({ date: confirmed.date, title: confirmed.title, start: confirmed.start, end: confirmed.end });
    expect(screen.getByRole("alert").textContent).toContain("Не удалось обновить список бронирований.");
});

function editBooking(title = "Планирование") {
    const row = screen.getByText(title).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Редактировать" }));
}

function formValues() {
    return Object.fromEntries(new FormData(screen.getByRole("form") as HTMLFormElement));
}

test.each([false, true])("prefills and PATCHes the same booking, including unchanged values (changed: %s)", async (changed) => {
    showPage();
    await screen.findByText("Планирование");
    editBooking();
    expect(screen.getByRole("form", { name: "Редактирование бронирования" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeDefined();
    expect(formValues()).toEqual({ date: early.date, title: early.title, start: early.start, end: early.end });
    if (changed) fillForm("15:15", "16:15", "Обновлённая встреча");
    await submitForm();
    await screen.findByRole("form", { name: "Новое бронирование" });
    expect(formValues()).toEqual({ date: early.date, title: "", start: "", end: "" });
    expect(screen.queryByRole("button", { name: "Отмена" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(writeRequests).toEqual(["PATCH"]);
    expect(readDates).toEqual([early.date, early.date]);
    expect(store.list()).toHaveLength(4);
    expect(store.get(early.id)).toEqual(changed ? { ...early, title: "Обновлённая встреча", start: "15:15", end: "16:15" } : early);
    if (changed) {
        const rows = screen.getAllByRole("listitem");
        expect(rows[0].textContent).toContain("14:00");
        expect(rows[1].textContent).toContain("15:15 — 16:15Обновлённая встреча");
    }
});

test("validates edits against other bookings before PATCH and retains the draft", async () => {
    showPage();
    await screen.findByText("Планирование");
    editBooking();
    fillForm("14:15", "14:45", "Изменённое название");
    await submitForm();
    expect((await screen.findByRole("alert")).textContent).toBe("Это время пересекается с другим бронированием.");
    expect(formValues()).toEqual({ date: early.date, title: "Изменённое название", start: "14:15", end: "14:45" });
    expect(writeRequests).toEqual([]);
    expect(store.get(early.id)).toEqual(early);
    fillForm("10:00", "10:29");
    await submitForm();
    expect((await screen.findByRole("alert")).textContent).toBe("Минимальная длительность бронирования — 30 минут.");
    expect(writeRequests).toEqual([]);
});

test("switches bookings, clears errors, cancels editing and returns to creation", async () => {
    showPage();
    await screen.findByText("Планирование");
    editBooking();
    fillForm("14:15", "14:45");
    await submitForm();
    await screen.findByRole("alert");
    editBooking("Без названия");
    expect(formValues()).toEqual({ date: late.date, title: "", start: late.start, end: late.end });
    expect(screen.queryByRole("alert")).toBeNull();
    fillForm("15:00", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.getByRole("form", { name: "Новое бронирование" })).toBeDefined();
    expect(formValues()).toEqual({ date: early.date, title: "", start: "", end: "" });
    expect(writeRequests).toEqual([]);
    expect(store.get(late.id)).toEqual(late);
    fillForm("10:15", "10:45");
    await submitForm();
    await screen.findByText("Встреча команды");
    await waitFor(() => expect(formValues().title).toBe(""));
    expect(writeRequests).toEqual(["POST"]);
});

test("changing the date closes editing and does not carry the edited booking to another day", async () => {
    showPage();
    await screen.findByText("Планирование");
    editBooking();
    fillForm("10:15", "10:45", "Черновик");
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: tomorrow.date } });
    await screen.findByText("Другая встреча");
    expect(screen.getByRole("form", { name: "Новое бронирование" })).toBeDefined();
    expect(formValues()).toEqual({ date: tomorrow.date, title: "", start: "", end: "" });
    expect(screen.queryByRole("button", { name: "Отмена" })).toBeNull();
    editBooking("Другая встреча");
    expect(formValues()).toEqual({ date: tomorrow.date, title: tomorrow.title, start: tomorrow.start, end: tomorrow.end });
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: "" } });
    expect(screen.getByRole("form", { name: "Новое бронирование" })).toBeDefined();
    expect(formValues()).toEqual({ date: "", title: "", start: "", end: "" });
    expect(writeRequests).toEqual([]);
});

test("PATCH sends JSON to the encoded booking URL and preserves error details", async () => {
    let received: unknown;
    let url: string | undefined;
    let contentType: string | null = null;
    server.use(http.patch(`${endpoint}/:id`, async ({ request }) => {
        url = request.url;
        received = await request.json();
        contentType = request.headers.get("Content-Type");
        return HttpResponse.json({ code: "conflict", field: "start", message: "Время занято." }, { status: 409 });
    }));
    await expect(updateBooking("booking/1", { title: "Новое название" })).rejects.toMatchObject({
        name: "BookingApiError", status: 409, code: "conflict", field: "start", message: "Время занято.",
    });
    expect(url).toBe(`${endpoint}/booking%2F1`);
    expect(contentType).toBe("application/json");
    expect(received).toEqual({ title: "Новое название" });
});

test("locks form, date, booking selection and cancel throughout PATCH and the following refresh", async () => {
    let resolvePatch!: () => void;
    let resolveRefresh!: () => void;
    const patchPending = new Promise<void>((done) => { resolvePatch = done; });
    const refreshPending = new Promise<void>((done) => { resolveRefresh = done; });
    server.use(http.patch(`${endpoint}/${early.id}`, async ({ request }) => {
        const input = await request.json() as BookingInput;
        await patchPending;
        const booking = { ...input, id: early.id };
        store.save(booking);
        return HttpResponse.json(booking);
    }));
    showPage();
    await screen.findByText("Планирование");
    editBooking();
    fillForm("10:15", "10:45", "Исправленная встреча");
    server.use(http.get(endpoint, async () => {
        await refreshPending;
        return HttpResponse.json(store.list().filter((booking) => booking.date === early.date));
    }));
    await act(async () => {
        fireEvent.submit(screen.getByRole("form"));
        fireEvent.submit(screen.getByRole("form"));
    });
    await screen.findByRole("button", { name: "Сохранение…" });
    for (const label of [/Название/, "Время начала", "Время окончания", "Дата"]) {
        expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
    }
    for (const button of screen.getAllByRole("button")) {
        expect((button as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(button);
    }
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: tomorrow.date } });
    expect((screen.getByLabelText("Дата") as HTMLInputElement).value).toBe(early.date);
    expect((screen.getByLabelText(/Название/) as HTMLInputElement).value).toBe("Исправленная встреча");
    expect(screen.getByRole("form", { name: "Редактирование бронирования" })).toBeDefined();
    await waitFor(() => expect(writeRequests).toEqual(["PATCH"]));
    resolvePatch();
    await screen.findByText("Обновление бронирований…");
    expect((screen.getByRole("button", { name: "Отмена" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Дата") as HTMLInputElement).disabled).toBe(true);
    resolveRefresh();
    await screen.findByRole("form", { name: "Новое бронирование" });
    expect(screen.getByText("Исправленная встреча")).toBeDefined();
    expect((screen.getByLabelText("Дата") as HTMLInputElement).disabled).toBe(false);
    expect(writeRequests).toEqual(["PATCH"]);
});

test.each([
    ["400", () => HttpResponse.json({ code: "invalid_input", field: "title", message: "Проверьте название." }, { status: 400 }), "Проверьте название."],
    ["404", () => HttpResponse.json({ code: "not_found", message: "Бронирование не найдено." }, { status: 404 }), "Бронирование не найдено."],
    ["500", () => new HttpResponse("Unavailable", { status: 500 }), "Не удалось сохранить бронирование. Попробуйте ещё раз."],
    ["network", () => HttpResponse.error(), "Не удалось сохранить бронирование. Проверьте соединение и попробуйте ещё раз."],
] as const)("retains editing and all fields on PATCH %s, then allows retry", async (_name, response, message) => {
    server.use(http.patch(`${endpoint}/:id`, response));
    showPage();
    await screen.findByText("Планирование");
    editBooking();
    fillForm("10:15", "10:45", "Черновик исправлений");
    await submitForm();
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(screen.getByRole("form", { name: "Редактирование бронирования" })).toBeDefined();
    expect(formValues()).toEqual({ date: early.date, title: "Черновик исправлений", start: "10:15", end: "10:45" });
    expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Отмена" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("Дата") as HTMLInputElement).disabled).toBe(false);
    expect(writeRequests).toEqual(["PATCH"]);
    expect(readDates).toEqual([early.date]);
    expect(store.get(early.id)).toEqual(early);
    server.resetHandlers(...createBookingHandlers({ store, now: () => now, baseUrl: "http://localhost" }));
    await submitForm();
    await screen.findByRole("form", { name: "Новое бронирование" });
    expect(screen.getByText("Черновик исправлений")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(writeRequests).toEqual(["PATCH", "PATCH"]);
});

test("PATCH conflict refreshes the edited day's bookings without replacing the draft", async () => {
    showPage();
    await screen.findByText("Планирование");
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: tomorrow.date } });
    await screen.findByText("Другая встреча");
    editBooking("Другая встреча");
    fillForm("10:15", "10:45", "Мои исправления");
    store.save({ id: "concurrent", date: tomorrow.date, start: "10:00", end: "11:00", title: "Время уже занято" });
    store.save({ ...tomorrow, title: "Название на сервере" });
    await submitForm();
    await screen.findByText("Время уже занято");
    expect((await screen.findByRole("alert")).textContent).toBe("Это время уже заняли. Список обновлён — выберите другой интервал");
    expect(formValues()).toEqual({ date: tomorrow.date, title: "Мои исправления", start: "10:15", end: "10:45" });
    expect(screen.getByRole("form", { name: "Редактирование бронирования" })).toBeDefined();
    expect(readDates).toEqual([early.date, tomorrow.date, tomorrow.date]);
    expect(client.getQueryData(["bookings", early.date])).toEqual([early, late]);
    expect(store.get(tomorrow.id)?.title).toBe("Название на сервере");
    await submitForm();
    expect(writeRequests).toEqual(["PATCH"]);
    fillForm("11:00", "11:30", "Мои исправления");
    await submitForm();
    await screen.findByRole("form", { name: "Новое бронирование" });
    expect(screen.getByText("Мои исправления")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(store.get(tomorrow.id)).toEqual({ ...tomorrow, title: "Мои исправления", end: "11:30" });
    expect(writeRequests).toEqual(["PATCH", "PATCH"]);
});

test("successful PATCH exits editing even if the following list refresh fails", async () => {
    showPage();
    await screen.findByText("Планирование");
    editBooking();
    fillForm("10:15", "10:45", "Сохранённые изменения");
    server.use(http.get(endpoint, () => new HttpResponse(null, { status: 503 })));
    await submitForm();
    await screen.findByRole("form", { name: "Новое бронирование" });
    expect(screen.getByRole("alert").textContent).toContain("Не удалось обновить список бронирований.");
    expect(formValues()).toEqual({ date: early.date, title: "", start: "", end: "" });
    expect(store.get(early.id)?.title).toBe("Сохранённые изменения");
    expect(writeRequests).toEqual(["PATCH"]);
    const updated = { ...early, start: "10:15", end: "10:45", title: "Сохранённые изменения" };
    expect(client.getQueryData(["bookings", early.date])).toEqual([updated, late]);
    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
        "10:15 — 10:45Сохранённые измененияРедактироватьУдалить",
        "14:00 — 15:00Без названияРедактироватьУдалить",
    ]);
    expect(screen.queryByText("Планирование")).toBeNull();
    editBooking(updated.title);
    expect(formValues()).toEqual({ date: updated.date, title: updated.title, start: updated.start, end: updated.end });
    expect(screen.getByRole("alert").textContent).toContain("Не удалось обновить список бронирований.");
    expect(readDates).toEqual([early.date, early.date]);
});

function clickDelete(title = "Планирование") {
    const row = screen.getByText(title).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Удалить" }));
}

test.each([false, true])("demo conflict runs once after valid submission and preserves fields and mode (editing: %s)", async (editing) => {
    showPage();
    await screen.findByText("Планирование");
    const summary = screen.getByText("Демо-сценарии");
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    const toggle = screen.getByRole("switch", { name: "Конфликт при следующем сохранении" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    if (editing) editBooking();

    // Client validation must not send a request or consume the scenario.
    fillForm("10:15", "10:29", "Мой черновик");
    await submitForm();
    expect((await screen.findByRole("alert")).textContent).toBe("Минимальная длительность бронирования — 30 минут.");
    expect(writeRequests).toEqual([]);
    expect(toggle.checked).toBe(true);
    fillForm("14:15", "14:45", "Мой черновик");
    await submitForm();
    expect((await screen.findByRole("alert")).textContent).toBe("Это время пересекается с другим бронированием.");
    expect(writeRequests).toEqual([]);
    expect(toggle.checked).toBe(true);

    fillForm("10:15", "10:45", "Мой черновик");
    await submitForm();
    await screen.findByText("Бронь другого участника");
    expect((await screen.findByRole("alert")).textContent).toBe("Это время уже заняли. Список обновлён — выберите другой интервал");
    expect(client.getMutationCache().getAll().at(-1)?.state.error).toMatchObject({ status: 409, code: "conflict" });
    expect(formValues()).toEqual({ date: early.date, title: "Мой черновик", start: "10:15", end: "10:45" });
    expect(screen.getByRole("form", { name: editing ? "Редактирование бронирования" : "Новое бронирование" })).toBeDefined();
    expect(toggle.checked).toBe(false);
    expect(store.get(early.id)).toEqual(early);
    expect(store.list()).toHaveLength(5);
    expect(store.list()).toContainEqual(expect.objectContaining({ date: early.date, start: "10:15", end: "10:45", title: "Бронь другого участника" }));
    expect(readDates).toEqual([early.date, early.date]);
    const method = editing ? "PATCH" : "POST";
    expect(writeRequests).toEqual([method]);

    // The refreshed list now blocks the conflicting draft locally.
    await submitForm();
    expect(writeRequests).toEqual([method]);
    fillForm("11:00", "11:30", "Мой черновик");
    await submitForm();
    await screen.findByText("Мой черновик");
    await waitFor(() => expect(formValues().title).toBe(""));
    expect(screen.getByRole("form", { name: "Новое бронирование" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(writeRequests).toEqual([method, method]);
    expect(store.list().filter((booking) => booking.title === "Бронь другого участника")).toHaveLength(1);
});

test("turning the demo switch off cancels the scenario", async () => {
    showPage();
    await screen.findByText("Планирование");
    fireEvent.click(screen.getByText("Демо-сценарии"));
    const toggle = screen.getByRole("switch", { name: "Конфликт при следующем сохранении" });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    fillForm("10:15", "10:45");
    await submitForm();
    await screen.findByText("Встреча команды");
    await waitFor(() => expect(formValues().title).toBe(""));
    expect(screen.queryByText("Бронь другого участника")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(writeRequests).toEqual(["POST"]);
});

test("DELETE handles an empty 204 response without reading JSON", async () => {
    const response = new Response(null, { status: 204 });
    const json = vi.spyOn(response, "json");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    await expect(deleteBooking("booking/1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(new URL(`${endpoint}/booking%2F1`), { method: "DELETE" });
    expect(json).not.toHaveBeenCalled();
});

test("canceling deletion preserves the booking and the editing draft without a request", async () => {
    showPage();
    await screen.findByText("Планирование");
    editBooking();
    fillForm("10:15", "10:45", "Черновик");
    clickDelete();
    expect(window.confirm).toHaveBeenCalledWith("Удалить бронирование «Планирование, 09.10.2026, 09:00–10:00»?");
    expect(writeRequests).toEqual([]);
    expect(readDates).toEqual([early.date]);
    expect(store.get(early.id)).toEqual(early);
    expect(screen.getByText("Планирование")).toBeDefined();
    expect(formValues()).toEqual({ date: early.date, title: "Черновик", start: "10:15", end: "10:45" });
});

test.each([false, true])("deletes the last booking for the selected date and closes its editor (editing: %s)", async (editing) => {
    vi.mocked(window.confirm).mockReturnValue(true);
    showPage();
    await screen.findByText("Планирование");
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: tomorrow.date } });
    await screen.findByText("Другая встреча");
    if (editing) {
        editBooking("Другая встреча");
        fillForm("10:15", "10:45", "Несохранённые изменения");
    }
    clickDelete("Другая встреча");
    await screen.findByText("На выбранную дату бронирований нет.");
    await screen.findByRole("form", { name: "Новое бронирование" });
    expect(screen.queryByText("Другая встреча")).toBeNull();
    expect(formValues()).toEqual({ date: tomorrow.date, title: "", start: "", end: "" });
    expect(store.get(tomorrow.id)).toBeUndefined();
    expect(store.get(early.id)).toEqual(early);
    expect(client.getQueryData(["bookings", early.date])).toEqual([early, late]);
    expect(readDates).toEqual([early.date, tomorrow.date, tomorrow.date]);
    expect(writeRequests).toEqual(["DELETE"]);
    expect(screen.queryByRole("alert")).toBeNull();
});

test("deleting another booking keeps the current editing draft", async () => {
    vi.mocked(window.confirm).mockReturnValue(true);
    showPage();
    await screen.findByText("Планирование");
    editBooking("Без названия");
    fillForm("15:15", "15:45", "Черновик другой брони");
    clickDelete();
    await waitFor(() => expect(screen.queryByText("Планирование")).toBeNull());
    await waitFor(() => expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("form", { name: "Редактирование бронирования" })).toBeDefined();
    expect(formValues()).toEqual({ date: late.date, title: "Черновик другой брони", start: "15:15", end: "15:45" });
    expect(store.get(late.id)).toEqual(late);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(writeRequests).toEqual(["DELETE"]);
});

test.each([
    ["404", () => HttpResponse.json({ code: "not_found", message: "Бронирование не найдено." }, { status: 404 }), "Бронирование не найдено."],
    ["500 JSON", () => HttpResponse.json({ message: "Удаление временно недоступно." }, { status: 500 }), "Удаление временно недоступно."],
    ["503 non-JSON", () => new HttpResponse("Unavailable", { status: 503 }), "Не удалось удалить бронирование. Попробуйте ещё раз."],
    ["network", () => HttpResponse.error(), "Не удалось удалить бронирование. Проверьте соединение и попробуйте ещё раз."],
] as const)("keeps the booking and draft after DELETE %s and allows retry", async (_name, response, message) => {
    vi.mocked(window.confirm).mockReturnValue(true);
    server.use(http.delete(`${endpoint}/:id`, response));
    showPage();
    await screen.findByText("Планирование");
    editBooking();
    fillForm("10:15", "10:45", "Черновик");
    clickDelete();
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(screen.getByText("Планирование")).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(store.get(early.id)).toEqual(early);
    expect(formValues()).toEqual({ date: early.date, title: "Черновик", start: "10:15", end: "10:45" });
    expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(false);
    expect(writeRequests).toEqual(["DELETE"]);
    expect(readDates).toEqual([early.date]);
    server.resetHandlers(...createBookingHandlers({ store, now: () => now, baseUrl: "http://localhost" }));
    clickDelete();
    await screen.findByRole("form", { name: "Новое бронирование" });
    expect(screen.queryByText("Планирование")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(writeRequests).toEqual(["DELETE", "DELETE"]);
    expect(window.confirm).toHaveBeenCalledTimes(2);
});

test("blocks duplicate DELETE and saving while deletion and its list refresh are pending", async () => {
    vi.mocked(window.confirm).mockReturnValue(true);
    let resolveDelete!: () => void;
    let resolveRefresh!: () => void;
    const pendingDelete = new Promise<void>((done) => { resolveDelete = done; });
    const pendingRefresh = new Promise<void>((done) => { resolveRefresh = done; });
    server.use(http.delete(`${endpoint}/${early.id}`, async () => {
        await pendingDelete;
        store.delete(early.id);
        return new HttpResponse(null, { status: 204 });
    }));
    showPage();
    await screen.findByText("Планирование");
    editBooking();
    fillForm("10:15", "10:45", "Черновик");
    server.use(http.get(endpoint, async () => {
        await pendingRefresh;
        return HttpResponse.json([late]);
    }));
    const row = screen.getByText("Планирование").closest("li")!;
    const button = within(row).getByRole("button", { name: "Удалить" });
    await act(async () => {
        fireEvent.click(button);
        fireEvent.click(button);
        fireEvent.submit(screen.getByRole("form"));
    });
    expect((await screen.findByRole("button", { name: "Удаление…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Планирование")).toBeDefined();
    expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(true);
    await submitForm();
    await waitFor(() => expect(writeRequests).toEqual(["DELETE"]));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    resolveDelete();
    await screen.findByText("Обновление бронирований…");
    expect(screen.queryByText("Планирование")).toBeNull();
    expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(true);
    resolveRefresh();
    await screen.findByRole("form", { name: "Новое бронирование" });
    expect(formValues()).toEqual({ date: early.date, title: "", start: "", end: "" });
    expect(writeRequests).toEqual(["DELETE"]);
});

test("a successful deletion stays removed and closes its editor if list refresh fails", async () => {
    vi.mocked(window.confirm).mockReturnValue(true);
    showPage();
    await screen.findByText("Планирование");
    editBooking();
    server.use(http.get(endpoint, () => new HttpResponse(null, { status: 503 })));
    clickDelete();
    await screen.findByRole("form", { name: "Новое бронирование" });
    expect(screen.getByRole("alert").textContent).toContain("Не удалось обновить список бронирований.");
    expect(screen.queryByText("Планирование")).toBeNull();
    expect(store.get(early.id)).toBeUndefined();
    expect(writeRequests).toEqual(["DELETE"]);
    expect(screen.getByText("Без названия")).toBeDefined();
});

test.each([false, true])("409 reports a failed refresh separately, retains the draft and allows saving after recovery (editing: %s)", async (editing) => {
    showPage();
    await screen.findByText("Планирование");
    if (editing) editBooking();
    fireEvent.click(screen.getByText("Демо-сценарии"));
    fireEvent.click(screen.getByRole("switch", { name: "Конфликт при следующем сохранении" }));
    fillForm("10:15", "10:45", "Мои изменения");
    let resolveRefresh!: () => void;
    const pendingRefresh = new Promise<void>((done) => { resolveRefresh = done; });
    server.use(http.get(endpoint, async () => {
        await pendingRefresh;
        return new HttpResponse(null, { status: 503 });
    }));
    await submitForm();
    await screen.findByText("Обновление бронирований…");
    expect(screen.queryByText(/Список обновлён/)).toBeNull();
    resolveRefresh();
    const conflict = await screen.findByText("Это время уже заняли. Выберите другой интервал.");
    expect(conflict.getAttribute("role")).toBe("alert");
    expect(screen.getByLabelText("Время начала").getAttribute("aria-describedby")).toBe(conflict.id);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getByText("Не удалось обновить список бронирований. Попробуйте ещё раз.")).toBeDefined();
    expect(screen.queryByText(/Список обновлён/)).toBeNull();
    expect(screen.queryByText("Бронь другого участника")).toBeNull();
    expect(formValues()).toEqual({ date: early.date, title: "Мои изменения", start: "10:15", end: "10:45" });
    const formName = editing ? "Редактирование бронирования" : "Новое бронирование";
    expect(screen.getByRole("form", { name: formName })).toBeDefined();
    expect(store.get(early.id)).toEqual(early);
    const method = editing ? "PATCH" : "POST";
    expect(writeRequests).toEqual([method]);

    // Saving remains blocked until the list has been refreshed successfully.
    expect((screen.getByRole("button", { name: editing ? "Сохранить" : "Забронировать" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: editing ? "Сохранить" : "Забронировать" }));
    expect(writeRequests).toEqual([method]);
    server.resetHandlers(...createBookingHandlers({ store, now: () => now, baseUrl: "http://localhost", scenarios: demoScenarios }));
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await screen.findByText("Бронь другого участника");
    expect(screen.queryByText("Не удалось обновить список бронирований. Попробуйте ещё раз.")).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toBe("Это время уже заняли. Список обновлён — выберите другой интервал");
    expect(formValues()).toEqual({ date: early.date, title: "Мои изменения", start: "10:15", end: "10:45" });
    expect(screen.getByRole("form", { name: formName })).toBeDefined();
    fillForm("11:00", "11:30", "Мои изменения");
    await submitForm();
    await screen.findByText("Мои изменения");
    await waitFor(() => expect(formValues().title).toBe(""));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("form", { name: "Новое бронирование" })).toBeDefined();
    expect(writeRequests).toEqual([method, method]);
    expect(store.list()).toContainEqual(expect.objectContaining({ title: "Мои изменения", start: "11:00", end: "11:30" }));
});
