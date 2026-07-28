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
    copyArtifact,
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
import { startingTown } from "../../cards/sets/fin";
import { archaeologicalDig } from "../../cards/sets/inv";
import { moxOpal } from "../../cards/sets/som";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import type { GameState, PlayerState, StackItem } from "../state";

// Same two abilities as Starting Town, declared in the OPPOSITE order (the
// any-color/life ability first, the free {C} ability second) — a synthetic
// probe proving the union in `getProducibleManaUnits` doesn't depend on
// declaration order (issue #1695 AC).
const REORDERED_TOWN_ID = "test:reordered-starting-town";
const reorderedStartingTown: CardDefinition = {
    id: REORDERED_TOWN_ID,
    rarity: "rare",
    name: "Reordered Starting Town (test probe)",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "reordered-any-color",
            oracleText: "{T}, Pay 1 life: Add one mana of any color.",
            cost: { tap: true, life: 1 },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
        {
            id: "reordered-colorless",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
    ],
};
registerTokenDefinition(reorderedStartingTown);

// Review finding (issue #1695, PR #1731): the REORDERED_TOWN_ID probe above
// does NOT actually pin declaration-order-independence — both its abilities
// produce exactly 1 unit, so the pre-#1695 "pick the ability with the most
// units, ties go to whichever was seen first" tie-break already keeps the
// FIRST-declared one regardless of which ability that is, and here the
// any-color ability happens to be declared first. Reverting the union fix
// entirely does not turn this test red. The probe below pins the direction
// that DOES turn red on a revert: a LONGER ability (2 units) declared first,
// with a SHORTER, differently-colored ability (1 unit) declared second — the
// old tie-break (strict `>`) never lets the second ability in at all, no
// matter its color, since it can never exceed the first ability's length.
const SHORTER_SECOND_ID = "test:shorter-ability-second";
const shorterAbilitySecond: CardDefinition = {
    id: SHORTER_SECOND_ID,
    rarity: "rare",
    name: "Shorter Ability Second (test probe)",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "shorter-second-colorless-cc",
            oracleText: "{T}: Add {C}{C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 2 }),
            manaProduced: { C: 2 },
        },
        {
            id: "shorter-second-blue-life",
            oracleText: "{T}, Pay 1 life: Add {U}.",
            cost: { tap: true, life: 1 },
            useStack: false,
            effect: (ctx) => ctx.addMana({ U: 1 }),
            manaProduced: { U: 1 },
        },
    ],
};
registerTokenDefinition(shorterAbilitySecond);

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

// issue #1695: a permanent with TWO independent tap-for-mana abilities only
// counted the first-declared ability's colors toward affordability — the
// planner picked a single "best" ability (most units, ties to first) instead
// of treating them as alternatives and unioning their colors. Starting Town
// declares "{T}: Add {C}" first and "{T}, Pay 1 life: Add one mana of any
// color" second; both yield 1 unit, so the tie kept only {C} and the
// any-color option was invisible to a colored spell's Cast gate.
describe("cast affordability with competing tap-mana abilities (issue #1695)", () => {
    function onBattlefield(defId: string, id: string) {
        return makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
    }

    it("Starting Town's any-color (life-cost) ability counts toward a colored spell even though it's declared second", () => {
        const bolt = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [bolt],
            battlefield: [onBattlefield(startingTown.id, "town")],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, bolt)).toContain("cast");
    });

    it("declaration order does not change the result — any-color ability declared FIRST still counts", () => {
        const bolt = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [bolt],
            battlefield: [onBattlefield(REORDERED_TOWN_ID, "town")],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, bolt)).toContain("cast");
    });
});

// Review finding 2 (issue #1695, PR #1731): a real declaration-order guard,
// in the direction the REORDERED_TOWN_ID probe above cannot detect (see the
// comment on `shorterAbilitySecond`). A LONGER colorless ability ({T}: Add
// {C}{C}, 2 units) declared FIRST must not shadow a SHORTER, differently
// colored ability ({T}, Pay 1 life: Add {U}, 1 unit) declared SECOND — the
// pre-#1695 single-"best"-ability tie-break (strict `>`, first-seen wins
// ties) never lets the second ability contribute at all once the first is
// longer, regardless of color. Copy Artifact ({1}{U}) forces BOTH a generic
// pip (only the {C}{C} ability can pay it) and a colored {U} pip (only the
// life-cost ability can pay it) to be satisfied from ONE land, so this only
// passes when the two abilities' outputs are correctly unioned across unit
// positions rather than one ability being picked over the other.
describe("cast affordability — shorter ability declared second (issue #1695 finding 2)", () => {
    function onBattlefield(defId: string, id: string) {
        return makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
    }

    it("a 2-unit colorless ability declared first does not shadow a shorter, differently-colored ability declared second", () => {
        const copy = makeInstance(copyArtifact.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [copy],
            battlefield: [onBattlefield(SHORTER_SECOND_ID, "probe")],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, copy)).toContain("cast");
    });
});

// Review finding 1 (issue #1695, PR #1731, blocking): the union offered casts
// that could never be paid. Archaeological Dig ("{T}: Add {C}." / "{T},
// Sacrifice this land: Add one mana of any color.") has a non-sacrifice tap
// ability, so the real payment authority (`getManaTapOptionsDetailed`'s
// `combined = nonSacrifice.length > 0 ? nonSacrifice : sacrifice`,
// constants.ts) NEVER offers the sacrifice ability's five colors — only {C}
// is ever payable without sacrificing. The old per-ability union in
// `getProducibleManaUnits` didn't know about that preference and folded the
// sacrifice ability's colors in anyway, so a colored spell wrongly showed a
// Cast button the payment step then refused.
describe("cast affordability — Archaeological Dig's sacrifice colors aren't payable (issue #1695 finding 1)", () => {
    function onBattlefield(defId: string, id: string) {
        return makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
    }

    it("Archaeological Dig alone cannot cast a colored spell — only {C} is ever produced without sacrificing", () => {
        const bolt = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [bolt],
            battlefield: [onBattlefield(archaeologicalDig.id, "dig")],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, bolt)).not.toContain("cast");
    });
});

// Re-review regression (issue #1695, PR #1731): `getProducibleManaUnits` used
// to call `getManaTapOptionsDetailed(card, undefined, undefined, …)`, so every
// mana ability's `canActivate` was evaluated against `minimalManaGateView
// (undefined)` = `{ players: [] }` — an empty board — instead of the real one.
// Mox Opal's Metalcraft ("Activate only if you control three or more
// artifacts") is board-dependent: with the board blanked out, `hasMetalcraft`
// always returns false and the ability drops out of the castability gate even
// though the real board (`game.ts`'s payment planner, which passes the real
// battlefields) genuinely satisfies it and would pay the cost. Sol Ring is
// included specifically because its OWN mana ({C}{C}) can't pay Lightning
// Bolt's coloured {R} pip on its own — so this spell is castable ONLY if
// Mox Opal's any-colour mana counts, making the assertion sensitive to a
// revert of the board-threading fix.
describe("cast affordability — board-dependent canActivate must see the real board (issue #1695 re-review)", () => {
    function onBattlefield(defId: string, id: string) {
        return makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
    }

    it("Mox Opal's Metalcraft ability counts toward Lightning Bolt when 3 artifacts are controlled", () => {
        const bolt = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [bolt],
            battlefield: [
                onBattlefield(moxOpal.id, "mox"),
                onBattlefield(ankhOfMishra.id, "ankh"),
                onBattlefield(solRing.id, "ring"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, bolt)).toContain("cast");
    });

    it("Mox Opal alone (metalcraft NOT satisfied, only 1 artifact) does not make Lightning Bolt castable", () => {
        const bolt = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [bolt],
            battlefield: [onBattlefield(moxOpal.id, "mox")],
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
