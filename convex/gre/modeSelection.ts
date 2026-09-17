// Mode cardinality on the announce-time mode list (ADR 0094, CR 700.2).
//
// Pure, JSON-in / JSON-out: every reader of a `ModeSelection` — the server
// validating an announcement, the client sizing the mode picker before any
// mutation is called, the Bot enumerating moves — goes through these helpers
// with the board facts it can see, so none of them executes card code.

import type {
    ModeCountCondition,
    ModeSelection,
    TargetRequirement,
    TargetSelection,
} from "../cards/types";
import type { PermanentFilter } from "../cards/filters";

/** The board / cost facts a conditional count reads at announcement. */
export interface ModeSelectionFacts {
    /** Whether the announcing player controls a permanent matching `filter`. */
    controls: (filter: PermanentFilter) => boolean;
    /** Whether the cast is kicked (CR 601.4 — the kicker decision may be
     *  considered while choosing modes). */
    kicked: boolean;
}

/** The resolved bounds of one announcement. */
export interface ModeBounds {
    min: number;
    max: number;
    repeats: boolean;
}

/** Absent `modeSelection` — exactly one mode, every pre-ADR-0094 card. */
const EXACTLY_ONE: ModeBounds = { min: 1, max: 1, repeats: false };

function conditionHolds(
    condition: ModeCountCondition,
    facts: ModeSelectionFacts
): boolean {
    if ("controls" in condition) return facts.controls(condition.controls);
    return facts.kicked;
}

/** Resolves a mode list's cardinality against the announcement's facts. A
 *  holding `when` REPLACES the base bounds. */
export function modeSelectionBounds(
    selection: ModeSelection | undefined,
    facts: ModeSelectionFacts
): ModeBounds {
    if (!selection) return EXACTLY_ONE;
    const repeats = selection.repeats === true;
    if (selection.when && conditionHolds(selection.when.condition, facts)) {
        return { min: selection.when.min, max: selection.when.max, repeats };
    }
    return { min: selection.min, max: selection.max, repeats };
}

/** The largest mode count a selection can ever reach, whatever the board —
 *  the static question the catalogue guard and the dispatch ask. */
export function maxModeCount(selection: ModeSelection | undefined): number {
    if (!selection) return 1;
    return Math.max(selection.max, selection.when?.max ?? 0);
}

/** CR 608.2c / 700.2d — a modal spell's instructions are followed in the
 *  order WRITTEN, and a mode chosen N times is "treated as if that mode
 *  appeared that many times in sequence". Sorts the picks into mode-
 *  declaration order (repeats consecutive); click order carries no meaning.
 *  Unknown ids sort last, so the validator still sees and rejects them. */
export function normalizeChosenModeIds(
    modes: readonly { id: string }[],
    ids: readonly string[]
): string[] {
    const rank = (id: string): number => {
        const i = modes.findIndex((m) => m.id === id);
        return i < 0 ? modes.length : i;
    };
    return [...ids].sort((a, b) => rank(a) - rank(b));
}

/** Why an announced mode list is illegal (CR 700.2a / 700.2d / 609.3), or
 *  `undefined` when it is a legal announcement: an empty list, an unknown id, a
 *  repeat the list does not allow, or a count outside the resolved bounds.
 *  `isModeLegal` answers CR 700.2a's "a mode that would be illegal can't be
 *  chosen" and is consulted only to size a SHORTFALL: when fewer legal modes
 *  exist than `min`, CR 609.3 ("does only as much as possible") lets the
 *  controller announce with as many as can be chosen. A chosen mode that is
 *  itself illegal is rejected by the per-group target validation that follows,
 *  exactly as for a single mode.
 *
 *  The non-throwing core of {@link validateChosenModeIds}, so the Bot's move
 *  enumerator ({@link announceableModeCombinations}) asks the SAME question the
 *  server does instead of a copy of it. */
export function chosenModeIdsViolation(args: {
    modes: readonly { id: string }[];
    selection: ModeSelection | undefined;
    ids: readonly string[] | undefined;
    facts: ModeSelectionFacts;
    isModeLegal: (modeId: string) => boolean;
    ownerName: string;
}): string | undefined {
    const { modes, selection, facts, isModeLegal, ownerName } = args;
    const ids = args.ids ?? [];
    if (ids.length === 0) {
        return "Modal spell — must choose a mode at announcement";
    }
    for (const id of ids) {
        if (!modes.some((m) => m.id === id)) {
            return `Unknown mode id "${id}" for ${ownerName}`;
        }
    }
    const bounds = modeSelectionBounds(selection, facts);
    if (!bounds.repeats && new Set(ids).size !== ids.length) {
        return `${ownerName} — the same mode can't be chosen more than once (CR 700.2d)`;
    }
    if (ids.length > bounds.max) {
        return `${ownerName} — at most ${bounds.max} mode(s) may be chosen`;
    }
    if (ids.length < bounds.min) {
        const legal = modes.filter((m) => isModeLegal(m.id)).length;
        // With repeats one legal mode fills every slot; without, each slot
        // needs a distinct legal mode.
        const reachable = bounds.repeats ? (legal > 0 ? bounds.min : 0) : legal;
        if (ids.length < Math.min(bounds.min, reachable)) {
            return `${ownerName} — at least ${bounds.min} mode(s) must be chosen`;
        }
    }
    return undefined;
}

/** Validates and normalises an announced mode list — throws
 *  {@link chosenModeIdsViolation}'s message on an illegal one. Returns the ids
 *  in printed order. */
export function validateChosenModeIds(args: {
    modes: readonly { id: string }[];
    selection: ModeSelection | undefined;
    ids: readonly string[] | undefined;
    facts: ModeSelectionFacts;
    isModeLegal: (modeId: string) => boolean;
    ownerName: string;
}): string[] {
    const violation = chosenModeIdsViolation(args);
    if (violation !== undefined) throw new Error(violation);
    return normalizeChosenModeIds(args.modes, args.ids ?? []);
}

/** Every mode list `args` could legally announce (CR 700.2a / 700.2d / 609.3),
 *  each in printed order, sizes ascending — the mode-combination level of the
 *  Bot's two-level cast enumeration (issue #2265).
 *
 *  Deliberately UNCAPPED: the space is small (C(4,2) = 6 for "choose two" of
 *  four, the 3-of-3 multiset of three modes is 10) and it is the level that
 *  must never be cut — a dropped combination deletes a whole line of play from
 *  the search's view, where a dropped target tuple only thins one. The target
 *  level below it is what gets budgeted.
 *
 *  Legality is {@link chosenModeIdsViolation}, the server's own question, so a
 *  list offered here is one the announcement accepts. A list naming a mode with
 *  no legal target is still offered; the target enumeration yields no tuple
 *  for it, exactly as for a single illegal mode. Absent `selection` yields one
 *  single-mode list per mode, in printed order — the pre-ADR-0094 shape. */
export function announceableModeCombinations(args: {
    modes: readonly { id: string }[];
    selection: ModeSelection | undefined;
    facts: ModeSelectionFacts;
    isModeLegal: (modeId: string) => boolean;
    ownerName: string;
}): string[][] {
    const { modes, selection, facts } = args;
    const bounds = modeSelectionBounds(selection, facts);
    const out: string[][] = [];
    // Non-decreasing mode indices: distinct (strictly increasing) without
    // repeats, a multiset with them — either way printed order by construction.
    const extend = (prefix: number[], from: number, size: number) => {
        if (prefix.length === size) {
            const ids = prefix.map((i) => modes[i].id);
            if (chosenModeIdsViolation({ ...args, ids }) === undefined) {
                out.push(ids);
            }
            return;
        }
        for (let i = from; i < modes.length; i++) {
            extend([...prefix, i], bounds.repeats ? i : i + 1, size);
        }
    };
    for (let size = 1; size <= bounds.max; size++) extend([], 0, size);
    return out;
}

/** The shape of a mode that declares targets — `SpellMode` and `AbilityMode`
 *  both satisfy it (an ability mode has no additional groups). */
export interface TargetedMode {
    id: string;
    targetRequirement?: TargetRequirement;
    additionalTargetRequirements?: TargetRequirement[];
}

/** One independent target group of an announcement, tagged with the mode
 *  INSTANCE (index into the chosen ids) that owns it. */
export interface ModeTargetGroup {
    requirement: TargetRequirement;
    instance: number;
}

/** CR 601.2c / 700.2c — the chosen instances' target groups, flattened in
 *  printed order: per instance, its `targetRequirement` then its
 *  `additionalTargetRequirements` (the #1953 group mechanism). A mode with no
 *  targets contributes no group. */
export function modeInstanceTargetGroups(
    modes: readonly TargetedMode[],
    chosenModeIds: readonly string[]
): ModeTargetGroup[] {
    return chosenModeIds.flatMap((id, instance) => {
        const mode = modes.find((m) => m.id === id);
        if (!mode) return [];
        return [
            ...(mode.targetRequirement ? [mode.targetRequirement] : []),
            ...(mode.additionalTargetRequirements ?? []),
        ].map((requirement) => ({ requirement, instance }));
    });
}

/** One mode instance at resolution, with the slice of the flat target list
 *  it owns — its script reads `{ target: 0 }` as its OWN first target. */
export interface ModeInstance {
    modeId: string;
    targets: (TargetSelection | undefined)[];
}

/** Splits a stack item's flat `targets` into per-instance slices using the
 *  stored `modeTargetCounts` (ADR 0094). One instance owns the whole list
 *  (offset 0 — the pre-ADR-0094 behaviour). More than one instance with no
 *  spans, or spans that do not cover the list, is an engine error: guessing a
 *  zero would hand one mode another mode's targets. */
export function modeInstances(
    chosenModeIds: readonly string[],
    modeTargetCounts: readonly number[] | undefined,
    targets: readonly (TargetSelection | undefined)[]
): ModeInstance[] {
    if (chosenModeIds.length === 1) {
        return [{ modeId: chosenModeIds[0], targets: [...targets] }];
    }
    if (!modeTargetCounts || modeTargetCounts.length !== chosenModeIds.length) {
        throw new Error(
            `Modal item with ${chosenModeIds.length} mode instances carries no per-instance target spans (modeTargetCounts)`
        );
    }
    let offset = 0;
    const instances = chosenModeIds.map((modeId, i) => {
        const span = modeTargetCounts[i];
        const slice = targets.slice(offset, offset + span);
        offset += span;
        return { modeId, targets: slice };
    });
    if (offset !== targets.length) {
        throw new Error(
            `modeTargetCounts cover ${offset} targets but the item carries ${targets.length}`
        );
    }
    return instances;
}

/** A completed target group's picks, credited to the mode instance that owns
 *  it (ADR 0094): shifts the group off `groupModeInstances` and adds `picks` to
 *  that instance's `modeTargetCounts` span. A no-op for a selection that did
 *  not announce several instances. Mutates `pt`. */
export function recordModeTargetGroup(
    pt: { groupModeInstances?: number[]; modeTargetCounts?: number[] },
    picks: number
): void {
    if (!pt.groupModeInstances || !pt.modeTargetCounts) return;
    const [instance, ...rest] = pt.groupModeInstances;
    if (instance === undefined) return;
    const counts = [...pt.modeTargetCounts];
    counts[instance] += picks;
    pt.modeTargetCounts = counts;
    pt.groupModeInstances = rest.length > 0 ? rest : undefined;
}

/** The earlier picks a group's `excludePriorTargets` ("another target", CR
 *  115.3) may exclude: with several mode instances, only the picks of the
 *  instance that owns the group — CR 700.2d lets a DIFFERENT instance choose
 *  the same object. Call after `recordModeTargetGroup`. */
export function priorTargetsOfSameModeInstance<T>(
    pt: { groupModeInstances?: number[]; modeTargetCounts?: number[] },
    priorSelected: readonly T[]
): readonly T[] {
    const next = pt.groupModeInstances?.[0];
    if (next === undefined || !pt.modeTargetCounts) return priorSelected;
    const span = pt.modeTargetCounts[next] ?? 0;
    return priorSelected.slice(priorSelected.length - span);
}

/** The one chosen mode id when exactly one instance was announced, else
 *  undefined — for a reader that reconstructs ONE requirement per item and
 *  must fail open (skip) rather than apply mode 1's requirement to mode 2's
 *  targets. */
export function soleChosenModeId(
    chosenModeIds: readonly string[] | undefined
): string | undefined {
    return chosenModeIds?.length === 1 ? chosenModeIds[0] : undefined;
}

/** The announcement-domain mode fields (ADR 0094), copied as a pair at every
 *  hand-off (pendingTarget → pendingCast / pendingActivation → stack item) so
 *  the per-instance target spans can never be dropped while the ids ride on.
 *  Spread it: absent fields stay absent. */
export function announcedModeFields(src: {
    chosenModeIds?: readonly string[];
    modeTargetCounts?: readonly number[];
}): { chosenModeIds?: string[]; modeTargetCounts?: number[] } {
    return {
        ...(src.chosenModeIds && src.chosenModeIds.length > 0
            ? { chosenModeIds: [...src.chosenModeIds] }
            : {}),
        ...(src.modeTargetCounts
            ? { modeTargetCounts: [...src.modeTargetCounts] }
            : {}),
    };
}
