import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { setupServer } from "msw/node";
import { createBookingHandlers } from "../src/mocks/handlers.ts";
import { createBookingStore } from "../src/mocks/bookings-store.ts";
import type { Booking, BookingInput } from "../src/features/bookings/types.ts";

const baseUrl = "http://localhost";
const endpoint = `${baseUrl}/api/bookings`;
const now = new Date(2026, 9, 9, 10, 0, 15);
const input: BookingInput = {
    date: "2026-10-10", start: "10:00", end: "11:00", title: "Планирование",
};
const server = setupServer();
let store: ReturnType<typeof createBookingStore>;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
    store = createBookingStore();
    server.resetHandlers(...createBookingHandlers({ store, baseUrl, now: () => now }));
});
afterAll(() => server.close());

function write(method: "POST" | "PATCH", body: unknown, id?: string) {
    return fetch(id ? `${endpoint}/${id}` : endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

async function create(changes: Partial<BookingInput> = {}): Promise<Booking> {
    const response = await write("POST", { ...input, ...changes });
    expect(response.status).toBe(201);
    const booking = await response.json() as Booking;
    expect(booking.id).toEqual(expect.any(String));
    return booking;
}

async function list(date = input.date): Promise<Booking[]> {
    const response = await fetch(`${endpoint}?date=${date}`);
    expect(response.status).toBe(200);
    return response.json() as Promise<Booking[]>;
}

test("completes a CRUD lifecycle and rejects operations on the deleted booking", async () => {
    const booking = await create();
    expect(await list()).toEqual([booking]);

    const changes = { start: "11:15", end: "12:00", title: "Обновлённая встреча" };
    const updated = await write("PATCH", changes, booking.id);
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({ ...booking, ...changes });
    expect(await list()).toEqual([{ ...booking, ...changes }]);

    const deleted = await fetch(`${endpoint}/${booking.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(await list()).toEqual([]);

    const missingPatch = await write("PATCH", { title: "Повторное изменение" }, booking.id);
    const missingDelete = await fetch(`${endpoint}/${booking.id}`, { method: "DELETE" });
    for (const response of [missingPatch, missingDelete]) {
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "not_found" });
    }
    expect(await list()).toEqual([]);
});

describe("GET /api/bookings", () => {
    test("starts with an empty list", async () => {
        expect(await list()).toEqual([]);
    });

    test("keeps stored bookings when handlers are recreated", async () => {
        const booking = await create();
        server.resetHandlers(...createBookingHandlers({ store, baseUrl, now: () => now }));
        expect(await list()).toEqual([booking]);
    });

    test("filters by date and sorts by start time", async () => {
        const late = await create({ start: "12:00", end: "13:00" });
        const middle = await create({ start: "10:30", end: "11:00" });
        const early = await create({ start: "10:00", end: "10:30" });
        await create({ date: "2026-10-11" });
        const before = store.list();
        expect(await list()).toEqual([early, middle, late]);
        expect(store.list()).toEqual(before);
    });

    test.each(["", "?date=", "?date=2026-02-29", "?date=2026-04-31", "?date=2026-1-01"])(
        "rejects a missing or invalid date: %s",
        async (query) => {
            await create();
            const before = store.list();
            const response = await fetch(`${endpoint}${query}`);
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({
                code: "invalid_date", field: "date", message: expect.stringMatching(/\S/),
            });
            expect(store.list()).toEqual(before);
        },
    );

    test("allows viewing a past date", async () => {
        expect(await list("2026-10-08")).toEqual([]);
    });
});

describe("POST /api/bookings", () => {
    test("creates a booking with a generated ID and returns it through GET", async () => {
        const booking = await create();
        expect(booking).toEqual({ ...input, id: expect.any(String) });
        expect(await list()).toEqual([booking]);
    });

    test("accepts an omitted title", async () => {
        const response = await write("POST", { date: input.date, start: input.start, end: input.end });
        expect(response.status).toBe(201);
        expect(await response.json()).not.toHaveProperty("title");
    });

    test("allows adjacent bookings and matching times on a different date", async () => {
        await create();
        await create({ start: "11:00", end: "12:00" });
        await create({ date: "2026-10-11" });
        expect(await list()).toHaveLength(2);
    });

    test("returns 409 for a conflict and preserves stored data", async () => {
        const booking = await create();
        const response = await write("POST", { ...input, start: "10:15", end: "10:45" });
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
            code: "conflict", field: "start", message: expect.stringMatching(/\S/),
        });
        expect(await list()).toEqual([booking]);
    });

    test("checks current server state for concurrent creation requests", async () => {
        const responses = await Promise.all([write("POST", input), write("POST", input)]);
        expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
        expect(await list()).toHaveLength(1);
    });

    test.each([
        [{ date: "2026-02-29" }, "invalid_date", "date"],
        [{ start: "9:00" }, "invalid_time", "start"],
        [{ start: "08:59" }, "outside_working_hours", "start"],
        [{ end: "10:00" }, "invalid_interval", "end"],
        [{ end: "10:29" }, "duration_too_short", "end"],
        [{ end: "12:01" }, "duration_too_long", "end"],
        [{ date: "2026-10-08" }, "past_time", "date"],
        [{ date: "2026-10-09" }, "past_time", "start"],
    ])("validates booking rules for %j", async (changes, code, field) => {
        const response = await write("POST", { ...input, ...changes });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ code, field, message: expect.stringMatching(/\S/) });
        expect(await list()).toEqual([]);
    });
});

describe("request body validation", () => {
    test.each([null, [], "booking", {}, { ...input, start: 600 }, { ...input, title: null }, { ...input, id: "custom" }])(
        "returns 400 instead of crashing on %j",
        async (body) => {
            const response = await write("POST", body);
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ code: "invalid_input", message: expect.stringMatching(/\S/) });
            expect(await list()).toEqual([]);
        },
    );

    test.each(["date", "start", "end"] as const)("requires %s for POST", async (field) => {
        await create();
        const before = store.list();
        const body: Partial<BookingInput> = { ...input };
        delete body[field];
        const response = await write("POST", body);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            code: "invalid_input", field, message: expect.stringMatching(/\S/),
        });
        expect(store.list()).toEqual(before);
    });

    describe.each(["POST", "PATCH"] as const)("%s rejects invalid bodies without modifying data", (method) => {
        test.each(["", "{", '{"date":}'])("rejects malformed JSON %j", async (body) => {
            const booking = await create();
            const before = store.list();
            const response = await fetch(method === "PATCH" ? `${endpoint}/${booking.id}` : endpoint, {
                method,
                headers: { "Content-Type": "application/json" },
                body,
            });
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ code: "invalid_json", message: expect.stringMatching(/\S/) });
            expect(store.list()).toEqual(before);
        });

        test.each([null, [], "booking", 42, false])("rejects a non-object JSON value %j", async (body) => {
            const booking = await create();
            const before = store.list();
            const response = await write(method, body, method === "PATCH" ? booking.id : undefined);
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ code: "invalid_input" });
            expect(store.list()).toEqual(before);
        });

        test.each(["date", "start", "end", "title"] as const)("requires %s to be a string", async (field) => {
            const booking = await create();
            const before = store.list();
            for (const value of [null, 600, true, [], {}]) {
                const body = method === "POST" ? { ...input, [field]: value } : { [field]: value };
                const response = await write(method, body, method === "PATCH" ? booking.id : undefined);
                expect(response.status).toBe(400);
                expect(await response.json()).toEqual({
                    code: "invalid_input", field, message: expect.stringMatching(/\S/),
                });
                expect(store.list()).toEqual(before);
            }
        });

        test("checks field types before business rules", async () => {
            const booking = await create();
            const before = store.list();
            const response = await write(
                method,
                { ...input, date: "2026-02-29", end: 660 },
                method === "PATCH" ? booking.id : undefined,
            );
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ code: "invalid_input", field: "end" });
            expect(store.list()).toEqual(before);
        });
    });
});

describe("PATCH /api/bookings/:id", () => {
    test("updates a single field and preserves ID and omitted fields", async () => {
        const booking = await create();
        const response = await write("PATCH", { title: "Новое название" }, booking.id);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ...booking, title: "Новое название" });
        expect(await list()).toEqual([{ ...booking, title: "Новое название" }]);
    });

    test("allows saving without changes, excluding its own ID", async () => {
        const booking = await create();
        const response = await write("PATCH", input, booking.id);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(booking);
    });

    test("returns 409 for a conflict with another booking without changing data", async () => {
        const booking = await create();
        const another = await create({ start: "11:00", end: "12:00" });
        const response = await write("PATCH", { start: "10:30", end: "11:30" }, booking.id);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: "conflict", field: "start" });
        expect(await list()).toEqual([booking, another]);
    });

    test("validates the merged interval and preserves the original on failure", async () => {
        const booking = await create();
        const response = await write("PATCH", { end: "10:29" }, booking.id);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "duration_too_short", field: "end" });
        expect(await list()).toEqual([booking]);
    });

    test("moves a booking to another date", async () => {
        const booking = await create();
        const response = await write("PATCH", { date: "2026-10-11" }, booking.id);
        expect(response.status).toBe(200);
        expect(await list()).toEqual([]);
        expect(await list("2026-10-11")).toEqual([{ ...booking, date: "2026-10-11" }]);
    });

    test("does not accept a replacement ID", async () => {
        const booking = await create();
        const response = await write("PATCH", { id: "changed" }, booking.id);
        expect(response.status).toBe(400);
        expect(await list()).toEqual([booking]);
    });

    test("returns 404 for an unknown ID", async () => {
        const booking = await create();
        const response = await write("PATCH", { title: "Название" }, "missing");
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "not_found" });
        expect(store.list()).toEqual([booking]);
    });
});

describe("DELETE /api/bookings/:id", () => {
    test("returns 204 and deletes only the requested booking", async () => {
        const booking = await create();
        const another = await create({ start: "11:00", end: "12:00" });
        const response = await fetch(`${endpoint}/${booking.id}`, { method: "DELETE" });
        expect(response.status).toBe(204);
        expect(await response.text()).toBe("");
        expect(await list()).toEqual([another]);
        await create();
    });

    test("returns 404 for an unknown ID", async () => {
        const booking = await create();
        const response = await fetch(`${endpoint}/missing`, { method: "DELETE" });
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "not_found" });
        expect(store.list()).toEqual([booking]);
    });
});
