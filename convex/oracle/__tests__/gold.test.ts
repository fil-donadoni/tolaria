// The gold round-trip harness, run over the whole hand-written catalogue.
//
// PRECISION IS THE GATE: of the cards the compiler accepted, 100% must be
// structurally equal to the hand-written definition. Recall is printed, never
// asserted — see `convex/oracle/gold.ts` for why gating recall would be an
// incentive to accept doubtful cards.
//
// The vacuity guards below matter as much as the precision assertion: a harness
// that accepts nothing has 100% precision, and would sail through a grammar
// that had been accidentally disabled.

import { describe, expect, it } from "vitest";
import { getAllCards } from "../../cards/catalogue";
import { compileCard } from "../compile";
import {
    behaviouralProjection,
    goldBucket,
    goldOracleCard,
    printManaCost,
    runGoldHarness,
} from "../gold";
import { readManaCost } from "../manaCost";

const CARDS = getAllCards();
const REPORT = runGoldHarness(CARDS);

/**
 * Cards where the compiler and the HAND-WRITTEN definition genuinely disagree.
 *
 * An enumerated list, not a tolerance. A ratio gate ("99% must match") would
 * let a new misread hide inside the budget; naming each divergence means the
 * NEXT one reds the suite, and each entry is a claim somebody signed rather
 * than a number somebody rounded. The list is meant to empty out — three of the
 * four are catalogue defects the harness FOUND, filed in docs/findings/ and
 * fixable in their own tickets (this issue's diff is `convex/oracle/**` plus
 * the lockfile, and changing four cards' behaviour is not a compiler change).
 *
 * Adding a row is a deliberate act with two obligations: state which side is
 * wrong and why, and file the finding. "The compiler differs, so the card must
 * be wrong" is exactly the reasoning this list exists to make expensive.
 */
const KNOWN_DIVERGENCES: readonly string[] = [
    // Ashnod's Altar left this list in issue #3047: it is now the CR 605.1a
    // mana ability the compiler emits (`useStack: false` + `manaProduced`).
    // Northern Paladin, Active Volcano, Flash Flood and Desert Twister left
    // this list in issues #3046 / #3073: each encoded "target … permanent" as
    // `type: "Creature"` or CR 115.4's `"any"`, and each now carries the
    // permanent-type list the compiler emits (CR 110.1 / 110.4).
];

describe("gold round-trip — precision", () => {
    it("every accepted card matches, except the enumerated divergences", () => {
        expect(
            REPORT.mismatches.map((m) => `${m.name} (${m.bucket})`).sort()
        ).toEqual([...KNOWN_DIVERGENCES].sort());
    });

    it("the two closed grammar-v0 buckets round-trip at 100%", () => {
        // `keyword-only` left this list in #2697 — not because the keyword
        // grammar changed but because Wall of Brambles is classified from the
        // HAND-WRITTEN side (`goldBucket`), and that side was missing the
        // regenerate ability its own Oracle text prints. Issue #3823 gave the
        // card its ability back, so the bucket rejoined.
        // `static` joined them in #2700: 11 accepted, 11 equal, 0 incomparable
        // — a closed shape with no divergence of its own, so the honest gate
        // is the same 100% the other two pay, not a ratio floor.
        for (const bucket of [
            "vanilla",
            "keyword-only",
            "mana-ability",
            "static",
        ] as const) {
            const stats = REPORT.buckets[bucket];
            expect(`${bucket}: ${stats.equal}/${stats.accepted}`).toBe(
                `${bucket}: ${stats.accepted}/${stats.accepted}`
            );
        }
    });

    it("the activated bucket's precision does not drift below its measured floor", () => {
        // A ratio floor UNDER the enumerated list, not instead of it: the list
        // catches a new named divergence, this catches a change that trades a
        // dozen matches for a dozen new accepts and calls it progress.
        const stats = REPORT.buckets.activated;
        const comparable = stats.accepted - stats.incomparable;
        expect(comparable).toBeGreaterThan(100);
        expect(stats.equal / comparable).toBeGreaterThanOrEqual(0.97);
    });

    it("reports the accepted cards the projection CANNOT compare", () => {
        // A hand-written `resolve()` closure and a compiled Effect Script are
        // not comparable in either direction — see `GoldIncomparable`. Counted
        // separately and bounded so the hole cannot grow unnoticed.
        //
        // 4 (#2697) -> 9 (#2699) -> 1 (#2703). The behavioural gold harness
        // (`bun run oracle:behavioural`) is what drains this bucket: it proves
        // a closure card's twin by running the card's own tests against it,
        // which is the evidence the structural comparison cannot produce, and
        // a card so proven has its closure retired to the `effects[]` the
        // compiler emitted. Eight of the nine went that way here (Disenchant,
        // Fissure, Goblin Grenade, Ice Storm, Royal Assassin, Shatter,
        // Sinkhole, Stone Rain — the five `effect: "destroy-target"` shorthand
        // spells plus three `resolve()` closures), and they now round-trip as
        // `equal`. Desert Twister stayed a MISMATCH until issue #3073 gave it
        // the six permanent types the compiler reads and retired its shorthand
        // to the same `destroy` script. Onulet is the survivor.
        //
        // The bound is still a bound and not a ratio — growth has to be
        // explained. So does emptiness: the `toContain` below is the vacuity
        // guard, and if Onulet is ever retired too it must be replaced by the
        // next survivor, not deleted.
        expect(REPORT.incomparable.length).toBeLessThan(15);
        expect(REPORT.incomparable.map((i) => i.name)).toContain("Onulet");
        for (const card of REPORT.incomparable) {
            expect(card.expected).toContain("[closure]");
        }
    });
});

describe("gold round-trip — the harness is not vacuous", () => {
    it("accepts a meaningful number of cards in each grammar-v0 bucket", () => {
        expect(REPORT.buckets.vanilla.accepted).toBeGreaterThan(10);
        expect(REPORT.buckets["keyword-only"].accepted).toBeGreaterThan(30);
        expect(REPORT.buckets["mana-ability"].accepted).toBeGreaterThan(10);
        // #2697 — without this the activated slot could be switched off
        // entirely and every assertion above would still pass.
        expect(REPORT.buckets.activated.accepted).toBeGreaterThan(80);
        // #2700 — without this the static slot could be switched off entirely
        // and every assertion above would still pass.
        expect(REPORT.buckets.static.accepted).toBeGreaterThan(5);
        // #2699 — same, for the spell slot.
        expect(REPORT.buckets.spell.accepted).toBeGreaterThan(20);
    });

    it("exercises every grammar-v0 slot against gold", () => {
        const slotKeys = Object.keys(REPORT.slots);
        expect(slotKeys).toContain("keyword-line");
        expect(slotKeys).toContain("mana-ability");
        expect(slotKeys).toContain("vanilla");
        expect(slotKeys).toContain("activated");
        expect(slotKeys).toContain("triggered");
        expect(slotKeys).toContain("static");
        expect(slotKeys).toContain("spell");
    });

    it("no hand-written card carries a MISSING Oracle text", () => {
        // Zero, not a bound. A card with no `oracleText` is excluded from every
        // count above on purpose — the compiler's INPUT is missing, so compiling
        // "" would score a card with real rules text (Berserk, Channel, Fear …)
        // as a vanilla match, and a missing fixture is not a passing test. The
        // 23 that predate this were backfilled by issue #3075; what keeps the
        // hole shut is THIS assertion, not that backfill, because the field is
        // optional in the type and the next hand-written card can omit it just
        // as silently.
        //
        // An EMPTY `oracleText` is not this failure: a vanilla creature's Oracle
        // text genuinely is "", and 15 of the 23 now say so. Only the FIELD may
        // never be absent.
        expect(
            REPORT.withoutOracleText,
            "a hand-written card omits `oracleText` entirely, so the Oracle compiler has no " +
                'input for it and it can never round-trip. Add the field — `oracleText: ""` ' +
                "if the card really is vanilla — rather than lowering this assertion."
        ).toEqual([]);
    });
});

describe("the comparison cannot be fooled by a closure", () => {
    it("renders a function-valued field as a visible sentinel, not as nothing", () => {
        const withClosure = behaviouralProjection({
            id: "x",
            name: "X",
            rarity: "common",
            types: ["Instant"],
            resolve: () => undefined,
        });
        expect(withClosure).toEqual({ resolve: "[closure]" });
    });

    it("a compiled definition never matches a hand-written one that has a resolve()", () => {
        const handWritten = behaviouralProjection({
            id: "x",
            name: "X",
            rarity: "common",
            types: ["Instant"],
            resolve: () => undefined,
        });
        const compiled = behaviouralProjection({
            name: "X",
            types: ["Instant"],
        });
        expect(compiled).not.toEqual(handWritten);
    });
});

describe("gold fixtures reconstruct a faithful Oracle card", () => {
    it("printManaCost round-trips through readManaCost for every catalogue cost", () => {
        // `{0}` is encoded both as `{}` and as `{ X: 0 }` in the catalogue, so
        // the fixed point is asserted on the PRINTED STRING rather than on the
        // object: print, re-read, print again, and the two strings must match.
        const drift: string[] = [];
        for (const card of CARDS) {
            if (card.manaCost === undefined) continue;
            const printed = printManaCost(card.manaCost);
            const read = readManaCost(printed);
            if (!read.ok) {
                drift.push(
                    `${card.name}: "${printed}" does not re-read (${read.reason})`
                );
                continue;
            }
            const reprinted = printManaCost(read.cost);
            if (reprinted !== printed) {
                drift.push(`${card.name}: "${printed}" -> "${reprinted}"`);
            }
        }
        expect(drift).toEqual([]);
    });

    it("classifies buckets from the HAND-WRITTEN side, never from the compile result", () => {
        const bears = CARDS.find((c) => c.name === "Grizzly Bears")!;
        expect(goldBucket(bears)).toBe("vanilla");
        const sprites = CARDS.find((c) => c.name === "Scryb Sprites")!;
        expect(goldBucket(sprites)).toBe("keyword-only");
        const elves = CARDS.find((c) => c.name === "Llanowar Elves")!;
        expect(goldBucket(elves)).toBe("mana-ability");
        const sorcerer = CARDS.find((c) => c.name === "Prodigal Sorcerer")!;
        expect(goldBucket(sorcerer)).toBe("activated");
    });

    it("compiles a known keyword card to exactly the hand-written behaviour", () => {
        const sprites = CARDS.find((c) => c.name === "Scryb Sprites")!;
        const outcome = compileCard(goldOracleCard(sprites));
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "unparsed") {
            expect(behaviouralProjection(outcome.definition)).toEqual(
                behaviouralProjection(sprites)
            );
        }
    });

    it("compiles a known activated ability to exactly the hand-written behaviour", () => {
        const sorcerer = CARDS.find((c) => c.name === "Prodigal Sorcerer")!;
        const outcome = compileCard(goldOracleCard(sorcerer));
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state !== "unparsed") {
            expect(behaviouralProjection(outcome.definition)).toEqual(
                behaviouralProjection(sorcerer)
            );
            expect(outcome.definition.activatedAbilities?.[0]?.id).toBe(
                "prodigal-sorcerer-ability"
            );
            expect(outcome.definition.activatedAbilities?.[0]?.useStack).toBe(
                true
            );
        }
    });

    it("compiles a known mana ability to exactly the hand-written behaviour", () => {
        const elves = CARDS.find((c) => c.name === "Llanowar Elves")!;
        const outcome = compileCard(goldOracleCard(elves));
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "unparsed") {
            // The hand-written ability also carries a legacy `effect` closure;
            // the projection elides it because a fixed-output mana ability's
            // body is never executed (see `isDeadManaAbilityClosure`).
            expect(behaviouralProjection(outcome.definition)).toEqual(
                behaviouralProjection(elves)
            );
            expect(outcome.definition.activatedAbilities?.[0]?.id).toBe(
                "llanowar-elves-mana"
            );
        }
    });
});
