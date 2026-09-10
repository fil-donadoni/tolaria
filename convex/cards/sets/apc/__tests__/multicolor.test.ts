// Per-card behaviour tests for APC gold cards (`convex/cards/sets/apc/multicolor.ts`).
//
// Life // Death is the whole subject here (issue #3308, ADR 0121 §6 slice 2).
// Its two halves reuse only already-exercised Ops, so the per-Op regime owes
// no test — what it does NOT cover is the three CARD-level claims, each of
// which fails silently:
//
//   * CR 709.4b — off the stack the card is GREEN AND BLACK with mana value 3.
//     That is what a tutor, a deck-legality check and the Bot's valuation all
//     read, and an authored combination that disagreed with the rule would
//     look like a perfectly ordinary card.
//   * CR 611.2c — "All lands you control become 1/1 creatures until end of
//     turn" fixes its set of objects when the continuous effect BEGINS. A land
//     entering the battlefield afterwards is not animated. Nothing else in the
//     card would notice if `forEach`'s frozen member set were re-scanned.
//   * CR 205.1b — "They're still lands": the Creature type is ADDED, so the
//     animated permanent is a land AND a creature at once, taps for mana, and
//     dies to the CR 704.5f toughness SBA.

import { describe, expect, it } from "vitest";
import { getDefinition } from "../../../index";
import { splitHalfDefinitionId } from "../../../splitCard";
import { getCardColors } from "../../../colors";
import { manaValue } from "../../../../gre/constants";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { finalizeCleanup } from "../../../../gre/phases";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { checkStateBasedActions } from "../../../../gre/sba";
import { projectPublicState } from "../../../../gameProjections";
import { applyCastModeCharacteristics } from "../../../../gre/castMode";
import { NO_BOARD_LAYER_VIEW } from "../../../../gre/layers";
import { splitCastAltCostId } from "../../../../gre/splitCast";

// Resolved through the REGISTRY SEAM by id, never by name: `getCardByName`
// reads the name registry, which `preloadDefinitions` never writes, so a
// name-keyed subject is blind to an identity swap (`card-test-seam-boundary`).
const LIFE_DEATH = getDefinition("7ab75cdb-93a1-4f78-b404-37566295c321");
const LIFE = getDefinition(splitHalfDefinitionId(LIFE_DEATH.id, "left"));
const DEATH = getDefinition(splitHalfDefinitionId(LIFE_DEATH.id, "right"));
const FOREST = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b").id;
const SWAMP = getDefinition("6176936d-72e2-4205-8871-4c5a4f1cb2d8").id;
const HILL_GIANT = getDefinition("0ddb98e8-13fe-4786-83f7-b72c56db135a");

/** The stack item a committed half cast produces, built the way every commit
 *  site in `game.ts` builds one — spread the card out of its zone, stamp the
 *  half's identity on it (CR 709.3b), push. Never a hand-written stand-in. */
function castHalf(
    state: GameState,
    side: "left" | "right",
    targets: StackItem["targets"] = []
): StackItem {
    const player = state.players[0];
    const card = player.hand.splice(
        player.hand.findIndex((c) => c.id === "split"),
        1
    )[0];
    const item: StackItem = {
        ...card,
        zone: "stack",
        castById: "p1",
        targets,
    };
    applyCastModeCharacteristics(
        NO_BOARD_LAYER_VIEW,
        item,
        splitCastAltCostId(LIFE_DEATH, side)
    );
    state.stack.push(item);
    return item;
}

const land = (id: string, cardId: string): CardInstanceState =>
    makeInstance(cardId, { id, controllerId: "p1", ownerId: "p1" });

const onBattlefield = (state: GameState, id: string): CardInstanceState =>
    state.players[0].battlefield.find((c) => c.id === id)!;

describe("Life // Death — CR 709.4b, the combined card off the stack", () => {
    // The ADR's own worked example, and the one fact every graveyard reader
    // sees: "a split card's colors and mana value are determined from its
    // combined mana cost", and {G} + {1}{B} is {1}{B}{G}.
    it("is a GREEN AND BLACK card with mana value 3", () => {
        expect(LIFE_DEATH.name).toBe("Life // Death");
        expect(getCardColors(LIFE_DEATH).sort()).toEqual(["B", "G"]);
        expect(manaValue(LIFE_DEATH.manaCost)).toBe(3);
        // CR 709.4c — every card type on either half. Both are sorceries, so
        // the union is one type, deduplicated.
        expect(LIFE_DEATH.types).toEqual(["Sorcery"]);
    });

    // CR 709.3b — on the stack only the cast half's characteristics exist:
    // Life is a {G} green spell with mana value 1, not the combination.
    it("each half twin carries only its OWN cost (CR 709.3b)", () => {
        expect(LIFE.name).toBe("Life");
        expect(DEATH.name).toBe("Death");
        expect(getCardColors(LIFE)).toEqual(["G"]);
        expect(manaValue(LIFE.manaCost)).toBe(1);
        expect(getCardColors(DEATH)).toEqual(["B"]);
        expect(manaValue(DEATH.manaCost)).toBe(2);
    });
});

describe("Life — mass land animation, CR 611.2c / 205.1b", () => {
    /** p1 has `lands` lands on the battlefield and Life // Death in hand. */
    function position(lands: string[]): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(LIFE_DEATH.id, {
                            id: "split",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: lands.map((cardId, i) =>
                        land(`land${i}`, cardId)
                    ),
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(FOREST, {
                            id: "oppLand",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
    }

    it("animates every land its controller has, and nobody else's (CR 205.1b — still lands)", () => {
        const state = position([FOREST, FOREST, SWAMP]);
        castHalf(state, "left");
        resolveTopOfStack(state);

        for (const id of ["land0", "land1", "land2"]) {
            const animated = onBattlefield(state, id);
            // "They're still lands" — CR 205.1b's "in addition to", so BOTH
            // card types are present; the effect never replaces the line.
            expect(animated.types).toContain("Creature");
            expect(animated.types).toContain("Land");
            expect(getEffectivePower(state, animated)).toBe(1);
            expect(getEffectiveToughness(state, animated)).toBe(1);
        }
        // "you control" — the opponent's Forest is untouched.
        const theirs = state.players[1].battlefield[0];
        expect(theirs.types).not.toContain("Creature");

        // Wire format (`.claude/rules/gre-development.md`): the projection
        // strips fat fields, so a GRE-only assertion passes while the client
        // renders a non-creature land.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "land0"
        )!;
        expect(slim.types).toContain("Creature");
        expect(slim.types).toContain("Land");
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
    });

    // CR 611.2c — "the set of objects it affects is determined when that
    // continuous effect begins. After that point, the set won't change."
    it("does NOT animate a land that enters AFTER the effect resolves", () => {
        const state = position([FOREST]);
        castHalf(state, "left");
        resolveTopOfStack(state);
        expect(onBattlefield(state, "land0").types).toContain("Creature");

        // A land played later the same turn. The continuous effect has already
        // begun, so its frozen set cannot grow to include this one.
        state.players[0].battlefield.push(land("lateLand", SWAMP));
        const late = onBattlefield(state, "lateLand");
        expect(late.types).not.toContain("Creature");
        expect(late.animation).toBeUndefined();
        expect(late.power).toBeUndefined();
        expect(late.toughness).toBeUndefined();
    });

    // CR 704.5f — a creature with toughness 0 is put into its owner's
    // graveyard. An animated land IS a creature, so the SBA reaches it.
    it("dies to the toughness SBA once animated (CR 704.5f)", () => {
        const state = position([FOREST]);
        castHalf(state, "left");
        resolveTopOfStack(state);
        const animated = onBattlefield(state, "land0");
        expect(animated.types).toContain("Creature");

        // -1/-1 on a 1/1 base: toughness 0.
        animated.counters = { "-1/-1": 1 };
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "land0")
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("land0");
    });

    // CR 514.2 — "until end of turn" effects end in the CLEANUP step, so the
    // land is STILL a creature right up to that turn-based action.
    it("stays a creature until the cleanup step, then reverts to a plain land (CR 514.2)", () => {
        const state = position([FOREST]);
        castHalf(state, "left");
        resolveTopOfStack(state);

        state.phase = "END_STEP";
        expect(onBattlefield(state, "land0").types).toContain("Creature");

        state.phase = "CLEANUP";
        finalizeCleanup(state);
        const after = onBattlefield(state, "land0");
        expect(after.types).not.toContain("Creature");
        expect(after.types).toContain("Land");
        expect(after.animation).toBeUndefined();
    });
});

describe("Death — reanimation out of YOUR graveyard, CR 400.7 / 119.3", () => {
    function position(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(LIFE_DEATH.id, {
                            id: "split",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    graveyard: [
                        makeInstance(HILL_GIANT.id, {
                            id: "giant",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("returns the targeted creature card to the battlefield and loses life equal to its mana value", () => {
        const state = position();
        castHalf(state, "right", [
            { type: "graveyard-card", id: "giant", playerId: "p1" },
        ]);
        resolveTopOfStack(state);

        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "giant"
        );
        expect(reanimated).toBeDefined();
        expect(reanimated!.controllerId).toBe("p1");
        expect(state.players[0].graveyard.some((c) => c.id === "giant")).toBe(
            false
        );
        // Hill Giant is {3}{R} — mana value 4 (CR 202.3), snapshotted BEFORE
        // the zone change (CR 608.2h).
        expect(manaValue(HILL_GIANT.manaCost)).toBe(4);
        expect(state.players[0].life).toBe(20 - 4);
    });

    // "from YOUR graveyard" — walked through the engine's own legal-target
    // scan, not by re-reading the requirement off the definition. An
    // identically-typed creature card in the opponent's graveyard must not be
    // offered, and a non-creature card in the caster's own must not either.
    it("offers only creature cards in the caster's OWN graveyard (CR 601.2c)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(HILL_GIANT.id, {
                            id: "mine",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                        makeInstance(FOREST, {
                            id: "myLand",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    graveyard: [
                        makeInstance(HILL_GIANT.id, {
                            id: "theirs",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "graveyard",
                        }),
                    ],
                }),
            ],
        });
        const ids = getLegalTargets(
            state,
            DEATH.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(ids).toContain("mine");
        expect(ids).not.toContain("theirs");
        expect(ids).not.toContain("myLand");
    });
});
