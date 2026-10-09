import type { Booking, BookingInput } from "./types.ts";

export class BookingApiError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly field?: keyof BookingInput;

    constructor(status: number, message: string, code?: string, field?: keyof BookingInput) {
        super(message);
        this.name = "BookingApiError";
        this.status = status;
        this.code = code;
        this.field = field;
    }
}

export async function getBookings(date: string, signal?: AbortSignal): Promise<Booking[]> {
    const url = new URL("/api/bookings", window.location.origin);
    url.searchParams.set("date", date);
    const response = await fetch(url, { signal });

    await checkResponse(response, "Не удалось загрузить бронирования. Попробуйте ещё раз.");
    return response.json();
}

export async function createBooking(input: BookingInput): Promise<Booking> {
    const response = await fetch(new URL("/api/bookings", window.location.origin), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    await checkResponse(response, "Не удалось сохранить бронирование. Попробуйте ещё раз.");
    return response.json();
}

export async function updateBooking(id: string, input: Partial<BookingInput>): Promise<Booking> {
    const response = await fetch(new URL(`/api/bookings/${encodeURIComponent(id)}`, window.location.origin), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    await checkResponse(response, "Не удалось сохранить бронирование. Попробуйте ещё раз.");
    return response.json();
}

export async function deleteBooking(id: string): Promise<void> {
    const response = await fetch(new URL(`/api/bookings/${encodeURIComponent(id)}`, window.location.origin), {
        method: "DELETE",
    });
    // A successful DELETE returns 204 with no JSON body.
    await checkResponse(response, "Не удалось удалить бронирование. Попробуйте ещё раз.");
}

async function checkResponse(response: Response, fallbackMessage: string): Promise<void> {
    if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        let message = fallbackMessage;
        let code: string | undefined;
        let field: keyof BookingInput | undefined;
        if (typeof body === "object" && body !== null) {
            if ("message" in body && typeof body.message === "string") message = body.message;
            if ("code" in body && typeof body.code === "string") code = body.code;
            if ("field" in body && (body.field === "date" || body.field === "start" || body.field === "end" || body.field === "title")) {
                field = body.field;
            }
        }
        throw new BookingApiError(response.status, message, code, field);
    }
}
