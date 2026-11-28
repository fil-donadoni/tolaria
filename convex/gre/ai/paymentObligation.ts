// A delayed "pay or lose the game" obligation the payer cannot meet (issue
// #10818).
//
// THE SHAPE. A spell or ability may leave a delayed triggered ability behind
// (CR 603.7a) whose script is "pay {cost}. If you don't, you lose the game" —
// a `mayPay` Op of the controller followed by an `if` whose unpaid arm is a
// `loseGame` of the controller (CR 104.3e: an effect may state that a player
// loses the game). The Pact cycle is the catalogue's shape: Summoner's Pact
// queues "At the beginning of your next upkeep, pay {2}{G}{G}. If you don't,
// you lose the game." as an inline delayed body.
//
// WHY THE EVALUATION READS IT. Between the resolution that queues the
// obligation and the upkeep that fires it, the position looks like any other:
// the tutor's find is in hand and nothing has been lost. A leaf scored there —
// the rollout policy's one-ply probe, which resolves the cast it probes, and a
// rollout cut by its horizon before the upkeep — read the cast as a free
// tutor, so both the tree and the rollouts below `pass` walked into a loss
// they could not see. When the payer's sources cannot pay the cost even all
// untapped, the obligation IS the loss, one trigger before the engine records
// it, exactly as an empty library is a loss one draw before the SBA
// (`deckOutDelta`).
//
// TWO READINGS. Queued (`state.delayedTriggers`), the obligation is paid at
// the payer's next upkeep from the board read as the untap step leaves it.
// Fired (the delayed trigger on the stack, CR 603.7a), it is paid from the
// board as it stands: no untap falls between. The second is not a corner —
// a leaf can stand in the Bot's upkeep with the obligation on the stack (a
// rollout cut by the clock or the stall cap, a tree line stopped there), and
// a leaf read the queued obligation before the turn and nothing at it.
//
// CONSERVATIVE, it under-reports rather than over-fires:
//   * queued, only an UPKEEP obligation of the payer's own upkeep (`next-upkeep` /
//     `each-own-upkeep` scoped to the controller): the untap step precedes it
//     (CR 502.3), so every source the payer controls is read untapped, and
//     the mana pool, which empties between steps (CR 500.5), is read empty.
//     Any other timing fails open — a land drop or an untap could fall
//     between now and the trigger. Fired, it fails open while the payer has
//     any other item on the stack, which may add a source first;
//   * the payer's board, untapped, is the board that pays — on EITHER
//     player's turn — unless the payer can still ADD a source before that
//     upkeep (issue #10947), when it fails open: a land in hand with this
//     turn's land drop open (own turn, before its ending phase); a card
//     castable now from the payer's current mana that brings a mana source —
//     a permanent with a mana ability, or a script that puts a card onto the
//     battlefield or makes a token (a ramp spell, a Treasure maker), at
//     sorcery speed (CR 302.1, 307.1) only on the payer's own turn before
//     its ending phase, at instant speed (CR 702.8a) on either turn; a hand card with a
//     mana ability activated from the hand (CR 113.6b: exile it from your
//     hand: add mana); a permanent whose activated ability puts a card onto
//     the battlefield (a fetchland: moving a card out of the library makes
//     it no mana ability, CR 605.1a, but it nets an untapped land before the
//     payment). The draw step comes AFTER the upkeep (CR 501.1), so no
//     card reaches the hand first. Read from DATA only: a `resolve()`-only
//     fetch or ramp, an untapper, and (fired) mana already floating in the
//     pool are not seen — no catalogue card hits these today;
//   * a creature that is summoning sick now is not at the upkeep: the payer
//     has controlled it continuously since their turn began (CR 302.6);
//   * only a mana-only cost — a life or permanent leg is not read here —
//     and only of plain symbols: a Phyrexian symbol is payable by life, a
//     hybrid one by either half (CR 107.4e/f), and a variable {X} carries
//     no amount here; the planner is not asked to price them, so such an
//     obligation is not read;
//   * a source that would not untap (an untap lock) is still read untapped,
//     which only ever makes the cost look MORE payable.
//
// Fix the class: the obligation is read from the Effect Script (the delayed
// body inline on the instance, else its template's script), payability from
// the payer's own mana sources through the planner the search pays with
// (`planManaPayment`). No card name, no per-card table (ADR 0102).

import type {
    CardDefinition,
    EffectOp,
    ManaCost,
    MayPayCost,
} from "../../cards/types";
import { tryGetDefinition } from "../../cards";
import { planManaPayment } from "../moves";
import {
    functionsOnBattlefield,
    hasInstantSpeed,
    isLand,
    isManaAbilityDefinition,
    PERMANENT_TYPES,
} from "../constants";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { isLandDropOpen } from "./asEntersDiscard";
import {
    normalizeManaCost,
    normalizeMayPayCost,
    type CardInstanceState,
    type DelayedTriggerInstance,
    type GameState,
    type PlayerState,
} from "../state";
import { unpaidArmLosesGame } from "./searchDestination";

/** The script a delayed trigger will run when it fires: its ADR 0048 inline
 *  body, else its template's on the source definition. */
function delayedScript(
    trigger: DelayedTriggerInstance
): readonly EffectOp[] | undefined {
    if (trigger.effects) return trigger.effects;
    return tryGetDefinition(trigger.sourceCardId)?.delayedTriggers?.find(
        (t) => t.id === trigger.triggerId
    )?.effects;
}

/** The mana cost of the controller's `mayPay` whose unpaid arm loses the
 *  game, or `undefined` when `script` is not that shape or its cost carries
 *  a non-mana leg. */
function lossObligationManaCost(
    script: readonly EffectOp[]
): Record<string, number> | undefined {
    for (let i = 0; i < script.length; i++) {
        const op = script[i] as {
            op: string;
            player?: unknown;
            bind?: unknown;
            cost?: MayPayCost;
        };
        if (op.op !== "mayPay" || op.player !== "controller") continue;
        if (typeof op.bind !== "string" || !op.cost) continue;
        if (!unpaidArmLosesGame(script, op.bind)) continue;
        const { mana, ...otherLegs } = normalizeMayPayCost(op.cost);
        if (!mana || Object.keys(otherLegs).length > 0) return undefined;
        if (!isPlainManaCost(mana)) return undefined;
        return normalizeManaCost(mana);
    }
    return undefined;
}

/** The symbols a cost may carry for the planner to price it exactly: fixed
 *  generic and the six plain symbols. */
const PLAIN_COST_KEYS: ReadonlySet<string> = new Set([
    "W",
    "U",
    "B",
    "R",
    "G",
    "C",
    "generic",
]);

/** Whether `cost` is made only of plain symbols (CR 107.4): no Phyrexian,
 *  hybrid or two-generic hybrid symbol, no variable {X}. */
function isPlainManaCost(cost: ManaCost): boolean {
    const keys = Object.keys(cost);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = (cost as Record<string, unknown>)[key];
        if (key === "X") {
            if (typeof value !== "number") return false;
            continue;
        }
        if (!PLAIN_COST_KEYS.has(key)) return false;
    }
    return true;
}

/** Whether `node` holds, at any depth, an Op that puts a card onto the
 *  battlefield (`moveZone` to it) or makes a token — the Ops through which a
 *  spell or ability can add a mana source. Structural on purpose: any such
 *  Op reads as a possible source, so the verdict fails open on it. */
function addsPermanent(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(addsPermanent);
    if (node === null || typeof node !== "object") return false;
    const op = (node as { op?: unknown }).op;
    if (op === "createToken") return true;
    if (op === "moveZone" && (node as { to?: unknown }).to === "battlefield") {
        return true;
    }
    return Object.values(node).some(addsPermanent);
}

const BRINGS_SOURCE = new WeakMap<CardDefinition, boolean>();

/** Whether casting `def` brings a mana source: a permanent with a mana
 *  ability that functions on the battlefield, or any card whose definition
 *  puts a card onto the battlefield or makes a token (its spell script, its
 *  AI shadow script, an enters trigger). Cached per definition. */
function castBringsSource(def: CardDefinition): boolean {
    const cached = BRINGS_SOURCE.get(def);
    if (cached !== undefined) return cached;
    const isPermanent = (def.types ?? []).some((t) =>
        (PERMANENT_TYPES as readonly string[]).includes(t)
    );
    const brings =
        (isPermanent &&
            (def.activatedAbilities ?? []).some(
                (a) => functionsOnBattlefield(a) && isManaAbilityDefinition(a)
            )) ||
        addsPermanent(def);
    BRINGS_SOURCE.set(def, brings);
    return brings;
}

/** Whether `def`, in its owner's hand, has a mana ability activated from
 *  the hand (CR 113.6b). */
function hasHandManaAbility(def: CardDefinition): boolean {
    return (def.activatedAbilities ?? []).some(
        (a) => a.activateFromHand === true && isManaAbilityDefinition(a)
    );
}

/** Whether a permanent `card` controls has an activated ability, not a mana
 *  ability, that puts a card onto the battlefield — a fetchland's crack nets
 *  an untapped land though it adds no mana itself (CR 605.1a). */
function fetchesPermanent(card: CardInstanceState): boolean {
    return getEffectiveActivatedAbilities(card).some(
        ({ ability }) =>
            functionsOnBattlefield(ability) &&
            !isManaAbilityDefinition(ability) &&
            addsPermanent(ability.effects)
    );
}

/** Whether `player` can still add a mana source before the payment (issue
 *  #10947; see the module header): at instant speed always, at sorcery speed
 *  only while `sorceryWindow` holds. Errs toward `true`. */
function canAddSource(
    state: GameState,
    player: PlayerState,
    sorceryWindow: boolean
): boolean {
    for (let i = 0; i < player.battlefield.length; i++) {
        const card = player.battlefield[i];
        if (fetchesPermanent(card)) return true;
    }
    const landDropOpen = sorceryWindow && isLandDropOpen(state, player);
    for (let i = 0; i < player.hand.length; i++) {
        const card = player.hand[i];
        // The instance carries a slim projection of its card; the
        // definition holds the scripts and abilities read here.
        const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
        if (!def) continue;
        if (hasHandManaAbility(def)) return true;
        if (isLand(card)) {
            if (landDropOpen) return true;
            continue;
        }
        if (!sorceryWindow && !hasInstantSpeed(card)) continue;
        if (!castBringsSource(def)) continue;
        const cost = def.manaCost ?? {};
        if (planManaPayment(state, player, normalizeManaCost(cost)) !== null) {
            return true;
        }
    }
    return false;
}

/** `player` at their next upkeep: every permanent untapped (CR 502.3) and
 *  no longer summoning sick (CR 302.6), the pool empty (CR 500.5). */
function atOwnUpkeep(
    state: GameState,
    player: PlayerState
): { state: GameState; player: PlayerState } {
    const untapped: PlayerState = {
        ...player,
        manaPool: {},
        restrictedMana: undefined,
        battlefield: player.battlefield.map((c) =>
            c.isTapped || c.isSummoningSick
                ? { ...c, isTapped: false, isSummoningSick: false }
                : c
        ),
    };
    return {
        state: {
            ...state,
            players: state.players.map((p) =>
                p.id === player.id ? untapped : p
            ),
        },
        player: untapped,
    };
}

const UPKEEP_TIMINGS: ReadonlySet<string> = new Set([
    "next-upkeep",
    "each-own-upkeep",
]);

/** Adds `cost` into `sum`, symbol by symbol. */
function addCost(
    sum: Record<string, number>,
    cost: Record<string, number>
): void {
    const symbols = Object.keys(cost);
    for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        sum[symbol] = (sum[symbol] ?? 0) + cost[symbol];
    }
}

/** The summed mana cost of the pay-or-lose obligations `playerId` has
 *  queued for their own next upkeep, or `undefined` for none. */
function queuedObligationCost(
    state: GameState,
    playerId: string
): Record<string, number> | undefined {
    const triggers = state.delayedTriggers;
    if (!triggers || triggers.length === 0) return undefined;
    let owed: Record<string, number> | undefined;
    for (let i = 0; i < triggers.length; i++) {
        const t = triggers[i];
        if (t.controller !== playerId || t.targetPlayerId !== playerId) {
            continue;
        }
        if (!UPKEEP_TIMINGS.has(t.timing)) continue;
        const script = delayedScript(t);
        if (!script) continue;
        const cost = lossObligationManaCost(script);
        if (cost) addCost((owed ??= {}), cost);
    }
    return owed;
}

/** The summed mana cost of the pay-or-lose obligations of `playerId` that
 *  have FIRED — delayed triggers on the stack (CR 603.7a), paid from the
 *  board as it stands, with no untap between now and the payment. A leaf
 *  can stand in the Bot's upkeep with the obligation exactly here.
 *  `undefined` for none, or when the payer has another item on the stack (it
 *  may add a source first). */
function firedObligationCost(
    state: GameState,
    playerId: string
): Record<string, number> | undefined {
    let owed: Record<string, number> | undefined;
    let ownOther = false;
    for (let i = 0; i < state.stack.length; i++) {
        const item = state.stack[i];
        if (item.controllerId !== playerId) continue;
        const script = item.delayedTriggerId
            ? (item.delayedEffects ??
              tryGetDefinition(
                  (item.card as { id?: string }).id ?? ""
              )?.delayedTriggers?.find((t) => t.id === item.delayedTriggerId)
                  ?.effects)
            : undefined;
        const cost = script ? lossObligationManaCost(script) : undefined;
        if (cost) addCost((owed ??= {}), cost);
        else ownOther = true;
    }
    return ownOther ? undefined : owed;
}

/** Whether `playerId` holds a pay-or-lose obligation (CR 603.7a, 104.3e)
 *  their mana sources cannot pay — the game is lost at that payment. Two
 *  readings, each a loss on its own: the obligations queued for the payer's
 *  own next upkeep, paid as ONE sum from their board read untapped; and the
 *  obligations already on the stack, paid as one sum from the board as it
 *  stands. Fails open (`false`) on anything it cannot read soundly; see the
 *  module header. Pure. */
export function holdsUnpayableLossObligation(
    state: GameState,
    playerId: string
): boolean {
    const hasQueued = (state.delayedTriggers?.length ?? 0) > 0;
    if (!hasQueued && state.stack.length === 0) return false;
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return false;
    const fired =
        state.stack.length > 0 && firedObligationCost(state, playerId);
    if (
        fired &&
        !canAddSource(state, player, false) &&
        planManaPayment(state, player, fired) === null
    ) {
        return true;
    }
    const owed = hasQueued && queuedObligationCost(state, playerId);
    if (!owed) return false;
    // The payer's sorcery-speed windows before that upkeep: the rest of
    // their own turn, short of its ending phase (CR 307.1).
    const sorceryWindow =
        state.activePlayerId === playerId &&
        state.phase !== "END_STEP" &&
        state.phase !== "CLEANUP";
    if (canAddSource(state, player, sorceryWindow)) return false;
    const upkeep = atOwnUpkeep(state, player);
    return planManaPayment(upkeep.state, upkeep.player, owed) === null;
}
