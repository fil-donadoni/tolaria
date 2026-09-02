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
    // Oracle: "Sacrifice a creature: Add {C}{C}." No target, adds mana, not a
    // loyalty ability, touches no library — a mana ability by every criterion
    // of CR 605.1a, so `useStack: false`. The hand-written ability puts it on
    // the stack. docs/findings/2697-gold-catalogue-divergences.md
    "Ashnod's Altar (activated)",
    // Oracle: "Sacrifice a Swamp: Regenerate target black creature." The
    // hand-written `sacrificeFilter` restates `types: "Land"` beside
    // `subtypes: "Swamp"`; three other cards with the same phrase shape
    // (Dark Heart of the Wood, Orcish Lumberjack, Deadapult) omit it. An
    // encoding tie, not a reading difference — see `readNoun`.
    "Horror of Horrors (activated)",
    // Oracle: "Destroy target black permanent." The hand-written
    // `targetRequirement` is `type: "Creature"` — narrower than the card
    // (CR 109.1 / 300.1). Same finding.
    "Northern Paladin (activated)",
    // Oracle prints "{G}: Regenerate this creature." and the hand-written
    // definition has no activated ability at all. Same finding.
    "Wall of Brambles (keyword-only)",
    // ── #2699: the spell slot's first pass over gold ──────────────────────
    //
    // Oracle: "Choose one — • Destroy target blue permanent. • Return target
    // Island to its owner's hand." Both hand-written definitions encode
    // "target <colour> permanent" as `type: "any"` — the SAME defect as
    // Northern Paladin above, and the reason it is a defect rather than an
    // encoding tie is that `"any"` is not a synonym for "permanent": CR 115.4
    // "any target" is a creature, planeswalker, battle or PLAYER, which is
    // what `matchesTargetRequirement` (src/lib/card-utils.ts) and
    // `getLegalTargets` (gre/rules.ts) both implement. So as shipped these two
    // can destroy a blue PLAYER and cannot destroy a blue artifact. The
    // compiler emits the six permanent card types (CR 110.4).
    "Active Volcano (spell)",
    "Flash Flood (spell)",
    // Oracle: "Flashback—Sacrifice a Mountain." The hand-written flashback
    // cost restates `types: "Land"` beside `subtypes: "Mountain"` — the
    // Horror of Horrors encoding tie above, at the flashback cost site.
    "Lava Dart (spell)",
    // Oracle: "Destroy target permanent." — `type: "any"` again, the FIFTH
    // instance of the Northern Paladin defect, and the reason `gold.ts`
    // exempts a closure body per KEY rather than per card: this one authors
    // its body with the `effect: "destroy-target"` shorthand, so a whole-card
    // exemption hid a live divergence behind it (review of PR #3044).
    // docs/findings/2699-spell-slot-gaps.md
    "Desert Twister (other)",
];

describe("gold round-trip — precision", () => {
    it("every accepted card matches, except the enumerated divergences", () => {
        expect(
            REPORT.mismatches.map((m) => `${m.name} (${m.bucket})`).sort()
        ).toEqual([...KNOWN_DIVERGENCES].sort());
    });

    it("the two closed grammar-v0 buckets round-trip at 100%", () => {
        // `keyword-only` was here until #2697. It left not because the keyword
        // grammar changed but because Wall of Brambles is classified from the
        // HAND-WRITTEN side (`goldBucket`), and the hand-written side is
        // missing the regenerate ability its own Oracle text prints — so the
        // card is keyword-only there and keyword-line+activated here. It is in
        // `KNOWN_DIVERGENCES` above, which is a stricter statement than the
        // percentage this loop used to make about it.
        // `static` joined them in #2700: 11 accepted, 11 equal, 0 incomparable
        // — a closed shape with no divergence of its own, so the honest gate
        // is the same 100% the other two pay, not a ratio floor.
        for (const bucket of ["vanilla", "mana-ability", "static"] as const) {
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
        // `equal`. Desert Twister stayed a MISMATCH throughout: its
        // hand-written `type: "any"` is narrower than the six permanent types
        // the compiler reads, so its behavioural green proves only the case
        // its own test covers. Onulet is the survivor.
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

    it("reports the hand-written cards that carry no Oracle text at all", () => {
        // Excluded from the counts on purpose: the compiler's INPUT is missing,
        // so compiling "" would score a card with real rules text as a vanilla
        // match. The number is asserted to be bounded so the hole cannot grow
        // silently — see docs/findings/2694-gold-cards-without-oracletext.md.
        expect(REPORT.withoutOracleText.length).toBeLessThan(40);
        expect(REPORT.withoutOracleText).toContain("Grizzly Bears");
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
