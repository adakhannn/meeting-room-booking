import { http, HttpResponse } from "msw";
import type { Booking, BookingInput } from "../features/bookings/types.ts";
import { intervalsOverlap, isValidDate, toMinutes } from "../features/bookings/time.ts";
import { validateBooking } from "../features/bookings/validation.ts";
import type { BookingValidationError } from "../features/bookings/validation.ts";
import type { BookingStore } from "./bookings-store.ts";
import { createDemoScenarios } from "../demo/scenarios.ts";

type ApiError = {
    code: BookingValidationError["code"] | "invalid_json" | "invalid_input" | "not_found";
    field?: keyof BookingInput;
    message: string;
};

type ParsedInput =
    | { ok: true; data: Partial<BookingInput> }
    | { ok: false; error: ApiError };

const fields = ["date", "start", "end", "title"] as const;

async function readInput(request: Request, partial: boolean): Promise<ParsedInput> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return { ok: false, error: { code: "invalid_json", message: "Тело запроса должно содержать корректный JSON." } };
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return { ok: false, error: { code: "invalid_input", message: "Ожидается объект с данными бронирования." } };
    }

    if (Object.keys(body).some((key) => !fields.some((field) => field === key))) {
        return { ok: false, error: { code: "invalid_input", message: "Допустимые поля: date, start, end, title." } };
    }

    const bodyFields = body as Record<string, unknown>;
    const data: Partial<BookingInput> = {};
    for (const field of fields) {
        if (!(field in body)) {
            if (partial || field === "title") continue;
            return { ok: false, error: { code: "invalid_input", field, message: "Заполните обязательное поле." } };
        }
        const value = bodyFields[field];
        if (typeof value !== "string") {
            return { ok: false, error: { code: "invalid_input", field, message: "Значение поля должно быть строкой." } };
        }
        data[field] = value;
    }
    return { ok: true, data };
}

function errorResponse(error: ApiError, status = 400) {
    return HttpResponse.json(error, { status });
}

function notFound() {
    return errorResponse({ code: "not_found", message: "Бронирование не найдено." }, 404);
}

export function createBookingHandlers({
    store,
    now = () => new Date(),
    baseUrl = "",
    scenarios = createDemoScenarios(),
}: { store: BookingStore; now?: () => Date; baseUrl?: string; scenarios?: ReturnType<typeof createDemoScenarios> }) {
    const endpoint = `${baseUrl}/api/bookings`;

    function validate(input: BookingInput, excludeBookingId?: string) {
        const result = validateBooking(input, store.list(), now(), excludeBookingId);
        if (result.valid === false) {
            const { code, field, message } = result;
            return errorResponse({ code, field, message }, code === "conflict" ? 409 : 400);
        }
    }

    function simulateConflict(input: BookingInput) {
        if (!scenarios.getConflictOnNextSave()) return;
        const start = toMinutes(input.start);
        const end = toMinutes(input.end);
        // Unlike PATCH validation, demo insertion must also respect the booking being edited.
        const occupied = store.list().some((booking) => booking.date === input.date
            && intervalsOverlap(start, end, toMinutes(booking.start), toMinutes(booking.end)));
        if (occupied) return;

        // Consume only after validation and when the entire requested interval is free.
        if (!scenarios.consumeConflict()) return;
        store.save({
            id: crypto.randomUUID(),
            date: input.date,
            start: input.start,
            end: input.end,
            title: "Бронь другого участника",
        });
        return errorResponse({
            code: "conflict", field: "start", message: "Это время пересекается с другим бронированием.",
        }, 409);
    }

    return [
        http.get(endpoint, ({ request }) => {
            const date = new URL(request.url).searchParams.get("date");
            if (date === null || !isValidDate(date)) {
                return errorResponse({
                    code: "invalid_date",
                    field: "date",
                    message: "Укажите существующую дату в формате ГГГГ-ММ-ДД.",
                });
            }
            return HttpResponse.json(
                store.list()
                    .filter((booking) => booking.date === date)
                    .sort((a, b) => a.start.localeCompare(b.start)),
            );
        }),

        http.post(endpoint, async ({ request }) => {
            const parsed = await readInput(request, false);
            if (parsed.ok === false) return errorResponse(parsed.error);
            // readInput has verified that all required fields exist and are strings.
            const input = parsed.data as BookingInput;
            const error = validate(input);
            if (error) return error;
            const conflict = simulateConflict(input);
            if (conflict) return conflict;

            const booking: Booking = { ...input, id: crypto.randomUUID() };
            store.save(booking);
            return HttpResponse.json(booking, { status: 201 });
        }),

        http.patch(`${endpoint}/:id`, async ({ request, params }) => {
            const parsed = await readInput(request, true);
            if (parsed.ok === false) return errorResponse(parsed.error);
            const id = String(params.id);
            const current = store.get(id);
            if (!current) return notFound();

            const booking: Booking = { ...current, ...parsed.data };
            const error = validate(booking, id);
            if (error) return error;
            const conflict = simulateConflict(booking);
            if (conflict) return conflict;

            store.save(booking);
            return HttpResponse.json(booking);
        }),

        http.delete(`${endpoint}/:id`, ({ params }) => {
            if (!store.delete(String(params.id))) return notFound();
            return new HttpResponse(null, { status: 204 });
        }),
    ];
}
