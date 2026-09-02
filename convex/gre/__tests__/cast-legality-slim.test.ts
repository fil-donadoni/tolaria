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
    crusade,
    elvishArchers,
    forest,
    grizzlyBears,
    island,
    islandSanctuary,
    lightningBolt,
    lordOfAtlantis,
    mountain,
    moxJet,
    moxSapphire,
    plains,
    savannahLions,
    serraAngel,
    solRing,
    swamp,
} from "../../cards/sets/lea";
import { metallicRebuke } from "../../cards/sets/aer";
import { startingTown } from "../../cards/sets/fin";
import {
    archaeologicalDig,
    nomadicElf,
    utopiaTree,
} from "../../cards/sets/inv";
import { farrelitePriest } from "../../cards/sets/fem";
import { moxOpal } from "../../cards/sets/som";
import { urzaLordHighArtificer } from "../../cards/sets/mh1";
import { firebolt } from "../../cards/sets/ody";
import { nethergoyf } from "../../cards/sets/mh3";
import { planarGate } from "../../cards/sets/leg";
import { castRawManaCost } from "../castCost";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
} from "../state";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
    StackItem,
} from "../state";

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

// Issue #2420 review round 2, finding 2 — the widened `requireTap` gate
// (`getManaTapOptionsDetailed`, constants.ts) taught `planManaPayment` about
// a `useStack: false` mana ability whose cost is `cost.mana` (Farrelite
// Priest's "{1}: Add {W}") but NOT `getProducibleManaUnits`, which still
// counted every such option as a free +1 mana unit. A `cost.mana` ability is
// NET ZERO (Farrelite Priest: spends {1}, returns {W}) or net NEGATIVE
// (Nomadic Elf: spends {1}{G}, returns one mana of any color) — never a free
// unit — so `canPotentiallyPayCost` → `getLegalActions` offered "cast" on a
// spell that was NOT actually payable, the exact false-positive-Cast-button
// class issue #1695 (above) exists to prevent. Same shape as Archaeological
// Dig above: the fix must net the ability's own funding cost out of what it
// contributes, not merely admit or exclude it wholesale.
describe("cast affordability — a cost.mana ability is NET mana, not a free unit (issue #2420 review round 2 finding 2)", () => {
    function onBattlefield(defId: string, id: string) {
        return makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
    }

    it("[Farrelite Priest, Plains] cannot cast Island Sanctuary ({1}{W}) — Farrelite Priest is net ZERO mana", () => {
        const spell = makeInstance(islandSanctuary.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [spell],
            battlefield: [
                onBattlefield(farrelitePriest.id, "priest"),
                onBattlefield(plains.id, "plains"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, spell)).not.toContain("cast");
    });

    it("[Nomadic Elf, Forest] cannot cast Grizzly Bears ({1}{G}) — Nomadic Elf is net NEGATIVE mana", () => {
        const spell = makeInstance(grizzlyBears.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [spell],
            battlefield: [
                onBattlefield(nomadicElf.id, "elf"),
                onBattlefield(forest.id, "forest"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, spell)).not.toContain("cast");
    });

    it("[Nomadic Elf, Utopia Tree] cannot cast Crusade ({W}{W}) — Nomadic Elf contributes nothing net", () => {
        const spell = makeInstance(crusade.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [spell],
            battlefield: [
                onBattlefield(nomadicElf.id, "elf"),
                onBattlefield(utopiaTree.id, "tree"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, spell)).not.toContain("cast");
    });
});

// Review round 2, finding 2 (issue #2420) — a `tapOtherFilter` mana ability
// (Urza, Lord High Artificer's "Tap an untapped artifact you control: Add
// {U}.") taps a DIFFERENT permanent than the one activating it. Counting its
// produced mana as an INDEPENDENT unit on top of that SAME artifact's own row
// double-counted a single physical artifact: [Urza, Mox Sapphire] casting
// Lord of Atlantis ({U}{U}) used to offer "cast" even though
// `planManaPayment` (moves.ts) returns null on that exact board — the #1695
// pendingCast trap (a Cast the player can never actually pay for). The
// admission itself is correct and must stay: [Urza, Mox Sapphire, Mox Jet] IS
// genuinely payable (Sapphire's own {U} plus Urza tapping Jet for a second
// {U}) and must still offer "cast" — only the double-count is wrong.
describe("cast affordability — a tapOtherFilter ability must not double-count the permanent it taps (issue #2420 review round 2 finding 2)", () => {
    function onBattlefield(defId: string, id: string) {
        return makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
    }

    it("[Urza, Mox Sapphire] cannot cast Lord of Atlantis ({U}{U}) — only ONE physical artifact to tap", () => {
        const spell = makeInstance(lordOfAtlantis.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [spell],
            battlefield: [
                onBattlefield(urzaLordHighArtificer.id, "urza"),
                onBattlefield(moxSapphire.id, "sapphire"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, spell)).not.toContain("cast");
    });

    it("[Urza, Mox Sapphire, Mox Jet] CAN cast Lord of Atlantis ({U}{U}) — Sapphire's own {U} plus Urza tapping Jet for a second {U}", () => {
        const spell = makeInstance(lordOfAtlantis.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [spell],
            battlefield: [
                onBattlefield(urzaLordHighArtificer.id, "urza"),
                onBattlefield(moxSapphire.id, "sapphire"),
                onBattlefield(moxJet.id, "jet"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, spell)).toContain("cast");
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

// Fourth-pass fix (issue #1695, PR #1731): the third-pass fix above only
// threaded the real board into `canPotentiallyPayCost`'s plain HAND-CAST
// branch — every OTHER call site (flashback/escape/madness/graveyard-
// permission/alternative-cost) still built its `coloredCostLeftover` probe
// with NO state at all, so a board-dependent mana ability was silently
// dropped on every one of those paths. This exercises the FLASHBACK branch
// specifically: Firebolt's flashback cost is {4}{R} (`ody/red.ts`); with Mox
// Opal + 2 other artifacts satisfying Metalcraft and 4 colorless-producing
// Islands covering the generic portion, the {R} pip can ONLY be paid by Mox
// Opal's any-colour ability — exactly the shape that is invisible unless
// this call site also receives the board. Revert-sensitive: removing the
// `state` argument threaded onto the flashback call site
// (`canPotentiallyPayCost(player, card, flashbackMana, state)` in
// `rules.ts`) makes `hasMetalcraft` see an empty board, Mox Opal produces no
// units, and this test goes red.
describe("cast affordability — non-hand-cast board threading (issue #1695 fourth-pass fix)", () => {
    function onBattlefield(defId: string, id: string) {
        return makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
    }

    it("Firebolt's flashback ({4}{R}) is castable from the graveyard when only Mox Opal's Metalcraft ability can pay the {R} pip", () => {
        const bolt = makeInstance(firebolt.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const player = makePlayer("p1", {
            graveyard: [bolt],
            battlefield: [
                onBattlefield(moxOpal.id, "mox"),
                onBattlefield(ankhOfMishra.id, "ank1"),
                onBattlefield(ankhOfMishra.id, "ank2"),
                onBattlefield(island.id, "is1"),
                onBattlefield(island.id, "is2"),
                onBattlefield(island.id, "is3"),
                onBattlefield(island.id, "is4"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, bolt)).toContain("cast");
    });

    it("Firebolt's flashback is NOT castable when Metalcraft is unsatisfied (only 1 artifact) — no other red source", () => {
        const bolt = makeInstance(firebolt.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const player = makePlayer("p1", {
            graveyard: [bolt],
            battlefield: [
                onBattlefield(moxOpal.id, "mox"),
                onBattlefield(island.id, "is1"),
                onBattlefield(island.id, "is2"),
                onBattlefield(island.id, "is3"),
                onBattlefield(island.id, "is4"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, bolt)).not.toContain("cast");
    });
});

// A dead card of a chosen card type sitting in a graveyard — a raw fixture,
// not a real card, used only to make `hasPayableEscapeExileCost`'s "4+
// distinct card types among OTHER graveyard cards" (CR 702.138a, Nethergoyf)
// affordable. Mirrors `deadCard` in `cards/sets/mh3/__tests__/black.test.ts`.
function deadCard(
    id: string,
    owner: string,
    types: CardDefinition["types"]
): CardInstanceState {
    return {
        id,
        card: { id: `fake-${id}` },
        types,
        subtypes: [],
        staticAbilities: [],
        power: 0,
        toughness: 0,
        controllerId: owner,
        ownerId: owner,
        zone: "graveyard",
        isTapped: false,
    };
}

// Issue #1751 finding 6 (coverage gap, not a code fix — the escape branch
// already threads `state` into `canPotentiallyPayCost`, unlike this suite's
// only prior non-hand-cast probe, which exercised flashback exclusively).
// Nethergoyf's escape cost ({2}{B}, CR 702.138) is castable from the
// graveyard when only Mox Opal's Metalcraft ability can pay the {B} pip —
// same shape as the Firebolt flashback test above, on the ESCAPE branch
// instead. Revert-sensitive: dropping the `state` argument at the escape
// call site (`canPotentiallyPayCost(player, card, getEscapeManaCost(state,
// card) ?? {}, state)` in rules.ts) makes Mox Opal's `canActivate` see an
// empty board and this test goes red.
describe("cast affordability — escape board threading (issue #1751 finding 6, coverage for the pre-existing #1695 fourth-pass fix)", () => {
    function onBattlefield(defId: string, id: string) {
        return makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
    }

    // 4 distinct card types among graveyard cards OTHER than Nethergoyf
    // itself, satisfying the escape exile cost (CR 702.138a `minCardTypes: 4`).
    function escapeFillerGraveyard() {
        return [
            deadCard("d1", "p1", ["Land"]),
            deadCard("d2", "p1", ["Instant"]),
            deadCard("d3", "p1", ["Sorcery"]),
            deadCard("d4", "p1", ["Enchantment"]),
        ];
    }

    it("Nethergoyf's escape ({2}{B}) is castable from the graveyard when only Mox Opal's Metalcraft ability can pay the {B} pip", () => {
        const goyf = makeInstance(nethergoyf.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const player = makePlayer("p1", {
            graveyard: [goyf, ...escapeFillerGraveyard()],
            battlefield: [
                onBattlefield(moxOpal.id, "mox"),
                onBattlefield(ankhOfMishra.id, "ank1"),
                onBattlefield(ankhOfMishra.id, "ank2"),
                onBattlefield(island.id, "is1"),
                onBattlefield(island.id, "is2"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, goyf)).toContain("cast");
    });

    it("is NOT castable when Metalcraft is unsatisfied (only 1 artifact) — no other black source", () => {
        const goyf = makeInstance(nethergoyf.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const player = makePlayer("p1", {
            graveyard: [goyf, ...escapeFillerGraveyard()],
            battlefield: [
                onBattlefield(moxOpal.id, "mox"),
                onBattlefield(island.id, "is1"),
                onBattlefield(island.id, "is2"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        expect(getLegalActions(state, player, goyf)).not.toContain("cast");
    });
});

// CR 601.2f / 702.138a (issue #2981, reversing issue #1751 finding 6) — an
// escape cast DOES take the board's cost modifiers.
//
// `bun run cr 702.138a`: "Casting a spell using its escape ability follows the
// rules for paying alternative costs in rules 601.2b and 601.2f-h."
// `bun run cr 601.2f`: "The total cost is the mana cost or alternative cost
// (as determined in rule 601.2b), plus all additional costs and cost
// increases, and minus all cost reductions."
//
// This block used to assert the OPPOSITE — that the then-opt-in
// `foldCostModifiers` separation held for escape, so Planar Gate ("Creature
// spells you cast cost {2} less to cast.") did NOT reduce Nethergoyf's
// {2}{B} escape cost. That separation was never a rule, it was an omission:
// `announceCast` folds the collector onto whatever cost a cast owes, for every
// zone and mechanism with no carve-out, so the gate refused a cast the payment
// prices at {B} — the same gate-vs-payment disagreement issue #2981 fixed on
// the free-exile branch, in the direction that hides a legal cast instead of
// offering an unpayable one. Same board as before, opposite verdict, and both
// sides asserted so they cannot drift apart again.
describe("cast affordability — an escape cast folds cost modifiers (CR 601.2f / 702.138a, issue #2981)", () => {
    function onBattlefield(defId: string, id: string) {
        return makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
    }

    it("Nethergoyf's escape picks up Planar Gate's creature-spell cost reduction, and the payment prices it the same", () => {
        const goyf = makeInstance(nethergoyf.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const player = makePlayer("p1", {
            graveyard: [
                goyf,
                deadCard("d1", "p1", ["Land"]),
                deadCard("d2", "p1", ["Instant"]),
                deadCard("d3", "p1", ["Sorcery"]),
                deadCard("d4", "p1", ["Enchantment"]),
            ],
            battlefield: [
                onBattlefield(planarGate.id, "gate"),
                onBattlefield(swamp.id, "swamp1"),
                // Deliberately NO other mana source: the one Swamp covers the
                // REDUCED {B} and nothing more, so this board discriminates.
                // The unreduced {2}{B} would need two further generic sources.
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        // GATE half — {2}{B} minus Planar Gate's {2} is {B}, which the Swamp
        // pays. (Nethergoyf's four other graveyard cards satisfy escape's own
        // "four or more card types among them" exile cost, so what is being
        // judged here is purely the mana half.)
        expect(getLegalActions(state, player, goyf)).toContain("cast");

        // PAYMENT half — the two calls `announceCast` makes, verbatim, on the
        // same board: the cost authority for the zone, then the collector
        // folded onto it. They must land on the SAME {B} the gate just offered.
        const paid = normalizeManaCost(
            castRawManaCost(state, goyf, "graveyard") ?? {}
        );
        applyCostModifiers(paid, getCostModifiers(state, goyf, "spell"));
        expect(paid).toEqual({ B: 1 });
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
