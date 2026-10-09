import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { BookingApiError } from "./api.ts";
import type { Booking, BookingInput } from "./types.ts";
import { formatLocalDate, isValidDate } from "./time.ts";
import { validateBooking } from "./validation.ts";

type BookingFormProps = {
    date: string;
    bookings: readonly Booking[] | undefined;
    isLoading: boolean;
    isError: boolean;
    isSaving: boolean;
    isDeleting: boolean;
    booking?: Booking;
    onSave: (input: BookingInput) => Promise<Booking | undefined>;
    onCancel: () => void;
};

const inputClassName = "block min-h-12 w-full min-w-0 rounded-lg border border-input bg-white px-3 py-2.5 text-sm transition-colors placeholder:text-muted hover:border-accent focus-visible:border-accent focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus aria-invalid:border-error";

export function BookingForm({ date, bookings, isLoading, isError, isSaving, isDeleting, booking, onSave, onCancel }: BookingFormProps) {
    const isBusy = isSaving || isDeleting;
    const [today, setToday] = useState(() => formatLocalDate(new Date()));
    const requestInFlight = useRef(false);
    const { register, setValue, handleSubmit, setError, clearErrors, reset, formState: { errors, isSubmitting } } = useForm<BookingInput>({
        defaultValues: { date, title: booking?.title ?? "", start: booking?.start ?? "", end: booking?.end ?? "" },
    });

    useEffect(() => {
        setValue("date", date);
        clearErrors();
    }, [date, setValue, clearErrors]);

    useEffect(() => {
        const updateToday = () => setToday(formatLocalDate(new Date()));
        const timer = window.setInterval(updateToday, 60_000);
        window.addEventListener("focus", updateToday);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", updateToday);
        };
    }, []);

    const validDate = isValidDate(date);
    const pastDate = validDate && date < today;
    const pastDateMessage = booking
        ? "Нельзя сохранить бронирование на прошедшую дату."
        : "На прошедшую дату нельзя создать бронирование.";
    const blockedReason = isDeleting
        ? "Дождитесь завершения удаления."
        : !validDate
        ? "Выберите дату для бронирования."
        : pastDate
          ? pastDateMessage
          : isError
            ? "Бронирование недоступно: не удалось загрузить список. Повторите запрос."
            : isLoading || bookings === undefined
              ? "Дождитесь загрузки списка бронирований."
              : undefined;

    async function onSubmit(values: BookingInput) {
        const now = new Date();
        setToday(formatLocalDate(now));
        // Guard the submit handler as well as the button (e.g. submission with Enter).
        if (requestInFlight.current || isBusy || !validDate || isLoading || isError || bookings === undefined) return;
        clearErrors();
        if (date < formatLocalDate(now)) {
            setError("date", { type: "past_time", message: pastDateMessage });
            return;
        }

        const result = validateBooking({ ...values, date }, bookings, now, booking?.id);
        if (result.valid === false) {
            setError(result.field, { type: result.code, message: result.message }, { shouldFocus: true });
            return;
        }
        requestInFlight.current = true;
        try {
            const saved = await onSave({ ...values, date });
            if (saved) reset({ date, title: "", start: "", end: "" });
        } catch (error) {
            const apiError = error instanceof BookingApiError ? error : undefined;
            setError(apiError?.field ?? "root.server", {
                type: apiError?.code ?? "server",
                message: apiError?.message ?? "Не удалось сохранить бронирование. Проверьте соединение и попробуйте ещё раз.",
            });
        } finally {
            requestInFlight.current = false;
        }
    }

    return (
        <section className="min-w-0 rounded-2xl border border-frame bg-white shadow-sm" aria-labelledby="booking-form-heading">
            <div className="border-b border-divider px-5 py-5 sm:px-6">
                <h2 id="booking-form-heading" className="text-lg font-semibold">{booking ? "Редактирование бронирования" : "Новое бронирование"}</h2>
                <p className="mt-1 text-sm text-muted">
                    {date ? <>На <time dateTime={date}>{date.split("-").reverse().join(".")}</time></> : "Выберите день в поле даты."}
                </p>
                {errors.date && <p id="booking-form-date-error" className="mt-2 text-sm text-error" role="alert">{errors.date.message}</p>}
            </div>

            <form
                className="space-y-5 p-5 sm:p-6"
                aria-labelledby="booking-form-heading"
                noValidate
                aria-busy={isBusy}
                onSubmit={(event) => { void handleSubmit(onSubmit)(event); }}
            >
                <input type="hidden" {...register("date")} />

                <div className="flex flex-col gap-2">
                    <label htmlFor="booking-title" className="text-sm font-semibold">Название <span className="font-normal text-muted">(необязательно)</span></label>
                    <input
                        id="booking-title"
                        type="text"
                        disabled={isBusy}
                        className={inputClassName}
                        placeholder="Например, встреча команды"
                        aria-invalid={Boolean(errors.title)}
                        aria-describedby={errors.title ? "booking-title-error" : undefined}
                        {...register("title")}
                    />
                    {errors.title && <p id="booking-title-error" className="text-sm text-error" role="alert">{errors.title.message}</p>}
                </div>

                <div className="grid gap-5 min-[400px]:grid-cols-2">
                    <div className="flex min-w-0 flex-col gap-2">
                        <label htmlFor="booking-start" className="text-sm font-semibold">Время начала</label>
                        <input
                            id="booking-start"
                            type="time"
                            disabled={isBusy}
                            className={inputClassName}
                            aria-invalid={Boolean(errors.start)}
                            aria-describedby={errors.start ? "booking-start-error" : undefined}
                            {...register("start")}
                        />
                        {errors.start && <p id="booking-start-error" className="text-sm text-error" role="alert">{errors.start.message}</p>}
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                        <label htmlFor="booking-end" className="text-sm font-semibold">Время окончания</label>
                        <input
                            id="booking-end"
                            type="time"
                            disabled={isBusy}
                            className={inputClassName}
                            aria-invalid={Boolean(errors.end)}
                            aria-describedby={errors.end ? "booking-end-error" : undefined}
                            {...register("end")}
                        />
                        {errors.end && <p id="booking-end-error" className="text-sm text-error" role="alert">{errors.end.message}</p>}
                    </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                        type="submit"
                        disabled={Boolean(blockedReason) || isSubmitting || isBusy}
                        aria-describedby={blockedReason ? "booking-submit-help" : undefined}
                        className="min-h-12 w-full cursor-pointer rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                    >
                        {isSaving ? "Сохранение…" : booking ? "Сохранить" : "Забронировать"}
                    </button>
                    {booking && (
                        <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => { if (!isBusy && !requestInFlight.current) onCancel(); }}
                            className="min-h-12 cursor-pointer rounded-lg border border-input px-5 py-2.5 text-sm font-semibold text-accent-strong transition-colors hover:bg-accent-soft focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Отмена
                        </button>
                    )}
                </div>
                {errors.root?.server && <p className="text-sm text-error" role="alert">{errors.root.server.message}</p>}
                {blockedReason && <p id="booking-submit-help" className="text-sm text-muted">{blockedReason}</p>}
            </form>
        </section>
    );
}
