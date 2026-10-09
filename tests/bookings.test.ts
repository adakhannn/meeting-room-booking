import { describe, expect, test } from "vitest";
import { intervalsOverlap, toMinutes } from "../src/features/bookings/time.ts";
import type { Booking, BookingInput } from "../src/features/bookings/types.ts";
import { validateBooking } from "../src/features/bookings/validation.ts";

const now = new Date(2026, 9, 9, 10, 0, 0);
const input: BookingInput = { date: "2026-10-10", start: "10:00", end: "11:00" };
const existing: Booking = { ...input, id: "existing" };

function validate(
    changes: Partial<BookingInput> = {},
    bookings: readonly Booking[] = [],
    currentTime = now,
    excludeBookingId?: string,
) {
    return validateBooking({ ...input, ...changes }, bookings, currentTime, excludeBookingId);
}

describe("time helpers", () => {
    test.each([
        ["00:00", 0],
        ["09:30", 570],
        ["18:00", 1080],
        ["23:59", 1439],
    ])("converts %s to %i minutes", (time, minutes) => {
        expect(toMinutes(time)).toBe(minutes);
    });

    test("allows touching boundaries but detects a one-minute overlap", () => {
        expect(intervalsOverlap(600, 660, 660, 720)).toBe(false);
        expect(intervalsOverlap(660, 720, 600, 660)).toBe(false);
        expect(intervalsOverlap(600, 661, 660, 720)).toBe(true);
    });
});

describe("workday and duration", () => {
    test.each([
        ["09:00", "09:30"],
        ["16:00", "18:00"],
        ["17:30", "18:00"],
        ["10:15", "10:45"],
        ["10:07", "10:38"],
    ])("accepts %s–%s without a 30-minute grid", (start, end) => {
        expect(validate({ start, end })).toEqual({ valid: true });
    });

    test.each([
        ["08:59", "10:00", "outside_working_hours", "start"],
        ["17:30", "18:01", "outside_working_hours", "end"],
        ["18:01", "18:30", "outside_working_hours", "start"],
        ["09:00", "08:59", "outside_working_hours", "end"],
        ["10:00", "10:00", "invalid_interval", "end"],
        ["10:00", "09:30", "invalid_interval", "end"],
        ["10:00", "10:29", "duration_too_short", "end"],
        ["10:00", "12:01", "duration_too_long", "end"],
    ])("rejects %s–%s with %s on %s", (start, end, code, field) => {
        expect(validate({ start, end })).toEqual({
            valid: false,
            code,
            field,
            message: expect.stringMatching(/\S/),
        });
    });
});

describe("date and time format", () => {
    test.each([
        "", "2026-2-01", "2026-02-29", "2026-04-31", "2026-13-01",
        "2026-00-10", "2026-10-00", "2026-10-10T00:00:00", "not-a-date",
    ])("rejects invalid date %j", (date) => {
        expect(validate({ date })).toEqual({
            valid: false,
            code: "invalid_date",
            field: "date",
            message: expect.stringMatching(/\S/),
        });
    });

    test("accepts a real leap day", () => {
        expect(validate({ date: "2028-02-29" })).toEqual({ valid: true });
    });

    test.each(["", "9:00", "10:60", "24:00", "12:30:00", "abc", " 10:00"])(
        "rejects invalid time %j in both fields",
        (value) => {
            for (const field of ["start", "end"] as const) {
                expect(validate({ [field]: value })).toEqual({
                    valid: false,
                    code: "invalid_time",
                    field,
                    message: expect.stringMatching(/\S/),
                });
            }
        },
    );
});

describe("past time in the local time zone", () => {
    test("rejects yesterday", () => {
        expect(validate({ date: "2026-10-08" })).toMatchObject({
            valid: false, code: "past_time", field: "date",
        });
    });

    test("rejects a start one minute before now today", () => {
        expect(validate({ date: "2026-10-09", start: "09:59" })).toMatchObject({
            valid: false, code: "past_time", field: "start",
        });
    });

    test("allows a start exactly now", () => {
        expect(validate({ date: "2026-10-09" })).toEqual({ valid: true });
    });

    test.each([1, 15, 59])("rejects the start of the current minute after %i seconds", (seconds) => {
        const currentTime = new Date(2026, 9, 9, 10, 0, seconds);
        expect(validate({ date: "2026-10-09" }, [], currentTime))
            .toMatchObject({ valid: false, code: "past_time", field: "start" });
    });

    test("allows a start one minute after now", () => {
        expect(validate({ date: "2026-10-09", start: "10:01" })).toEqual({ valid: true });
    });

    test("allows tomorrow morning when it is late tonight", () => {
        expect(validate({ start: "09:00", end: "09:30" }, [], new Date(2026, 9, 9, 23, 59)))
            .toEqual({ valid: true });
    });
});

describe("overlaps on the selected date", () => {
    test.each([
        ["09:30", "10:30", "partial overlap from the left"],
        ["10:30", "11:30", "partial overlap from the right"],
        ["10:15", "10:45", "new booking inside an existing booking"],
        ["09:30", "11:30", "existing booking inside the new booking"],
        ["10:00", "11:00", "identical intervals"],
        ["09:31", "10:01", "one-minute overlap"],
    ])("rejects %s–%s: %s", (start, end) => {
        expect(validate({ start, end }, [existing])).toEqual({
            valid: false,
            code: "conflict",
            field: "start",
            message: expect.stringMatching(/\S/),
        });
    });

    test.each([["09:00", "10:00"], ["11:00", "12:00"]])(
        "allows adjacent interval %s–%s",
        (start, end) => {
            expect(validate({ start, end }, [existing])).toEqual({ valid: true });
        },
    );

    test("ignores the same interval on another date", () => {
        expect(validate({}, [{ ...existing, date: "2026-10-11" }])).toEqual({ valid: true });
    });
});

describe("editing", () => {
    test("allows saving an unchanged booking when its ID is excluded", () => {
        expect(validate({}, [existing], now, existing.id)).toEqual({ valid: true });
    });

    test("still detects another booking with the same times", () => {
        expect(validate({}, [existing, { ...existing, id: "another" }], now, existing.id))
            .toMatchObject({ valid: false, code: "conflict", field: "start" });
    });

    test("rejects moving the edited booking into another booking", () => {
        const another: Booking = { ...existing, id: "another", start: "11:00", end: "12:00" };
        expect(validate(
            { start: "10:30", end: "11:30" },
            [existing, another],
            now,
            existing.id,
        )).toMatchObject({ valid: false, code: "conflict", field: "start" });
    });

    test("does not exclude a booking with a different ID", () => {
        expect(validate({}, [existing], now, "another"))
            .toMatchObject({ valid: false, code: "conflict", field: "start" });
    });

    test("does not mutate form data or existing bookings", () => {
        const frozenInput = Object.freeze({ ...input, title: "Обсуждение" });
        const bookings = Object.freeze([Object.freeze({ ...existing })]);
        expect(validateBooking(frozenInput, bookings, now))
            .toMatchObject({ valid: false, code: "conflict" });
        expect(frozenInput.title).toBe("Обсуждение");
    });
});
