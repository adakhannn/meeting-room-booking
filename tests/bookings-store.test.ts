import { expect, test } from "vitest";
import { createBookingStore } from "../src/mocks/bookings-store.ts";
import type { Booking } from "../src/features/bookings/types.ts";

const booking: Booking = {
    id: "booking-1", date: "2026-10-10", start: "10:00", end: "11:00",
};

test("store instances do not share bookings", () => {
    const first = createBookingStore();
    const second = createBookingStore();
    first.save(booking);
    expect(first.list()).toEqual([booking]);
    expect(second.list()).toEqual([]);
});

test("stored bookings cannot be changed through input or read references", () => {
    const store = createBookingStore();
    const input = { ...booking };
    store.save(input);
    input.start = "12:00";
    const saved = store.get(booking.id)!;
    saved.end = "13:00";
    const list = store.list();
    list[0].date = "2026-10-11";
    list.length = 0;
    expect(store.get(booking.id)).toEqual(booking);
    expect(store.list()).toEqual([booking]);
});
