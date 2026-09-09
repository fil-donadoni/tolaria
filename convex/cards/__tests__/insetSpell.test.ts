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
    castableInsetKind,
    chooseableCardNames,
    hasAdventure,
    insetSpellDefinitionId,
    insetSpellTwinDefinition,
    parentIdOfInsetSpell,
    INSET_SPELL_KINDS,
} from "../insetSpell";
import {
    getChooseableCardNames,
    tryGetPlaceableCardByName,
} from "../catalogue";

import type { CardDefinition } from "../types";

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

describe("the choice DOMAIN and the placeable POPULATION are different sets", () => {
    // PR #3302 review findings 4 and 5, which are the same boundary read from
    // opposite sides. CR 715.5 widens what a player may NAME; CR 715.2c and
    // 715.4 keep what may be PLACED at exactly one card per adventurer card.
    // Sharing one lookup for both is what left the human's name-choice button
    // inert while a scenario spec could seed an Instant into a hand.
    it("a player may CHOOSE the inset name", () => {
        const names = getChooseableCardNames();
        expect(names).toContain(PARENT);
        expect(names).toContain(INSET);
    });

    it("adds ONLY inset names — a domain that drifted would offer names the server refuses", () => {
        // Not merely "bigger". The client's `name-card` submit gate is built
        // from this list and the server validates with `tryGetCardByName`, so
        // every extra name here must resolve, and resolve to a TWIN — anything
        // else is a name the button would accept and the mutation would throw
        // on. Stated as an invariant rather than a count so the assertion
        // survives the next adventurer card (13 compiled rows already
        // contribute one each).
        const enumerated = new Set(getAllCardNames());
        const extras = getChooseableCardNames().filter(
            (n) => !enumerated.has(n)
        );
        expect(extras).toContain(INSET);
        for (const name of extras) {
            const resolved = tryGetCardByName(name);
            expect(resolved, `"${name}" resolves`).not.toBeNull();
            expect(resolved!.id).toContain("#");
        }
        for (const name of getAllCardNames()) {
            expect(getChooseableCardNames()).toContain(name);
        }
    });

    it("the inset name is NOT placeable into a zone (CR 715.4)", () => {
        // "In every zone except the stack … an adventurer card has only its
        // NORMAL characteristics." A scenario, cube or banlist entry naming
        // the Adventure resolves to nothing rather than to the twin.
        expect(tryGetPlaceableCardByName(INSET)).toBeNull();
        expect(tryGetPlaceableCardByName(PARENT)?.name).toBe(PARENT);
        expect(tryGetPlaceableCardByName("Boomerang")?.name).toBe("Boomerang");
    });
});

describe("CR 722.3 — castability is read from the table, never from the kind string", () => {
    // PR #3302 review finding 6: `INSET_SPELL_KINDS` existed but nothing read
    // it, so every cast surface answered "may the parent cast this?" with a
    // literal `kind === "adventure"` — and adding a kind would have compiled
    // with no site forced to answer.
    it("answers for an adventurer card and for a card with no inset spell", () => {
        expect(castableInsetKind(getCardByName(PARENT))).toBe("adventure");
        expect(castableInsetKind(getCardByName("Boomerang"))).toBeUndefined();
        expect(castableInsetKind(undefined)).toBeUndefined();
    });

    it("withholds a kind the table says the parent may never cast", () => {
        // CR 722.3 — "a preparation card can never be cast" with its inset
        // characteristics. Asserted through the same predicate every cast
        // surface reads, on a variant definition, so the claim is about the
        // TABLE and not about which kinds happen to ship today.
        const parent = getCardByName(PARENT);
        const prepared: CardDefinition = {
            ...parent,
            insetSpell: { ...parent.insetSpell!, kind: "prepare" },
        };
        expect(castableInsetKind(prepared)).toBeUndefined();
        // …while CR 715.2a's "has an X" predicate is a different question and
        // is unaffected by castability.
        expect(INSET_SPELL_KINDS.prepare.castableFromParent).toBe(false);
    });
});
