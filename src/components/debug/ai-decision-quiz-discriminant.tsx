// "Wrong now" — name the Discriminant (issue #4800, PRD #4792, ADR 0148).
//
// The WHY of a Conditional Verdict: the one factor whose change makes the same
// move right. A closed list of kinds plus `other`, whose words are the judge's
// own — a phrase that recurs under `other` is the kind the list is missing, so
// it is asked for rather than defaulted. The kind's own inputs say HOW the
// copied position changes; the detail is what the fit report counts and prints,
// and is read off the edit when the judge types none.

import { useState } from "react";
import {
    changeFromFields,
    DISCRIMINANT_KINDS,
    DISCRIMINANT_KIND_LABELS,
    discriminantOf,
    initialFields,
    type DiscriminantKind,
} from "~/lib/ai/verdict-pair";
import type { DiscriminantChange } from "@convex/gre/ai/verdicts/pairDerivation";
import type { Discriminant } from "@convex/gre/ai/verdicts/types";
import DebugButton from "./debug-button";
import { DEBUG_INPUT_CLASS } from "./debug-form-styles";
import AiDecisionQuizChangeFields from "./ai-decision-quiz-change-fields";

export type DiscriminantChoice = {
    discriminant: Discriminant;
    change: DiscriminantChange;
};

export default function AiDecisionQuizDiscriminant({
    disabled,
    onChosen,
    onDefer,
    onBack,
}: {
    disabled: boolean;
    /** The judge named a Discriminant and its edit: show the right-hand half. */
    onChosen: (choice: DiscriminantChoice) => void;
    /** Submit the Conditional Verdict now, the half still owed. */
    onDefer: (discriminant: Discriminant) => void;
    onBack: () => void;
}) {
    const [kind, setKind] = useState<DiscriminantKind | null>(null);
    const [fields, setFields] = useState<Record<string, string>>({});
    const [detail, setDetail] = useState("");
    const [problem, setProblem] = useState<string | null>(null);

    const pick = (next: DiscriminantKind) => {
        setKind(next);
        setFields(initialFields(next));
        setProblem(null);
    };

    // Showing the half needs the edit; deferring it needs only the REASON — a
    // judge in the middle of play names why, and the position is built by
    // whoever completes the half (ADR 0148), so a half-typed edit is no
    // obstacle to that.
    const resolve = (deferring: boolean): DiscriminantChoice | null => {
        if (kind === null) return null;
        const change = changeFromFields(kind, fields);
        if (!change.ok && !deferring) {
            setProblem(change.error);
            return null;
        }
        const edit: DiscriminantChange = change.ok
            ? change.value
            : { kind: "other" };
        const named = discriminantOf(kind, detail, edit);
        if (!named.ok) {
            setProblem(named.error);
            return null;
        }
        setProblem(null);
        return { discriminant: named.value, change: edit };
    };

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-label">What changes to make it right?</span>
            <ul className="flex flex-col gap-0.5">
                {DISCRIMINANT_KINDS.map((option) => (
                    <li key={option}>
                        <button
                            type="button"
                            onClick={() => pick(option)}
                            disabled={disabled}
                            aria-pressed={option === kind}
                            className={`w-full rounded-sm border px-1.5 py-1 text-left text-[11px] transition-colors disabled:opacity-50 ${
                                option === kind
                                    ? "border-accent text-accent-strong"
                                    : "border-border-subtle text-text-muted hover:border-accent hover:text-parchment"
                            }`}
                        >
                            {DISCRIMINANT_KIND_LABELS[option]}
                        </button>
                    </li>
                ))}
            </ul>

            {kind !== null && (
                <>
                    <AiDecisionQuizChangeFields
                        kind={kind}
                        fields={fields}
                        disabled={disabled}
                        onChange={(key, value) =>
                            setFields((prev) => ({ ...prev, [key]: value }))
                        }
                    />
                    <label className="flex flex-col gap-0.5 text-[10px] text-text-muted">
                        {kind === "other"
                            ? "In your words: what changes?"
                            : "Detail (optional — read off the change)"}
                        <input
                            type="text"
                            value={detail}
                            disabled={disabled}
                            onChange={(e) => setDetail(e.target.value)}
                            className={DEBUG_INPUT_CLASS}
                        />
                    </label>
                    {problem && (
                        <p className="break-words text-[10px] text-danger-strong">
                            {problem}
                        </p>
                    )}
                    <DebugButton
                        onClick={() => {
                            const choice = resolve(false);
                            if (choice) onChosen(choice);
                        }}
                        disabled={disabled}
                    >
                        Show the right-hand position
                    </DebugButton>
                    <DebugButton
                        onClick={() => {
                            const choice = resolve(true);
                            if (choice) onDefer(choice.discriminant);
                        }}
                        disabled={disabled}
                    >
                        Defer the right-hand half
                    </DebugButton>
                </>
            )}
            <DebugButton onClick={onBack} disabled={disabled}>
                Back
            </DebugButton>
        </div>
    );
}
