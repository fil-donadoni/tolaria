// Target-choice requirements (CR 601.2c) — "while an opponent is choosing
// targets ..., that player must choose at least one Flagbearer if able".
//
// CR 601.2c: "If any effects say that an object or player must be chosen as a
// target, the player chooses targets so that they obey the maximum possible
// number of such effects without violating any rules or effects that say that
// an object or player can't be chosen as a target."
//
// The positive twin of `permanentGuard.ts`: that module answers "this object
// CAN'T be chosen", this one answers "one of THESE objects MUST be". Same
// live-query model (CR 611 — a continuous effect applies only while its source
// is on the battlefield, which is exactly the iteration set below), same
// single-authority discipline: the narrowed set computed here is what the
// server ACCEPTS (`applyOneTargetSelection`, `game.ts`), what the Bot is
// OFFERED (`enumerateMoves` / `legalActions`), and what the client renders as
// clickable — the last two through `PendingTarget.requiredTargetChoiceIds`,
// which `refreshRequiredTargetChoiceIds` writes from this same derivation.
//
// WHY the ids are carried on the pending selection rather than re-derived on
// the client: ADR 0074 — the client is a view. The narrowing depends on the
// WHOLE announcement (which slots are still to come, what earlier groups
// already chose), so a client re-derivation is a second implementation of the
// rule that can disagree with the server's. The same argument
// `announcedTargetRoles` (`gre/state.ts`) records for its own announcement-time
// derivation.
//
// Scope (CR 601.2c reads "as part of casting a spell or activating an
// ability"): a CAST or an ABILITY activation is bound; a TRIGGERED ability
// choosing its targets as it goes on the stack (CR 603.3d) is not, and neither
// is changing the targets of a spell already on the stack (CR 115.7 / 707.10c)
// — no one is casting or activating anything there. `resolvePendingTargetKind`
// is the single place that classifies a `PendingTarget`, so the gate below
// cannot drift from the rest of the engine's reading of `kind`.

import { findPermanent } from "./lookup";
import type {
    PermanentFilter,
    StaticEffect,
    TargetRequirement,
    TargetSelection,
} from "../cards/types";
import { matchesPermanentFilter } from "../cards/filters";
import { tryGetDefinition } from "../cards";
import { resolvePendingTargetKind } from "./constants";
import { effectivePermanentView } from "./permanentView";
import { requirementFromPendingTarget } from "./pendingTargetOrigin";
import {
    getLegalTargets,
    pendingTargetingSource,
    type TargetingSource,
} from "./rules";
import { resolveTargetRequirementCount } from "./state";
import type { GameState, PendingTarget } from "./state";

/** One active CR 601.2c requirement binding a particular chooser. */
export interface ActiveTargetChoiceRequirement {
    /** Identity for DEDUP (see `activeTargetChoiceRequirements`): two sources
     *  imposing the same requirement impose it ONCE. */
    key: string;
    /** Oracle text of the clause (informational — why a pick was narrowed). */
    oracleText: string;
    /** Objects that SATISFY the requirement. */
    filter: PermanentFilter;
    /** Controller of the permanent whose clause this is (CR 109.4) — the
     *  reference point every `controllerRelation` in `filter` reads. */
    sourceControllerId: string;
    /** The source permanent's instance id, for a `filter` that excludes or
     *  names its own source. */
    sourceInstanceId: string;
}

/** Every CR 601.2c requirement that binds `chooserId` right now.
 *
 *  Walks every battlefield (a requirement binds the OPPONENTS of its source's
 *  controller, so it is never found on the chooser's own side, but the scan is
 *  symmetric like `isGuardedAgainst`'s) and reads each permanent's card
 *  definition live, so a source leaving the battlefield drops its requirement
 *  with no bookkeeping (CR 611.2).
 *
 *  DEDUP is by clause identity — `binds` plus the `filter` — not by source.
 *  Three Flagbearers on the battlefield are three copies of ONE requirement
 *  ("choose at least one Flagbearer"), and choosing a single Flagbearer obeys
 *  all three; counting them as three would make `unsatisfied.length` say the
 *  chooser has to spend three slots. */
export function activeTargetChoiceRequirements(
    state: GameState,
    chooserId: string
): ActiveTargetChoiceRequirement[] {
    const byKey = new Map<string, ActiveTargetChoiceRequirement>();
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            const effects: readonly StaticEffect[] | undefined =
                def?.staticEffects;
            if (!effects) continue;
            for (const effect of effects) {
                if (effect.kind !== "target-choice-requirement") continue;
                // CR 601.2c — `binds: "opponents"` is the Flagbearer wording
                // ("while an OPPONENT is choosing targets"): the source's own
                // controller is free.
                if (source.controllerId === chooserId) continue;
                const key = JSON.stringify({
                    binds: effect.binds,
                    filter: effect.filter,
                });
                if (byKey.has(key)) continue;
                byKey.set(key, {
                    key,
                    oracleText: effect.oracleText,
                    filter: effect.filter,
                    sourceControllerId: source.controllerId,
                    sourceInstanceId: source.id,
                });
            }
        }
    }
    return [...byKey.values()];
}

/** Does `target` satisfy `req`? Only a battlefield permanent ever can — the
 *  requirement names objects on the battlefield (CR 601.2c via CR 109.2), so a
 *  player, a spell on the stack or a graveyard card never answers one. */
export function satisfiesTargetChoiceRequirement(
    state: GameState,
    req: ActiveTargetChoiceRequirement,
    target: Pick<TargetSelection, "type" | "id">
): boolean {
    if (target.type !== "permanent") return false;
    const card = findPermanent(state, target.id);
    if (!card) return false;
    // The LIVE, layer-materialized characteristics (CR 613): a creature that is
    // a Flagbearer only because of an Aura (Coalition Flag's layer-4
    // `subtype-add`) answers the requirement exactly like a printed one, and a
    // colour/power clause reads its effective value — `effectivePermanentView`
    // is the single authority on that projection.
    return matchesPermanentFilter(
        effectivePermanentView(state, card),
        req.filter,
        {
            selfInstanceId: req.sourceInstanceId,
            selfControllerId: req.sourceControllerId,
            activePlayerId: state.activePlayerId,
        }
    );
}

/** How many FURTHER picks this announcement still owes after the one being
 *  made now (CR 601.2c). A fixed count owes the rest of its slots; a variable
 *  count owes only its `min`, because the chooser may confirm as soon as the
 *  minimum is reached and a slot they can decline is not a slot the
 *  requirement can be deferred to. */
function slotsOwedAfterThisPick(pt: PendingTarget): number {
    const min =
        typeof pt.count === "number" ? pt.count : Math.max(0, pt.count.min);
    return Math.max(0, min - pt.selected.length - 1);
}

/** The CR 601.2c narrowing for the pick being made NOW: the permanent instance
 *  ids the chooser must choose among, or `undefined` when nothing binds this
 *  pick (which is the overwhelmingly common case — no requirement on the
 *  battlefield at all).
 *
 *  The rule, in order:
 *
 *  1. Only a CAST or an ABILITY activation is bound (see the module header).
 *  2. A requirement already obeyed by an earlier pick — of this group or of an
 *     earlier independent group (CR 601.2c: one announcement, one set of
 *     targets) — is satisfied and imposes nothing further.
 *  3. "if able" — a requirement no legal candidate satisfies is dropped, and
 *     when NO unsatisfied requirement can be satisfied by any candidate the
 *     pick is unconstrained.
 *  4. DEFERRAL: while the announcement still owes more slots that could take a
 *     satisfying object, the chooser is free to pick anything now — picking a
 *     non-satisfying object never removes a satisfying one from a later slot's
 *     candidate set, so the requirement can still be obeyed. The narrowing
 *     therefore bites only when the slots left cannot cover the requirements
 *     left (`unsatisfied.length > deferrable`), which for the single
 *     Flagbearer-style requirement means "the last slot that can take one".
 *  5. MAXIMUM POSSIBLE NUMBER: among the candidates, those satisfying the most
 *     unsatisfied requirements at once — CR 601.2c's own tie-break, and the
 *     whole rule when a single pick has to answer several clauses.
 *
 *  What this deliberately does not do: re-order the chooser's freedom for a
 *  VARIABLE-count announcement. `slotsOwedAfterThisPick` counts only the
 *  `min`, so "up to N targets" narrows its FIRST pick rather than its last.
 *  The set of announcements that can be COMPLETED is identical either way
 *  (every legal set contains a satisfying object); only the order in which the
 *  chooser may name them is constrained. Announcing ZERO targets stays legal
 *  and unconstrained — CR 601.2c announces the NUMBER of targets before the
 *  targets, so a chooser who takes no targets violates nothing. */
export function computeRequiredTargetChoiceIds(
    state: GameState,
    pt: PendingTarget
): string[] | undefined {
    const kind = resolvePendingTargetKind(pt.kind);
    if (kind !== "cast" && kind !== "ability") return undefined;
    // ADR 0037 — CR 601.2c binds whoever is CHOOSING, which for a controlled
    // cast (Word of Command) is the acting player, not the seat the selection
    // is filed under. The CANDIDATES are a different question: every other
    // authority (`applyOneTargetSelection`, `targetActions`) derives the legal
    // set from `pt.playerId`, and a narrowed set computed against a different
    // `controller: "you"` reference point than the accepted set is the ADR 0068
    // divergence in miniature — so the two ids are kept apart on purpose.
    const chooserId = pt.actingPlayerId ?? pt.playerId;
    const candidateSeatId = pt.playerId;
    const requirements = activeTargetChoiceRequirements(state, chooserId);
    if (requirements.length === 0) return undefined;

    const chosen = [...(pt.priorSelected ?? []), ...pt.selected];
    const unsatisfied = requirements.filter(
        (req) =>
            !chosen.some((t) => satisfiesTargetChoiceRequirement(state, req, t))
    );
    if (unsatisfied.length === 0) return undefined;

    const candidates = legalCandidatesForCurrentSlot(
        state,
        pt,
        candidateSeatId
    );
    const scored = candidates.map((target) => ({
        target,
        score: unsatisfied.filter((req) =>
            satisfiesTargetChoiceRequirement(state, req, target)
        ).length,
    }));
    const best = scored.reduce((max, c) => Math.max(max, c.score), 0);
    // CR 601.2c "if able" — no candidate obeys anything, so nothing is barred.
    if (best === 0) return undefined;

    if (
        unsatisfied.length <=
        deferrableSlots(state, pt, candidateSeatId, unsatisfied)
    )
        return undefined;

    return scored.filter((c) => c.score === best).map((c) => c.target.id);
}

/** The legal targets for the slot being chosen now — the SAME offered set
 *  `getLegalTargets` computes for the Bot's enumerator and for the client's
 *  clickability, so a narrowed set can never contain a target the rest of the
 *  engine considers illegal. */
function legalCandidatesForCurrentSlot(
    state: GameState,
    pt: PendingTarget,
    chooserId: string
): TargetSelection[] {
    return getLegalTargets(
        state,
        requirementFromPendingTarget(pt),
        pendingTargetingSource(state, pt.cardInstanceId, pt.kind),
        chooserId,
        pt.chosenX,
        pt.selected
    );
}

/** How many slots AFTER this pick could still take an object satisfying one of
 *  `unsatisfied` (CR 601.2c deferral — see `computeRequiredTargetChoiceIds`
 *  step 4).
 *
 *  A later slot of the CURRENT group counts whenever a satisfying candidate
 *  exists at all: the candidate set of the next slot is this one's minus the
 *  object just picked, so declining to satisfy now leaves the satisfier
 *  available. A queued INDEPENDENT group (CR 601.2c — Fumarole's
 *  creature-then-land walk) counts only when its OWN legal set contains a
 *  satisfier: "target land" cannot be deferred to for a Flagbearer creature,
 *  and counting it would let the whole announcement escape the requirement. */
function deferrableSlots(
    state: GameState,
    pt: PendingTarget,
    chooserId: string,
    unsatisfied: readonly ActiveTargetChoiceRequirement[]
): number {
    const satisfiable = (targets: readonly TargetSelection[]): boolean =>
        targets.some((t) =>
            unsatisfied.some((req) =>
                satisfiesTargetChoiceRequirement(state, req, t)
            )
        );

    let slots = 0;
    const owedHere = slotsOwedAfterThisPick(pt);
    if (
        owedHere > 0 &&
        // CR 601.2c — deferral inside the CURRENT group rests on "picking a
        // non-satisfier never removes a satisfier from a later slot", and a
        // CROSS-SLOT constraint breaks exactly that: under `sameController`
        // (Barrin's Spite's "two target creatures controlled by the same
        // player") the first pick decides the second slot's controller, so
        // deferring can make the requirement unsatisfiable and the whole
        // announcement escapes it. Fail CLOSED — bind here instead.
        !pt.sameController &&
        satisfiable(legalCandidatesForCurrentSlot(state, pt, chooserId))
    )
        slots += owedHere;

    const source = pendingTargetingSource(state, pt.cardInstanceId, pt.kind);
    for (const requirement of pt.remainingRequirements ?? []) {
        // Issue #2365 — `resolveTargetRequirementCount` is the single resolver
        // every count consumer calls, so an `"X"` count is read here exactly as
        // the group itself will read it when the walk reaches it.
        const count = resolveTargetRequirementCount(
            requirement.count,
            pt.chosenX
        );
        const min = typeof count === "number" ? count : Math.max(0, count.min);
        if (min === 0) continue;
        const legal = getLegalTargets(
            state,
            requirement,
            source,
            chooserId,
            pt.chosenX
        );
        if (satisfiable(legal)) slots += min;
    }
    return slots;
}

/** True when `targets` obeys EVERY requirement in `requirements` (CR 601.2c).
 *  ALL, not "the maximum possible number": the caller hands in the
 *  requirements still UNOBEYED, and with more than one of them the conjunction
 *  is the conservative reading — an announcement that obeys only some is
 *  dropped from the Bot's options rather than offered and then refused. Every
 *  shipped clause is the same Flagbearer requirement, which
 *  `activeTargetChoiceRequirements` dedups to exactly one, so the two readings
 *  differ only on a card Magic has never printed. */
export function obeysTargetChoiceRequirements(
    state: GameState,
    requirements: readonly ActiveTargetChoiceRequirement[],
    targets: readonly TargetSelection[]
): boolean {
    return requirements.every((req) =>
        targets.some((t) => satisfiesTargetChoiceRequirement(state, req, t))
    );
}

/** CR 601.2c for ONE target GROUP of a Bot-enumerated announcement — the Bot's
 *  half of this rule.
 *
 *  The Bot does not pick targets one at a time: `enumerateTargetGroupTuples`
 *  (`gre/moves.ts`) builds complete target tuples for a cast or an ability
 *  activation and submits one in a single move, which the server then applies
 *  PICK BY PICK. An enumerated tuple the server rejects half-way through
 *  freezes the Bot exactly as hard as no move at all (`gre-development.md`
 *  § Bot reachability), so this predicate is the per-pick rule
 *  (`computeRequiredTargetChoiceIds`) read as a property of a whole group —
 *  never a second, looser statement of it.
 *
 *  The per-pick rule narrows a slot only when the requirement can no longer be
 *  deferred, which inside one group is the slot at index `minSlots - 1` and
 *  every slot after it. So a group's picks obey the rule exactly when a
 *  satisfying object sits among its first `max(minSlots, 1)` picks — a
 *  satisfier chosen LATER, in an optional slot of an "up to N" group, is one
 *  the server already refused to reach. That asymmetry is the whole reason
 *  this is not a plain "does the tuple contain one" test.
 *
 *  Two escapes, both the per-pick rule's own: `canSatisfyHere` false is
 *  CR 601.2c's "if able" (nothing in this group's legal set obeys), and
 *  `canSatisfyLater` is the deferral a further independent group offers
 *  (`deferrableSlots`). A group that announces NO targets is unconstrained:
 *  CR 601.2c announces the NUMBER of targets before the targets, so a chooser
 *  who takes none has no target choice to constrain. */
export function groupPicksObeyTargetChoice(
    state: GameState,
    requirements: readonly ActiveTargetChoiceRequirement[],
    picks: readonly TargetSelection[],
    minSlots: number,
    opts: { canSatisfyHere: boolean; canSatisfyLater: boolean }
): boolean {
    if (requirements.length === 0) return true;
    if (picks.length === 0) return true;
    if (!opts.canSatisfyHere || opts.canSatisfyLater) return true;
    return obeysTargetChoiceRequirements(
        state,
        requirements,
        picks.slice(0, Math.max(minSlots, 1))
    );
}

/** Can this target group's own legal set answer any of `requirements`? The
 *  Bot-side twin of `deferrableSlots`' satisfiability probe, run over the SAME
 *  `getLegalTargets` offered set the announcement will use.
 *
 *  TWO ROLES, differing on one line — which is why `role` is a required
 *  argument and not a default. As the group's OWN "if able" test (`"here"`), a
 *  group the chooser MAY decline still has picks to constrain the moment they
 *  make one, so its `min: 0` is irrelevant. As the DEFERRAL target of an
 *  earlier group (`"later"`), a group nobody is forced to fill cannot be
 *  deferred to at all — the chooser may simply decline it — exactly as
 *  `deferrableSlots` refuses to count it.
 *
 *  Collapsing the two is a Bot FREEZE, not a nuance: every "up to N" group
 *  (Teferi, Time Raveler's +1) read as unable to obey, so the enumerator
 *  offered tuples whose first pick `applyOneTargetSelection` then threw on,
 *  after `announceCast` had already persisted. */
export function requirementGroupCanSatisfy(
    state: GameState,
    requirements: readonly ActiveTargetChoiceRequirement[],
    requirement: TargetRequirement | undefined,
    source: TargetingSource,
    chooserId: string,
    chosenX: number | undefined,
    role: "here" | "later"
): boolean {
    if (!requirement || requirements.length === 0) return false;
    if (role === "later") {
        const count = resolveTargetRequirementCount(requirement.count, chosenX);
        const min = typeof count === "number" ? count : Math.max(0, count.min);
        if (min === 0) return false;
    }
    return getLegalTargets(state, requirement, source, chooserId, chosenX).some(
        (t) =>
            requirements.some((req) =>
                satisfiesTargetChoiceRequirement(state, req, t)
            )
    );
}

/** Recomputes `PendingTarget.requiredTargetChoiceIds` in place (CR 601.2c).
 *
 *  Called wherever the pending selection is CREATED with a slot to fill or
 *  ADVANCES to one — announcement of a targeted cast, of a targeted activated
 *  ability, each accepted pick, and each hand-off to a further independent
 *  target group. The server never trusts the field it wrote: every pick is
 *  re-derived from this same function at acceptance time
 *  (`applyOneTargetSelection`), so the field is a VIEW of the rule for the
 *  client and the Bot, never its authority. */
export function refreshRequiredTargetChoiceIds(
    state: GameState,
    pt: PendingTarget
): void {
    const ids = computeRequiredTargetChoiceIds(state, pt);
    if (ids === undefined) {
        delete pt.requiredTargetChoiceIds;
        return;
    }
    pt.requiredTargetChoiceIds = ids;
}
