// PROTOTYPE — throwaway. Variant A: classic wizard — ONE step on screen,
// a progress rail on top, Back / Next at the bottom. Prefilled setups open
// on the first unanswered step (or the last one when everything is set).
import { useState } from "react";
import { cn } from "~/lib/utils";
import ProtoStepBody from "./proto-step-body";
import ProtoStartButton from "./proto-start-button";
import { firstOpenStep } from "./match-setup-logic";
import type { ProtoVariantProps } from "./proto-variant-props";

export const VARIANT_A_NAME = "Wizard, one step at a time";

export default function VariantAWizard(p: ProtoVariantProps) {
    const [index, setIndex] = useState(() =>
        Math.min(firstOpenStep(p.steps), p.steps.length - 1)
    );
    const i = Math.min(index, p.steps.length - 1);
    const step = p.steps[i];
    const isLast = i === p.steps.length - 1;

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <ol className="flex flex-wrap gap-1">
                {p.steps.map((s, k) => (
                    <li key={s.key} className="flex-1">
                        <button
                            type="button"
                            disabled={k > firstOpenStep(p.steps)}
                            onClick={() => setIndex(k)}
                            className={cn(
                                "w-full border-t-2 pt-1 text-left text-[10px] uppercase tracking-wide disabled:cursor-not-allowed",
                                k === i
                                    ? "border-accent text-text"
                                    : s.summary
                                      ? "border-parchment/50 text-text-muted"
                                      : "border-[var(--hairline)] text-text-disabled"
                            )}
                        >
                            {k + 1}. {s.title}
                        </button>
                    </li>
                ))}
            </ol>
            <section className="rounded-[var(--panel-radius)] border border-border-strong bg-surface/80 p-4">
                <h2 className="mb-3 font-display text-xl text-parchment">
                    {step.title}
                </h2>
                <ProtoStepBody step={step.key} {...p} />
            </section>
            <div className="flex items-center justify-between">
                <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => setIndex(i - 1)}
                    className="text-sm text-text-muted disabled:opacity-30"
                >
                    ← Back
                </button>
                {isLast ? (
                    <ProtoStartButton ready={p.ready} onStart={p.onStart} />
                ) : (
                    <ProtoStartButton
                        ready={step.summary !== null}
                        onStart={() => setIndex(i + 1)}
                        label="Next →"
                    />
                )}
            </div>
        </div>
    );
}
