// PROTOTYPE — throwaway. Variant C: two panes — a recap rail on the left
// (every step with its current answer, click to edit, Start at its foot),
// the active step's full content on the right. Lands on the first open step.
import { useState } from "react";
import { cn } from "~/lib/utils";
import ProtoStepBody from "./proto-step-body";
import ProtoStartButton from "./proto-start-button";
import { firstOpenStep, type StepKey } from "./match-setup-logic";
import type { ProtoVariantProps } from "./proto-variant-props";

export const VARIANT_C_NAME = "Recap rail + active step";

export default function VariantCSplit(p: ProtoVariantProps) {
    const [active, setActive] = useState<StepKey | null>(null);
    const open = firstOpenStep(p.steps);
    const current =
        p.steps.find((s) => s.key === active) ??
        p.steps[Math.min(open, p.steps.length - 1)];

    return (
        <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
            <aside className="flex flex-col gap-1 rounded-[var(--panel-radius)] border border-border-strong bg-surface/80 p-2">
                {p.steps.map((s, k) => (
                    <button
                        key={s.key}
                        type="button"
                        disabled={k > open}
                        onClick={() => setActive(s.key)}
                        className={cn(
                            "flex flex-col rounded-sm px-2 py-1.5 text-left disabled:opacity-35",
                            s.key === current.key
                                ? "bg-accent/15"
                                : "hover:bg-surface-elevated/40"
                        )}
                    >
                        <span className="text-[10px] uppercase tracking-wide text-text-muted">
                            {k + 1}. {s.title}
                        </span>
                        <span className="truncate text-sm text-parchment">
                            {s.summary ?? "—"}
                        </span>
                    </button>
                ))}
                <div className="mt-2 border-t border-[var(--hairline)] pt-2">
                    <ProtoStartButton ready={p.ready} onStart={p.onStart} />
                </div>
            </aside>
            <section className="rounded-[var(--panel-radius)] border border-border-strong bg-surface/80 p-4">
                <h2 className="mb-3 font-display text-xl text-parchment">
                    {current.title}
                </h2>
                <ProtoStepBody
                    step={current.key}
                    {...p}
                    update={(patch) => {
                        p.update(patch);
                        setActive(null);
                    }}
                />
            </section>
        </div>
    );
}
