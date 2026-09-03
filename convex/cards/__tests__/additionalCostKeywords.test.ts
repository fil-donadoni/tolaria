// Additional-cost keyword identity (CR 702.33a / 702.33d / 702.175a, ADR 0085).
//
// `AdditionalCostKeyword` is the closed union a `kickers[]` entry draws its
// identity from, and `ADDITIONAL_COST_KEYWORDS` is the exhaustive table over it
// that says — among other things — whether paying that cost makes the spell
// "kicked" (CR 702.33d). The union is vocabulary the ENGINE understands; this
// file is what keeps that vocabulary honest against the Mechanics Registry, the
// single name authority for keywords, and against the catalogue.
//
// Three separate claims, in order of what they protect:
//
//  1. every member names a REAL censused keyword-ability (never an invented
//     name — `.claude/rules/gre-development.md` § DSL-first authoring);
//  2. a member whose mechanic is not yet `implemented` is declared as such and
//     may NOT be reached by any shipped card — so vocabulary can exist ahead of
//     the mechanic (the identity is what issue #2079 needs in order to BUILD
//     offspring) without a card ever silently shipping half of it;
//  3. every shipped `kickers[]` entry's keyword is implemented, and obeys its
//     own table row (`allowsMulti`, `requiresTrigger`).
import { describe, expect, it } from "vitest";
import { MECHANICS_REGISTRY } from "../mechanicsRegistry";
import {
    ADDITIONAL_COST_KEYWORDS,
    additionalCostKeywordOf,
} from "../../gre/kicker";
import type { AdditionalCostKeyword } from "../types";
import { getAllCards } from "../index";

/** Union members whose Mechanics Registry row is not `implemented` yet, each
 *  with the OPEN issue that ships it. The identity has to exist before the
 *  mechanic can be built against it — ADR 0085's whole point is that adding a
 *  member is a compile error until its kicked-ness is stated, which is only
 *  useful if a member can be stated ahead of its card. What this map buys back
 *  is the fail-closed half: a keyword listed here may not be reached by any
 *  shipped card (asserted below), so nothing ships half a mechanic. It empties
 *  out as the mechanics land; it is never a standing hatch. */
const PENDING_ADDITIONAL_COST_KEYWORDS: Partial<
    Record<AdditionalCostKeyword, number>
> = {
    // CR 702.175a — the cost half is expressible as of ADR 0085; the twin
    // "create a 1/1 token copy" trigger is issue #2079.
    offspring: 2079,
};

const registryRow = (id: AdditionalCostKeyword) =>
    MECHANICS_REGISTRY.find((row) => row.id === id);

const unionMembers = Object.keys(
    ADDITIONAL_COST_KEYWORDS
) as AdditionalCostKeyword[];

describe("AdditionalCostKeyword ↔ Mechanics Registry (CR 702.33a, ADR 0085)", () => {
    it("has at least the two identities the split exists to tell apart", () => {
        // Guards against the table being narrowed back to a single member, at
        // which point the partition is vacuous and every assertion below is
        // trivially satisfied.
        expect(unionMembers).toContain("kicker");
        expect(
            unionMembers.filter(
                (k) => !ADDITIONAL_COST_KEYWORDS[k].countsAsKicked
            ).length
        ).toBeGreaterThan(0);
    });

    it.each(unionMembers)("%s is a censused keyword-ability row", (keyword) => {
        const row = registryRow(keyword);
        expect(
            row,
            `no Mechanics Registry row named "${keyword}"`
        ).toBeDefined();
        expect(row!.kind).toBe("keyword-ability");
    });

    it.each(unionMembers)(
        "%s is either implemented or declared pending with a tracking issue",
        (keyword) => {
            const row = registryRow(keyword)!;
            const pending = PENDING_ADDITIONAL_COST_KEYWORDS[keyword];
            if (pending === undefined) {
                expect(
                    row.status,
                    `"${keyword}" is not in PENDING_ADDITIONAL_COST_KEYWORDS, so its registry row must be implemented`
                ).toBe("implemented");
            } else {
                expect(
                    row.status,
                    `"${keyword}" is implemented — drop its PENDING_ADDITIONAL_COST_KEYWORDS row`
                ).not.toBe("implemented");
                expect(pending).toBeGreaterThan(0);
            }
        }
    );

    it("declares no pending keyword that is not a union member", () => {
        for (const keyword of Object.keys(
            PENDING_ADDITIONAL_COST_KEYWORDS
        ) as AdditionalCostKeyword[]) {
            expect(unionMembers).toContain(keyword);
        }
    });

    // CR 702.33d — the one axis every kicked-ness reader depends on. Pinned
    // here so a flip is a deliberate edit to a test, not a silent one-word
    // change in a table nobody reads.
    it("pins each member's kicked-ness (CR 702.33d)", () => {
        expect(ADDITIONAL_COST_KEYWORDS.kicker.countsAsKicked).toBe(true);
        expect(ADDITIONAL_COST_KEYWORDS.offspring.countsAsKicked).toBe(false);
    });
});

describe("shipped kickers[] entries obey their keyword's table row (ADR 0085)", () => {
    const shippedEntries = getAllCards().flatMap((def) =>
        (def.kickers ?? []).map((entry) => ({
            card: def,
            entry,
            keyword: additionalCostKeywordOf(entry),
        }))
    );

    it("the catalogue actually declares some, so the rows below are not vacuous", () => {
        expect(shippedEntries.length).toBeGreaterThan(0);
    });

    it("no shipped card reaches a PENDING keyword", () => {
        const offenders = shippedEntries.filter(
            (e) => PENDING_ADDITIONAL_COST_KEYWORDS[e.keyword] !== undefined
        );
        expect(
            offenders.map((o) => `${o.card.id}:${o.entry.id} (${o.keyword})`)
        ).toEqual([]);
    });

    it("no entry sets `multi` on a keyword whose row forbids it (CR 702.33c)", () => {
        const offenders = shippedEntries.filter(
            (e) =>
                e.entry.multi === true &&
                !ADDITIONAL_COST_KEYWORDS[e.keyword].allowsMulti
        );
        expect(
            offenders.map((o) => `${o.card.id}:${o.entry.id} (${o.keyword})`)
        ).toEqual([]);
    });

    // ADR 0085 § Decision 4 asks for more than this: the twin must be THE twin
    // (CR 702.175a's "create a token that's a copy of it, except it's 1/1"),
    // and the "and vice versa" direction — a card carrying the twin trigger but
    // no cost entry declaring the keyword — is not checked here at all. Both
    // need the trigger to be RECOGNISABLE, which it only becomes once issue
    // #2079 ships the shape it takes; recognising it is that ticket's work.
    // Until then the row above ("no shipped card reaches a PENDING keyword")
    // is what actually keeps a half-mechanic out of the catalogue, and this row
    // is the coarse floor beneath it.
    it("a keyword that demands a twin trigger ships at least one (CR 702.175a)", () => {
        const offenders = shippedEntries.filter(
            (e) =>
                ADDITIONAL_COST_KEYWORDS[e.keyword].requiresTrigger &&
                (e.card.triggeredAbilities?.length ?? 0) === 0
        );
        expect(
            offenders.map((o) => `${o.card.id}:${o.entry.id} (${o.keyword})`)
        ).toEqual([]);
    });
});
