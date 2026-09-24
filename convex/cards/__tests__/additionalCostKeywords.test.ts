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
//     own table row — `allowsMulti` (repetition rejected where CR 702.175 has
//     no "any number of times" clause) and `requiresTrigger`, which since issue
//     #2079 is checked BIDIRECTIONALLY against the twin marker: a cost entry
//     with no twin trigger naming it, and a twin trigger naming no cost entry,
//     are both half a mechanic.
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
    // Empty, and meant to stay that way: issue #2079 shipped offspring's twin
    // trigger, which was the last member declared ahead of its mechanic. A new
    // member may sit here while its trigger half is built — that is what the
    // map is for — but it may never be reached by a shipped card while it does.
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
        const pending = Object.keys(
            PENDING_ADDITIONAL_COST_KEYWORDS
        ) as AdditionalCostKeyword[];
        expect(pending.filter((k) => !unionMembers.includes(k))).toEqual([]);
    });

    // CR 702.33d — the one axis every kicked-ness reader depends on. Pinned
    // here so a flip is a deliberate edit to a test, not a silent one-word
    // change in a table nobody reads.
    it("pins each member's kicked-ness (CR 702.33d)", () => {
        expect(ADDITIONAL_COST_KEYWORDS.kicker.countsAsKicked).toBe(true);
        // CR 702.175 (issue #2079) — offspring is never a kick, has no "any
        // number of times" clause (702.175b's multiple instances are multiple
        // ENTRIES), and its twin is authored by the card, not synthesized.
        expect(ADDITIONAL_COST_KEYWORDS.offspring.countsAsKicked).toBe(false);
        expect(ADDITIONAL_COST_KEYWORDS.offspring.allowsMulti).toBe(false);
        expect(ADDITIONAL_COST_KEYWORDS.offspring.requiresTrigger).toBe(true);
        expect(ADDITIONAL_COST_KEYWORDS.offspring.castCopyTrigger).toBe(false);
        // CR 702.56a (issue #2100) — replicate buys COPIES, never a kick, and
        // its twin trigger is the synthesized cast-copy one.
        expect(ADDITIONAL_COST_KEYWORDS.replicate.countsAsKicked).toBe(false);
        expect(ADDITIONAL_COST_KEYWORDS.replicate.allowsMulti).toBe(true);
        expect(ADDITIONAL_COST_KEYWORDS.replicate.castCopyTrigger).toBe(true);
        // CR 702.157a (issue #3220) — squad is the first member to set BOTH
        // repeatability flags, and it is still not a kicker cost.
        expect(ADDITIONAL_COST_KEYWORDS.squad.countsAsKicked).toBe(false);
        expect(ADDITIONAL_COST_KEYWORDS.squad.allowsMulti).toBe(true);
        expect(ADDITIONAL_COST_KEYWORDS.squad.requiresTrigger).toBe(true);
    });

    // CR 702.33c / 702.157a (issue #3220) — `printedLabel` and `allowsMulti`
    // answer the same question from two sides ("may this entry repeat?" /
    // "what does it print when it does?"), so they are pinned AGAINST each
    // other rather than each on its own: a row that gains a `repeated` label
    // without the flag would mislabel a cost the engine then refuses to
    // charge twice, and a row that gains the flag without the label makes
    // `additionalCostPrintedLabel` return undefined for the only form the
    // entry can legally take.
    // ADR 0052 / CR 702.56a — a synthesized cast-copy twin is still a twin:
    // a row claiming the engine builds its trigger while denying the keyword
    // has one would let the catalogue guard below skip a card for a trigger
    // `collectCastTriggers` is then free to never build.
    it.each(unionMembers)(
        "%s: castCopyTrigger implies requiresTrigger",
        (keyword) => {
            const row = ADDITIONAL_COST_KEYWORDS[keyword];
            // The implication, asserted whole: a row without the trigger
            // satisfies it vacuously but must still be checked.
            expect(!row.castCopyTrigger || row.requiresTrigger === true).toBe(
                true
            );
        }
    );

    it.each(unionMembers)(
        "%s's printed labels agree with allowsMulti (CR 702.33c)",
        (keyword) => {
            const row = ADDITIONAL_COST_KEYWORDS[keyword];
            expect(row.printedLabel.repeated !== undefined).toBe(
                row.allowsMulti
            );
            // A keyword with no printed word in EITHER form could never be
            // written on a card at all.
            expect(
                row.printedLabel.single ?? row.printedLabel.repeated
            ).toBeTruthy();
        }
    );
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

    // ADR 0085 § Decision 4, delivered by issue #2079: both directions of the
    // LINK between a cost entry and its trigger half — a cost entry with no
    // twin, and a card carrying the twin trigger but no cost entry declaring
    // the keyword.
    //
    // What these rows check is the LINK, not the twinned ability's CONTENT: a
    // marker stamped onto an ability that does something else entirely would
    // pass. That is deliberate. The content of the twin is per-KEYWORD
    // (CR 702.175a's 1/1 token copy is not CR 702.174b's "[effect]"), and this
    // file's whole value is being keyword-generic — a content check here would
    // be the hardcoded-on-offspring shape issue #2079 explicitly ruled out.
    // The content is proved per keyword instead, by the factory's own test
    // (`cards/abilities/__tests__/offspring.test.ts`), and the marker is
    // stamped ONLY by that factory, never by hand on a card.
    //
    // Both directions need the trigger to be RECOGNISABLE, which is what
    // `TriggeredAbility.additionalCostTwin` is for. It has to be an explicit
    // marker because Guard A (issue #957/#958) reads keyword strings out of
    // `staticAbilities[]` and an offspring card has NONE: it is a cost entry
    // plus a separate triggered ability. So this exact form would otherwise
    // pass every gate in the repo — an offspring cost entry with no offspring
    // trigger. The cost gets paid, the token never comes, nothing goes red.
    //
    // Keyword-GENERIC by construction: the only input is
    // `ADDITIONAL_COST_KEYWORDS[...].requiresTrigger`, never a hardcoded list,
    // so Gift (CR 702.174) and Casualty inherit both directions by adding a
    // table row and calling `withAdditionalCostTwin`.
    //
    // A `castCopyTrigger` keyword's twin is synthesized by the ENGINE from the
    // cost entry itself (`collectCastTriggers`, CR 702.56a), so no card authors
    // it and no card can carry its marker; `replicate.test.ts` is what proves
    // the engine puts it on the stack.
    const twinsOf = (card: (typeof shippedEntries)[number]["card"]) =>
        (card.triggeredAbilities ?? []).flatMap((ability) =>
            ability.additionalCostTwin ? [ability.additionalCostTwin] : []
        );

    it("every cost entry whose keyword demands a twin has one naming IT (CR 702.175a/b)", () => {
        const offenders = shippedEntries.filter((e) => {
            const row = ADDITIONAL_COST_KEYWORDS[e.keyword];
            if (!row.requiresTrigger || row.castCopyTrigger) return false;
            // CR 702.175b — the link is per ENTRY id, not per keyword, so a
            // card with two instances needs two triggers and one matching the
            // OTHER entry does not satisfy this one.
            return !twinsOf(e.card).some(
                (twin) =>
                    twin.keyword === e.keyword && twin.costId === e.entry.id
            );
        });
        expect(
            offenders.map(
                (o) =>
                    `${o.card.name} (${o.card.id}): ${o.keyword} cost entry "${o.entry.id}" has no twin trigger`
            )
        ).toEqual([]);
    });

    it("the rows above are not vacuous — some shipped keyword actually demands a twin", () => {
        // Without this, the bidirectional guard would pass trivially the day
        // the last twin-demanding card left the catalogue.
        expect(
            shippedEntries
                .filter((e) => {
                    const row = ADDITIONAL_COST_KEYWORDS[e.keyword];
                    return row.requiresTrigger && !row.castCopyTrigger;
                })
                .map((e) => e.keyword)
        ).not.toEqual([]);
    });

    it("no twin trigger is an orphan — every one names a real cost entry (ADR 0085)", () => {
        // The other direction. A card that keeps the trigger half but loses or
        // renames the cost entry is just as broken as the reverse: the ability
        // is check-time-gated on a payment record that can never be written, so
        // it silently never fires.
        const offenders = getAllCards().flatMap((card) =>
            (card.triggeredAbilities ?? []).flatMap((ability) => {
                const twin = ability.additionalCostTwin;
                if (!twin) return [];
                const matched = (card.kickers ?? []).some(
                    (entry) =>
                        entry.id === twin.costId &&
                        additionalCostKeywordOf(entry) === twin.keyword
                );
                return matched
                    ? []
                    : [
                          `${card.name} (${card.id}): trigger "${ability.id}" claims to be the twin of ${twin.keyword} cost entry "${twin.costId}", which the card does not declare`,
                      ];
            })
        );
        expect(offenders).toEqual([]);
    });
});
