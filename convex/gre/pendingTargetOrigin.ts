// Who put this `PendingTarget` there? (issue #2283)
//
// `PendingTarget.kind` already discriminates five target-selection flows, but
// nothing in the codebase answered the ONE question the vs-AI bot needs before
// it may touch a live selection: **did the answering player ANNOUNCE this
// selection themselves, or did the engine RAISE it at them?**
//
//   * ANNOUNCED (`"cast"` / `"ability"`) — the player opened the selection with
//     `announceCast` / `activateAbility` and is mid-announcement (CR 601.2c /
//     602.2b). For the bot this is a CONTINUATION its own executor drives
//     atomically inside one `executeMove` sequence: the Move already carries the
//     whole target tuple, and surfacing fresh moves here would let a second
//     decision interleave into a half-built announcement.
//   * RAISED (`"trigger"` / `"retarget"` / `"copy-retarget"`) — the ENGINE
//     opened the selection at the player during resolution (CR 603.3d targeted
//     trigger; CR 115.7 retarget; CR 707.10c copy retarget). Nobody
//     announced anything; the player simply owes an answer, exactly like a
//     `PendingChoice`. Before this module the bot had no way to say so, so
//     `enumerateMoves` surfaced NOTHING and the game froze forever (Flickerwisp,
//     Badgermole Cub, Azure Beastbinder).
//
// The classification is COMPILE-TIME EXHAUSTIVE over `PendingTarget["kind"]`
// (`PENDING_TARGET_ORIGIN` + the `MissingPendingTargetOriginKind` witness), the
// same structural guard `botActionRealisation` gives `BotAction["kind"]`: a
// sixth pending-target kind is a build error here, never a silent hang.
//
// This module is also the SINGLE AUTHORITY for finalizing a raised selection.
// `game.ts`'s `finalizeTargetSelection` (the human/mutation path) and
// `applyMoveInSearch` (the bot's in-tree simulation) both route through
// `applyRaisedTargetFinalization`, so the two can never drift — a second
// hand-written copy in the search would be the classic "the bot simulates a
// different game than the server plays" bug.

import type { GameState, PendingTarget, PendingTargetFilterKey } from "./state";
import {
    PENDING_TARGET_FILTER_KEYS,
    emitBecameTargetEvents,
    resolveTargetRequirementCount,
} from "./state";
import type { TargetRequirement, TargetSelection } from "../cards/types";
import { drainAutoPasses } from "./phases";
import { raiseTriggerTargetSelection } from "./rules";
import { resolvePendingTargetKind } from "./constants";

/** Whether the player who owes a `PendingTarget` opened it themselves
 *  (`"announced"`) or the engine opened it at them (`"raised"`). */
export type PendingTargetOrigin = "announced" | "raised";

/** The census, one row per `PendingTarget["kind"]`.
 *
 *  | producer                                        | kind             | owed by             | origin      |
 *  | ----------------------------------------------- | ---------------- | ------------------- | ----------- |
 *  | `announceCast` (`game.ts`)                      | absent → "cast"  | `args.playerId`     | announced   |
 *  | `activateAbility` (`game.ts`)                   | `"ability"`      | `args.playerId`     | announced   |
 *  | `raiseTriggerTargetSelection` (`rules.ts`)      | `"trigger"`      | `item.controllerId` | raised      |
 *  | `requestRetarget` (`state.ts`)                  | `"retarget"`     | `item.castById`     | raised      |
 *  | `requestCopyRetargetOn` (`state.ts`)            | `"copy-retarget"`| `copy.controllerId` | raised      |
 *
 *  `satisfies Record<…>` is the guard: a kind added to the union cannot compile
 *  until it is classified, and classifying it wrong in the permissive direction
 *  (an announced kind marked `"raised"`) is what would break every existing bot
 *  cast/activation by letting the enumerator surface moves mid-announcement. */
export const PENDING_TARGET_ORIGIN = {
    cast: "announced",
    ability: "announced",
    trigger: "raised",
    retarget: "raised",
    "copy-retarget": "raised",
} as const satisfies Record<
    NonNullable<PendingTarget["kind"]>,
    PendingTargetOrigin
>;

/** Compile-time witness: a `PendingTarget["kind"]` member missing from
 *  {@link PENDING_TARGET_ORIGIN} makes this alias non-`never`, and the
 *  assignment below fails `tsc`. Mirrors `MissingExpectedInputKind`
 *  (`expectedInput.ts`) — a build error, not a runtime hang. */
export type MissingPendingTargetOriginKind = Exclude<
    NonNullable<PendingTarget["kind"]>,
    keyof typeof PENDING_TARGET_ORIGIN
>;
const _pendingTargetOriginExhaustive: [MissingPendingTargetOriginKind] extends [
    never,
]
    ? true
    : never = true;
void _pendingTargetOriginExhaustive;

/** Classify a `PendingTarget.kind`. An ABSENT kind is `"cast"` — resolved by
 *  the SHARED `resolvePendingTargetKind` (`gre/constants.ts`), the one default
 *  `finalizeTargetSelection`, `targetActions`, `pendingTargetingSource` and
 *  the client's targeting gate all read, so the fallback is announced
 *  (fail-CLOSED for the bot: an unclassifiable selection is never touched). */
export function pendingTargetOrigin(
    kind: PendingTarget["kind"]
): PendingTargetOrigin {
    return PENDING_TARGET_ORIGIN[resolvePendingTargetKind(kind)];
}

/** The live `PendingTarget` that `playerId` owes AND did not announce, or
 *  `undefined`. This is the one predicate the bot may act on: a target owed to
 *  the OPPONENT, or one this player is mid-announcing, both return `undefined`. */
export function raisedPendingTargetOwedBy(
    state: GameState,
    playerId: string
): PendingTarget | undefined {
    const pt = state.pendingTarget;
    if (!pt) return undefined;
    if (pt.playerId !== playerId) return undefined;
    if (pendingTargetOrigin(pt.kind) !== "raised") return undefined;
    return pt;
}

/** Lower a live `PendingTarget` back into the `TargetRequirement`
 *  `getLegalTargets` consumes (CR 601.2c). Moved here from `legalActions.ts`
 *  (issue #2283) so the Move enumerator can reuse it without importing
 *  `legalActions` (which imports `moves`, a cycle).
 *
 *  The filter copy is driven by `PENDING_TARGET_FILTER_KEYS` — the
 *  compile-forced key set (ADR 0068 / issue #1956) — never a hand-written list:
 *  a dropped filter makes an enumerator offer a target the accepting site then
 *  rejects, which for the bot means a rejected submission and a fresh freeze.
 *  Only the STRUCTURAL fields stay hand-written (`type` / `count` / `zone` are
 *  not registry filters and `type` is renamed on the `PendingTarget`). */
export function requirementFromPendingTarget(
    pt: PendingTarget
): TargetRequirement {
    const out: Record<string, unknown> = {
        type: pt.targetType,
        count: pt.count,
        ...(pt.zone ? { zone: pt.zone } : {}),
    };
    for (const key of Object.keys(
        PENDING_TARGET_FILTER_KEYS
    ) as PendingTargetFilterKey[]) {
        const value = pt[key];
        if (value !== undefined) out[key] = value;
    }
    // The `PendingTarget` field IS the lowered `TargetRequirement` value for
    // each key by construction (`pendingTargetFiltersFromRequirement` writes
    // `lower()`'s own output), so the deliberately WIDENED `PendingTarget`
    // declarations (`colorFilter?: string` where the requirement says `Color`)
    // carry across unchanged — one cast here instead of a per-key one, which
    // is what let the old hand-written list drift in the first place.
    return out as unknown as TargetRequirement;
}

/** CR 601.2c — has the selection reached its upper bound (so the next pick
 *  auto-finalizes instead of resting for an explicit `confirmTargets`)? A
 *  range with an open `max` never auto-finalizes. Moved here from `game.ts`
 *  (issue #2283) so the Move enumerator can decide whether a submission needs
 *  a trailing `confirmTargets` using the SAME predicate the accepting site
 *  uses — a disagreement means either a stranded half-finished selection or a
 *  `confirmTargets` against a selection that already committed, both of which
 *  the server rejects and both of which re-freeze the bot. */
export function pendingTargetCountMaxReached(
    count: PendingTarget["count"],
    selected: number
): boolean {
    if (typeof count === "number") return selected >= count;
    if (count.max === undefined) return false;
    return selected >= count.max;
}

/** Resolves a divide-as-you-choose total spec against the chosen / derived X
 *  (CR 601.2d / 120.4). `"X"` → X, `"X+1"` → X+1 (Meteor Shower), a number →
 *  the fixed total (Fiery Justice). A missing X is treated as 0. Never
 *  negative. Moved here from `game.ts` (issue #2870) because
 *  `announcedTargetCount` below — the count authority BOTH the announcing
 *  mutation and the Bot's Move enumerator read — needs it to apply CR 601.2d's
 *  cap, and a second copy in the enumerator is exactly the drift this module
 *  exists to prevent. */
export function resolveDivideTotal(
    spec: number | "X" | "X+1",
    chosenX: number | undefined
): number {
    if (typeof spec === "number") return Math.max(0, spec);
    const x = chosenX ?? 0;
    return Math.max(0, spec === "X+1" ? x + 1 : x);
}

/** CR 601.2c / 601.2d — the live `PendingTarget.count` an ANNOUNCEMENT opens
 *  with for ONE target requirement at an announced X, or `undefined` when the
 *  requirement takes no targets at all so no selection is opened:
 *
 *    - a fixed count of 0 (`resolveTargetRequirementCount` collapsing `"X"`
 *      with X = 0 — Sky Diamond-style "destroy X target ..." at X = 0);
 *    - an "up to X" range whose resolved `max` is 0 (Pest Infestation at
 *      X = 0) — CR 601.2c's "as many as you choose, from zero to X" with
 *      nothing to choose from;
 *    - a divide-as-you-choose budget of 0 (Meteor Shower / Fire Covenant at
 *      X = 0) — CR 601.2d, there are no points to divide.
 *
 *  This is the SINGLE AUTHORITY for that derivation, read by both sides of the
 *  announcement (issue #2870):
 *
 *    - `announceCast` (`game.ts`) builds the `PendingTarget` from it, and skips
 *      target selection entirely when it is `undefined`;
 *    - the Bot's Move enumerator (`gre/moves.ts`) reads it to predict whether
 *      its executor's batched `selectTargets` leaves the selection RESTING for
 *      a trailing `confirmTargets`, or whether the last pick already
 *      auto-finalized it (`pendingTargetCountMaxReached` above).
 *
 *  Before the extraction the enumerator approximated the answer as
 *  "the requirement is variable-count AND the tuple is non-empty", which is
 *  wrong at BOTH ends of an "up to N" range: a declined selection (0 chosen —
 *  the only possible answer when the board offers no legal target) sent no
 *  mutation at all and stranded the announcement, and a selection filled to
 *  its max sent a confirm the server rejects because the pick already
 *  finalized it. Both shapes froze the Bot in a cast → cancel → re-cast loop. */
export function announcedTargetCount(
    req: TargetRequirement | undefined,
    chosenX: number | undefined,
    options: { requireX?: boolean } = {}
): number | { min: number; max?: number } | undefined {
    if (!req) return undefined;
    // CR 601.2d / 120.4 — the divide budget caps the target count (each target
    // must receive at least 1 point), and a zero budget means no targets.
    const divideTotal = req.divideAsChosen
        ? resolveDivideTotal(req.divideAsChosen.total, chosenX)
        : undefined;
    if (divideTotal === 0) return undefined;
    let count = resolveTargetRequirementCount(req.count, chosenX, options);
    if (
        divideTotal !== undefined &&
        typeof count === "object" &&
        count.max === undefined
    ) {
        count = { min: count.min, max: divideTotal };
    }
    if (typeof count === "number") return count > 0 ? count : undefined;
    return count.max === 0 ? undefined : count;
}

/** Finalizes the divide-as-you-choose split at commit (CR 601.2d / 120.4).
 *  Uses the chooser's assigned amounts when present and complete; otherwise
 *  auto-divides the total ≥1-each (the "no real choice" / Arena-UX default —
 *  e.g. a single target takes the whole total). The returned map is keyed by
 *  `${type}:${id}` and always sums to `pt.divideTotal`. Moved here from
 *  `game.ts` (issue #2283) alongside the raised-origin finalization it feeds. */
export function finalizeDivideAmounts(
    pt: PendingTarget,
    targets: TargetSelection[]
): Record<string, number> {
    const total = pt.divideTotal ?? 0;
    const assigned = pt.divideAmounts;
    // Use the chooser's split iff every target has a positive amount and the
    // amounts sum to the total (a complete, legal division). Otherwise fall
    // back to an even ≥1-each split.
    if (assigned) {
        let sum = 0;
        let complete = true;
        for (const t of targets) {
            const a = assigned[`${t.type}:${t.id}`] ?? 0;
            if (a < 1) complete = false;
            sum += a;
        }
        if (complete && sum === total) return assigned;
    }
    const out: Record<string, number> = {};
    const n = targets.length;
    const base = Math.floor(total / n);
    let remainder = total - base * n;
    for (const t of targets) {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder -= 1;
        out[`${t.type}:${t.id}`] = base + extra;
    }
    return out;
}

/** Commit a completed ENGINE-RAISED target selection (`"copy-retarget"` /
 *  `"retarget"` / `"trigger"`). Returns `true` when it handled `pt` — an
 *  ANNOUNCED origin returns `false` untouched, leaving `state.pendingTarget`
 *  alone so the caller's cast/ability commit path runs instead.
 *
 *  All three write the chosen targets onto an object ALREADY on the stack and
 *  pay nothing: no card is cast, no cost is charged. That is exactly why the
 *  search can share this function — it needs no mutation machinery, only the
 *  GRE primitives.
 *
 *  SINGLE AUTHORITY: `finalizeTargetSelection` (`game.ts`, the human path) and
 *  `applyMoveInSearch` (`search.ts`, the bot's in-tree simulation) both call
 *  this. */
export function applyRaisedTargetFinalization(
    state: GameState,
    pt: PendingTarget
): boolean {
    const kind = resolvePendingTargetKind(pt.kind);
    if (pendingTargetOrigin(kind) !== "raised") return false;

    // CR 601.2c — a multi-group selection locked earlier groups' picks into
    // `priorSelected`; concatenate in declaration order so the stack item's
    // `targets` are positionally indexable by the Effect Script. (No raised
    // producer queues `remainingRequirements` today, but the concat costs
    // nothing and keeps this identical to the announced path.)
    const targets = [...(pt.priorSelected ?? []), ...pt.selected];
    const divideAmounts =
        pt.divideTotal !== undefined && targets.length > 0
            ? finalizeDivideAmounts(pt, targets)
            : undefined;
    const cardInstanceId = pt.cardInstanceId;
    state.pendingTarget = undefined;

    // Copy-retarget branch (CR 707.10b — Fork's "you may choose new targets
    // for the copy"). The targets are written onto the spell COPY already on
    // the stack; nothing is cast and no cost is paid. After the choice, the
    // resolving spell (Fork) has finished, so a fresh priority round begins
    // with the active player and the copy on top of the stack.
    if (kind === "copy-retarget") {
        const copy = state.stack.find((s) => s.id === cardInstanceId);
        if (copy) copy.targets = targets;
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);
        return true;
    }

    // Retarget branch (CR 115.7 — Reflecting Mirror's "change the target of
    // target spell"). The new target is written onto the ORIGINAL spell already
    // on the stack (not a copy). The resolving Reflecting Mirror ability has
    // finished, so a fresh priority round begins with the active player and the
    // retargeted spell still on the stack.
    if (kind === "retarget") {
        const spell = state.stack.find((s) => s.id === cardInstanceId);
        if (spell) spell.targets = targets;
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);
        return true;
    }

    // Trigger-target branch (CR 603.3d, issue #1193). The chosen target(s) —
    // and the divide-as-you-choose split (Fury's `targetAmounts`) — are written
    // onto the TRIGGERED-ability stack item already on the stack; nothing is
    // cast and no cost is paid. Then chain to the next targeted trigger of the
    // same simultaneous batch (`raiseTriggerTargetSelection`); when none remain,
    // a fresh priority round begins with the active player (CR 117.3d) and the
    // (now fully targeted) triggers still on the stack.
    const trig = state.stack.find((s) => s.id === cardInstanceId);
    if (trig) {
        trig.targets = targets;
        if (divideAmounts) trig.targetAmounts = divideAmounts;
        // CR 603.2b / 603.3d (issue #1265) — a targeted trigger's targets
        // are locked at announcement; fire "becomes the target of an ability"
        // triggers (Leovold) for this trigger's controller.
        // `"triggered-ability"` (issue #2360) — a trigger's targets, chosen by
        // its controller; never a cast spell (CR 603.3d).
        emitBecameTargetEvents(
            state,
            targets,
            trig.controllerId,
            trig.id,
            "triggered-ability"
        );
    }
    // Despite its name this also runs the CR 603.3c MODE announcement for any
    // still-un-announced modal trigger of the batch first (issue #2461).
    if (raiseTriggerTargetSelection(state)) return true;
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
    drainAutoPasses(state);
    return true;
}
