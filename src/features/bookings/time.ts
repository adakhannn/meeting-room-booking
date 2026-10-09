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