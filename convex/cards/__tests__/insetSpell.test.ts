// The INSET SPELL as a registered TWIN definition (CR 715 / 722, ADR 0120).
//
// The design's whole claim is a pair of opposites that must BOTH hold, and
// neither is visible from the other side: the twin is resolvable by id
// everywhere, and invisible to every enumerator. Half of that shipping alone is
// a silent bug in either direction — a twin nothing can resolve makes the cast
// unresolvable, and a twin the catalogue can see makes an adventurer card two
// cards for deck legality, the Limited pool, `check:index` and the deck
// builder, which CR 715.2c forbids.

import { describe, expect, it } from "vitest";
import {
    getAllCardNames,
    getAllCards,
    getAllCatalogueCards,
    getCardByName,
    tryGetCardByName,
    tryGetDefinition,
} from "../index";
import {
    chooseableCardNames,
    hasAdventure,
    insetSpellDefinitionId,
    insetSpellTwinDefinition,
    parentIdOfInsetSpell,
    INSET_SPELL_KINDS,
} from "../insetSpell";

const PARENT = "Brazen Borrower";
const INSET = "Petty Theft";

describe("the twin definition is REGISTERED (CR 715.2 / 715.3b)", () => {
    it("resolves by its derived id, with the inset half's own characteristics", () => {
        const parent = getCardByName(PARENT);
        const twin = tryGetDefinition(
            insetSpellDefinitionId(parent.id, "adventure")
        );
        expect(twin).not.toBeNull();
        // CR 715.3b — "the spell has ONLY its alternative characteristics."
        expect(twin!.name).toBe(INSET);
        expect(twin!.types).toEqual(["Instant"]);
        expect(twin!.subtypes).toEqual(["Adventure"]);
        expect(twin!.manaCost).toEqual({ X: 1, U: 1 });
        // …and NONE of the parent's. A twin that inherited the creature half's
        // keywords would put a flying, flash-having Instant on the stack.
        expect(twin!.staticAbilities).toBeUndefined();
        expect(twin!.power).toBeUndefined();
        expect(twin!.toughness).toBeUndefined();
        expect(twin!.staticEffects).toBeUndefined();
    });

    it("carries the parent's PRINT metadata, which is not a characteristic", () => {
        const parent = getCardByName(PARENT);
        const twin = insetSpellTwinDefinition(parent)!;
        // CR 206.1 / 111.1 — rarity and art belong to the printing, and the
        // printing is one card. A twin with no rarity would trip every
        // catalogue guard that reads one.
        expect(twin.rarity).toBe(parent.rarity);
    });

    it("round-trips its id back to the parent's (CR 715.4)", () => {
        const parent = getCardByName(PARENT);
        const twinId = insetSpellDefinitionId(parent.id, "adventure");
        expect(parentIdOfInsetSpell(twinId)).toBe(parent.id);
        // An ordinary card id names no parent, so the revert cannot fire on one.
        expect(parentIdOfInsetSpell(parent.id)).toBeUndefined();
    });
});

describe("the twin is INVISIBLE to every enumerator (CR 715.2c)", () => {
    // "Each adventurer card is only one card. For example, a player who has
    // drawn or discarded an adventurer card has drawn or discarded one card,
    // not two." Every population below is one that decides how many cards
    // something is: deck legality and the Limited pool read `getAllCards()` /
    // `getAllCatalogueCards()`, `check:index` reads the same, and the deck
    // builder's search index is built from the catalogue.
    const twinId = insetSpellDefinitionId(
        getCardByName(PARENT).id,
        "adventure"
    );

    it("is not in getAllCards()", () => {
        expect(getAllCards().some((c) => c.id === twinId)).toBe(false);
        expect(getAllCards().filter((c) => c.name === PARENT)).toHaveLength(1);
    });

    it("is not in getAllCatalogueCards()", () => {
        expect(getAllCatalogueCards().some((c) => c.id === twinId)).toBe(false);
    });

    it("is not in getAllCardNames()", () => {
        const names = getAllCardNames();
        expect(names).toContain(PARENT);
        expect(names).not.toContain(INSET);
    });
});

describe("CR 715.5 — the alternative name may be chosen", () => {
    it("resolves the inset name to the TWIN, not to the parent", () => {
        // "If an effect instructs a player to choose a card name and the player
        // wants to choose an adventurer card's alternative name, the player may
        // do so." Naming Petty Theft must name the Adventure: a lookup that
        // answered with the creature would make "name a card" and "the card so
        // named" disagree.
        const named = tryGetCardByName(INSET);
        expect(named).not.toBeNull();
        expect(named!.name).toBe(INSET);
        expect(named!.id).toBe(
            insetSpellDefinitionId(getCardByName(PARENT).id, "adventure")
        );
    });

    it("still resolves the parent's own name to the parent", () => {
        expect(tryGetCardByName(PARENT)!.types).toEqual(["Creature"]);
    });

    it("offers BOTH names for an adventurer card and one for every other", () => {
        expect(chooseableCardNames(getCardByName(PARENT))).toEqual([
            PARENT,
            INSET,
        ]);
        expect(chooseableCardNames(getCardByName("Boomerang"))).toEqual([
            "Boomerang",
        ]);
    });
});

describe("CR 715.2a — the 'has an Adventure' predicate", () => {
    it("is a question about the CARD, true wherever the card is", () => {
        // "…even if the object currently doesn't use them." The predicate reads
        // the printed declaration, so it holds for a Brazen Borrower sitting in
        // a graveyard as a plain 3/1 Faerie.
        expect(hasAdventure(getCardByName(PARENT))).toBe(true);
        expect(hasAdventure(getCardByName("Boomerang"))).toBe(false);
        expect(hasAdventure(undefined)).toBe(false);
    });

    it("is false for the TWIN itself — an Adventure has no Adventure", () => {
        const twinId = insetSpellDefinitionId(
            getCardByName(PARENT).id,
            "adventure"
        );
        expect(hasAdventure(tryGetDefinition(twinId) ?? undefined)).toBe(false);
    });
});

describe("the twin-id space cannot collide with a printed card's", () => {
    it("no catalogue card's id contains the separator", () => {
        const colliding = getAllCatalogueCards()
            .filter((c) => c.id.includes("#"))
            .map((c) => `${c.name} (${c.id})`);
        expect(
            colliding,
            "a printed card whose id contains `#` would be indistinguishable " +
                "from an inset-spell twin id, and `parentIdOfInsetSpell` would " +
                "silently claim it belongs to another card"
        ).toEqual([]);
    });
});

describe("CR 722.3 — the kind decides whether the parent offers a cast", () => {
    it("adventure is castable from the parent and prepare is never", () => {
        // The single bit that separates CR 715 from CR 722. It is a `Record`
        // over the kind union so a third kind cannot compile without answering.
        expect(INSET_SPELL_KINDS.adventure.castableFromParent).toBe(true);
        expect(INSET_SPELL_KINDS.prepare.castableFromParent).toBe(false);
    });
});
