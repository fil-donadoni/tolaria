// A ONE-SIDED PUT — a spell whose whole script lets each player put a card from
// hand onto the battlefield (CR 608.2d), cast by a player holding no card the
// pick admits.
//
// The caster has no legal card to choose, so the spell does nothing for it and
// offers every other player a free permanent. Whether that is the position depends
// only on the caster's hand, which the caster always knows, so it needs no read of
// the opponent's.
//
// Fail closed in every clause, so an unread shape stays a scored option: only a
// script that is this one `forEach` and nothing else, only a pick each player may
// decline from their own hand, only a `type` filter, and only that pick moved from
// hand to its chooser's battlefield.

import type { CardType, EffectOp } from "../../cards/types";
import { tryGetDefinition } from "../../cards";
import type { GameState } from "../state";

const HAND_PUT_FILTER_MEMO = new WeakMap<
    readonly EffectOp[],
    readonly CardType[] | null
>();

/** The card types `effects` lets each player put from hand onto the battlefield,
 *  or `undefined` for any other script. A script is data, so this is read once
 *  per script. */
export function eachPlayerHandPutTypes(
    effects: readonly EffectOp[]
): readonly CardType[] | undefined {
    const memo = HAND_PUT_FILTER_MEMO.get(effects);
    if (memo !== undefined) return memo ?? undefined;
    const types = readHandPutTypes(effects);
    HAND_PUT_FILTER_MEMO.set(effects, types);
    return types ?? undefined;
}

function readHandPutTypes(
    effects: readonly EffectOp[]
): readonly CardType[] | null {
    const each = effects.length === 1 ? effects[0] : undefined;
    if (each?.op !== "forEach" || each.effects.length !== 2) return null;
    const select = each.select as { set?: unknown };
    if (select.set !== "players") return null;
    const [pick, put] = each.effects;
    if (
        pick.op !== "choice" ||
        pick.kind !== "choose-hand-card" ||
        pick.zone !== "hand" ||
        pick.zoneOwnerId !== undefined ||
        !pick.bind
    ) {
        return null;
    }
    const min = (pick.count as { min?: unknown } | undefined)?.min;
    if (min !== 0) return null;
    const chooser = pick.player as { ref?: unknown };
    if (chooser.ref !== "$each") return null;
    const { type, ...rest } = (pick.filter ?? {}) as {
        type?: readonly CardType[] | CardType;
    };
    if (!Array.isArray(type) || Object.keys(rest).length > 0) return null;
    if (
        put.op !== "moveZone" ||
        !("cards" in put) ||
        put.from !== "hand" ||
        put.to !== "battlefield" ||
        (put.player as { ref?: unknown }).ref !== "$each"
    ) {
        return null;
    }
    const moved = put.cards as { ref?: unknown };
    return moved.ref === pick.bind ? type : null;
}

/** Whether `effects`, cast by `casterId` from `spellInstanceId`, is a one-sided
 *  put: the caster's hand, without the spell itself, holds no card the pick
 *  admits. */
export function isEmptyForCaster(
    state: GameState,
    casterId: string,
    effects: readonly EffectOp[],
    spellInstanceId: string
): boolean {
    const types = eachPlayerHandPutTypes(effects);
    if (!types) return false;
    const caster = state.players.find((p) => p.id === casterId);
    if (!caster) return false;
    return !caster.hand.some((c) => {
        if (c.id === spellInstanceId) return false;
        const id = (c.card as { id?: string }).id;
        const def = id ? tryGetDefinition(id) : undefined;
        // Unknown card: it may be puttable, so the cast stays a scored option.
        return !def || def.types.some((t) => types.includes(t));
    });
}
