export function toMinutes(time: string): number {
    const [hours, minutes] = time.split(":").map(Number);

    return hours * 60 + minutes;
}

export function intervalsOverlap(
    start: number,
    end: number,
    otherStart: number,
    otherEnd: number,
): boolean {
    return start < otherEnd && end > otherStart;
}

export function isValidDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

    const date = new Date(`${value}T00:00:00`);
    return (
        !Number.isNaN(date.getTime()) &&
        date.getFullYear() === Number(value.slice(0, 4)) &&
        date.getMonth() + 1 === Number(value.slice(5, 7)) &&
        date.getDate() === Number(value.slice(8, 10))
    );
}

export function formatLocalDate(date: Date): string {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
