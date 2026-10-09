export function createDemoScenarios() {
    let conflictOnNextSave = false;
    const listeners = new Set<() => void>();

    function setConflictOnNextSave(enabled: boolean) {
        if (conflictOnNextSave === enabled) return;
        conflictOnNextSave = enabled;
        listeners.forEach((listener) => listener());
    }

    return {
        getConflictOnNextSave: () => conflictOnNextSave,
        setConflictOnNextSave,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        consumeConflict() {
            if (!conflictOnNextSave) return false;
            setConflictOnNextSave(false);
            return true;
        },
    };
}

// Only demo settings are shared with the UI; bookings remain behind the API.
export const demoScenarios = createDemoScenarios();
