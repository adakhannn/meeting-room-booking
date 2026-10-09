import { intervalsOverlap, toMinutes } from "./time.ts";
import type { Booking, BookingInput } from "./types.ts";

export type BookingValidationErrorCode =
    | "invalid_date"
    | "invalid_time"
    | "outside_working_hours"
    | "invalid_interval"
    | "duration_too_short"
    | "duration_too_long"
    | "past_time"
    | "conflict";

export type BookingValidationError = {
    field: "date" | "start" | "end";
    code: BookingValidationErrorCode;
    message: string;
};

export type BookingValidationResult =
    | { valid: true }
    | ({ valid: false } & BookingValidationError);

const WORKDAY_START = 9 * 60;
const WORKDAY_END = 18 * 60;
const MIN_DURATION = 30;
const MAX_DURATION = 120;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Date and time are interpreted in the user's local time zone.
export function validateBooking(
    input: BookingInput,
    bookings: readonly Booking[],
    now: Date,
    excludeBookingId?: Booking["id"],
): BookingValidationResult {
    const date = new Date(`${input.date}T00:00:00`);
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== Number(input.date.slice(0, 4)) ||
        date.getMonth() + 1 !== Number(input.date.slice(5, 7)) ||
        date.getDate() !== Number(input.date.slice(8, 10))
    ) {
        return {
            valid: false,
            field: "date",
            code: "invalid_date",
            message: "Укажите существующую дату в формате ГГГГ-ММ-ДД.",
        };
    }

    for (const field of ["start", "end"] as const) {
        if (!TIME_PATTERN.test(input[field])) {
            return {
                valid: false,
                field,
                code: "invalid_time",
                message: "Укажите время в формате ЧЧ:ММ.",
            };
        }

        const minutes = toMinutes(input[field]);
        if (minutes < WORKDAY_START || minutes > WORKDAY_END) {
            return {
                valid: false,
                field,
                code: "outside_working_hours",
                message: "Время бронирования должно быть в пределах 09:00–18:00.",
            };
        }
    }

    const start = toMinutes(input.start);
    const end = toMinutes(input.end);
    const duration = end - start;

    if (duration <= 0) {
        return {
            valid: false,
            field: "end",
            code: "invalid_interval",
            message: "Время окончания должно быть позже времени начала.",
        };
    }
    if (duration < MIN_DURATION) {
        return {
            valid: false,
            field: "end",
            code: "duration_too_short",
            message: "Минимальная длительность бронирования — 30 минут.",
        };
    }
    if (duration > MAX_DURATION) {
        return {
            valid: false,
            field: "end",
            code: "duration_too_long",
            message: "Максимальная длительность бронирования — 2 часа.",
        };
    }

    const startsAt = new Date(`${input.date}T${input.start}:00`);
    if (startsAt.getTime() < now.getTime()) {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return {
            valid: false,
            field: date < today ? "date" : "start",
            code: "past_time",
            message: "Нельзя бронировать прошедшее время.",
        };
    }

    const hasConflict = bookings.some(
        (booking) =>
            booking.id !== excludeBookingId &&
            booking.date === input.date &&
            intervalsOverlap(
                start,
                end,
                toMinutes(booking.start),
                toMinutes(booking.end),
            ),
    );
    if (hasConflict) {
        return {
            valid: false,
            field: "start",
            code: "conflict",
            message: "Это время пересекается с другим бронированием.",
        };
    }

    return { valid: true };
}
