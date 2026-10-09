import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookingApiError, createBooking, deleteBooking, getBookings, updateBooking } from "./api.ts";
import { isValidDate } from "./time.ts";
import type { Booking, BookingInput } from "./types.ts";

function sortByStart(bookings: Booking[]) {
    return [...bookings].sort((a, b) => a.start.localeCompare(b.start));
}

export function useBookings(date: string) {
    return useQuery({
        queryKey: ["bookings", date],
        queryFn: ({ signal }) => getBookings(date, signal),
        enabled: isValidDate(date),
        select: sortByStart,
    });
}

export function useCreateBooking() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: createBooking,
        retry: false,
        onSuccess: (_booking, input) => queryClient.invalidateQueries({ queryKey: ["bookings", input.date], exact: true }),
        onError: (error, input) => {
            if (error instanceof BookingApiError && error.status === 409) {
                return queryClient.invalidateQueries({ queryKey: ["bookings", input.date], exact: true });
            }
        },
    });
}

export function useUpdateBooking() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, input }: { id: string; input: BookingInput }) => updateBooking(id, input),
        retry: false,
        onSuccess: (_booking, { input }) => queryClient.invalidateQueries({ queryKey: ["bookings", input.date], exact: true }),
        onError: (error, { input }) => {
            if (error instanceof BookingApiError && error.status === 409) {
                return queryClient.invalidateQueries({ queryKey: ["bookings", input.date], exact: true });
            }
        },
    });
}

export function useDeleteBooking() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id }: { id: string; date: string }) => deleteBooking(id),
        retry: false,
        onSuccess: async (_result, { id, date }) => {
            const queryKey = ["bookings", date];
            // Remove only after server confirmation, even if refreshing the list later fails.
            queryClient.setQueryData<Booking[]>(queryKey, (current) => current?.filter((booking) => booking.id !== id));
            await queryClient.invalidateQueries({ queryKey, exact: true });
        },
    });
}
