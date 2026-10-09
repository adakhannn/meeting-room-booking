// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BookingForm } from "../src/features/bookings/BookingForm.tsx";
import type { BookingInput } from "../src/features/bookings/types.ts";

const today = "2026-10-09";
const tomorrow = "2026-10-10";
const closedMessage = "Сегодня уже нельзя разместить бронирование на 30 минут. Выберите другой день.";
const onSave = vi.fn(async (input: BookingInput) => ({ ...input, id: "saved" }));
const props = {
    date: today, bookings: [], isLoading: false, isError: false, isSaving: false, isDeleting: false,
    onSave, onCancel: vi.fn(),
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 9, 9, 8));
    onSave.mockClear();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function fields() {
    return {
        start: screen.getByLabelText("Время начала") as HTMLInputElement,
        end: screen.getByLabelText("Время окончания") as HTMLInputElement,
        save: screen.getByRole("button", { name: "Забронировать" }) as HTMLButtonElement,
    };
}

function fill(start: string, end: string) {
    fireEvent.change(fields().start, { target: { value: start } });
    fireEvent.change(fields().end, { target: { value: end } });
}

async function submit() {
    await act(async () => { fireEvent.submit(screen.getByRole("form")); });
}

test.each([
    [8, 59, 59, 0, "09:00", "09:30", false],
    [9, 0, 0, 0, "09:00", "09:30", false],
    [9, 0, 1, 0, "09:01", "09:31", false],
    [10, 15, 0, 0, "10:15", "10:45", false],
    [10, 15, 0, 1, "10:16", "10:46", false],
    [10, 15, 20, 0, "10:16", "10:46", false],
    [17, 29, 59, 0, "17:30", "18:00", false],
    [17, 30, 0, 0, "17:30", "18:00", false],
    [17, 30, 0, 1, "17:30", "18:00", true],
    [18, 0, 0, 0, "17:30", "18:00", true],
    [23, 59, 59, 0, "17:30", "18:00", true],
] as const)("sets local time limits at %i:%i:%i.%i", (hour, minute, second, ms, minStart, minEnd, closed) => {
    vi.setSystemTime(new Date(2026, 9, 9, hour, minute, second, ms));
    render(<BookingForm {...props} />);
    const { start, end, save } = fields();
    expect([start.min, start.max, start.step]).toEqual([minStart, "17:30", "60"]);
    expect([end.min, end.max, end.step]).toEqual([minEnd, "18:00", "60"]);
    expect(start.disabled).toBe(closed);
    expect(end.disabled).toBe(closed);
    expect(save.disabled).toBe(closed);
    expect(Boolean(screen.queryByText(closedMessage))).toBe(closed);
});

test("links interval limits, allows arbitrary minutes, and avoids ranges crossing midnight", () => {
    render(<BookingForm {...props} date={tomorrow} />);
    fill("10:17", "11:03");
    expect(fields().start.max).toBe("10:33");
    expect(fields().end.min).toBe("10:47");
    expect(fields().start.validity.valid).toBe(true);
    expect(fields().end.validity.valid).toBe(true);
    fill("17:30", "18:00");
    expect(fields().start.max).toBe("17:30");
    expect(fields().end.min).toBe("18:00");
    fill("18:00", "09:00");
    expect(fields().start.min <= fields().start.max).toBe(true);
    expect(fields().end.min <= fields().end.max).toBe(true);
    fill("", "");
    expect(fields().start.max).toBe("17:30");
    expect(fields().end.min).toBe("09:30");
});

test.each([
    [9, 0, "09:00", "09:30"],
    [10, 15, "10:17", "10:47"],
    [17, 30, "17:30", "18:00"],
] as const)("saves a valid interval at %i:%i including arbitrary minutes and workday boundaries", async (hour, minute, start, end) => {
    vi.setSystemTime(new Date(2026, 9, 9, hour, minute));
    render(<BookingForm {...props} />);
    fill(start, end);
    await submit();
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ date: today, title: "", start, end });
});

test("still validates against actual submission time before the next timer tick", async () => {
    vi.setSystemTime(new Date(2026, 9, 9, 10, 15));
    render(<BookingForm {...props} />);
    fill("10:15", "10:45");
    vi.setSystemTime(new Date(2026, 9, 9, 10, 15, 0, 1));
    await submit();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Нельзя бронировать прошедшее время.");
    expect(fields().start.min).toBe("10:16");
    expect(fields().start.value).toBe("10:15");
    expect(fields().end.value).toBe("10:45");
});

test("blocks direct submission after the last start time even before a timer update", async () => {
    vi.setSystemTime(new Date(2026, 9, 9, 17, 30));
    render(<BookingForm {...props} />);
    fill("17:30", "18:00");
    vi.setSystemTime(new Date(2026, 9, 9, 17, 30, 0, 1));
    await submit();
    expect(onSave).not.toHaveBeenCalled();
    expect(fields().save.disabled).toBe(true);
    expect(screen.getByText(closedMessage)).toBeDefined();
});

test("timer updates the minimum and closes today's booking window without discarding the draft", () => {
    vi.setSystemTime(new Date(2026, 9, 9, 17, 29));
    const view = render(<BookingForm {...props} />);
    fill("17:30", "18:00");
    expect(fields().start.min).toBe("17:29");
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(fields().start.min).toBe("17:30");
    expect(fields().save.disabled).toBe(false);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(fields().save.disabled).toBe(true);
    expect(fields().start.value).toBe("17:30");
    expect(fields().end.value).toBe("18:00");
    view.rerender(<BookingForm {...props} date={tomorrow} />);
    expect(fields().save.disabled).toBe(false);
    expect(fields().start.min).toBe("09:00");
    expect(screen.queryByText(closedMessage)).toBeNull();
});

test.each(["focus", "visibilitychange"])("refreshes the clock on %s after returning to the tab", (event) => {
    vi.setSystemTime(new Date(2026, 9, 9, 10, 15));
    render(<BookingForm {...props} />);
    vi.setSystemTime(new Date(2026, 9, 9, 10, 16, 20));
    if (event === "focus") fireEvent.focus(window);
    else {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
        fireEvent(document, new Event("visibilitychange"));
    }
    expect(fields().start.min).toBe("10:17");
    expect(fields().end.min).toBe("10:47");
});

test("handles local midnight and removes the timer when unmounted", () => {
    vi.setSystemTime(new Date(2026, 9, 9, 23, 59, 59));
    const view = render(<BookingForm {...props} />);
    expect(fields().save.disabled).toBe(true);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByText("На прошедшую дату нельзя создать бронирование.")).toBeDefined();
    view.rerender(<BookingForm {...props} date={tomorrow} />);
    expect(fields().start.min).toBe("09:00");
    expect(fields().save.disabled).toBe(false);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
});
