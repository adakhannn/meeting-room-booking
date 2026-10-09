import { setupWorker } from "msw/browser";
import { createBookingHandlers } from "./handlers.ts";
import { createBookingStore } from "./bookings-store.ts";

const store = createBookingStore();

export const worker = setupWorker(...createBookingHandlers({ store }));
