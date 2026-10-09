import { useRef, useState } from "react";
import { BookingApiError } from "./api.ts";
import { BookingForm } from "./BookingForm.tsx";
import { useBookings, useCreateBooking, useDeleteBooking, useUpdateBooking } from "./queries.ts";
import { formatLocalDate, isValidDate } from "./time.ts";
import type { Booking, BookingInput } from "./types.ts";
import { DemoScenarios } from "../../demo/DemoScenarios.tsx";

export function BookingsPage() {
    const [date, setDate] = useState(() => formatLocalDate(new Date()));
    // Keep a snapshot so list refreshes do not replace the user's draft.
    const [editingBooking, setEditingBooking] = useState<Booking>();
    const validDate = isValidDate(date);
    const { data: bookings, isPending, isFetching, isError, isRefetchError, error, refetch } = useBookings(date);
    const creation = useCreateBooking();
    const update = useUpdateBooking();
    const deletion = useDeleteBooking();
    const isSaving = creation.isPending || update.isPending;
    const isBusy = isSaving || deletion.isPending;
    // Protect against multiple actions before mutation state has re-rendered the UI.
    const mutationInFlight = useRef(false);
    const editTrigger = useRef<HTMLButtonElement | null>(null);

    async function saveBooking(input: BookingInput) {
        if (mutationInFlight.current) return;
        mutationInFlight.current = true;
        deletion.reset();
        try {
            const saved = editingBooking
                ? await update.mutateAsync({ id: editingBooking.id, input })
                : await creation.mutateAsync(input);
            setEditingBooking(undefined);
            return saved;
        } finally {
            mutationInFlight.current = false;
        }
    }

    async function removeBooking(booking: Booking) {
        if (mutationInFlight.current || isBusy) return;
        const description = `${booking.title?.trim() || "Без названия"}, ${booking.date.split("-").reverse().join(".")}, ${booking.start}–${booking.end}`;
        if (!window.confirm(`Удалить бронирование «${description}»?`)) return;
        mutationInFlight.current = true;
        try {
            await deletion.mutateAsync({ id: booking.id, date: booking.date });
            setEditingBooking((current) => current?.id === booking.id ? undefined : current);
        } catch {
            // The mutation error is displayed next to the booking; keep its draft intact.
        } finally {
            mutationInFlight.current = false;
        }
    }

    return (
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:py-16">
            <header className="mb-7 sm:mb-9">
                <div className="mb-5 h-1 w-12 rounded-full bg-accent" aria-hidden="true" />
                <h1 className="mb-4 text-[clamp(1.65rem,4vw,2.25rem)] leading-tight font-bold tracking-tight">Бронирование переговорной</h1>
                <p className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-strong">
                    <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
                    Рабочее время: 09:00–18:00
                </p>
            </header>

            <DemoScenarios disabled={isBusy} />

            <div className="grid items-start gap-5 md:grid-cols-[250px_minmax(0,1fr)] md:gap-6">
                <section className="min-w-0 rounded-2xl border border-frame bg-white p-5 shadow-sm sm:p-6" aria-label="Выбор даты">
                    <div className="flex flex-col gap-3">
                        <label htmlFor="booking-date" className="text-sm font-semibold text-accent-strong">Дата</label>
                        <input
                            className="block min-h-12 w-full min-w-0 rounded-lg border border-input bg-white px-3 py-2.5 font-medium transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus"
                            id="booking-date"
                            type="date"
                            aria-describedby="booking-date-help"
                            value={date}
                            disabled={isBusy}
                            onChange={(event) => {
                                if (isBusy || mutationInFlight.current) return;
                                setEditingBooking(undefined);
                                deletion.reset();
                                setDate(event.target.value);
                            }}
                        />
                        <p id="booking-date-help" className="text-sm leading-relaxed text-muted">Выберите день, чтобы посмотреть расписание.</p>
                    </div>
                </section>

                <div className="min-w-0 space-y-5 md:space-y-6">
                    <BookingForm
                        key={editingBooking?.id ?? "new"}
                        date={date}
                        bookings={bookings}
                        isLoading={isPending || isFetching}
                        isError={isError}
                        isSaving={isSaving}
                        isDeleting={deletion.isPending}
                        booking={editingBooking}
                        onSave={saveBooking}
                        onCancel={() => {
                            if (isBusy || mutationInFlight.current) return;
                            setEditingBooking(undefined);
                            editTrigger.current?.focus();
                        }}
                    />
                    <section className="min-w-0 rounded-2xl border border-frame bg-white shadow-sm" aria-labelledby="bookings-heading">
                        <div className="border-b border-divider px-5 py-5 sm:px-6">
                            <h2 id="bookings-heading" className="text-lg font-semibold">Бронирования на день</h2>
                        </div>

                        {!validDate ? (
                            <p className="px-6 py-16 text-center text-sm leading-relaxed text-muted" role="status">Выберите дату, чтобы посмотреть бронирования.</p>
                        ) : (
                            <>
                                {isPending && (
                                    <div className="flex min-h-52 flex-col items-center justify-center gap-4 px-6 py-12 text-center text-sm text-muted" role="status">
                                        <span className="size-7 rounded-full border-2 border-blue-100 border-t-accent motion-safe:animate-spin" aria-hidden="true" />
                                        <p>Загрузка бронирований…</p>
                                    </div>
                                )}
                                {isError && (
                                    <div className="m-5 rounded-xl border border-error-border bg-error-surface p-5 text-sm leading-relaxed text-error sm:m-6" role="alert">
                                        <p className="mb-3">{isRefetchError
                                            ? "Не удалось обновить список бронирований. Попробуйте ещё раз."
                                            : error instanceof BookingApiError ? error.message : "Не удалось загрузить бронирования. Проверьте соединение и попробуйте ещё раз."}</p>
                                        <button
                                            className="min-h-11 cursor-pointer rounded-lg bg-accent px-4 py-2 font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-65"
                                            type="button"
                                            disabled={isFetching}
                                            onClick={() => void refetch()}
                                        >
                                            {isFetching ? "Повторяем запрос…" : "Повторить"}
                                        </button>
                                    </div>
                                )}
                                {isFetching && !isPending && <p className="border-b border-blue-100 bg-accent-soft px-6 py-3 text-sm text-accent-strong" role="status">Обновление бронирований…</p>}
                                {bookings && bookings.length === 0 && !isError && (
                                    <div className="flex min-h-52 flex-col items-center justify-center gap-4 px-6 py-12 text-center text-sm leading-relaxed text-muted" role="status">
                                        <span className="flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent" aria-hidden="true">
                                            <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                                <rect x="4" y="5" width="16" height="16" rx="2" />
                                                <path d="M8 3v4M16 3v4M4 11h16M9 16h6" />
                                            </svg>
                                        </span>
                                        <p>На выбранную дату бронирований нет.</p>
                                    </div>
                                )}
                                {bookings && bookings.length > 0 && (
                                    <ul className="divide-y divide-divider" aria-label="Бронирования по времени" aria-busy={isFetching}>
                                        {bookings.map((booking) => (
                                            <li key={booking.id} className="flex flex-col items-start gap-3 px-5 py-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-5 sm:px-6">
                                                <div className="shrink-0 rounded-lg bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-strong tabular-nums">
                                                    <time dateTime={`${booking.date}T${booking.start}`}>{booking.start}</time>
                                                    <span aria-hidden="true"> — </span>
                                                    <time dateTime={`${booking.date}T${booking.end}`}>{booking.end}</time>
                                                </div>
                                                <span className="min-w-0 flex-1 text-sm leading-relaxed font-medium wrap-anywhere">{booking.title?.trim() || "Без названия"}</span>
                                                <div className="flex w-full flex-wrap gap-2 lg:w-auto">
                                                    <button
                                                        type="button"
                                                        disabled={isBusy}
                                                        aria-pressed={editingBooking?.id === booking.id}
                                                        onClick={(event) => {
                                                            if (isBusy || mutationInFlight.current) return;
                                                            editTrigger.current = event.currentTarget;
                                                            setEditingBooking(booking);
                                                        }}
                                                        className="min-h-11 shrink-0 cursor-pointer rounded-lg border border-input px-3 py-2 text-sm font-semibold text-accent-strong transition-colors hover:bg-accent-soft focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                        Редактировать
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={isBusy}
                                                        onClick={() => { void removeBooking(booking); }}
                                                        className="min-h-11 cursor-pointer rounded-lg border border-error-border px-3 py-2 text-sm font-semibold text-error transition-colors hover:bg-error-surface focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                        {deletion.isPending && deletion.variables?.id === booking.id ? "Удаление…" : "Удалить"}
                                                    </button>
                                                </div>
                                                {deletion.isError && deletion.variables?.id === booking.id && (
                                                    <p className="w-full text-sm text-error" role="alert">
                                                        {deletion.error instanceof BookingApiError ? deletion.error.message : "Не удалось удалить бронирование. Проверьте соединение и попробуйте ещё раз."}
                                                    </p>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        )}
                    </section>
                </div>
            </div>
        </main>
    );
}
