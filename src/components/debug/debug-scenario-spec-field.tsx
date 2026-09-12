import { SCENARIO_PHASES } from "@convex/debugScenarioSpec";
import { DEBUG_INPUT_CLASS } from "./debug-form-styles";
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

/** The chrome every knob shares: the field's own name, at the form's readable
 *  size and full-contrast (issue #3494 — every label in here was
 *  `text-text-muted` at 10-11px, so a label and a disabled value read the
 *  same). */
const FIELD_CLASS = "flex items-center gap-1.5 text-xs text-text";
/** The me/opp sub-label inside a per-seat pair — one contrast step down from
 *  the field name, never two. */
const SEAT_CLASS = "flex items-center gap-1 text-xs text-text-muted";

/**
 * ONE spec-level knob of the scenario save form (issue #3494, extracted from
 * `debug-scenario-spec-fields.tsx` when that file grew a second group).
 *
 * Which knobs exist, what each renders and which group it renders in are all
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
                <label className={FIELD_CLASS}>
                    {input.label}
                    <input
                        type="number"
                        min={input.min}
                        value={draft[field]}
                        aria-label={labels[0]}
                        onChange={(e) => onPatch({ [field]: e.target.value })}
                        className={`${DEBUG_INPUT_CLASS} w-16`}
                    />
                </label>
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
                <label className={FIELD_CLASS}>
                    {input.label}
                    <select
                        value={draft.phase}
                        aria-label={labels[0]}
                        onChange={(e) => onPatch({ phase: e.target.value })}
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
        }
        case "seat": {
            const field = fieldKey as SeatDraftKey;
            return (
                <label className={FIELD_CLASS}>
                    {input.label}
                    <select
                        value={draft[field]}
                        aria-label={labels[0]}
                        onChange={(e) =>
                            onPatch({
                                [field]: e.target
                                    .value as SpecDraft[SeatDraftKey],
                            })
                        }
                        className={DEBUG_INPUT_CLASS}
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
                </label>
            );
        }
        case "boolean": {
            const field = fieldKey as BooleanDraftKey;
            return (
                <label className={FIELD_CLASS}>
                    <input
                        type="checkbox"
                        checked={draft[field]}
                        aria-label={labels[0]}
                        onChange={(e) => onPatch({ [field]: e.target.checked })}
                        className="size-4"
                    />
                    {input.label}
                </label>
            );
        }
        case "per-seat": {
            const field = fieldKey as SeatPairDraftKey;
            const pair = draft[field];
            return (
                <span className={FIELD_CLASS}>
                    {input.label}
                    {SCENARIO_SEATS.map((seat, i) => (
                        <label key={seat} className={SEAT_CLASS}>
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
        case "per-seat-flag": {
            // Issue #3450 — the flag pair. No blank state: the builder CLEARS
            // all three before seeding, so an unchecked box and an absent field
            // are the same board, which is what lets two checkboxes stand in
            // for a tri-state.
            const field = fieldKey as SeatFlagPairDraftKey;
            const pair = draft[field];
            return (
                <span className={FIELD_CLASS}>
                    {input.label}
                    {SCENARIO_SEATS.map((seat, i) => (
                        <label key={seat} className={SEAT_CLASS}>
                            {seat}
                            <input
                                type="checkbox"
                                checked={pair[seat]}
                                aria-label={labels[i]}
                                onChange={(e) =>
                                    onPatch({
                                        [field]: {
                                            ...pair,
                                            [seat]: e.target.checked,
                                        },
                                    })
                                }
                                className="size-4"
                            />
                        </label>
                    ))}
                </span>
            );
        }
        case "companion":
            // CR 702.139c / ADR 0064 — a companion is a CARD name, so it gets
            // the same catalogue autocomplete a card row does; the slot's seat
            // and the "already used" state sit beside it.
            return (
                <span className={FIELD_CLASS}>
                    {input.label}
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
                    <label className={SEAT_CLASS}>
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
                            className="size-4"
                        />
                        used
                    </label>
                </span>
            );
    }
}
