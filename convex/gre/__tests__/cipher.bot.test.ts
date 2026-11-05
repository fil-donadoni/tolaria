// Cipher (CR 702.99a, issue #4017) as the Bot's evaluator sees it. An encoded card
// is a spell its creature's controller still holds, so the search has a reason to
// encode rather than let the card go to a graveyard, and killing the creature reads
// as losing it. The engine's side is `cipher.test.ts`; the decision itself is a
// `must` blade entry.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { isEncodedForController } from "../cipher";
import { evaluate } from "../evaluate";
import type { CardInstanceState, GameState } from "../state";

const CIPHER_SPELL = "test:bot-cipher-spell";
registerTokenDefinition({
    id: CIPHER_SPELL,
    rarity: "common",
    name: "Test Bot Cipher Spell",
    manaCost: { X: 3, U: 1 },
    types: ["Sorcery"],
    staticAbilities: ["cipher"],
    effects: [{ op: "draw", player: "controller", count: 2 }],
});
const CREATURE = "test:bot-cipher-creature";
registerTokenDefinition({
    id: CREATURE,
    rarity: "common",
    name: "Test Bot Cipher Creature",
    manaCost: { G: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
});

function spell(overrides: Partial<CardInstanceState>): CardInstanceState {
    return makeInstance(CIPHER_SPELL, {
        id: "spell",
        ownerId: "p1",
        controllerId: "p1",
        ...overrides,
    });
}

function bear(controllerId: string): CardInstanceState {
    return makeInstance(CREATURE, {
        id: "bear",
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        power: 2,
        toughness: 2,
    });
}

function position(args: {
    p1Bear?: boolean;
    p2Bear?: boolean;
    p1Exile?: CardInstanceState[];
    p1Graveyard?: CardInstanceState[];
}): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: args.p1Bear ? [bear("p1")] : [],
                exile: args.p1Exile ?? [],
                graveyard: args.p1Graveyard ?? [],
            }),
            makePlayer("p2", { battlefield: args.p2Bear ? [bear("p2")] : [] }),
        ],
    });
}

const ENCODED = spell({
    zone: "exile",
    encodedOn: { permanentId: "bear", seq: 1 },
});

describe("Cipher: the evaluator's read of an encoded card (CR 702.99a)", () => {
    it("an encoded card outscores the same card in the graveyard", () => {
        const encoded = position({ p1Bear: true, p1Exile: [ENCODED] });
        const binned = position({
            p1Bear: true,
            p1Graveyard: [spell({ zone: "graveyard" })],
        });

        expect(evaluate(encoded, "p1")).toBeGreaterThan(evaluate(binned, "p1"));
    });

    it("a link to a creature no longer on the battlefield is worth nothing (CR 702.99c)", () => {
        const stale = position({ p1Exile: [ENCODED] });
        const plainExile = position({ p1Exile: [spell({ zone: "exile" })] });

        expect(isEncodedForController(stale, ENCODED, "p1")).toBe(false);
        expect(evaluate(stale, "p1")).toBe(evaluate(plainExile, "p1"));
    });

    it("it counts for whoever controls the creature, not for the card's owner", () => {
        const stolen = position({ p2Bear: true, p1Exile: [ENCODED] });

        expect(isEncodedForController(stolen, ENCODED, "p1")).toBe(false);
        expect(isEncodedForController(stolen, ENCODED, "p2")).toBe(true);
        const unlinked = position({
            p2Bear: true,
            p1Exile: [spell({ zone: "exile" })],
        });
        expect(evaluate(stolen, "p2")).toBeGreaterThan(
            evaluate(unlinked, "p2")
        );
    });
});
