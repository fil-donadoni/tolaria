// The SPLIT CARD as one combined definition with two registered half twins
// (CR 709.1–709.4, ADR 0121).
//
// The design makes two claims that pull in opposite directions, and shipping
// either one alone is a silent bug:
//
//   * CR 709.4 — off the stack the card IS its two halves combined, and the
//     combination is DERIVED, never authored. A wrong hand-typed sum is
//     undetectable by anything but a re-derivation.
//   * CR 709.3b — on the stack only the chosen half exists, and it exists as a
//     real definition the registry resolves. A twin nothing can resolve makes
//     the cast unresolvable; a twin the catalogue can SEE makes Wax // Wane two
//     cards for deck legality, the Limited pool and `check:index`, which
//     CR 709.2 forbids.

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
    getChooseableCardNames,
    tryGetPlaceableCardByName,
} from "../catalogue";
import { chooseableNamesOf, hasName } from "../cardNames";
import {
    combineSplitManaCosts,
    deriveSplitCombination,
    isSplitCard,
    offersPrintedCast,
    SPLIT_HALF_SIDES,
    splitHalfDefinitionId,
} from "../splitCard";
import { getColorsFromCost } from "../colors";
import { manaValue } from "../../gre/constants";
import type { SplitHalf } from "../types";
import { isLegalNamedCard } from "../../gre/pendingChoiceSubmit";
import type { PendingChoice } from "../../gre/state";
import type { GameState } from "../../gre/state";

const CARD = "Stand // Deliver";
const LEFT = "Stand";
const RIGHT = "Deliver";

describe("the two half twins are REGISTERED (CR 709.3b)", () => {
    it("each resolves by its derived id, with that half's own characteristics", () => {
        const parent = getCardByName(CARD);
        const left = tryGetDefinition(splitHalfDefinitionId(parent.id, "left"));
        const right = tryGetDefinition(
            splitHalfDefinitionId(parent.id, "right")
        );
        expect(left?.name).toBe(LEFT);
        expect(right?.name).toBe(RIGHT);
        // CR 709.3b — "the other half's characteristics are treated as though
        // they didn't exist", and neither half's cost is the combined one.
        expect(left!.manaCost).toEqual({ W: 1 });
        expect(right!.manaCost).toEqual({ X: 2, U: 1 });
        expect(left!.types).toEqual(["Instant"]);
        expect(left!.oracleText).not.toContain(RIGHT);
        expect(right!.oracleText).not.toContain("Prevent");
    });

    it("neither twin carries the combined name, cost or type line", () => {
        const parent = getCardByName(CARD);
        for (const side of SPLIT_HALF_SIDES) {
            const twin = tryGetDefinition(
                splitHalfDefinitionId(parent.id, side)
            )!;
            expect(twin.name).not.toBe(parent.name);
            expect(twin.manaCost).not.toEqual(parent.manaCost);
            expect(twin.splitHalves).toBeUndefined();
        }
    });

    it("the twin's art is the PARENT's print, never its own `#` id", () => {
        // Issue #3321 — a `#`-bearing id reaching the Scryfall URL builder
        // truncates at the fragment delimiter into a 404. One card is one
        // printing (CR 709.2 / 111.1).
        const parent = getCardByName(CARD);
        for (const side of SPLIT_HALF_SIDES) {
            const twin = tryGetDefinition(
                splitHalfDefinitionId(parent.id, side)
            )!;
            expect(twin.imagePrintId).toBe(parent.imagePrintId ?? parent.id);
            expect(twin.imagePrintId).not.toContain("#");
        }
    });
});

describe("one card is ONE card (CR 709.2)", () => {
    const parent = getCardByName(CARD);
    const twinIds = SPLIT_HALF_SIDES.map((s) =>
        splitHalfDefinitionId(parent.id, s)
    );

    it("no twin reaches any ENUMERATED population", () => {
        // The populations deck legality, the Limited pool, `check:index` and
        // the deck-builder search index are all built from.
        for (const id of twinIds) {
            expect(getAllCards().some((c) => c.id === id)).toBe(false);
            expect(getAllCatalogueCards().some((c) => c.id === id)).toBe(false);
        }
        expect(getAllCardNames()).toContain(CARD);
        expect(getAllCardNames()).not.toContain(LEFT);
        expect(getAllCardNames()).not.toContain(RIGHT);
    });

    it("a half name is NOT placeable into a zone (CR 709.4)", () => {
        // A scenario spec, cube list or banlist row naming a half binds to
        // nothing: off the stack there is no such object, only the combined
        // card.
        expect(tryGetPlaceableCardByName(LEFT)).toBeNull();
        expect(tryGetPlaceableCardByName(RIGHT)).toBeNull();
        expect(tryGetPlaceableCardByName(CARD)?.name).toBe(CARD);
    });

    it("a half name still RESOLVES, to the twin", () => {
        expect(tryGetCardByName(LEFT)?.id).toBe(twinIds[0]);
        expect(tryGetCardByName(RIGHT)?.id).toBe(twinIds[1]);
    });
});

describe("off the stack the card is its halves COMBINED (CR 709.4)", () => {
    it("is a two-colour card with the summed mana value (CR 709.4b)", () => {
        // The ADR's worked example, and what every tutor, deck-legality check
        // and Bot valuation sees: Stand {W} + Deliver {2}{U} = {2}{W}{U}.
        const card = getCardByName(CARD);
        expect(card.manaCost).toEqual({ X: 2, W: 1, U: 1 });
        expect(manaValue(card.manaCost)).toBe(4);
        expect([...getColorsFromCost(card.manaCost)].sort()).toEqual([
            "U",
            "W",
        ]);
    });

    it("carries every card type on either half (CR 709.4c)", () => {
        const wax = getCardByName("Wax // Wane");
        expect(wax.types).toEqual(["Instant"]);
        // A union, not a concatenation — both halves are Instants and the
        // combined type line says "Instant" once.
        expect(
            deriveSplitCombination([
                { name: "A", types: ["Instant"], oracleText: "" },
                { name: "B", types: ["Sorcery"], oracleText: "" },
            ] as [SplitHalf, SplitHalf]).types
        ).toEqual(["Instant", "Sorcery"]);
    });

    it("sums generic mana out of BOTH of ManaCost's generic slots", () => {
        // `X` doubles as the generic slot when it is a number (`types.ts`), so
        // a combination reading only `generic` would turn Fire {1}{R} + Ice
        // {1}{U} into {U}{R}.
        expect(combineSplitManaCosts({ X: 1, R: 1 }, { X: 1, U: 1 })).toEqual({
            X: 2,
            U: 1,
            R: 1,
        });
        expect(
            combineSplitManaCosts({ X: "X", B: 1 }, { generic: 2, R: 1 })
        ).toEqual({ X: "X", generic: 2, B: 1, R: 1 });
    });

    it("refuses two VARIABLE {X} halves rather than inventing a reading", () => {
        expect(() => combineSplitManaCosts({ X: "X" }, { X: "X" })).toThrow(
            /variable \{X\}/
        );
    });

    it("every shipped split card's combination IS the derivation", () => {
        // The guard that makes ADR 0121 §1 a rule rather than a convention.
        // Duplicated deliberately from `cardDataConformance.test.ts`, which
        // reaches it through MTGJSON: this one holds even for a split card
        // whose home set is not vendored.
        const split = getAllCards().filter((c) => c.splitHalves);
        expect(split.length).toBeGreaterThan(0);
        for (const card of split) {
            const derived = deriveSplitCombination(card.splitHalves!);
            expect({
                name: card.name,
                manaCost: card.manaCost,
                types: card.types,
            }).toEqual({
                name: derived.name,
                manaCost: derived.manaCost,
                types: derived.types,
            });
        }
    });
});

describe("two names, and not both (CR 709.4a)", () => {
    it("the choice domain offers the two HALF names, never the combined one", () => {
        const card = getCardByName(CARD);
        expect(chooseableNamesOf(card)).toEqual([LEFT, RIGHT]);
        const domain = getChooseableCardNames();
        expect(domain).toContain(LEFT);
        expect(domain).toContain(RIGHT);
        expect(domain).not.toContain(CARD);
    });

    it("`hasName` matches either half and never the combined string", () => {
        const card = getCardByName(CARD);
        expect(hasName(card, LEFT)).toBe(true);
        expect(hasName(card, RIGHT)).toBe(true);
        expect(hasName(card, CARD)).toBe(false);
        expect(hasName(card, "Boomerang")).toBe(false);
    });

    it("the SERVER refuses the combined name too — the gate matches the list", () => {
        // A gate that accepted a name the button never offers is the exact
        // asymmetry PR #3302 review finding 4 closed for Adventure. Reachable
        // without a hand-crafted mutation: the Bot's `firstLegalRegisteredName`
        // walks the registry filtered only by `isLegalNamedCard`.
        const head = {
            kind: "name-card",
            playerId: "p1",
            stackItemId: "s1",
            step: 0,
            choiceId: "c1",
        } as unknown as PendingChoice;
        const empty = {} as Pick<GameState, "stagedEntries">;
        expect(isLegalNamedCard(empty, head, LEFT)).toBe(true);
        expect(isLegalNamedCard(empty, head, RIGHT)).toBe(true);
        expect(isLegalNamedCard(empty, head, CARD)).toBe(false);
        // An ordinary card and an Adventure's alternative name are untouched.
        expect(isLegalNamedCard(empty, head, "Boomerang")).toBe(true);
        expect(isLegalNamedCard(empty, head, "Petty Theft")).toBe(true);
        expect(isLegalNamedCard(empty, head, "Brazen Borrower")).toBe(true);
    });

    it("`hasName` still answers CR 715.5 and the ordinary one-name case", () => {
        // One predicate, two rules — the reason it is not `def.name ===`.
        const plain = getCardByName("Boomerang");
        expect(hasName(plain, "Boomerang")).toBe(true);
        expect(hasName(plain, "Stand")).toBe(false);
        const adventurer = getCardByName("Brazen Borrower");
        expect(hasName(adventurer, "Brazen Borrower")).toBe(true);
        expect(hasName(adventurer, "Petty Theft")).toBe(true);
    });
});

describe("a split card offers no printed cast (CR 709.3)", () => {
    it("`offersPrintedCast` is false for it and true for everything else", () => {
        expect(isSplitCard(getCardByName(CARD))).toBe(true);
        expect(offersPrintedCast(getCardByName(CARD))).toBe(false);
        expect(offersPrintedCast(getCardByName("Wax // Wane"))).toBe(false);
        // An adventurer card DOES offer one (CR 715.3), which is the one place
        // the two mechanics differ.
        expect(offersPrintedCast(getCardByName("Brazen Borrower"))).toBe(true);
        expect(offersPrintedCast(getCardByName("Boomerang"))).toBe(true);
        expect(offersPrintedCast(undefined)).toBe(true);
    });
});
