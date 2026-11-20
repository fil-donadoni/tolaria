// The doomed-mana-source float window (issue #8355).
//
// The Bot never activates a mana ability standalone: the cast planner
// (`planManaPayment`, `gre/moves.ts`) funds every cost on demand off the
// sources that are untapped WHEN it pays. That is lossless everywhere but one
// window — an item on the stack whose resolution REMOVES one of the Bot's
// untapped mana sources (an own "sacrifice this land" trigger, an opponent's
// land destruction aimed at it). Once it resolves the source is gone, and the
// mana it could have made with it is gone too. A mana ability can be activated
// whenever its controller holds priority (CR 605.3a), and the mana stays in the
// pool until the step or phase ends (CR 106.4), so the play is to tap the
// source in response and spend the mana after the resolution.
//
// The window is decided by EFFECT, never by card: the top of the stack is
// resolved on a clone, and a source that is no longer on its controller's
// battlefield afterwards is doomed. A resolution that asks the controller which
// ONE of its own permanents leaves (a bounce land's "return a land you control
// to its owner's hand", issue #9698) is settled once per answer: a source is
// doomed under the answer that removes it, and its float is weighed against
// that same answer left unfloated. Any OTHER choice the resolution parks on is
// answered once, deterministically, the same way on every probe: a library
// search finds nothing (CR 701.23b), every other kind takes the search's forced
// answer (`forcedChoiceAnswer`, handed in), and a choice with neither still
// fails closed. The float is offered only when the mana it
// keeps has a SPENDER — a cast or activation that the post-resolution position
// offers with the floated mana and does not offer without it — so a float that
// would only empty out unspent is never a candidate, and an ordinary position
// pays one stack-top probe and adds no Move at all.
//
// A LEAF beside `searchTapPlan.ts`: it never imports `moves.ts` at runtime (the
// enumerator is handed in), so `moves.ts` can import it without a cycle.

import type { ActivatedAbility, ManaCost } from "../../cards/types";
import type {
    CardInstanceState,
    GameState,
    PendingChoice,
    PlayerState,
} from "../state";
import { getPendingChoiceMin, resolveTopOfStack } from "../state";
import { checkStateBasedActions } from "../sba";
import { cloneGameState } from "../clone";
import {
    getManaTapOptionRestriction,
    isTapLockedBySummoningSickness,
    manaGateBattlefields,
    replaceProducedManaColor,
} from "../constants";
import { getProducibleManaSourceView } from "../rules";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { applyTapPlanInSearch } from "../searchTapPlan";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import {
    choiceSpansAllBattlefields,
    eligibleZonePickCards,
} from "../zonePickEligibility";
// Type-only: erased at compile time, so `moves.ts` importing this module back
// is NOT a runtime import cycle.
import type { Move } from "../moves";

/** The standalone mana-ability Move this window offers. */
export type ManaFloatMove = Extract<Move, { kind: "activate-mana-ability" }>;

/** The enumerator, handed in by `moves.ts`. `noManaFloat` keeps the spender
 *  probe from re-opening this window on the position it is probing. */
export type FloatEnumerator = (
    state: GameState,
    playerId: string,
    options: { noManaFloat: true }
) => Move[];

/** The search's forced answer to a choice it does not branch on
 *  (`forcedChoiceAnswer`, `ai/choiceCandidates.ts`), handed in by `moves.ts`
 *  for the same reason the enumerator is. */
export type ForcedChoiceAnswerer = (
    state: GameState,
    choice: PendingChoice
) => Move | null;

/** One way to tap one source for mana right now. */
type FloatOption = ManaFloatMove & { mana: ManaCost };

/** CR 602.1 — a cost whose ONLY leg is {T}. The float Move is realised through
 *  the `tapUntap` mutation, which pays exactly that leg; every other cost shape
 *  (a mana leg, a tap-other leg, a filtered sacrifice, a discard) parks or is
 *  refused there, so the window fails closed on it rather than offer a Move
 *  the server would bounce. */
function isPlainTapCost(ability: ActivatedAbility): boolean {
    return (
        ability.cost.tap === true &&
        Object.entries(ability.cost).every(
            ([key, value]) =>
                key === "tap" || value === undefined || value === false
        )
    );
}

function manaTotal(mana: ManaCost): number {
    let total = 0;
    const valueList = Object.values(mana);
    for (let i = 0; i < valueList.length; i++) {
        const value = valueList[i];
        if (typeof value === "number") total += value;
    }
    return total;
}

/** CR 605.1a / 106.1 — every plain-{T} mana option `perm` offers now, indexed
 *  exactly as the tap mutations resolve `manaChoiceIndex` (the planner's own
 *  `getProducibleManaSourceView`). Restricted mana (CR 106.6) is skipped: it
 *  lands in `restrictedMana`, which this window does not reason about. */
function floatOptionsOf(
    state: GameState,
    player: PlayerState,
    perm: CardInstanceState
): FloatOption[] {
    if (perm.isTapped) return [];
    // CR 302.6 — every option here carries {T}.
    if (isTapLockedBySummoningSickness(perm)) return [];
    const view = getProducibleManaSourceView(
        perm,
        player.id,
        manaGateBattlefields(state),
        state
    );
    const options: FloatOption[] = [];
    for (let index = 0; index < view.detailed.length; index++) {
        const opt = view.detailed[index];
        if (opt.sacrificesSource) continue;
        if (getManaTapOptionRestriction(perm, opt.source) !== null) continue;
        if (opt.source.kind === "activated") {
            const abilityId = opt.source.abilityId;
            const ability = getEffectiveActivatedAbilities(perm).find(
                ({ ability: a }) => a.id === abilityId
            )?.ability;
            if (!ability || !isPlainTapCost(ability)) continue;
        }
        if (manaTotal(opt.mana) === 0) continue;
        options.push({
            kind: "activate-mana-ability",
            cardInstanceId: perm.id,
            ...(view.needIndex ? { manaChoiceIndex: index } : {}),
            mana: opt.mana,
        });
    }
    return options;
}

/** Search-side application of a float Move: the source is tapped through the
 *  shared coarse payment model (`applyTapPlanInSearch`) and the option's mana
 *  is credited to the pool, through the same colour replacement the mutation
 *  applies (CR 614.1a). Mana abilities do not use the stack (CR 605.3b) and
 *  priority stays with the activator, so nothing else moves. Returns `false`
 *  (and changes nothing) when the option no longer exists. */
export function applyManaFloatInSearch(
    state: GameState,
    playerId: string,
    move: ManaFloatMove
): boolean {
    const player = state.players.find((p) => p.id === playerId);
    const perm = player?.battlefield.find((c) => c.id === move.cardInstanceId);
    if (!player || !perm) return false;
    const option = floatOptionsOf(state, player, perm).find(
        (o) => o.manaChoiceIndex === move.manaChoiceIndex
    );
    if (!option) return false;
    applyTapPlanInSearch(state, playerId, [
        {
            cardInstanceId: move.cardInstanceId,
            ...(move.manaChoiceIndex !== undefined
                ? { manaChoiceIndex: move.manaChoiceIndex }
                : {}),
        },
    ]);
    const entries2 = Object.entries(
        replaceProducedManaColor(state, playerId, option.mana)
    );
    for (let i = 0; i < entries2.length; i++) {
        const [color, count] = entries2[i];
        if (color !== "X" && typeof count === "number" && count > 0) {
            player.manaPool[color] = (player.manaPool[color] ?? 0) + count;
        }
    }
    return true;
}

/** One way the top of the stack can settle. `answer` is the permanent the
 *  controller's own mid-resolution pick returned, or `null` when the
 *  resolution asked nothing. */
type Settlement = { state: GameState; answer: string | null };

/** A probe that came out of the resolution with nothing left owed — fail
 *  closed on an engine throw's aftermath, a game over, or any suspension. */
function isSettled(probe: GameState): boolean {
    return !(
        probe.gameOver ||
        (probe.pendingChoices?.length ?? 0) > 0 ||
        probe.pendingCast ||
        probe.pendingTarget ||
        probe.pendingActivation ||
        probe.pendingCompanionPay
    );
}

/** CR 608.2d — the one mid-resolution pick this window branches on: the
 *  CONTROLLER choosing exactly one of its own battlefield permanents (a
 *  bounce land's return). A pick across every battlefield, a sacrifice pick
 *  and every other suspension still fail closed. */
function isOwnSinglePermanentPick(probe: GameState, playerId: string): boolean {
    const head = probe.pendingChoices?.[0];
    return (
        probe.pendingChoices?.length === 1 &&
        head !== undefined &&
        head.kind === "choose-permanents" &&
        head.zone === "battlefield" &&
        !choiceSpansAllBattlefields(head) &&
        head.playerId === playerId &&
        (head.zoneOwnerId ?? head.playerId) === playerId &&
        head.count === 1
    );
}

/** The top of the stack resolved on a clone, up to the end or to a pick —
 *  `null` on an engine throw (fail closed). */
function resolveProbe(state: GameState): GameState | null {
    const probe = cloneGameState(state);
    try {
        resolveTopOfStack(probe);
        checkStateBasedActions(probe);
    } catch {
        return null;
    }
    return probe;
}

/** `answer` submitted to `probe`'s head choice in place, then SBAs (CR 704.3)
 *  — `false` when the resolver rejects it. */
function submitAnswer(
    probe: GameState,
    head: PendingChoice,
    answer: { cardInstanceIds: string[]; secondZoneIds?: string[] }
): boolean {
    try {
        applyPendingChoiceSubmit(probe, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: answer.cardInstanceIds,
            ...(answer.secondZoneIds
                ? { secondZoneIds: answer.secondZoneIds }
                : {}),
        });
        checkStateBasedActions(probe);
    } catch {
        return false;
    }
    return true;
}

/** The ONE deterministic answer the probe gives a parked choice it does not
 *  branch on, or `null` when it has none (fail closed).
 *
 *  CR 701.23b — a search of a hidden zone for cards with a stated quality may
 *  find nothing, so a `search-library` whose count admits an empty pick is
 *  answered with nothing: legal whatever the library holds, it reads no hidden
 *  card, and it never credits the player with a find. Every other kind takes
 *  the search's forced answer when that is a plain submission. Both arms of
 *  the spender comparison go through here, so the floated mana is the only
 *  difference between them. */
function deterministicAnswer(
    probe: GameState,
    head: PendingChoice,
    forcedAnswer: ForcedChoiceAnswerer
): { cardInstanceIds: string[]; secondZoneIds?: string[] } | null {
    if (head.kind === "search-library") {
        return getPendingChoiceMin(head.count) <= 0
            ? { cardInstanceIds: [] }
            : null;
    }
    const forced = forcedAnswer(probe, head);
    if (!forced || forced.kind !== "resolution-choice") return null;
    return {
        cardInstanceIds: forced.cardInstanceIds,
        ...(forced.secondZoneIds
            ? { secondZoneIds: forced.secondZoneIds }
            : {}),
    };
}

/** Bound on the deterministic answers one probe gives — a resolution parks a
 *  handful of times at most; a loop past it fails closed. */
const MAX_PARKED_ANSWERS = 8;

/** Drive `probe` in place past every parked choice it answers
 *  deterministically, stopping settled or at the controller's own
 *  single-permanent pick (which `settlements` branches on). `false` when it
 *  stops anywhere else — a game over, a half-made announcement, a choice with
 *  no deterministic answer, a rejected answer: fail closed. */
function advanceParked(
    probe: GameState,
    playerId: string,
    forcedAnswer: ForcedChoiceAnswerer
): boolean {
    for (let i = 0; i < MAX_PARKED_ANSWERS; i++) {
        if (isSettled(probe)) return true;
        if (
            probe.gameOver ||
            probe.pendingCast ||
            probe.pendingTarget ||
            probe.pendingActivation ||
            probe.pendingCompanionPay
        ) {
            return false;
        }
        if (isOwnSinglePermanentPick(probe, playerId)) return true;
        const head = probe.pendingChoices![0];
        const answer = deterministicAnswer(probe, head, forcedAnswer);
        if (!answer || !submitAnswer(probe, head, answer)) return false;
    }
    return isSettled(probe);
}

/** `probe`'s pending single-permanent pick answered with `cardId` and every
 *  later parked choice settled, or `null` when the resolver rejects it or the
 *  resolution does not settle after. */
function answerPick(
    probe: GameState,
    playerId: string,
    cardId: string,
    forcedAnswer: ForcedChoiceAnswerer
): GameState | null {
    const branch = cloneGameState(probe);
    if (
        !submitAnswer(branch, branch.pendingChoices![0], {
            cardInstanceIds: [cardId],
        })
    ) {
        return null;
    }
    return advanceParked(branch, playerId, forcedAnswer) && isSettled(branch)
        ? branch
        : null;
}

/** The top of the stack resolved on a clone with every parked choice it
 *  answers deterministically settled — settled, or parked on the
 *  controller's own single-permanent pick; `null` otherwise (fail closed). */
function resolveAndAdvance(
    state: GameState,
    playerId: string,
    forcedAnswer: ForcedChoiceAnswerer
): GameState | null {
    const probe = resolveProbe(state);
    if (!probe || !advanceParked(probe, playerId, forcedAnswer)) return null;
    return probe;
}

/** Every position the top of the stack can settle into for `playerId`: one
 *  when the resolution asks nothing or only what the probe answers
 *  deterministically, one per eligible permanent when it parks on the
 *  controller's own single-permanent pick, none when the sandbox cannot
 *  settle it (an engine throw, a game over, a choice with no deterministic
 *  answer) — fail closed. */
function settlements(
    state: GameState,
    playerId: string,
    forcedAnswer: ForcedChoiceAnswerer
): Settlement[] {
    const probe = resolveAndAdvance(state, playerId, forcedAnswer);
    if (!probe) return [];
    if (isSettled(probe)) return [{ state: probe, answer: null }];
    const out: Settlement[] = [];
    const cardList = eligibleZonePickCards(probe, probe.pendingChoices![0]);
    for (let i = 0; i < cardList.length; i++) {
        const card = cardList[i];
        const branch = answerPick(probe, playerId, card.id, forcedAnswer);
        if (branch) out.push({ state: branch, answer: card.id });
    }
    return out;
}

/** `state`'s top of the stack settled under ONE answer — the replay of an
 *  outcome `settlements` found on the unfloated position, every
 *  deterministic answer given the same way. */
function settleAs(
    state: GameState,
    playerId: string,
    answer: string | null,
    forcedAnswer: ForcedChoiceAnswerer
): GameState | null {
    const probe = resolveAndAdvance(state, playerId, forcedAnswer);
    if (!probe) return null;
    if (answer === null) return isSettled(probe) ? probe : null;
    if (isSettled(probe)) return null;
    return answerPick(probe, playerId, answer, forcedAnswer);
}

/** The spend set of a settled position: every cast and activation `playerId`
 *  could make there with priority, keyed by what it acts with. `null` when the
 *  enumerator declines the window altogether — no evidence about mana. */
function spendKeys(
    settled: GameState,
    playerId: string,
    enumerate: FloatEnumerator
): Set<string> | null {
    // CR 117.3b — after a resolution the ACTIVE player receives priority,
    // which is the opponent when this player is responding on their turn. The
    // question is what THIS player could pay for with the mana it holds, so it
    // is asked holding priority; timing legality (sorcery speed, CR 307.1) is
    // gated on the active player and the stack, never on this field.
    settled.priorityPlayerId = playerId;
    const moves = enumerate(settled, playerId, { noManaFloat: true });
    if (moves.length === 0) return null;
    const keys = new Set<string>();
    for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        if (m.kind === "cast-spell") {
            keys.add(`cast:${m.cardInstanceId}:${m.castFromZone ?? "hand"}`);
        } else if (m.kind === "activate-ability") {
            keys.add(`ability:${m.cardInstanceId}:${m.abilityId}`);
        } else if (m.kind === "activate-granted-ability") {
            keys.add(`grant:${m.grantedAbilityInstanceId}:${m.abilityId}`);
        }
    }
    return keys;
}

/** CR 605.3a / 106.4 — the float Moves open to `player` now: one per mana
 *  option of an untapped source that the top of the stack removes on
 *  resolution, kept only when the floated mana has a spender after it. Empty
 *  on an empty stack, without priority, and on every position the probes
 *  cannot settle. */
export function enumerateDoomedManaFloatMoves(
    state: GameState,
    player: PlayerState,
    enumerate: FloatEnumerator,
    forcedAnswer: ForcedChoiceAnswerer
): ManaFloatMove[] {
    if (state.stack.length === 0) return [];
    if (state.priorityPlayerId !== player.id) return [];
    const candidates = player.battlefield.flatMap((perm) =>
        floatOptionsOf(state, player, perm)
    );
    if (candidates.length === 0) return [];

    const outcomes = settlements(state, player.id, forcedAnswer);
    if (outcomes.length === 0) return [];
    // Each outcome's spend set, computed once and shared by every candidate.
    const baselines = new Map<Settlement, Set<string> | null>();
    const baselineOf = (o: Settlement) => {
        if (!baselines.has(o)) {
            baselines.set(o, spendKeys(o.state, player.id, enumerate));
        }
        return baselines.get(o)!;
    };

    const moves: ManaFloatMove[] = [];
    for (let i = 0; i < candidates.length; i++) {
        const option = candidates[i];
        // Doomed under an outcome that leaves the source off its controller's
        // battlefield; that outcome's answer is replayed on the floated clone.
        const doomedUnder = outcomes.filter(
            (o) =>
                !o.state.players
                    .find((p) => p.id === player.id)
                    ?.battlefield.some((c) => c.id === option.cardInstanceId)
        );
        if (doomedUnder.length === 0) continue;
        const move: ManaFloatMove = {
            kind: "activate-mana-ability",
            cardInstanceId: option.cardInstanceId,
            ...(option.manaChoiceIndex !== undefined
                ? { manaChoiceIndex: option.manaChoiceIndex }
                : {}),
        };
        const floated = cloneGameState(state);
        if (!applyManaFloatInSearch(floated, player.id, move)) continue;
        const hasSpender = doomedUnder.some((outcome) => {
            const baseline = baselineOf(outcome);
            if (!baseline) return false;
            const settled = settleAs(
                floated,
                player.id,
                outcome.answer,
                forcedAnswer
            );
            if (!settled) return false;
            const spend = spendKeys(settled, player.id, enumerate);
            if (!spend) return false;
            // eslint-disable-next-line no-restricted-syntax -- a Map/Set with an early exit, which forEach cannot take (issue #10126)
            for (const key of spend) if (!baseline.has(key)) return true;
            return false;
        });
        if (hasSpender) moves.push(move);
    }
    return moves;
}
