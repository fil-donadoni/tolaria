import { SCENARIO_PHASES } from "@convex/debugScenarioSpec";
import {
    DEBUG_CHECKBOX_CLASS,
    DEBUG_INPUT_CLASS,
    DEBUG_NUMBER_INPUT_CLASS,
    DEBUG_SEAT_SELECT_CLASS,
    DEBUG_WIDE_VALUE_CLASS,
} from "./debug-form-styles";
import DebugCardNameField from "./debug-card-name-field";
import type {
    SeatFlagPairDraft,
    SeatPairDraft,
    SpecDraft,
} from "./scenario-draft";
import {
    type FormOwnedScenarioSpecKey,
    type ScenarioSpecFieldInput,
    SCENARIO_SEATS,
    SCENARIO_SPEC_FIELD_INPUT,
    scenarioSpecFieldLabels,
} from "./scenario-spec-ownership";

/** The `SpecDraft` fields each rendering branch reads. The casts below are the
 *  component's one unchecked step — `SCENARIO_SPEC_FIELD_INPUT[key]` narrows on
 *  `kind`, which does not narrow `key` — and what makes them safe is the
 *  `ScenarioSpecFieldInputFor` pin in `scenario-spec-ownership.ts`: a row whose
 *  `kind` disagrees with its draft field's TYPE reds `tsc` there. */
/** CR 102.1 / 117.1 (issue #3454) — a draft field narrowed to ONE seat plus
 *  the spec's own absent. It is a `<select>`, so it comes out of the free-text
 *  key set below rather than joining it. */
type SeatDraftKey = {
    [K in keyof SpecDraft]: SpecDraft[K] extends "" | "me" | "opp" ? K : never;
}[keyof SpecDraft];
type TextDraftKey = Exclude<
    {
        [K in keyof SpecDraft]: SpecDraft[K] extends string ? K : never;
    }[keyof SpecDraft],
    "phase" | SeatDraftKey
>;
type BooleanDraftKey = {
    [K in keyof SpecDraft]: SpecDraft[K] extends boolean ? K : never;
}[keyof SpecDraft];
type SeatPairDraftKey = {
    [K in keyof SpecDraft]: SpecDraft[K] extends SeatPairDraft ? K : never;
}[keyof SpecDraft];
/** Issue #3450 — the BOOLEAN per-seat pairs (Arboria's qualifying-action
 *  flags, Revolt), two checkboxes rather than two number inputs. */
type SeatFlagPairDraftKey = {
    [K in keyof SpecDraft]: SpecDraft[K] extends SeatFlagPairDraft ? K : never;
}[keyof SpecDraft];

/** The label cell: the field's own name at the form's readable size and
 *  full contrast (issue #3494). `col-start-1` is what makes every field START a
 *  grid row — a single-value field fills only the `me` column, and without it
 *  the next field's label would auto-place into the empty `opp` cell. */
const LABEL_CLASS = "col-start-1 min-w-0 text-xs break-words text-text";

/**
 * ONE spec-level knob of the scenario save form, as one row of its section's
 * label/value grid (issue #3512; extracted from `debug-scenario-spec-fields.tsx`
 * by issue #3494).
 *
 * It returns the row's grid CELLS — a label, then its values — rather than a
 * wrapper, so every value lands in the section grid's own columns: a per-seat
 * pair's `me` input in the `me` column, its `opp` input in the `opp` column,
 * and a single value (number, seat, boolean) in the first value column. That
 * is the whole alignment; a wrapper element would give each row its own
 * columns again.
 *
 * Which knobs exist, what each renders and which section it renders in are all
 * read from the classification table (`scenario-spec-ownership.ts`) — this
 * component only knows how to draw a `kind`. Pure/controlled: the form owns
 * the draft.
 */
export default function DebugScenarioSpecField({
    fieldKey,
    draft,
    onPatch,
}: {
    fieldKey: FormOwnedScenarioSpecKey;
    draft: SpecDraft;
    onPatch: (patch: Partial<SpecDraft>) => void;
}) {
    // Widened on purpose: the table is `as const`, so a row without `min`
    // would otherwise make `input.min` a type error on the union rather than
    // an absent optional.
    const input: ScenarioSpecFieldInput = SCENARIO_SPEC_FIELD_INPUT[fieldKey];
    const labels = scenarioSpecFieldLabels(fieldKey);

    switch (input.kind) {
        // The card repeater owns `cards` and carries its own per-row labels —
        // nothing spec-level to render.
        case "cards":
            return null;
        case "number": {
            const field = fieldKey as TextDraftKey;
            return (
                <>
                    <span className={LABEL_CLASS}>{input.label}</span>
                    <input
                        type="number"
                        min={input.min}
                        value={draft[field]}
                        aria-label={labels[0]}
                        onChange={(e) => onPatch({ [field]: e.target.value })}
                        className={DEBUG_NUMBER_INPUT_CLASS}
                    />
                </>
            );
        }
        case "phase": {
            // `SCENARIO_PHASES` is what the form OFFERS, not what a stored row
            // may hold: `specFromState` (`convex/gre/scenarioBuilder.ts`)
            // lowers the live `Phase` verbatim, so a board captured mid-first-
            // strike-damage arrives carrying a step the offer list omits. A
            // `<select>` with no matching `<option>` renders as the blank first
            // entry, which reads as "no phase set" and invites an admin to
            // overwrite a value that was there — so the loaded value is always
            // among the options.
            const phaseOptions: readonly string[] =
                draft.phase === "" ||
                (SCENARIO_PHASES as readonly string[]).includes(draft.phase)
                    ? SCENARIO_PHASES
                    : [draft.phase, ...SCENARIO_PHASES];
            return (
                <>
                    <span className={LABEL_CLASS}>{input.label}</span>
                    <select
                        value={draft.phase}
                        aria-label={labels[0]}
                        onChange={(e) => onPatch({ phase: e.target.value })}
                        className={`${DEBUG_INPUT_CLASS} ${DEBUG_WIDE_VALUE_CLASS}`}
                    >
                        <option value="">—</option>
                        {phaseOptions.map((p) => (
                            <option key={p} value={p}>
                                {p}
                            </option>
                        ))}
                    </select>
                </>
            );
        }
        case "seat": {
            const field = fieldKey as SeatDraftKey;
            return (
                <>
                    <span className={LABEL_CLASS}>{input.label}</span>
                    <select
                        value={draft[field]}
                        aria-label={labels[0]}
                        onChange={(e) =>
                            onPatch({
                                [field]: e.target
                                    .value as SpecDraft[SeatDraftKey],
                            })
                        }
                        className={DEBUG_SEAT_SELECT_CLASS}
                    >
                        {/* "—" is the spec's own absent, which the builder
                            reads as "leave the base state's turn holder
                            alone". */}
                        <option value="">—</option>
                        {SCENARIO_SEATS.map((seat) => (
                            <option key={seat} value={seat}>
                                {seat}
                            </option>
                        ))}
                    </select>
                </>
            );
        }
        case "boolean": {
            const field = fieldKey as BooleanDraftKey;
            return (
                <>
                    <span className={LABEL_CLASS}>{input.label}</span>
                    <input
                        type="checkbox"
                        checked={draft[field]}
                        aria-label={labels[0]}
                        onChange={(e) => onPatch({ [field]: e.target.checked })}
                        className={DEBUG_CHECKBOX_CLASS}
                    />
                </>
            );
        }
        case "per-seat": {
            const field = fieldKey as SeatPairDraftKey;
            const pair = draft[field];
            return (
                <>
                    <span className={LABEL_CLASS}>{input.label}</span>
                    {SCENARIO_SEATS.map((seat, i) => (
                        <input
                            key={seat}
                            type="number"
                            min={input.min}
                            value={pair[seat]}
                            aria-label={labels[i]}
                            data-seat={seat}
                            onChange={(e) =>
                                onPatch({
                                    [field]: {
                                        ...pair,
                                        [seat]: e.target.value,
                                    },
                                })
                            }
                            className={DEBUG_NUMBER_INPUT_CLASS}
                        />
                    ))}
                </>
            );
        }
        case "per-seat-flag": {
            // Issue #3450 — the flag pair. No blank state: the builder CLEARS
            // all three before seeding, so an unchecked box and an absent field
            // are the same board, which is what lets two checkboxes stand in
            // for a tri-state.
            const field = fieldKey as SeatFlagPairDraftKey;
            const pair = draft[field];
            return (
                <>
                    <span className={LABEL_CLASS}>{input.label}</span>
                    {SCENARIO_SEATS.map((seat, i) => (
                        <input
                            key={seat}
                            type="checkbox"
                            checked={pair[seat]}
                            aria-label={labels[i]}
                            data-seat={seat}
                            onChange={(e) =>
                                onPatch({
                                    [field]: {
                                        ...pair,
                                        [seat]: e.target.checked,
                                    },
                                })
                            }
                            className={DEBUG_CHECKBOX_CLASS}
                        />
                    ))}
                </>
            );
        }
        case "companion":
            // CR 702.139c / ADR 0064 — a companion is a CARD name, so it gets
            // the same catalogue autocomplete a card row does. Two grid rows:
            // the name spans both value columns, and the slot's seat and the
            // "already used" state sit under it in the value columns.
            return (
                <>
                    <span className={LABEL_CLASS}>{input.label}</span>
                    <div className={`${DEBUG_WIDE_VALUE_CLASS} flex`}>
                        <DebugCardNameField
                            value={draft.companion.name}
                            onChange={(name) =>
                                onPatch({
                                    companion: { ...draft.companion, name },
                                })
                            }
                            ariaLabel={labels[0]}
                            source="cards"
                            placeholder="Companion…"
                        />
                    </div>
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
                        className={`${DEBUG_SEAT_SELECT_CLASS} col-start-2`}
                    >
                        {SCENARIO_SEATS.map((seat) => (
                            <option key={seat} value={seat}>
                                {seat}
                            </option>
                        ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-text">
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
                            className={DEBUG_CHECKBOX_CLASS}
                        />
                        used
                    </label>
                </>
            );
    }
}
