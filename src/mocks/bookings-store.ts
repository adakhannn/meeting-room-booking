import type { Booking } from "../features/bookings/types.ts";

export function createBookingStore() {
    const bookings = new Map<string, Booking>();

    return {
        list(): Booking[] {
            return [...bookings.values()].map((booking) => ({ ...booking }));
        },

        get(id: string): Booking | undefined {
            const booking = bookings.get(id);
            return booking ? { ...booking } : undefined;
        },

        save(booking: Booking): void {
            bookings.set(booking.id, { ...booking });
        },

        delete(id: string): boolean {
            return bookings.delete(id);
        },
    };
}

export type BookingStore = ReturnType<typeof createBookingStore>;
