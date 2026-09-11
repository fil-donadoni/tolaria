import { SCENARIO_PHASES } from "@convex/debugScenarioSpec";
import { DEBUG_INPUT_CLASS } from "./debug-form-styles";
import DebugCardNameField from "./debug-card-name-field";
import type { SeatPairDraft, SpecDraft } from "./scenario-draft";
import {
    type ScenarioSpecFieldInput,
    FORM_OWNED_SCENARIO_SPEC_KEYS,
    SCENARIO_SEATS,
    SCENARIO_SPEC_FIELD_INPUT,
    scenarioSpecFieldLabels,
} from "./scenario-spec-ownership";

/** The `SpecDraft` fields each rendering branch reads. The casts below are the
 *  loop's one unchecked step — `SCENARIO_SPEC_FIELD_INPUT[key]` narrows on
 *  `kind`, which does not narrow `key` — and what makes them safe is the
 *  `ScenarioSpecFieldInputFor` pin in `scenario-spec-ownership.ts`: a row whose
 *  `kind` disagrees with its draft field's TYPE reds `tsc` there. */
type TextDraftKey = Exclude<
    {
        [K in keyof SpecDraft]: SpecDraft[K] extends string ? K : never;
    }[keyof SpecDraft],
    "phase"
>;
type BooleanDraftKey = {
    [K in keyof SpecDraft]: SpecDraft[K] extends boolean ? K : never;
}[keyof SpecDraft];
type SeatPairDraftKey = {
    [K in keyof SpecDraft]: SpecDraft[K] extends SeatPairDraft ? K : never;
}[keyof SpecDraft];

/**
 * The SPEC-LEVEL knobs of the scenario save form — one input per
 * `form-owned` field of `ScenarioSpec` (issue #3463).
 *
 * It renders by ITERATING `FORM_OWNED_SCENARIO_SPEC_KEYS` rather than by
 * spelling out a fixed list of JSX rows: the classification table
 * (`scenario-spec-ownership.ts`) is then the only place a spec field has to be
 * named, and a field classified `form-owned` cannot be left unrendered — `tsc`
 * demands its row in `SCENARIO_SPEC_FIELD_INPUT`, the row makes this loop
 * render it, and `__tests__/scenario-spec-fields.test.tsx` asserts the
 * aria-labels the row derives are in the document. Before this, "the form
 * renders an input for it" was a claim in a doc comment.
 *
 * Per-seat fields (`poison` / `life` / `experience`) render as the me/opp pair
 * the spec's own `{ me?, opp? }` shape already has. Pure/controlled — the
 * parent owns the draft.
 */
export default function DebugScenarioSpecFields({
    draft,
    onPatch,
}: {
    draft: SpecDraft;
    onPatch: (patch: Partial<SpecDraft>) => void;
}) {
    // `SCENARIO_PHASES` is what the form OFFERS, not what a stored row may
    // hold: `specFromState` (`convex/gre/scenarioBuilder.ts`) lowers the live
    // `Phase` verbatim, so a board captured mid-first-strike-damage arrives
    // carrying a step the offer list omits. A `<select>` with no matching
    // `<option>` renders as the blank first entry, which reads as "no phase
    // set" and invites an admin to overwrite a value that was there — so the
    // loaded value is always among the options.
    const phaseOptions: readonly string[] =
        draft.phase === "" ||
        (SCENARIO_PHASES as readonly string[]).includes(draft.phase)
            ? SCENARIO_PHASES
            : [draft.phase, ...SCENARIO_PHASES];

    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {FORM_OWNED_SCENARIO_SPEC_KEYS.map((key) => {
                // Widened on purpose: the table is `as const`, so a row
                // without `min` would otherwise make `input.min` a type error
                // on the union rather than an absent optional.
                const input: ScenarioSpecFieldInput =
                    SCENARIO_SPEC_FIELD_INPUT[key];
                const labels = scenarioSpecFieldLabels(key);
                switch (input.kind) {
                    // The card repeater owns `cards` and carries its own
                    // per-row labels — nothing spec-level to render.
                    case "cards":
                        return null;
                    case "number": {
                        const field = key as TextDraftKey;
                        return (
                            <label
                                key={key}
                                className="flex items-center gap-1 text-text-muted"
                            >
                                {input.label}
                                <input
                                    type="number"
                                    min={input.min}
                                    value={draft[field]}
                                    aria-label={labels[0]}
                                    onChange={(e) =>
                                        onPatch({ [field]: e.target.value })
                                    }
                                    className={`${DEBUG_INPUT_CLASS} w-16`}
                                />
                            </label>
                        );
                    }
                    case "phase":
                        return (
                            <label
                                key={key}
                                className="flex items-center gap-1 text-text-muted"
                            >
                                {input.label}
                                <select
                                    value={draft.phase}
                                    aria-label={labels[0]}
                                    onChange={(e) =>
                                        onPatch({ phase: e.target.value })
                                    }
                                    className={DEBUG_INPUT_CLASS}
                                >
                                    <option value="">—</option>
                                    {phaseOptions.map((p) => (
                                        <option key={p} value={p}>
                                            {p}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        );
                    case "boolean": {
                        const field = key as BooleanDraftKey;
                        return (
                            <label
                                key={key}
                                className="flex items-center gap-1 text-text-muted"
                            >
                                <input
                                    type="checkbox"
                                    checked={draft[field]}
                                    aria-label={labels[0]}
                                    onChange={(e) =>
                                        onPatch({ [field]: e.target.checked })
                                    }
                                />
                                {input.label}
                            </label>
                        );
                    }
                    case "per-seat": {
                        const field = key as SeatPairDraftKey;
                        const pair = draft[field];
                        return (
                            <span
                                key={key}
                                className="flex items-center gap-1 text-text-muted"
                            >
                                {input.label}
                                {SCENARIO_SEATS.map((seat, i) => (
                                    <label
                                        key={seat}
                                        className="flex items-center gap-0.5 text-[10px] text-text-disabled"
                                    >
                                        {seat}
                                        <input
                                            type="number"
                                            min={input.min}
                                            value={pair[seat]}
                                            aria-label={labels[i]}
                                            onChange={(e) =>
                                                onPatch({
                                                    [field]: {
                                                        ...pair,
                                                        [seat]: e.target.value,
                                                    },
                                                })
                                            }
                                            className={`${DEBUG_INPUT_CLASS} w-14`}
                                        />
                                    </label>
                                ))}
                            </span>
                        );
                    }
                    case "companion":
                        // CR 702.139c / ADR 0064 — a companion is a CARD name,
                        // so it gets the same catalogue autocomplete a card row
                        // does; the slot's seat and the "already used" state sit
                        // beside it.
                        return (
                            <span
                                key={key}
                                className="flex items-center gap-1 text-text-muted"
                            >
                                {input.label}
                                <DebugCardNameField
                                    value={draft.companion.name}
                                    onChange={(name) =>
                                        onPatch({
                                            companion: {
                                                ...draft.companion,
                                                name,
                                            },
                                        })
                                    }
                                    ariaLabel={labels[0]}
                                    source="cards"
                                    placeholder="Companion…"
                                />
                                <select
                                    value={draft.companion.owner}
                                    aria-label={labels[1]}
                                    onChange={(e) =>
                                        onPatch({
                                            companion: {
                                                ...draft.companion,
                                                owner: e.target
                                                    .value as SpecDraft["companion"]["owner"],
                                            },
                                        })
                                    }
                                    className={DEBUG_INPUT_CLASS}
                                >
                                    {SCENARIO_SEATS.map((seat) => (
                                        <option key={seat} value={seat}>
                                            {seat}
                                        </option>
                                    ))}
                                </select>
                                <label className="flex items-center gap-0.5 text-[10px] text-text-disabled">
                                    <input
                                        type="checkbox"
                                        checked={draft.companion.used}
                                        aria-label={labels[2]}
                                        onChange={(e) =>
                                            onPatch({
                                                companion: {
                                                    ...draft.companion,
                                                    used: e.target.checked,
                                                },
                                            })
                                        }
                                    />
                                    used
                                </label>
                            </span>
                        );
                }
            })}
        </div>
    );
}
