// Per-card behaviour tests for APC black cards
// (`convex/cards/sets/apc/black.ts`).
//
// Both cards are hand-tail (issue #3806) and both carry a card-level claim no
// Op test makes:
//
//   * Dead Ringers — the printed line is a DOUBLE NEGATIVE ("unless either one
//     is a color the other isn't") over a colour SET, and every cheaper
//     reading is wrong in a way that still looks like a working card:
//     `sharesColor` destroys a gold/mono pair it must spare, and any
//     "shares nothing" reading spares two colourless creatures it must
//     destroy. The gate is also at RESOLUTION, not at targeting: a mismatched
//     pair is perfectly legal to target and simply does nothing.
//   * Mind Extraction — the discard reads the colours of a creature that is
//     already in the graveyard (CR 608.2h), and a colourless victim must
//     discard NOTHING. The fail-open shape of that read empties the hand.
//
// The cost → snapshot half of Mind Extraction runs through `game.ts` in
// `convex/__tests__/sacrificedColorsFullPath.test.ts`; these tests exercise
// the REAL card definitions at resolution.
//
// Resolved through the REGISTRY SEAM by id, never by name.
import { describe, expect, it } from "vitest";
import { getDefinition } from "../../../index";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";

const DEAD_RINGERS = getDefinition("9b78028c-3ebd-432d-b628-e1fa284f08f3");
const MIND_EXTRACTION = getDefinition("7d77ddcc-e66b-4036-8a55-ec42953918d1");

/** Angus Mackenzie — {G}{W}{U}, nonblack and multicoloured. */
const GOLD_CREATURE = getDefinition("57264bd9-94f6-4d4d-baff-2b2900585635");
/** Grizzly Bears — {1}{G}, nonblack and monocoloured. */
const GREEN_CREATURE = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
/** Ornithopter — colourless (CR 105.2c). */
const COLORLESS_CREATURE = getDefinition(
    "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0"
);
/** Barktooth Warbeard — {4}{B}{R}, so BLACK: never a legal target. */
const BLACK_CREATURE = getDefinition("0ea52228-f8ad-4623-9e05-f162473bfc03");
/** Dark Ritual — a black card in hand. */
const BLACK_CARD = getDefinition("ebb6664d-23ca-456e-9916-afcd6f26aa7f");
/** Lightning Bolt — a red card in hand. */
const RED_CARD = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");

describe("Dead Ringers — destroy two target nonblack creatures unless either is a color the other isn't (CR 105.2 / 608.2b, issue #3806)", () => {
    /** p2 controls the two creatures named by definition id. */
    function board(aDef: string, bDef: string): GameState {
        const a = makeInstance(aDef, {
            id: "a",
            controllerId: "p2",
            ownerId: "p2",
        });
        const b = makeInstance(bDef, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [a, b] }),
            ],
        });
    }

    function cast(state: GameState, bId = "b"): string[] {
        pushSpell(state, DEAD_RINGERS.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: bId },
        ]);
        resolveTopOfStack(state);
        return state.players[1].battlefield.map((c) => c.id).sort();
    }

    it("destroys both when the colour SETS are equal", () => {
        expect(cast(board(GREEN_CREATURE.id, GREEN_CREATURE.id))).toEqual([]);
    });

    // The `sharesColor` misparse: a green-white-blue creature SHARES green
    // with a mono-green one, and green is a colour it isn't. Neither dies.
    it("destroys NEITHER when one is a colour the other isn't", () => {
        expect(cast(board(GOLD_CREATURE.id, GREEN_CREATURE.id))).toEqual([
            "a",
            "b",
        ]);
    });

    // CR 105.2c — colourless is the absence of colour, not a sixth colour:
    // neither is a colour the other isn't, so both die.
    it("destroys two COLOURLESS creatures (CR 105.2c)", () => {
        expect(
            cast(board(COLORLESS_CREATURE.id, COLORLESS_CREATURE.id))
        ).toEqual([]);
    });

    it("destroys neither when only one is colourless", () => {
        expect(cast(board(COLORLESS_CREATURE.id, GREEN_CREATURE.id))).toEqual([
            "a",
            "b",
        ]);
    });

    // The "unless" is a RESOLUTION gate, not a targeting restriction: a
    // mismatched pair is legal to announce and simply does nothing.
    it("targets any two NONBLACK creatures — the colour gate is not a targeting one", () => {
        const state = board(GOLD_CREATURE.id, GREEN_CREATURE.id);
        const black = makeInstance(BLACK_CREATURE.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(black);
        const legal = getLegalTargets(
            state,
            DEAD_RINGERS.targetRequirement!,
            "p1",
            NO_TARGETING_SOURCE
        );
        const ids = legal
            .filter((t) => t.type === "permanent")
            .map((t) => (t as { id: string }).id)
            .sort();
        expect(ids).toEqual(["a", "b"]);
    });

    // CR 608.2b — "if part of the effect requires information about an
    // illegal target, it fails to determine any such information".
    it("destroys neither when one target is gone (CR 608.2b)", () => {
        const state = board(GREEN_CREATURE.id, GREEN_CREATURE.id);
        expect(() => cast(state, "ghost")).not.toThrow();
        expect(state.players[1].battlefield.map((c) => c.id).sort()).toEqual([
            "a",
            "b",
        ]);
    });
});

describe("Mind Extraction — discard all cards of each of the sacrificed creature's colors (CR 105.2 / 608.2h, issue #3806)", () => {
    /** p2's hand is one green creature, one black card and one red card;
     *  `colors` is the cost-sacrifice snapshot stamped on the stack item. */
    function run(colors: string[] | undefined): {
        graveyard: string[];
        hand: string[];
        revealed: boolean;
    } {
        const cards: CardInstanceState[] = [
            GREEN_CREATURE.id,
            BLACK_CARD.id,
            RED_CARD.id,
        ].map((defId, i) =>
            makeInstance(defId, {
                id: `h${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: cards })],
        });
        const item = pushSpell(state, MIND_EXTRACTION.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "victim",
            mv: 2,
            ...(colors !== undefined ? { colors: colors as never[] } : {}),
        };
        resolveTopOfStack(state);
        const player = state.players[1];
        return {
            graveyard: player.graveyard.map((c) => c.id).sort(),
            hand: player.hand.map((c) => c.id).sort(),
            // CR 701.20a — the reveal happens regardless of what is discarded.
            revealed: [...player.hand, ...player.graveyard].every(
                (c) => (c.knownTo ?? []).length > 0
            ),
        };
    }

    it("discards every card of the sacrificed creature's colour", () => {
        const out = run(["G"]);
        expect(out.graveyard).toEqual(["h0"]);
        expect(out.hand).toEqual(["h1", "h2"]);
    });

    it("discards the UNION for a multicoloured victim", () => {
        expect(run(["B", "R"]).graveyard).toEqual(["h1", "h2"]);
    });

    // CR 105.2c — no colours, so no card is "of" them. The reveal still
    // happened; the discard found nothing.
    it("discards NOTHING for a colourless victim, but still reveals (CR 105.2c / 701.20a)", () => {
        const out = run([]);
        expect(out.graveyard).toEqual([]);
        expect(out.hand).toEqual(["h0", "h1", "h2"]);
        expect(out.revealed).toBe(true);
    });

    it("discards nothing with no snapshot colours at all (CR 608.2b)", () => {
        expect(run(undefined).graveyard).toEqual([]);
    });
});
