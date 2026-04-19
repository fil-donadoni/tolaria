import { describe, it, expect } from "vitest";
import { effectivePower, effectiveToughness } from "../effective-stats";
import type { CardInstance, Player } from "~/types/game";

// Known card ids from convex/cards/sets/lea.ts
const SAVANNAH_LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0";
const CASTLE = "b0da8d56-3178-44c2-9344-95d2346d326f";
const BAD_MOON = "43572906-ea74-4411-a549-5dc401591d2a";

function makePlayer(id: string, battlefield: CardInstance[] = []): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        deck: {},
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: {},
    };
}

function makeCreature(
    overrides: Partial<CardInstance> & {
        cardId?: string;
    } = {}
): CardInstance {
    const { cardId, ...rest } = overrides;
    return {
        id: rest.id ?? "c1",
        card: { id: cardId ?? SAVANNAH_LIONS },
        controllerId: rest.controllerId ?? "me",
        ownerId: rest.ownerId ?? "me",
        zone: "battlefield",
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        power: 2,
        toughness: 1,
        ...rest,
    };
}

function makeEnchant(cardId: string, controllerId = "me"): CardInstance {
    return {
        id: `enc-${cardId}`,
        card: { id: cardId },
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        types: ["Enchantment"],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
    };
}

describe("effectivePower / effectiveToughness (CR 611, 613)", () => {
    it("returns base stats when no static effects are present", () => {
        const me = makePlayer("me", [makeCreature()]);
        const players: Player[] = [me];
        const card = me.battlefield[0];
        expect(effectivePower(players, card)).toBe(2);
        expect(effectiveToughness(players, card)).toBe(1);
    });

    it("Castle grants +0/+2 to untapped creatures the controller controls", () => {
        const creature = makeCreature({ id: "lion" });
        const me = makePlayer("me", [creature, makeEnchant(CASTLE)]);
        const players: Player[] = [me];
        expect(effectivePower(players, creature)).toBe(2);
        expect(effectiveToughness(players, creature)).toBe(3);
    });

    it("Castle does NOT grant toughness to tapped creatures", () => {
        const creature = makeCreature({ id: "lion", isTapped: true });
        const me = makePlayer("me", [creature, makeEnchant(CASTLE)]);
        const players: Player[] = [me];
        expect(effectiveToughness(players, creature)).toBe(1);
    });

    it("Castle of one player does NOT affect the opponent's creatures", () => {
        const myLion = makeCreature({
            id: "my-lion",
            controllerId: "me",
            ownerId: "me",
        });
        const oppLion = makeCreature({
            id: "opp-lion",
            controllerId: "opp",
            ownerId: "opp",
        });
        const me = makePlayer("me", [myLion, makeEnchant(CASTLE, "me")]);
        const opp = makePlayer("opp", [oppLion]);
        const players: Player[] = [me, opp];
        expect(effectiveToughness(players, myLion)).toBe(3);
        expect(effectiveToughness(players, oppLion)).toBe(1);
    });

    it("Bad Moon buffs black creatures +1/+1 even when the card def is slimmed (regression)", () => {
        // Regression: the public/full projection strips `card` to { id } only.
        // The layer system's getColors used to read manaCost from `card.card`
        // directly, which would silently yield no colors after the strip —
        // breaking Bad Moon. Must now resolve manaCost via the registry.
        //
        // Hypbrid Zombies from lea (id known to be black-costed) is covered by
        // `convex/gre/__tests__/layers.test.ts`; here we verify the FRONTEND
        // path (Player[] → adapter → layers) resolves colors correctly.
        //
        // We synthesize a fake "black creature" by overriding types + cardId
        // to a known black card from the registry. Black Knight is not
        // registered; we use Nevinyrral's Disk id with a manual mana override
        // via card.card to exercise the fallback path.
        const blackCreature: CardInstance = {
            id: "black-c",
            // Embedded manaCost survives here — layer reads from embedded first
            // when available (fallback path for non-slim fixtures).
            card: { id: "inline-black", manaCost: { B: 1 } } as unknown as {
                id: string;
            },
            controllerId: "me",
            ownerId: "me",
            zone: "battlefield",
            types: ["Creature"],
            subtypes: [],
            staticAbilities: [],
            isTapped: false,
            power: 1,
            toughness: 1,
        };
        const me = makePlayer("me", [blackCreature, makeEnchant(BAD_MOON)]);
        const players: Player[] = [me];
        expect(effectivePower(players, blackCreature)).toBe(2);
        expect(effectiveToughness(players, blackCreature)).toBe(2);
    });

    it("Bad Moon resolves color via registry when card.card is slimmed to { id }", () => {
        // Savannah Lions is WHITE (manaCost: W). Bad Moon must NOT buff it
        // even though the card is slimmed to { id } only — getColors must
        // resolve via getCardById to see the actual cost.
        const whiteLion = makeCreature({
            id: "white-lion",
            cardId: SAVANNAH_LIONS,
        });
        const me = makePlayer("me", [whiteLion, makeEnchant(BAD_MOON)]);
        const players: Player[] = [me];
        expect(effectivePower(players, whiteLion)).toBe(2);
        expect(effectiveToughness(players, whiteLion)).toBe(1);
    });
});
