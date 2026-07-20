// Regression suite for the slim card shape ({card: {id}} — no embedded def
// fields). The pre-existing rules.test.ts inlines fat synthetic cards
// (`{name, manaCost, types, ...}`), so it accidentally exercises a code path
// that production no longer hits: `card.card.manaCost` reads succeed in tests
// but yield `undefined` in production. Production must go through
// `getInstanceManaCost` / `getDefinition`, and these tests prove it does by
// constructing instances via `makeInstance(cardId)` (registry-backed slim).

import { describe, expect, it } from "vitest";
import { getLegalActions } from "../rules";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    ankhOfMishra,
    elvishArchers,
    forest,
    island,
    lightningBolt,
    mountain,
    plains,
    savannahLions,
    serraAngel,
    solRing,
} from "../../cards/sets/lea";
import { metallicRebuke } from "../../cards/sets/aer";
import type { GameState, PlayerState, StackItem } from "../state";

function withTurnOf(state: GameState, playerId: string): GameState {
    return {
        ...state,
        activePlayerId: playerId,
        priorityPlayerId: playerId,
    };
}

describe("cast legality on slim card shape", () => {
    it("Elvish Archers is NOT castable without any mana (CR 601.2f)", () => {
        const card = makeInstance(elvishArchers.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [card],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        const actions = getLegalActions(state, player, card);
        expect(actions).not.toContain("cast");
    });

    it("Elvish Archers IS castable with GG in the pool", () => {
        const card = makeInstance(elvishArchers.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [card],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        const actions = getLegalActions(state, player, card);
        expect(actions).toContain("cast");
    });

    it("Elvish Archers is NOT castable during the opponent's main phase (CR 307.1)", () => {
        const card = makeInstance(elvishArchers.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [card],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 5, C: 0 },
        });
        const p2 = makePlayer("p2");
        const state = withTurnOf(makeState({ players: [p1, p2] }), "p2");

        const actions = getLegalActions(state, p1, card);
        expect(actions).not.toContain("cast");
    });

    it("Savannah Lions (sorcery-timing creature) blocked while stack non-empty (CR 307.1)", () => {
        const lions = makeInstance(savannahLions.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const stackBolt: StackItem = {
            ...makeInstance(lightningBolt.id, {
                controllerId: "p2",
                ownerId: "p2",
                zone: "stack",
            }),
            castById: "p2",
        };
        const player: PlayerState = makePlayer("p1", {
            hand: [lions],
            manaPool: { W: 5, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(
            makeState({ players: [player], stack: [stackBolt] }),
            "p1"
        );

        const actions = getLegalActions(state, player, lions);
        expect(actions).not.toContain("cast");
    });

    it("Lightning Bolt (instant) castable on opponent turn with priority (CR 117.1, 304.1)", () => {
        const bolt = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [bolt],
            manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2");
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });

        const actions = getLegalActions(state, p1, bolt);
        expect(actions).toContain("cast");
    });
});

// issue #132: the affordability precheck counted each untapped source as one
// mana, so a {C}{C} source (Sol Ring) was treated as a single mana and spells
// it could pay for showed no Cast action until it was tapped manually.
describe("cast affordability with multi-mana sources (issue #132)", () => {
    function onBattlefield(defId: string, id: string) {
        return makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
    }

    it("Sol Ring alone ({C}{C}) pays a {2} spell — counts as two mana", () => {
        const ankh = makeInstance(ankhOfMishra.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [ankh],
            battlefield: [onBattlefield(solRing.id, "ring")],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, ankh)).toContain("cast");
    });

    it("repro: 2 Plains + Forest + untapped Sol Ring casts Serra Angel ({3}{W}{W})", () => {
        const angel = makeInstance(serraAngel.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [angel],
            battlefield: [
                onBattlefield(plains.id, "pl1"),
                onBattlefield(plains.id, "pl2"),
                onBattlefield(forest.id, "fo1"),
                onBattlefield(solRing.id, "ring"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, angel)).toContain("cast");
    });

    it("no false positive: 2 Plains + Sol Ring (4 mana) cannot cast Serra Angel (5)", () => {
        const angel = makeInstance(serraAngel.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [angel],
            battlefield: [
                onBattlefield(plains.id, "pl1"),
                onBattlefield(plains.id, "pl2"),
                onBattlefield(solRing.id, "ring"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, angel)).not.toContain("cast");
    });

    it("colored pips respected: Sol Ring's colorless cannot pay a {R} spell", () => {
        const bolt = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [bolt],
            battlefield: [onBattlefield(solRing.id, "ring")],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, bolt)).not.toContain("cast");
    });
});

// CR 702.126 (issue #1313): Improvise lets untapped artifacts pay the generic
// portion of the spell's own cost. The castability gate (coloredCostLeftover)
// had no branch for it, so a spell payable only by tapping artifacts was judged
// unaffordable and its Cast action hidden even with the artifacts sitting
// untapped. Metallic Rebuke ({2}{U}) is AER's Improvise carrier; Ankh of Mishra
// is an artifact with NO mana ability, so it counts ONLY through Improvise.
describe("cast affordability with Improvise (CR 702.126)", () => {
    function onBattlefield(defId: string, id: string) {
        return makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
    }

    // Metallic Rebuke counters "target spell", so the cast is only offered when
    // a spell is on the stack to target — put an opponent's Bolt there.
    function stateWithRebuke(battlefield: ReturnType<typeof onBattlefield>[]) {
        const rebuke = makeInstance(metallicRebuke.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const stackBolt: StackItem = {
            ...makeInstance(lightningBolt.id, {
                controllerId: "p2",
                ownerId: "p2",
                zone: "stack",
            }),
            castById: "p2",
        };
        const p1 = makePlayer("p1", {
            hand: [rebuke],
            battlefield,
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2");
        const state = withTurnOf(
            makeState({ players: [p1, p2], stack: [stackBolt] }),
            "p1"
        );
        return { state, p1, rebuke };
    }

    it("castable: 1 Island pays {U}, 2 artifacts pay {2} via Improvise", () => {
        const { state, p1, rebuke } = stateWithRebuke([
            onBattlefield(island.id, "is1"),
            onBattlefield(ankhOfMishra.id, "ak1"),
            onBattlefield(ankhOfMishra.id, "ak2"),
        ]);
        expect(getLegalActions(state, p1, rebuke)).toContain("cast");
    });

    it("NOT castable: 1 Island and no artifacts — Improvise has nothing to tap", () => {
        const { state, p1, rebuke } = stateWithRebuke([
            onBattlefield(island.id, "is1"),
        ]);
        expect(getLegalActions(state, p1, rebuke)).not.toContain("cast");
    });

    it("Improvise cannot pay the {U} pip: only a Mountain + artifacts ⇒ not castable", () => {
        const { state, p1, rebuke } = stateWithRebuke([
            onBattlefield(mountain.id, "mt1"),
            onBattlefield(ankhOfMishra.id, "ak1"),
            onBattlefield(ankhOfMishra.id, "ak2"),
            onBattlefield(ankhOfMishra.id, "ak3"),
        ]);
        expect(getLegalActions(state, p1, rebuke)).not.toContain("cast");
    });
});
