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
// battlefield afterwards is doomed. The float is offered only when the mana it
// keeps has a SPENDER — a cast or activation that the post-resolution position
// offers with the floated mana and does not offer without it — so a float that
// would only empty out unspent is never a candidate, and an ordinary position
// pays one stack-top probe and adds no Move at all.
//
// A LEAF beside `searchTapPlan.ts`: it never imports `moves.ts` at runtime (the
// enumerator is handed in), so `moves.ts` can import it without a cycle.

import type { ActivatedAbility, ManaCost } from "../../cards/types";
import type { CardInstanceState, GameState, PlayerState } from "../state";
import { resolveTopOfStack } from "../state";
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
    for (const value of Object.values(mana)) {
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
    for (const [color, count] of Object.entries(
        replaceProducedManaColor(state, playerId, option.mana)
    )) {
        if (color !== "X" && typeof count === "number" && count > 0) {
            player.manaPool[color] = (player.manaPool[color] ?? 0) + count;
        }
    }
    return true;
}

/** The position after the top of the stack resolves, or `null` when the
 *  sandbox cannot settle it (an engine throw, a resolution that parks on a
 *  choice or a continuation, a game over) — fail closed. */
function resolveTop(state: GameState): GameState | null {
    const probe = cloneGameState(state);
    try {
        resolveTopOfStack(probe);
        checkStateBasedActions(probe);
    } catch {
        return null;
    }
    if (
        probe.gameOver ||
        (probe.pendingChoices?.length ?? 0) > 0 ||
        probe.pendingCast ||
        probe.pendingTarget ||
        probe.pendingActivation ||
        probe.pendingCompanionPay
    ) {
        return null;
    }
    return probe;
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
    for (const m of moves) {
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
    enumerate: FloatEnumerator
): ManaFloatMove[] {
    if (state.stack.length === 0) return [];
    if (state.priorityPlayerId !== player.id) return [];
    const candidates = player.battlefield.flatMap((perm) =>
        floatOptionsOf(state, player, perm)
    );
    if (candidates.length === 0) return [];

    const resolved = resolveTop(state);
    if (!resolved) return [];
    const survivors = new Set(
        resolved.players
            .find((p) => p.id === player.id)
            ?.battlefield.map((c) => c.id) ?? []
    );
    const doomed = candidates.filter((o) => !survivors.has(o.cardInstanceId));
    if (doomed.length === 0) return [];

    const baseline = spendKeys(resolved, player.id, enumerate);
    if (!baseline) return [];
    const moves: ManaFloatMove[] = [];
    for (const option of doomed) {
        const move: ManaFloatMove = {
            kind: "activate-mana-ability",
            cardInstanceId: option.cardInstanceId,
            ...(option.manaChoiceIndex !== undefined
                ? { manaChoiceIndex: option.manaChoiceIndex }
                : {}),
        };
        const floated = cloneGameState(state);
        if (!applyManaFloatInSearch(floated, player.id, move)) continue;
        const settled = resolveTop(floated);
        if (!settled) continue;
        const spend = spendKeys(settled, player.id, enumerate);
        if (!spend) continue;
        for (const key of spend) {
            if (!baseline.has(key)) {
                moves.push(move);
                break;
            }
        }
    }
    return moves;
}
