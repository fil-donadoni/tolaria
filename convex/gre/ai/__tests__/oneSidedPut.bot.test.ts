/**
 * A spell letting each player put a card from hand onto the battlefield, cast
 * with nothing of the caster's to put (CR 608.2d): the search below the root
 * stops re-offering it. The blade entries are the `cheat into play` Show and
 * Tell pair; this file names the mechanism.
 */

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { EffectOp } from "../../../cards/types";
import { buildBladeState, findBladeScenario } from "../blade";
import { seatPlayerId } from "../blade/matcher";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { cloneGameState } from "../../clone";
import { enumerateMoves, type Move } from "../../moves";
import { makeRng } from "../../rng";
import { applyMoveInSearch, isOneSidedPutCast, rollout } from "../../search";
import type { GameState } from "../../state";
import { eachPlayerHandPutTypes } from "../oneSidedPut";

const HOLDS =
    "cheat into play: holds Show and Tell when only the opponent has a fatty";
const CASTS = "cheat into play: casts Show and Tell with Griselbrand in hand";

function stateOf(label: string): GameState {
    const entry = findBladeScenario(label);
    if (!entry) throw new Error(`No blade entry "${label}"`);
    return buildBladeState(entry);
}

function castOf(state: GameState, botId: string): Move {
    const move = enumerateMoves(state, botId).find((m) => {
        if (m.kind !== "cast-spell") return false;
        const me = state.players.find((p) => p.id === botId);
        const held = me?.hand.find((c) => c.id === m.cardInstanceId);
        const id = (held?.card as { id?: string } | undefined)?.id;
        return id === getCardByName("Show and Tell").id;
    });
    if (!move) throw new Error("no Show and Tell cast offered");
    return move;
}

describe("the script of a put from each player's hand", () => {
    const script = getCardByName("Show and Tell").effects as EffectOp[];
    const each = script[0] as Extract<EffectOp, { op: "forEach" }>;
    const pick = each.effects[0] as Extract<EffectOp, { op: "choice" }>;
    const put = each.effects[1] as Extract<EffectOp, { op: "moveZone" }>;
    const withBody = (body: EffectOp[]): EffectOp[] => [
        { ...each, effects: body },
    ];

    it("reads the types the pick admits", () => {
        expect(eachPlayerHandPutTypes(script)).toEqual([
            "Artifact",
            "Creature",
            "Enchantment",
            "Land",
        ]);
    });

    it("fails closed on every shape it cannot read", () => {
        const draw = { op: "draw", player: "controller", amount: 1 };
        const shapes: EffectOp[][] = [
            // Anything else in the script is worth something on its own.
            [...script, draw as EffectOp],
            [draw as EffectOp, ...script],
            withBody([pick, put, draw as EffectOp]),
            // A pick that cannot be declined, or that another player answers.
            withBody([{ ...pick, count: { min: 1, max: 1 } }, put]),
            withBody([{ ...pick, player: "controller" }, put]),
            // A filter it does not read, or a move that is not this pick's.
            withBody([
                {
                    ...pick,
                    filter: { ...pick.filter, maxManaValue: 3 },
                } as EffectOp,
                put,
            ]),
            withBody([pick, { ...put, cards: { ref: "$other" } }]),
            withBody([pick, { ...put, to: "graveyard" }]),
            withBody([pick, { ...put, from: "graveyard" }]),
            withBody([pick, { ...put, player: "controller" }]),
            // Not a pick from each chooser's own hand.
            withBody([
                { ...pick, kind: "choose-card" } as unknown as EffectOp,
                put,
            ]),
            withBody([{ ...pick, zone: "graveyard" }, put]),
            withBody([{ ...pick, zoneOwnerId: "controller" } as EffectOp, put]),
            withBody([
                { ...pick, bind: undefined } as unknown as EffectOp,
                put,
            ]),
            // Not over the players, or a type filter it cannot list.
            [{ ...each, select: { set: "creatures" } } as unknown as EffectOp],
            withBody([
                { ...pick, filter: { type: "Creature" } } as EffectOp,
                put,
            ]),
        ];
        for (const shape of shapes) {
            expect(eachPlayerHandPutTypes(shape)).toBeUndefined();
        }
    });
});

describe("the cast that puts nothing of the caster's", () => {
    it("is dropped with no card to put, for the bot only", () => {
        const state = stateOf(HOLDS);
        const me = seatPlayerId(state, "me");
        const opp = seatPlayerId(state, "opp");
        const cast = castOf(state, me);
        expect(isOneSidedPutCast(state, me, me, cast)).toBe(true);
        expect(isOneSidedPutCast(state, me, opp, cast)).toBe(false);
    });

    it("stays open with a card the pick admits", () => {
        const state = stateOf(CASTS);
        const me = seatPlayerId(state, "me");
        expect(isOneSidedPutCast(state, me, me, castOf(state, me))).toBe(false);
    });

    it("stays open with a land to put, and not with a spell the pick refuses", () => {
        const entry = findBladeScenario(HOLDS);
        if (!entry) throw new Error(`No blade entry "${HOLDS}"`);
        const holding = (name: string): boolean => {
            const state = buildBladeState({
                ...entry,
                spec: {
                    ...entry.spec,
                    cards: [
                        ...(entry.spec.cards ?? []),
                        { name, owner: "me", zone: "hand" },
                    ],
                },
            });
            const me = seatPlayerId(state, "me");
            return isOneSidedPutCast(state, me, me, castOf(state, me));
        };
        expect(holding("Island")).toBe(false);
        expect(holding("Lightning Bolt")).toBe(true);
    });

    it("is never spent by a rollout of the line that holds it", () => {
        const state = stateOf(HOLDS);
        const me = seatPlayerId(state, "me");
        const showAndTell = getCardByName("Show and Tell").id;
        for (let seed = 0; seed < 20; seed++) {
            const world = cloneGameState(state);
            applyMoveInSearch(world, me, { kind: "pass" });
            rollout(world, me, makeRng(seed), DEFAULT_EVAL_WEIGHTS);
            const seat = world.players.find((p) => p.id === me)!;
            expect(seat.graveyard.map((c) => c.card.id)).not.toContain(
                showAndTell
            );
        }
    });
});
