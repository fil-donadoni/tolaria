// PROTOTYPE — throwaway. Variant B: one progressive page — every step is a
// section in a single column; a step unlocks when the one above is answered;
// answered steps collapse to a one-line summary you can re-open. A sticky
// bar at the bottom carries the recap and Start.
import { useState } from "react";
import { cn } from "~/lib/utils";
import ProtoStepBody from "./proto-step-body";
import ProtoStartButton from "./proto-start-button";
import { firstOpenStep, type StepKey } from "./match-setup-logic";
import type { ProtoVariantProps } from "./proto-variant-props";

export const VARIANT_B_NAME = "One page, steps unlock as you go";

export default function VariantBScroll(p: ProtoVariantProps) {
    const [reopened, setReopened] = useState<StepKey | null>(null);
    const open = firstOpenStep(p.steps);

    return (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 pb-20">
            {p.steps.map((s, k) => {
                const locked = k > open;
                const expanded = !locked && (k === open || reopened === s.key);
                return (
                    <section
                        key={s.key}
                        className={cn(
                            "rounded-[var(--panel-radius)] border bg-surface/80 px-4 py-3",
                            expanded
                                ? "border-border-strong"
                                : "border-[var(--hairline)]",
                            locked && "opacity-40"
                        )}
                    >
                        <button
                            type="button"
                            disabled={locked}
                            onClick={() =>
                                setReopened(reopened === s.key ? null : s.key)
                            }
                            className="flex w-full items-baseline justify-between text-left"
                        >
                            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                                {k + 1}. {s.title}
                            </span>
                            {s.summary && !expanded && (
                                <span className="text-sm text-parchment">
                                    {s.summary} ·{" "}
                                    <span className="text-xs text-text-muted">
                                        change
                                    </span>
                                </span>
                            )}
                        </button>
                        {expanded && (
                            <div className="mt-3">
                                <ProtoStepBody
                                    step={s.key}
                                    {...p}
                                    update={(patch) => {
                                        p.update(patch);
                                        setReopened(null);
                                    }}
                                />
                            </div>
                        )}
                    </section>
                );
            })}
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--hairline)] bg-surface-base/95 px-4 py-2 backdrop-blur">
                <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
                    <span className="truncate text-xs text-text-muted">
                        {p.steps.map((s) => s.summary ?? "…").join(" · ")}
                    </span>
                    <ProtoStartButton ready={p.ready} onStart={p.onStart} />
                </div>
            </div>
        </div>
    );
}
