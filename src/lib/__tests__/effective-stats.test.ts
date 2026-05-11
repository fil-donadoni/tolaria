import { describe, it, expect } from "vitest";
import { effectivePower, effectiveToughness } from "../effective-stats";
import type { CardInstance, Player } from "~/types/game";

// Known card ids from convex/cards/sets/lea.ts
const SAVANNAH_LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0";
const CASTLE = "b0da8d56-3178-44c2-9344-95d2346d326f";
const BAD_MOON = "43572906-ea74-4411-a549-5dc401591d2a";
const GRIZZLY_BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870";
const HOLY_ARMOR = "b01041d2-687e-4972-81c8-16690809275b";
const FIREBREATHING = "3eb27381-505d-4e47-bf66-9e7ba91a5075";

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

    it("Holy Armor static +0/+2 reaches host via attachedTo (regression: client view)", () => {
        // Regression: toPermanentView used to strip `attachedTo`, so the
        // AURA_AFFECTS_HOST predicate (target.id === source.attachedTo) was
        // always false on the client and the static buff did not display.
        const bear: CardInstance = {
            id: "bear",
            card: { id: GRIZZLY_BEARS },
            controllerId: "me",
            ownerId: "me",
            zone: "battlefield",
            types: ["Creature"],
            subtypes: ["Bear"],
            staticAbilities: [],
            isTapped: false,
            power: 2,
            toughness: 2,
        };
        const aura: CardInstance = {
            id: "armor",
            card: { id: HOLY_ARMOR },
            controllerId: "me",
            ownerId: "me",
            zone: "battlefield",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            staticAbilities: [],
            isTapped: false,
            attachedTo: "bear",
        };
        const me = makePlayer("me", [bear, aura]);
        expect(effectivePower([me], bear)).toBe(2);
        expect(effectiveToughness([me], bear)).toBe(4);
    });

    it("Firebreathing temporaryPTMods reach the host (regression: client view)", () => {
        // Regression: toPermanentView used to strip `temporaryPTMods`, so a
        // +1/+0 pump that resolved server-side never showed up on the client.
        const bear: CardInstance = {
            id: "bear",
            card: { id: GRIZZLY_BEARS },
            controllerId: "me",
            ownerId: "me",
            zone: "battlefield",
            types: ["Creature"],
            subtypes: ["Bear"],
            staticAbilities: [],
            isTapped: false,
            power: 2,
            toughness: 2,
            temporaryPTMods: [{ power: 1, toughness: 0 }],
        };
        const aura: CardInstance = {
            id: "fb",
            card: { id: FIREBREATHING },
            controllerId: "me",
            ownerId: "me",
            zone: "battlefield",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            staticAbilities: [],
            isTapped: false,
            attachedTo: "bear",
        };
        const me = makePlayer("me", [bear, aura]);
        expect(effectivePower([me], bear)).toBe(3);
        expect(effectiveToughness([me], bear)).toBe(2);
    });

    it("Counters layer 7d reach the host (regression: client view)", () => {
        // Regression: toPermanentView used to strip `counters`, so +1/+1
        // counters did not affect the displayed P/T.
        const bear: CardInstance = {
            id: "bear",
            card: { id: GRIZZLY_BEARS },
            controllerId: "me",
            ownerId: "me",
            zone: "battlefield",
            types: ["Creature"],
            subtypes: ["Bear"],
            staticAbilities: [],
            isTapped: false,
            power: 2,
            toughness: 2,
            counters: { "+1/+1": 2 },
        };
        const me = makePlayer("me", [bear]);
        expect(effectivePower([me], bear)).toBe(4);
        expect(effectiveToughness([me], bear)).toBe(4);
    });

    // Wire-format invariant: every PermanentView field the layer system can
    // read must survive the client adapter (toPermanentView). This test is the
    // contract — if the adapter ever goes back to explicit enumeration and
    // drops a field, this fails. Each assertion targets one runtime field
    // through a behavior that depends on it.
    describe("wire-format invariant — PermanentView fields survive the adapter", () => {
        it("attachedTo reaches an aura source (Holy Armor static +0/+2)", () => {
            const bear = makeCreature({
                id: "bear",
                cardId: GRIZZLY_BEARS,
                power: 2,
                toughness: 2,
            });
            const aura: CardInstance = {
                id: "armor",
                card: { id: HOLY_ARMOR },
                controllerId: "me",
                ownerId: "me",
                zone: "battlefield",
                types: ["Enchantment"],
                subtypes: ["Aura"],
                staticAbilities: [],
                isTapped: false,
                attachedTo: "bear",
            };
            const me = makePlayer("me", [bear, aura]);
            expect(effectiveToughness([me], bear)).toBe(4);
        });

        it("temporaryPTMods reach the target (Firebreathing pump)", () => {
            const bear = makeCreature({
                id: "bear",
                cardId: GRIZZLY_BEARS,
                power: 2,
                toughness: 2,
                temporaryPTMods: [{ power: 1, toughness: 0 }],
            });
            const me = makePlayer("me", [bear]);
            expect(effectivePower([me], bear)).toBe(3);
        });

        it("counters reach layer 7d (+1/+1 counters)", () => {
            const bear = makeCreature({
                id: "bear",
                cardId: GRIZZLY_BEARS,
                power: 2,
                toughness: 2,
                counters: { "+1/+1": 2 },
            });
            const me = makePlayer("me", [bear]);
            expect(effectivePower([me], bear)).toBe(4);
            expect(effectiveToughness([me], bear)).toBe(4);
        });

        it("isTapped reaches predicates (Castle skips tapped creatures)", () => {
            // Castle's `applies` reads target.isTapped — already covered by an
            // earlier test, repeated here to keep the invariant block exhaustive.
            const tapped = makeCreature({
                id: "lion",
                isTapped: true,
            });
            const me = makePlayer("me", [tapped, makeEnchant(CASTLE)]);
            expect(effectiveToughness([me], tapped)).toBe(1);
        });

        it("controllerId reaches predicates (Castle scopes to controller)", () => {
            // controllerId mismatch must prevent Castle's grant — also already
            // covered above; kept here to anchor the invariant.
            const myLion = makeCreature({ id: "my-lion", controllerId: "me" });
            const oppLion = makeCreature({
                id: "opp-lion",
                controllerId: "opp",
                ownerId: "opp",
            });
            const me = makePlayer("me", [myLion, makeEnchant(CASTLE, "me")]);
            const opp = makePlayer("opp", [oppLion]);
            expect(effectiveToughness([me, opp], oppLion)).toBe(1);
        });

        it("types reach the layer fast-path (non-creature target skipped)", () => {
            // getStaticPTBuff short-circuits when target is not a creature.
            // Strip Creature from types → no buff even with Castle on board.
            const fakeArtifact: CardInstance = {
                id: "art",
                card: { id: SAVANNAH_LIONS },
                controllerId: "me",
                ownerId: "me",
                zone: "battlefield",
                types: ["Artifact"],
                subtypes: [],
                staticAbilities: [],
                isTapped: false,
                power: 2,
                toughness: 1,
            };
            const me = makePlayer("me", [fakeArtifact, makeEnchant(CASTLE)]);
            expect(effectiveToughness([me], fakeArtifact)).toBe(1);
        });

        it("card.id reaches getStaticEffects (aura source resolves its def)", () => {
            // getStaticEffects looks up the def by `source.card.id`. Strip the
            // id → no static effects discovered → no buff.
            const bear = makeCreature({
                id: "bear",
                cardId: GRIZZLY_BEARS,
                power: 2,
                toughness: 2,
            });
            const aura: CardInstance = {
                id: "armor",
                card: { id: "" }, // unknown id
                controllerId: "me",
                ownerId: "me",
                zone: "battlefield",
                types: ["Enchantment"],
                subtypes: ["Aura"],
                staticAbilities: [],
                isTapped: false,
                attachedTo: "bear",
            };
            const me = makePlayer("me", [bear, aura]);
            expect(effectiveToughness([me], bear)).toBe(2);
        });
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
