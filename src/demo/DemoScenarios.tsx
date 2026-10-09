import { useSyncExternalStore } from "react";
import { demoScenarios } from "./scenarios.ts";

export function DemoScenarios({ disabled }: { disabled: boolean }) {
    const conflictEnabled = useSyncExternalStore(demoScenarios.subscribe, demoScenarios.getConflictOnNextSave);

    return (
        <details className="mb-5 rounded-2xl border border-frame bg-white p-5 shadow-sm sm:mb-6 sm:p-6">
            <summary className="cursor-pointer rounded text-sm font-semibold text-accent-strong focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus">
                Демо-сценарии
            </summary>
            <label className="mt-4 flex items-start gap-3 text-sm font-medium">
                <input
                    type="checkbox"
                    role="switch"
                    checked={conflictEnabled}
                    disabled={disabled}
                    onChange={(event) => demoScenarios.setConflictOnNextSave(event.target.checked)}
                    aria-describedby="demo-conflict-help"
                    className="mt-0.5 size-5 shrink-0 cursor-pointer accent-accent focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus disabled:cursor-not-allowed"
                />
                Конфликт при следующем сохранении
            </label>
            <p id="demo-conflict-help" className="mt-2 text-sm leading-relaxed text-muted">
                При следующем корректном сохранении выбранное время займёт другой участник. Переключатель выключится автоматически.
            </p>
        </details>
    );
}
