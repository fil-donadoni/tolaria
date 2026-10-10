// PROTOTYPE — throwaway. Shared state + first-visit/returning toggle + toast.
import { useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import {
    FIRST_VISIT,
    RETURNING,
    SOURCES,
    selectable,
    sourceOf,
    typeLabel,
    type EventType,
    type PackSource,
    type SetupState,
} from "./setup-data";

export interface SetupApi {
    s: SetupState;
    source: PackSource;
    set: (patch: Partial<SetupState>) => void;
    setType: (t: EventType) => void;
    create: () => void;
}

export default function SetupFrame({
    children,
}: {
    children: (api: SetupApi) => ReactNode;
}) {
    const [visit, setVisit] = useState<"first" | "returning">("first");
    const [s, setS] = useState<SetupState>(FIRST_VISIT);
    const [toast, setToast] = useState<string | null>(null);

    const pickVisit = (v: "first" | "returning") => {
        setVisit(v);
        setS(v === "first" ? FIRST_VISIT : RETURNING);
    };
    const set = (patch: Partial<SetupState>) =>
        setS((p) => ({ ...p, ...patch }));
    const setType = (type: EventType) =>
        setS((p) => {
            const next = { ...p, type };
            if (!selectable(sourceOf(p.sourceId), type))
                next.sourceId =
                    SOURCES.find((x) => selectable(x, type))?.id ?? p.sourceId;
            return next;
        });
    const source = sourceOf(s.sourceId);
    const create = () => {
        setToast(
            `Event created (mock): ${typeLabel(s.type)} · ${source.name} · ${s.seats} seats`
        );
        window.setTimeout(() => setToast(null), 2800);
    };

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
            <header className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h1 className="font-display text-3xl leading-none text-parchment">
                        New Limited event
                    </h1>
                    <p className="mt-1 text-xs text-text-muted">
                        Everything is preset — change only what you care about.
                    </p>
                </div>
                <div
                    role="radiogroup"
                    aria-label="Simulated visit"
                    className="inline-flex overflow-hidden rounded-sm border border-fuchsia-600/60 text-[11px] font-semibold"
                >
                    {(["first", "returning"] as const).map((v) => (
                        <button
                            key={v}
                            type="button"
                            role="radio"
                            aria-checked={visit === v}
                            onClick={() => pickVisit(v)}
                            className={cn(
                                "px-2.5 py-1",
                                visit === v
                                    ? "bg-fuchsia-600 text-white"
                                    : "bg-fuchsia-950/40 text-fuchsia-200"
                            )}
                        >
                            {v === "first" ? "First visit" : "Returning"}
                        </button>
                    ))}
                </div>
            </header>
            {children({ s, source, set, setType, create })}
            {toast && (
                <div
                    role="status"
                    className="fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md rounded-[var(--panel-radius)] border border-accent/60 bg-surface-elevated px-4 py-3 text-sm text-parchment shadow-xl"
                >
                    {toast}
                </div>
            )}
        </div>
    );
}
