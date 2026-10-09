export type Booking = {
    id: string;
    date: string;
    start: string;
    end: string;
    title?: string;
};

export type BookingInput = Omit<Booking, "id">;