/**
 * Shared setup constants and expectation predicates for the blade entries in
 * `scenarios.ts` (issue #5942). Logic lives here, under the ordinary 3-way
 * merge; the entries file is data and merges by union.
 */

import type { BladeScenario, BladeSeat, MoveMatcher } from "./types";
import type { Discriminant } from "../verdicts/types";
import type { GameState } from "../../state";
import type { Move } from "../../moves";
import { enumerateMoves, enumerateRaisedTargetMoves } from "../../moves";
import { applyMoveInSearch, isDiscouragedRolloutMove } from "../../search";
import { raisedPendingTargetOwedBy } from "../../pendingTargetOrigin";
import { cloneGameState } from "../../clone";
import { instanceIdsForName, matchesMove, seatPlayerId } from "./matcher";
import { materialMargin } from "../../evaluate";
import { isLand, manaValue } from "../../constants";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { getCardByName, getInstanceManaCost } from "../../../cards";
import { activationSacrificeVictims } from "../../activationCostPicks";

/** CR 702.34a — five untapped Mountains, exactly Firebolt's {4}{R} flashback
 *  cost, shared by the two halves of the issue-#2971 graveyard-cast pair so the
 *  ONLY difference between them is the zone the Firebolt sits in. Basics rather
 *  than `landCount` because the flashback cost is coloured. */
export const MOUNTAINS_5 = Array.from({ length: 5 }, () => ({
    name: "Mountain",
    owner: "me" as const,
    zone: "battlefield" as const,
    tapped: false,
}));

/** CR 702.49a — exactly Fallen Shinobi's {2}{U}{B} ninjutsu cost. Basics
 *  rather than `landCount` for the same reason {@link MOUNTAINS_5} is: the cost
 *  is coloured, and a generic land count would leave the mana leg unpayable and
 *  the entry silently testing nothing. */
export const NINJUTSU_LANDS_4 = [
    ...Array.from({ length: 2 }, () => ({
        name: "Island",
        owner: "me" as const,
        zone: "battlefield" as const,
        tapped: false,
    })),
    ...Array.from({ length: 2 }, () => ({
        name: "Swamp",
        owner: "me" as const,
        zone: "battlefield" as const,
        tapped: false,
    })),
];

/** Issue #2927 — the `manaDevelopment` term's FLOODED branch, asserted on a
 *  position built through the real `ScenarioSpec` pipeline rather than a
 *  hand-assembled `GameState`.
 *
 *  The scenario is seven untapped Forests against a hand whose curve tops out
 *  at MV 2, plus a 6-MV Craw Wurm sitting in the library. Two readings are
 *  taken of the SAME board, and the entry demands both:
 *
 *   - as built, the hand no longer wants a seventh land, so the marginal land
 *     is priced flat (`permanentWeight + manaWeight`, no development bonus);
 *   - move the Craw Wurm from library to hand — the curve's top end becomes 6,
 *     the board is back on curve — and the SAME land gains exactly
 *     `manaDevWeight`.
 *
 *  It also asserts the position is one the #2686 SUM proxy would have called
 *  ON CURVE (hand mana values sum past the land count): without that, the entry
 *  would be pinning a reading both proxies agree on, and the flooded branch
 *  would still be the unreachable one #2927 found. Zeroing `manaDevWeight`
 *  collapses the two readings into each other and this goes red. */
export function floodedLandEarnsNoDevelopmentBonus(
    _move: Move | null,
    state: GameState
): boolean {
    const pid = seatPlayerId(state, "me");
    const player = state.players.find((p) => p.id === pid);
    if (!player) return false;
    const lands = player.battlefield.filter((c) => isLand(c));
    if (lands.length === 0) return false;
    const handSum = player.hand.reduce(
        (total, c) => total + manaValue(getInstanceManaCost(c)),
        0
    );
    // The #2686 proxy's reading of this position: on curve. If the hand ever
    // stops summing past the board, the entry no longer discriminates.
    if (handSum <= lands.length) return false;

    // The marginal land: this board minus one Forest.
    const marginalLand = (from: GameState): number => {
        const minusOne = cloneGameState(from);
        const p = minusOne.players.find((q) => q.id === pid);
        if (!p) return Number.NaN;
        p.battlefield = p.battlefield.filter((c) => c.id !== lands[0].id);
        return materialMargin(from, pid) - materialMargin(minusOne, pid);
    };

    // A margin-point tolerance rather than `===` (issue #3401): the weights
    // are FITTED now, so the margin accumulates the same two of them in a
    // different order than this sum and the two land one ulp apart. The
    // tolerance is orders of magnitude below every distinction the predicate
    // draws — the two readings it separates differ by `manaDevWeight`.
    const EPS = 1e-6;
    const flat =
        DEFAULT_EVAL_WEIGHTS.permanentWeight + DEFAULT_EVAL_WEIGHTS.manaWeight;
    const flooded = marginalLand(state);
    if (Math.abs(flooded - flat) > EPS) return false;

    // Raise the hand's curve with the Craw Wurm the scenario left in the
    // library (a real instance, so no fabricated card ever enters the state).
    const onCurveState = cloneGameState(state);
    const p = onCurveState.players.find((q) => q.id === pid);
    if (!p) return false;
    const wurmIndex = p.library.findIndex(
        (c) => manaValue(getInstanceManaCost(c)) === 6
    );
    if (wurmIndex === -1) return false;
    p.hand = [...p.hand, p.library[wurmIndex]];
    p.library = p.library.filter((_, i) => i !== wurmIndex);

    // Strictly greater FIRST: tying the delta to `manaDevWeight` alone would
    // be self-referential — zero the weight and `0 === 0` still holds. The two
    // readings must actually differ; the second clause then pins the size.
    const onCurve = marginalLand(onCurveState);
    return (
        onCurve > flooded &&
        Math.abs(onCurve - flooded - DEFAULT_EVAL_WEIGHTS.manaDevWeight) < EPS
    );
}

/** "The dominance pruner (issue #1887) still leaves the bot a cast to make" —
 *  the negative control for a position where the CHOSEN move is not a stable
 *  expectation (holding an instant through your own main phase is legitimate
 *  play, ADR 0021) but the surviving LEGAL SET is. */
export function pruningKeepsACast(
    state: Parameters<typeof enumerateMoves>[0]
): boolean {
    const pid = state.players[0].id;
    return enumerateMoves(state, pid, { pruneDominatedNoOps: true }).some(
        (m) => m.kind === "cast-spell"
    );
}

/** "An 'up to X' cast with NO legal target on the board is EXECUTABLE" — the
 *  liveness guard for issue #2870 (CR 601.2c).
 *
 *  A `{ min: 0, max: X }` requirement on a board offering nothing to target has
 *  exactly one possible answer: zero targets. `selectTargets` rejects an empty
 *  array, so that answer is a confirm-ONLY submission — a cast declaring
 *  `confirmTargets: false` alongside an empty tuple sends NO mutation for its
 *  live `PendingTarget`, the following `tapForPayment` throws against an
 *  expected input of `"target"`, and the announcement strands at an owed target
 *  of ANNOUNCED origin, which the owed-target gate is fail-closed against by
 *  design. The Bot then answers `no-move`, the liveness ladder cancels the
 *  announcement, and the search — whose `applyMove` puts the spell straight on
 *  the stack and never opens a `PendingTarget` — re-picks the identical cast
 *  forever (~10s per cycle in the reported game).
 *
 *  Asserted as a POSITION guard on the LEGAL SET (the `pruningKeepsACast`
 *  shape) rather than as a positive move match, because whether casting a
 *  token-maker this turn is the best play is a matter of opinion while whether
 *  the offered cast can be COMPLETED is not — plus the CHOSEN move, when it is
 *  one of them, must be executable too. */
export function upToXZeroTargetCastIsExecutable(
    move: Move | null,
    state: Parameters<typeof enumerateMoves>[0]
): boolean {
    const pid = state.players[0].id;
    const declined = enumerateMoves(state, pid).filter(
        (m) =>
            m.kind === "cast-spell" &&
            (m.chosenX ?? 0) >= 1 &&
            m.targets.length === 0
    );
    // The position must OFFER the declined-target cast at all — an entry that
    // stopped enumerating it would otherwise pass vacuously.
    if (declined.length === 0) return false;
    if (!declined.every((m) => m.kind === "cast-spell" && m.confirmTargets)) {
        return false;
    }
    return !(
        move?.kind === "cast-spell" &&
        (move.chosenX ?? 0) >= 1 &&
        move.targets.length === 0 &&
        !move.confirmTargets
    );
}

/** "The issue-#1890 reactive-timing discipline is a PREFERENCE, not a filter" —
 *  the weaker, POSITION-level negative control for the activation-timing
 *  entries below: in a window where the activation belongs, it is still
 *  ENUMERATED (the timing rules never touch legality) and carries NO rollout
 *  policy penalty. If items 1-2 ever widen into a mute button, this goes red.
 *
 *  It was, until issue #1920, the STRONGEST thing a blade could assert here.
 *  `applyMoveInSearch` applied an activation's COSTS and never put its effect on
 *  the stack, so in the world the search reasoned about every activation was
 *  pure cost — a Mother of Runes activation tapped a 1/1 and granted nothing.
 *  No blade could make the bot CHOOSE an activation for its payoff, because the
 *  payoff was invisible by construction. (That is also the deeper reason issue
 *  #1890's symptoms existed at all: with no payoff visible, every activation
 *  tied `pass` inside `OUTCOME_EPS` and the pick fell to rollout noise.)
 *
 *  Issue #1920 closed that: the ability now reaches the stack and `policyValue`
 *  resolves it one ply deep. So the blind spot this helper's docstring used to
 *  disclaim — "a change could leave the move enumerated and unpenalised while
 *  making the bot's CHOICE in that window deterministically decline it" — is now
 *  covered by real CHOSEN-MOVE entries in the `activation payoff:` group below,
 *  which is where new coverage of this kind belongs. This predicate is kept for
 *  the positions whose right answer is genuinely a legal-set property rather
 *  than a single best move. */
export function activationStaysAvailable(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const pid = state.players[seat === "me" ? 0 : 1].id;
    const defId = getCardByName(cardName).id;
    const activations = enumerateMoves(state, pid, {
        pruneDominatedNoOps: true,
    }).filter(
        (m) =>
            m.kind === "activate-ability" &&
            state.players.some((p) =>
                p.battlefield.some(
                    (c) =>
                        c.id === m.cardInstanceId &&
                        (c.card as { id?: string }).id === defId
                )
            )
    );
    return (
        activations.length > 0 &&
        activations.every((m) => !isDiscouragedRolloutMove(state, pid, m))
    );
}

/** "An activation whose cost is paid by NAMING CARDS arrives at the executor
 *  already answered" (CR 602.1 / 118.3) — the guard for the tap-a-land-then-
 *  untap-it loop.
 *
 *  Asserted on the POSITION rather than the chosen move, for the same measured
 *  reason as `activationStaysAvailable` above: the search does not put an
 *  activated ability's EFFECT on the stack (issue #1920), so a tutor engine's
 *  payoff is invisible and no blade can make the bot CHOOSE this activation.
 *  What IS assertable — and what actually broke — is that every enumerated
 *  activation carries a legal, complete pick for its deferred cost leg. Without
 *  one the server parks a `pendingActivation` it can never commit, the payment
 *  rolls back, and the identical position re-produces the identical move
 *  forever.
 *
 *  It also asserts the pick is SEARCHED, not fixed: with two different
 *  creatures in hand there must be one variant per creature, or the bot has no
 *  way to express which one it wants to give up. */
export function activationCostPicksArePaid(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const player = state.players[seat === "me" ? 0 : 1];
    const defId = getCardByName(cardName).id;
    const activations = enumerateMoves(state, player.id).filter(
        (m) =>
            m.kind === "activate-ability" &&
            player.battlefield.some(
                (c) =>
                    c.id === m.cardInstanceId &&
                    (c.card as { id?: string }).id === defId
            )
    );
    if (activations.length === 0) return false;
    const picked = new Set<string>();
    for (const move of activations) {
        if (move.kind !== "activate-ability") return false;
        const ids = move.costPicks?.discardIds;
        if (!ids || ids.length !== 1) return false;
        // The named card must really be in hand — a pick the server would
        // reject leaves the activation just as stuck as no pick at all.
        if (!player.hand.some((c) => c.id === ids[0])) return false;
        picked.add(ids[0]);
    }
    return picked.size === activations.length && picked.size >= 2;
}

/** Issue #5161 — `move` activates an ability of a permanent `seat` controls
 *  naming exactly the hand card `cardName` for its discard cost. */
export function activationDiscardsCard(
    state: GameState,
    seat: BladeSeat,
    move: Move | null,
    cardName: string
): boolean {
    if (move?.kind !== "activate-ability") return false;
    const player = state.players[seat === "me" ? 0 : 1];
    const ids = move.costPicks?.discardIds;
    if (!ids || ids.length !== 1) return false;
    const named = player.hand.find((c) => c.id === ids[0]);
    return (
        named !== undefined &&
        (named.card as { id?: string }).id === getCardByName(cardName).id
    );
}

/** Every permanent each enumerated activation of `cardName` would actually
 *  sacrifice, plus the source's own instance id (issue #2297).
 *
 *  Reads `activationSacrificeVictims` rather than `move.costPicks.sacrificeIds`
 *  because the two differ in exactly the case that matters: when the board
 *  leaves no real choice, the server auto-resolves the victim at announcement
 *  (`autoResolveFungible`) and it never appears in the submission list at all.
 *  Asserting on `sacrificeIds` would report "no victim" for the position where
 *  the source is the ONLY victim — a vacuous pass. */
function enumeratedSacrificeVictims(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): { sourceId: string; victims: string[][] } | null {
    const player = state.players[seat === "me" ? 0 : 1];
    const defId = getCardByName(cardName).id;
    const sources = player.battlefield.filter(
        (c) => (c.card as { id?: string }).id === defId
    );
    // Exactly one, or "the source" is ambiguous and the entry proves nothing.
    if (sources.length !== 1) return null;
    const source = sources[0];
    const victims: string[][] = [];
    for (const move of enumerateMoves(state, player.id)) {
        if (move.kind !== "activate-ability") continue;
        if (move.cardInstanceId !== source.id) continue;
        const ability = getCardByName(cardName).activatedAbilities?.find(
            (a) => a.id === move.abilityId
        );
        if (!ability) return null;
        victims.push(
            activationSacrificeVictims(
                state,
                player,
                source,
                ability,
                move.costPicks
            )
        );
    }
    return { sourceId: source.id, victims };
}

/** "A sac outlet whose whole effect is scoped to `$source` is never paid with
 *  the source itself" (issue #2297, CR 609.3) — the activation stays
 *  available, and every enumerated variant names some OTHER victim. */
export function sacrificeVictimSparesTheSource(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const found = enumeratedSacrificeVictims(state, seat, cardName);
    if (!found) return false;
    if (found.victims.length === 0) return false;
    return found.victims.every(
        (v) => v.length > 0 && !v.includes(found.sourceId)
    );
}

/** "…and when the source is the only victim the board offers, the activation
 *  is not a move at all" — the same rule with nothing left to name. */
export function noActivationEnumerated(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const found = enumeratedSacrificeVictims(state, seat, cardName);
    return found !== null && found.victims.length === 0;
}

/** The DISCRIMINATING HALF (issue #2297): a sac outlet whose payoff does NOT
 *  depend on its source keeps self-sacrifice enumerable. Sacrificing the last
 *  creature to an outlet that draws / adds mana / damages / reanimates is a
 *  real line (before a wrath; denying a gain-control effect), and pruning it
 *  would be invisible damage. If the guard above ever widens into a blanket
 *  ban on naming the source, this goes red. */
export function selfSacrificeStaysEnumerable(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const found = enumeratedSacrificeVictims(state, seat, cardName);
    if (!found) return false;
    return found.victims.some((v) => v.includes(found.sourceId));
}

/** "A creature that already attacked this turn may attack AGAIN in the extra
 *  combat, provided it is untapped (CR 508.1a)." Asserted as a LEGALITY
 *  property — the named creature appears among the attackers the enumerator
 *  offers — never as a preference about whether the bot should send it, which
 *  would be a strength claim and seed-sensitive.
 *
 *  It also stops the CR 500.8 progress entry below from being satisfied by an
 *  EMPTY declaration: with `hasAttackedThisTurn` set and the creature untapped
 *  by vigilance, a regression that made a second attack illegal would leave the
 *  bot returning a legal-but-empty `declare-attackers` and the phase assertions
 *  alone would still pass. */
export function mayAttackAgain(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const pid = seatPlayerId(state, seat);
    const ids = instanceIdsForName(state, cardName);
    const instance = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => ids.has(c.id));
    if (!instance || instance.isTapped) return false;
    if (instance.hasAttackedThisTurn !== true) return false;
    return enumerateMoves(state, pid, { pruneDominatedNoOps: true }).some(
        (m) =>
            m.kind === "declare-attackers" &&
            m.attackerIds.some((a) => ids.has(a))
    );
}

/** Issue #4765 — a TIMING measurement written as a `predicate`, never as
 *  `moves` / `forbidden`. Those two shapes lower to a Verdict, and a Verdict
 *  enters the weight fit (`weightFit.bot.test.ts`): a report-only entry would
 *  then move `DEFAULT_EVAL_WEIGHTS`, i.e. change behaviour. PRD #4754 records
 *  why timing must not reach the fit at all — the fit cannot express it, and
 *  the first promotion bent unrelated weights (issue #4761). `expected` is the
 *  same name-based matcher a `moves` entry would carry; `hold` asserts the
 *  bot chose something OTHER than it (the `forbidden` shape). */
export function timingMeasurement(
    expected: MoveMatcher,
    hold = false
): BladeScenario["expect"] {
    return {
        predicate: (move, state) =>
            move === null ? hold : matchesMove(state, move, expected) !== hold,
        describe: `${hold ? "does NOT choose" : "chooses"} ${expected.kind} ${expected.card ?? ""}${expected.target ? ` → ${expected.target}` : ""}`,
    };
}

/** The exact MIRROR of {@link activationStaysAvailable} — the activation is
 *  enumerated (so the assertion is not vacuously satisfied by an illegal or
 *  unaffordable ability) AND carries the rollout-policy penalty. Written for
 *  the CR 500.8 pair below, whose two halves differ only in whether an extra
 *  combat is owed: without the mirror, "the carve-out fires" could be asserted
 *  while nothing had ever suppressed the move in the first place. */
export function activationIsDiscouraged(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const pid = state.players[seat === "me" ? 0 : 1].id;
    const defId = getCardByName(cardName).id;
    const activations = enumerateMoves(state, pid, {
        pruneDominatedNoOps: true,
    }).filter(
        (m) =>
            m.kind === "activate-ability" &&
            state.players.some((p) =>
                p.battlefield.some(
                    (c) =>
                        c.id === m.cardInstanceId &&
                        (c.card as { id?: string }).id === defId
                )
            )
    );
    return (
        activations.length > 0 &&
        activations.every((m) => isDiscouragedRolloutMove(state, pid, m))
    );
}

/** The enumerated `activate-ability` moves of ONE ability of the named
 *  battlefield card, for `seat` (issue #4238). The manland entries read an
 *  animation and a self-pump of the SAME card apart by ability id, which the
 *  card-wide helpers above cannot. */
export function abilityMovesOf(
    state: GameState,
    seat: BladeSeat,
    cardName: string,
    abilityId: string
): Extract<Move, { kind: "activate-ability" }>[] {
    const pid = state.players[seat === "me" ? 0 : 1].id;
    const defId = getCardByName(cardName).id;
    return enumerateMoves(state, pid, { pruneDominatedNoOps: true }).filter(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" &&
            m.abilityId === abilityId &&
            state.players.some((p) =>
                p.battlefield.some(
                    (c) =>
                        c.id === m.cardInstanceId &&
                        (c.card as { id?: string }).id === defId
                )
            )
    );
}

/** The ability is NOT worth taking here: never enumerated, or enumerated and
 *  carrying the rollout-policy penalty on every variant (issue #4238). */
export function abilityIsUnavailableOrDiscouraged(
    state: GameState,
    seat: BladeSeat,
    cardName: string,
    abilityId: string
): boolean {
    const pid = state.players[seat === "me" ? 0 : 1].id;
    return abilityMovesOf(state, seat, cardName, abilityId).every((m) =>
        isDiscouragedRolloutMove(state, pid, m)
    );
}

/** The ability is enumerated and no variant carries the penalty (issue #4238). */
export function abilityStaysAvailable(
    state: GameState,
    seat: BladeSeat,
    cardName: string,
    abilityId: string
): boolean {
    const pid = state.players[seat === "me" ? 0 : 1].id;
    const moves = abilityMovesOf(state, seat, cardName, abilityId);
    return (
        moves.length > 0 &&
        moves.every((m) => !isDiscouragedRolloutMove(state, pid, m))
    );
}

// Discriminants of the registry's declared Minimal Pairs (ADR 0148, issue
// #4796). Each names WHY the anchor's move is wrong here and right in its
// half; a half repeats its anchor's constant, which the derivation compares
// field for field. An anchor with no half beside it is conditional debt: its
// pair prose (kept, see each entry's PAIRED WITH) did not differ by this
// Discriminant only, or its other half is no `moves` verdict. Every entry is
// classified since issue #4797 (`RegistryBladeScenario`); one whose
// Discriminant appears only once below, or inline, is conditional debt.
export const DENSE_LIBRARY: Discriminant = {
    kind: "other",
    detail: "a library of twenty creatures where the anchor's holds twenty lands",
};
export const PAYOFF_BODY: Discriminant = {
    kind: "card",
    detail: "a body that pays on the way out, in place of a vanilla one",
};
export const STIFLE_BACKUP: Discriminant = {
    kind: "card",
    detail: "Stifle in hand, with a land to cast it",
};
export const TITANIA_PAYOFF: Discriminant = {
    kind: "card",
    detail: "Titania, Protector of Argoth on the battlefield",
};
export const EXTRA_PLAINS: Discriminant = {
    kind: "card",
    detail: "one extra Plains",
};

/** "The bot answered the ENGINE-RAISED target selection with a submission the
 *  server would accept, and the game moved on" (issue #2283).
 *
 *  Deliberately NOT a shape-only `{ kind: "submit-target" }` matcher. The bug
 *  this guards is not "the bot picked the wrong permanent" (target QUALITY is
 *  explicitly out of scope) — it is that the bot produced NO action at all and
 *  the game froze forever. So the assertion is the two properties that
 *  distinguish a fix from a hang, both checked through the real engine:
 *
 *    1. LEGALITY — the chosen submission is one the enumerator actually offers
 *       for this selection (same target ids, same `confirmTargets` flag). An
 *       illegal or over-picked submission is rejected server-side and re-freezes
 *       the bot exactly as hard as no submission at all, so "did not throw" is
 *       not sufficient evidence.
 *    2. PROGRESS — replaying it through `applyMoveInSearch` (the engine's own
 *       move-application chokepoint) CLEARS `pendingTarget` and writes the
 *       chosen targets onto the trigger's stack item, i.e. the position really
 *       advances to the next priority window.
 */
export function answersRaisedTargetLegally(
    move: Move | null,
    state: GameState,
    seat: BladeSeat
): boolean {
    if (!move || move.kind !== "submit-target") return false;
    const playerId = seatPlayerId(state, seat);
    const pt = raisedPendingTargetOwedBy(state, playerId);
    if (!pt) return false;

    const key = (m: Move) =>
        m.kind === "submit-target"
            ? `${m.confirmTargets}|${m.targets
                  .map((t) => `${t.type}:${t.id}`)
                  .join(",")}`
            : "";
    const legal = enumerateRaisedTargetMoves(state, playerId);
    if (!legal.some((m) => key(m) === key(move))) return false;

    // CR 603.3d — replay it and demand the selection is actually committed.
    const after = cloneGameState(state);
    applyMoveInSearch(after, playerId, move);
    if (after.pendingTarget !== undefined) return false;
    const trigger = after.stack.find((s) => s.id === pt.cardInstanceId);
    if (!trigger) return false;
    const chosen = new Set(move.targets.map((t) => `${t.type}:${t.id}`));
    const landed = trigger.targets ?? [];
    return (
        landed.length === move.targets.length &&
        landed.every((t) => chosen.has(`${t.type}:${t.id}`))
    );
}
