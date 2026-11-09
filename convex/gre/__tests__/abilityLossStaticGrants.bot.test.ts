// CR 613.1f (issue #7942) — the Bot's half of "a battlefield-static grant ends
// with its ability": under a real layer-6 suppressor (Humility), the move
// enumerator offers no escape / retrace / graveyard-land move the grant would
// have licensed, and the evaluator stops crediting the escape engine. The GRE
// half (the resolvers and the wire) is `abilityLossStaticGrants.test.ts`.

import { describe, it, expect } from "vitest";
import {
    beginApplyingStaticEffects,
    getPlayer,
    recomputeContinuousEffects,
    removePermanentTo,
    type CardInstanceState,
    type GameState,
} from "../state";
import { enumerateMoves } from "../moves";
import { evaluateBreakdown } from "../evaluate";
import { getCardByName, getDefinition } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const HUMILITY = getCardByName("Humility").id;
const BREACH = getCardByName("Underworld Breach").id;
const SIX = getCardByName("Six").id;
const BEARS = getCardByName("Grizzly Bears").id;
const BOLT = getCardByName("Lightning Bolt").id;
const FOREST = getCardByName("Forest").id;
const MOUNTAIN = getCardByName("Mountain").id;

/** Underworld Breach's grant on a CREATURE body, so Humility is its real
 *  layer-6 suppressor. */
const BREACH_CREATURE_ID = "test-7942-bot-breach-creature";
function breachCreature(): CardDefinition {
    return {
        ...getDefinition(BREACH),
        id: BREACH_CREATURE_ID,
        name: "Breach Creature (bot test)",
        types: ["Creature"],
        power: 1,
        toughness: 1,
    };
}

function p1Card(
    defId: string,
    zone: CardInstanceState["zone"],
    id: string
): CardInstanceState {
    return makeInstance(defId, {
        id,
        zone,
        controllerId: "p1",
        ownerId: "p1",
    });
}

function board(over: Parameters<typeof makePlayer>[1]): GameState {
    return makeState({
        players: [makePlayer("p1", over), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function suppress(state: GameState): void {
    const source = p1Card(HUMILITY, "battlefield", "humility");
    getPlayer(state, "p1").battlefield.push(source);
    beginApplyingStaticEffects(state, source);
    recomputeContinuousEffects(state);
}

function release(state: GameState): void {
    removePermanentTo(state, "humility", "graveyard");
    recomputeContinuousEffects(state);
}

function castsFromGraveyard(state: GameState, cardId: string): boolean {
    return enumerateMoves(state, "p1").some(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === cardId
    );
}

describe("Bot: ability loss ends a battlefield-static grant (CR 613.1f, issue #7942)", () => {
    it("offers no RETRACE cast while Six is under Humility, and offers it again once Humility leaves", () => {
        const state = board({
            battlefield: [
                p1Card(SIX, "battlefield", "six"),
                p1Card(FOREST, "battlefield", "f1"),
                p1Card(FOREST, "battlefield", "f2"),
            ],
            graveyard: [p1Card(BEARS, "graveyard", "bears")],
            hand: [p1Card(FOREST, "hand", "handForest")],
            landsPlayedThisTurn: 1,
        });
        expect(castsFromGraveyard(state, "bears")).toBe(true);
        suppress(state);
        expect(castsFromGraveyard(state, "bears")).toBe(false);
        release(state);
        expect(castsFromGraveyard(state, "bears")).toBe(true);
    });

    it("offers no ESCAPE cast and credits no graveyard engine while the granter is under Humility", () => {
        withTemporaryDefinition(breachCreature(), () => {
            const state = board({
                battlefield: [
                    p1Card(BREACH_CREATURE_ID, "battlefield", "breach"),
                    p1Card(MOUNTAIN, "battlefield", "m1"),
                ],
                graveyard: [
                    p1Card(BOLT, "graveyard", "bolt"),
                    ...[1, 2, 3, 4, 5, 6, 7].map((n) =>
                        p1Card(BOLT, "graveyard", `fodder${n}`)
                    ),
                ],
            });
            const engine = () => evaluateBreakdown(state, "p1").self.graveyard;
            expect(castsFromGraveyard(state, "bolt")).toBe(true);
            expect(engine()).toBeGreaterThan(0);

            suppress(state);
            expect(castsFromGraveyard(state, "bolt")).toBe(false);
            expect(engine()).toBe(0);

            release(state);
            expect(castsFromGraveyard(state, "bolt")).toBe(true);
            expect(engine()).toBeGreaterThan(0);
        });
    });
});
