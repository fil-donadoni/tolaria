// Resolved-script characterisation of the Ops whose FIELD reading the
// field-kind derivation (issue #4451) will move (issue #4477).
//
// Three groups, measured 2026-09-24:
//   - the seven Ops no generated smoke run reaches and at most one test file
//     exercises: `exileTopOfLibrary`, `lockDamage`, `rangedTopdeck`,
//     `restrictActivation`, `reduceSpellCostThisTurn`, `grantManaSubstitution`,
//     `replaceManaProductionColor`;
//   - the Ops whose only direct test was the interpreter file AND that declare
//     a binding or read an amount: `discardAtRandom`, `digMatchingToHand`,
//     `revealTopAndRoute`, `setBasePT` (plus `exileTopOfLibrary` and
//     `rangedTopdeck` above);
//   - the Ops no test named at all (every test reached them through one
//     card): `grantCastTiming`, `grantSpellManaSubstitution`, `redirectDamage`.
//
// Each test feeds the field in the shape the derivation must classify — an
// amount as a COMPUTED `EffectValue` (never the literal the interpreter file
// already uses), an object or player slot through a `ref` / announced target,
// a binding read back through a later Op's `ref` — and asserts the outcome on
// the board, never an internal. A derivation that misfiles one field changes
// a zone, a life total or a legality verdict below.

import { describe, expect, it } from "vitest";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import { getDefinition, registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup";
import {
    getCastManaSubstitutions,
    getCostModifiers,
    getManaSubstitutions,
    isManaCostCovered,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../state";
import { replaceProducedManaColor } from "../../constants";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { activateAbilityOnState } from "../../activation";
import { getEffectivePower, getEffectiveToughness } from "../../layers";
import { getLegalActions } from "../../rules";

/** A 2/5 vanilla Bear, mana value 2 ({1}{G}) — the number every bound-object
 *  read below expects to see (CR 202.3). */
const BEAR_ID = "test-field-kinds-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: BEAR_ID,
    rarity: "common",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 5,
});

/** A land — the non-matching card for the creature filters and the land
 *  route. */
const LAND_ID = "test-field-kinds-land";
registerTokenDefinition({
    id: LAND_ID,
    name: LAND_ID,
    rarity: "common",
    manaCost: {},
    types: ["Land"],
});

/** A creature with a non-mana activated ability, for the activation lock. */
const ACTIVATOR_ID = "test-field-kinds-activator";
registerTokenDefinition({
    id: ACTIVATOR_ID,
    name: ACTIVATOR_ID,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "field-kinds-activate",
            oracleText: "{T}: You gain 1 life.",
            cost: { tap: true },
            useStack: true,
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        },
    ],
});

/** An artifact costing {3}, for the cost reduction. */
const ARTIFACT_ID = "test-field-kinds-artifact";
registerTokenDefinition({
    id: ARTIFACT_ID,
    name: ARTIFACT_ID,
    rarity: "common",
    manaCost: { X: 3 },
    types: ["Artifact"],
});

/** A {R} sorcery held in hand, for the cast-timing and spell-mana grants. */
const HELD_SORCERY_ID = "test-field-kinds-held-sorcery";
registerTokenDefinition({
    id: HELD_SORCERY_ID,
    name: HELD_SORCERY_ID,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [{ op: "gainLife", player: "controller", amount: 1 }],
});

/** Registers a synthetic sorcery under a stable test id, through the same
 *  registry seam a real card hydrates from. */
function registerScript(
    id: string,
    effects: EffectOp[],
    extra: Partial<CardDefinition> = {}
): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
        ...extra,
    });
    return id;
}

const PLAYER_TARGET: Partial<CardDefinition> = {
    targetRequirement: { type: "player", count: 1 },
};

function card(
    cardId: string,
    owner: "p1" | "p2",
    id: string,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone,
    });
}

/** `n` Bears on `owner`'s battlefield — the count every computed amount below
 *  reads (`{ count: { zone: "battlefield", controller } }`, CR 608.2h). */
function bears(owner: "p1" | "p2", n: number): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        card(BEAR_ID, owner, `${owner}-bear${i}`, "battlefield")
    );
}

/** The number of permanents the caster controls, as an `EffectValue`. */
const CASTER_PERMANENTS = {
    count: { zone: "battlefield" as const, controller: "controller" as const },
};

describe("exileTopOfLibrary — computed count, bindAll read back (CR 608.2h)", () => {
    it("exiles as many cards as the computed count, and the bound set sizes a later amount", () => {
        const id = registerScript("test-fk-exile-top", [
            {
                op: "exileTopOfLibrary",
                player: "controller",
                count: CASTER_PERMANENTS,
                bindAll: "$exiled",
            },
            {
                op: "gainLife",
                player: "controller",
                amount: { setSize: { of: { ref: "$exiled" } } },
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: bears("p1", 2),
                    library: ["l0", "l1", "l2", "l3"].map((cid) =>
                        card(BEAR_ID, "p1", cid, "library")
                    ),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].exile.map((c) => c.id)).toEqual(["l0", "l1"]);
        expect(state.players[0].library.map((c) => c.id)).toEqual(["l2", "l3"]);
        // CR 608.2c — the later instruction reads the set the earlier one bound.
        expect(state.players[0].life).toBe(22);
    });
});

describe("lockDamage — the object slot read through a forEach `ref` (CR 615.12)", () => {
    it("locks every creature the loop names, so a prevention shield on each stops nothing", () => {
        const opponentCreatures = {
            set: "permanents" as const,
            zone: "battlefield" as const,
            controller: "opponent" as const,
            filter: { type: "Creature" as const },
        };
        const id = registerScript("test-fk-lock-damage", [
            {
                op: "forEach",
                select: opponentCreatures,
                effects: [{ op: "lockDamage", target: { ref: "$each" } }],
            },
            {
                op: "forEach",
                select: opponentCreatures,
                effects: [
                    { op: "dealDamage", amount: 2, to: { ref: "$each" } },
                ],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: bears("p2", 2) }),
            ],
        });
        state.targetPreventionShields = ["p2-bear0", "p2-bear1"].map(
            (targetId) => ({
                targetType: "permanent" as const,
                targetId,
                remaining: 100,
                duration: { phase: "end-of-turn" as const },
            })
        );
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.damageMarked)).toEqual(
            [2, 2]
        );
    });
});

describe("rangedTopdeck — computed max and costPerKept (CR 119.4)", () => {
    it("caps the choice at the computed max and charges the computed life per kept card", () => {
        const id = registerScript("test-fk-ranged-topdeck", [
            {
                op: "rangedTopdeck",
                player: "controller",
                pool: "drawn-this-turn",
                max: { X: true },
                costPerKept: CASTER_PERMANENTS,
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: bears("p1", 3),
                    hand: [
                        card(BEAR_ID, "p1", "h0", "hand"),
                        card(BEAR_ID, "p1", "h1", "hand"),
                    ],
                    drawnThisTurn: ["h0", "h1"],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, id, "p1");
        item.chosenX = 1;
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        // n = min(max = X = 1, pool = 2).
        expect(head.count).toEqual({ min: 0, max: 1 });
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        // Nothing topdecked: the one chosen slot is KEPT, at 3 life — the
        // caster's three permanents.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["h0", "h1"]);
        expect(state.players[0].life).toBe(17);
    });
});

describe("restrictActivation — the announced player slot (CR 602.5)", () => {
    function withActivator(): GameState {
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        card(ACTIVATOR_ID, "p2", "activator", "battlefield"),
                    ],
                }),
            ],
        });
    }

    function activate(state: GameState): void {
        state.priorityPlayerId = "p2";
        activateAbilityOnState(state, {
            playerId: "p2",
            cardInstanceId: "activator",
            abilityId: "field-kinds-activate",
        });
    }

    it("the targeted player can no longer activate a non-mana ability", () => {
        const id = registerScript(
            "test-fk-restrict-activation",
            [{ op: "restrictActivation", player: { target: 0 } }],
            PLAYER_TARGET
        );
        const state = withActivator();
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(() => activate(state)).toThrow(
            "You can't activate abilities that aren't mana abilities this turn"
        );
    });

    it("the contrast: the untargeted caster's lock leaves the opponent free to activate", () => {
        const id = registerScript(
            "test-fk-restrict-activation-self",
            [{ op: "restrictActivation", player: { target: 0 } }],
            PLAYER_TARGET
        );
        const state = withActivator();
        pushSpell(state, id, "p1", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        activate(state);
        expect(state.stack).toHaveLength(1);
    });
});

describe("reduceSpellCostThisTurn — the announced player slot and the reduction amount (CR 601.2f)", () => {
    it("discounts the TARGETED player's spells by the amount, and nobody else's", () => {
        const id = registerScript(
            "test-fk-reduce-cost",
            [
                {
                    op: "reduceSpellCostThisTurn",
                    player: { target: 0 },
                    amount: { X: 2 },
                },
            ],
            PLAYER_TARGET
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [card(ARTIFACT_ID, "p1", "mine", "hand")],
                }),
                makePlayer("p2", {
                    hand: [card(ARTIFACT_ID, "p2", "theirs", "hand")],
                }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const theirs = state.players[1].hand[0];
        const mine = state.players[0].hand[0];
        expect(getCostModifiers(state, theirs, "spell").reductionGeneric).toBe(
            2
        );
        expect(
            getCostModifiers(state, mine, "spell").reductionGeneric ?? 0
        ).toBe(0);
    });
});

describe("grantManaSubstitution / replaceManaProductionColor — the announced player slot and the colour fields (CR 609.4b / 614.1a)", () => {
    function resolveOnOpponent(
        effects: EffectOp[],
        scriptId: string
    ): GameState {
        const id = registerScript(scriptId, effects, PLAYER_TARGET);
        const state = makeState();
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        return state;
    }

    it("grantManaSubstitution: the targeted player may spend BLUE as any colour; the caster may not", () => {
        const state = resolveOnOpponent(
            [
                {
                    op: "grantManaSubstitution",
                    player: { target: 0 },
                    from: "U",
                    breadth: "any-color",
                },
            ],
            "test-fk-grant-substitution"
        );
        const subs = getManaSubstitutions(state, "p2");
        expect(subs.every((s) => s.from === "U")).toBe(true);
        expect(isManaCostCovered({ U: 1 }, { R: 1 }, subs)).toBe(true);
        expect(isManaCostCovered({ W: 1 }, { R: 1 }, subs)).toBe(false);
        expect(getManaSubstitutions(state, "p1")).toEqual([]);
    });

    it("replaceManaProductionColor: the targeted player's coloured mana comes out BLACK; the caster's is untouched", () => {
        const state = resolveOnOpponent(
            [
                {
                    op: "replaceManaProductionColor",
                    player: { target: 0 },
                    color: "B",
                },
            ],
            "test-fk-replace-color"
        );
        expect(
            replaceProducedManaColor(state, "p2", { R: 1, G: 1, C: 1 })
        ).toEqual({ B: 2, C: 1 });
        expect(replaceProducedManaColor(state, "p1", { R: 1 })).toEqual({
            R: 1,
        });
    });
});

describe("discardAtRandom — computed count, bind read back (CR 701.9b / 608.2h)", () => {
    /** Resolves the script against a p2 hand of three `handCardId` cards, the
     *  caster controlling two permanents. */
    function discardFrom(handCardId: string, scriptId: string): GameState {
        const id = registerScript(
            scriptId,
            [
                {
                    op: "discardAtRandom",
                    player: { target: 0 },
                    count: CASTER_PERMANENTS,
                    bind: "$discarded",
                },
                {
                    op: "if",
                    predicate: {
                        boundMatchesFilter: { ref: "$discarded" },
                        filter: { type: "Creature" },
                    },
                    then: [{ op: "gainLife", player: "controller", amount: 7 }],
                },
            ],
            PLAYER_TARGET
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: bears("p1", 2) }),
                makePlayer("p2", {
                    hand: ["a", "b", "c"].map((cid) =>
                        card(handCardId, "p2", cid, "hand")
                    ),
                }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        return state;
    }

    it("discards the computed number of cards, and a later gate reads the bound card", () => {
        const state = discardFrom(BEAR_ID, "test-fk-discard-random");
        expect(state.players[1].hand).toHaveLength(1);
        expect(state.players[1].graveyard).toHaveLength(2);
        expect(state.players[0].life).toBe(27);
    });

    it("the contrast: a bound non-creature fails the same gate", () => {
        const state = discardFrom(LAND_ID, "test-fk-discard-random-land");
        expect(state.players[1].graveyard).toHaveLength(2);
        expect(state.players[0].life).toBe(20);
    });
});

describe("digMatchingToHand — computed look, bind read back (CR 701.20a)", () => {
    it("looks at the computed number of cards, keeps the matches, and the bound card sizes a later amount", () => {
        const id = registerScript("test-fk-dig-matching", [
            {
                op: "digMatchingToHand",
                player: "controller",
                look: { X: true },
                filter: { type: "Creature" },
                destination: "graveyard",
                bind: "$kept",
            },
            {
                op: "gainLife",
                player: "controller",
                amount: { manaValue: { of: { ref: "$kept" } } },
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        card(LAND_ID, "p1", "land0", "library"),
                        card(BEAR_ID, "p1", "bear1", "library"),
                        card(LAND_ID, "p1", "land2", "library"),
                        card(BEAR_ID, "p1", "bear3", "library"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, id, "p1");
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["bear1"]);
        // The resolved sorcery itself also lands in the graveyard.
        expect(
            state.players[0].graveyard
                .map((c) => c.id)
                .filter((cid) => cid.startsWith("land"))
                .sort()
        ).toEqual(["land0", "land2"]);
        // The fourth card was outside the X = 3 window.
        expect(state.players[0].library.map((c) => c.id)).toEqual(["bear3"]);
        expect(state.players[0].life).toBe(22);
    });
});

describe("revealTopAndRoute — computed count (CR 701.20a)", () => {
    it("reveals and routes the computed number of top cards, leaving the rest", () => {
        const id = registerScript("test-fk-reveal-route", [
            {
                op: "revealTopAndRoute",
                player: "controller",
                count: { X: true },
                routes: [{ filter: { type: "Land" }, to: "battlefield" }],
                fallback: "hand",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        card(BEAR_ID, "p1", "top", "library"),
                        card(LAND_ID, "p1", "second", "library"),
                        card(BEAR_ID, "p1", "third", "library"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, id, "p1");
        item.chosenX = 2;
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["top"]);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "second",
        ]);
        expect(state.players[0].library.map((c) => c.id)).toEqual(["third"]);
    });
});

describe("setBasePT — the power and toughness amounts (CR 613.4b)", () => {
    it("sets base power and toughness to the two numbers, each read from its own field", () => {
        const id = registerScript("test-fk-set-base-pt", [
            {
                op: "setBasePT",
                target: { target: 0 },
                power: 7,
                toughness: 1,
                duration: { phase: "end-of-turn" },
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: bears("p2", 1) }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "p2-bear0" }]);
        resolveTopOfStack(state);
        const bear = state.players[1].battlefield[0];
        expect(getEffectivePower(state, bear)).toBe(7);
        expect(getEffectiveToughness(state, bear)).toBe(1);
    });
});

describe("grantCastTiming — the announced player slot and the card-type list (CR 601.3b)", () => {
    it("the targeted player may cast a Sorcery on the other player's turn; the caster still may not", () => {
        const id = registerScript(
            "test-fk-grant-cast-timing",
            [
                {
                    op: "grantCastTiming",
                    player: { target: 0 },
                    cardTypes: ["Sorcery"],
                },
            ],
            PLAYER_TARGET
        );
        const pool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [card(HELD_SORCERY_ID, "p1", "mine", "hand")],
                    manaPool: { ...pool },
                }),
                makePlayer("p2", {
                    hand: [card(HELD_SORCERY_ID, "p2", "theirs", "hand")],
                    manaPool: { ...pool },
                }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p2",
        });
        const theirs = state.players[1].hand[0];
        expect(getLegalActions(state, state.players[1], theirs)).not.toContain(
            "cast"
        );
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        state.priorityPlayerId = "p2";
        expect(getLegalActions(state, state.players[1], theirs)).toContain(
            "cast"
        );
        // Next turn is p2's: now p1 is the non-active player, and holds no grant.
        state.activePlayerId = "p2";
        state.priorityPlayerId = "p1";
        const mine = state.players[0].hand[0];
        expect(getLegalActions(state, state.players[0], mine)).not.toContain(
            "cast"
        );
    });
});

describe("grantSpellManaSubstitution — the announced player slot and the breadth (CR 609.4b)", () => {
    it("the targeted player's next spell may be paid with mana of any COLOUR — never colourless", () => {
        const id = registerScript(
            "test-fk-grant-spell-substitution",
            [
                {
                    op: "grantSpellManaSubstitution",
                    player: { target: 0 },
                    breadth: "any-color",
                },
            ],
            PLAYER_TARGET
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [card(HELD_SORCERY_ID, "p1", "mine", "hand")],
                }),
                makePlayer("p2", {
                    hand: [card(HELD_SORCERY_ID, "p2", "theirs", "hand")],
                }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const theirs = getCastManaSubstitutions(
            state,
            state.players[1],
            "theirs",
            getDefinition(HELD_SORCERY_ID),
            { R: 1 }
        );
        expect(theirs.length).toBeGreaterThan(0);
        // "any-color", not "any-type": colourless is not a colour (CR 105.1).
        expect(theirs.some((s) => s.to === "C")).toBe(false);
        expect(
            getCastManaSubstitutions(
                state,
                state.players[0],
                "mine",
                getDefinition(HELD_SORCERY_ID),
                { R: 1 }
            )
        ).toEqual([]);
    });
});

describe("redirectDamage — the two recipient slots and a computed amount (CR 614.9)", () => {
    it("the next N damage to the first target — N computed — is dealt to the second instead", () => {
        const redirect = registerScript(
            "test-fk-redirect",
            [
                {
                    op: "redirectDamage",
                    from: { target: 0 },
                    to: { target: 1 },
                    amount: CASTER_PERMANENTS,
                    duration: { phase: "end-of-turn" },
                },
            ],
            { targetRequirement: { type: "any", count: 2 } }
        );
        const burn = registerScript(
            "test-fk-redirect-burn",
            [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
            PLAYER_TARGET
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: bears("p1", 2) }),
                makePlayer("p2", { battlefield: bears("p2", 1) }),
            ],
        });
        pushSpell(state, redirect, "p1", [
            { type: "player", id: "p1" },
            { type: "permanent", id: "p2-bear0" },
        ]);
        resolveTopOfStack(state);
        pushSpell(state, burn, "p2", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        // N = the caster's two permanents: 2 of the 3 move, 1 stays.
        expect(state.players[1].battlefield[0].damageMarked).toBe(2);
        expect(state.players[0].life).toBe(19);
    });
});
