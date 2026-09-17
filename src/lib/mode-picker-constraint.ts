// The client half of an announce-time mode list's cardinality (ADR 0094, issue
// #2264): the mode picker opens BEFORE `announceCast` / `activateAbility` is
// called, and the server rejects a modal announcement whose mode count is out of
// bounds — so the picker has to size itself from the same declarative
// `ModeSelection` the server validates against. Every bound comes from the
// shared pure grammar in `convex/gre/modeSelection.ts`; nothing here decides a
// rule the server does not also decide (ADR 0074 — a hint, never authority).

import type {
    ModeSelection,
    TargetRequirement,
    TriggerStateView,
} from "@convex/cards/types";
import type { PlayerState } from "@convex/gre/state";
import {
    modeSelectionBounds,
    normalizeChosenModeIds,
    type ModeSelectionFacts,
} from "@convex/gre/modeSelection";
import { announcementModeFacts } from "@convex/gre/modeAnnouncement";
import type { CardInstance, Player } from "~/types/game";
import { hasBattlefieldTargetCandidate } from "~/lib/card-utils";

/** What the multi-select picker enforces for one announcement. */
export interface ModePickerConstraint {
    /** The resolved bounds (a holding `when` already applied). */
    min: number;
    max: number;
    /** CR 700.2d — the same mode may be picked more than once. */
    repeats: boolean;
    /** The modes that can be chosen at all (CR 700.2a). */
    legalModeIds: readonly string[];
    /** The fewest picks Confirm accepts: `min`, lowered by a CR 609.3
     *  shortfall to what the legal modes can reach — never below one, since
     *  a modal announcement must name a mode. */
    requiredCount: number;
    /** True when `requiredCount` sits below `min` because too few modes are
     *  legal — the picker says so instead of waiting for an unreachable count. */
    shortfall: boolean;
}

/** The shape of a mode the picker judges — `SpellMode` and `AbilityMode`. */
interface PickableMode {
    id: string;
    targetRequirement?: TargetRequirement;
    additionalTargetRequirements?: TargetRequirement[];
}

/** Sizes the picker for a mode list (ADR 0094). The reachable count mirrors
 *  `validateChosenModeIds`: with repeats one legal mode fills every slot,
 *  without them each slot needs a distinct legal mode. */
export function modePickerConstraint(args: {
    modes: readonly PickableMode[];
    selection: ModeSelection | undefined;
    facts: ModeSelectionFacts;
    isModeLegal: (mode: PickableMode) => boolean;
}): ModePickerConstraint {
    const { min, max, repeats } = modeSelectionBounds(
        args.selection,
        args.facts
    );
    const legalModeIds = args.modes
        .filter((m) => args.isModeLegal(m))
        .map((m) => m.id);
    const reachable = repeats
        ? legalModeIds.length > 0
            ? min
            : 0
        : legalModeIds.length;
    const requiredCount = Math.max(1, Math.min(min, reachable));
    return {
        min,
        max,
        repeats,
        legalModeIds,
        requiredCount,
        shortfall: requiredCount < min && legalModeIds.length > 0,
    };
}

/** The board facts a conditional count reads, from the viewer's projected
 *  seat — the SAME `announcementModeFacts` the server validates with, fed the
 *  wire battlefield (which carries every field the permanent filter and the
 *  layer colour read consult). No seat → nothing controlled. */
export function viewerModeSelectionFacts(
    player: Player | undefined,
    kicked: boolean
): ModeSelectionFacts {
    if (!player) return { controls: () => false, kicked };
    return announcementModeFacts(player as unknown as PlayerState, kicked);
}

/** CR 700.2a — "a mode that would be illegal can't be chosen": false only when
 *  some target group of the mode provably has too few candidates on the board.
 *  Delegates to `hasBattlefieldTargetCandidate`, which FAILS OPEN on anything
 *  it cannot judge, so a disabled mode is reliably illegal and the server's
 *  per-group validation stays the authority for the rest. */
export function modeLegalityHint(
    source: CardInstance,
    stateView: TriggerStateView | undefined
): (mode: PickableMode) => boolean {
    return (mode) =>
        [
            ...(mode.targetRequirement ? [mode.targetRequirement] : []),
            ...(mode.additionalTargetRequirements ?? []),
        ].every((req) => hasBattlefieldTargetCandidate(req, source, stateView));
}

/** Per-mode pick counts → the announced id list, in printed order with
 *  repeats consecutive (CR 700.2d), exactly as the server normalises it. */
export function chosenModeIdsFromCounts(
    modes: readonly { id: string }[],
    counts: Readonly<Record<string, number>>
): string[] {
    const ids = modes.flatMap((m) =>
        Array.from({ length: counts[m.id] ?? 0 }, () => m.id)
    );
    return normalizeChosenModeIds(modes, ids);
}

function totalPicks(counts: Readonly<Record<string, number>>): number {
    return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/** Whether one more pick of `modeId` stays inside the constraint. */
export function canAddModePick(
    constraint: ModePickerConstraint,
    counts: Readonly<Record<string, number>>,
    modeId: string
): boolean {
    if (!constraint.legalModeIds.includes(modeId)) return false;
    if (totalPicks(counts) >= constraint.max) return false;
    return constraint.repeats || (counts[modeId] ?? 0) === 0;
}

/** Confirm is enabled once the pick count satisfies the constraint. */
export function canConfirmModePicks(
    constraint: ModePickerConstraint,
    counts: Readonly<Record<string, number>>
): boolean {
    const total = totalPicks(counts);
    return total >= constraint.requiredCount && total <= constraint.max;
}

const COUNT_WORDS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
];

function countWord(n: number): string {
    return COUNT_WORDS[n] ?? String(n);
}

/** The declared constraint as the picker header reads it — "Choose three",
 *  "Choose 1–2" — derived from the selection, never written per card. */
export function modePickerHeading(constraint: ModePickerConstraint): string {
    if (constraint.min === constraint.max) {
        return `Choose ${countWord(constraint.min)}`;
    }
    return `Choose ${constraint.min}–${constraint.max}`;
}

/** The CR 609.3 note shown when fewer modes are legal than the count asks. */
export function modePickerShortfallNote(
    constraint: ModePickerConstraint
): string | undefined {
    if (!constraint.shortfall) return undefined;
    const n = constraint.requiredCount;
    return `Only ${n} mode${n === 1 ? " can" : "s can"} be chosen right now — confirm with ${n}.`;
}
