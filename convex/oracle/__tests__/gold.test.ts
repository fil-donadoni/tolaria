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

describe("gold round-trip — precision", () => {
    it("every accepted card is structurally equal to its hand-written definition", () => {
        expect(REPORT.mismatches.map((m) => `${m.name} (${m.bucket})`)).toEqual(
            []
        );
    });

    it("the three grammar-v0 buckets round-trip at 100%", () => {
        for (const bucket of [
            "vanilla",
            "keyword-only",
            "mana-ability",
        ] as const) {
            const stats = REPORT.buckets[bucket];
            expect(`${bucket}: ${stats.equal}/${stats.accepted}`).toBe(
                `${bucket}: ${stats.accepted}/${stats.accepted}`
            );
        }
    });
});

describe("gold round-trip — the harness is not vacuous", () => {
    it("accepts a meaningful number of cards in each grammar-v0 bucket", () => {
        expect(REPORT.buckets.vanilla.accepted).toBeGreaterThan(10);
        expect(REPORT.buckets["keyword-only"].accepted).toBeGreaterThan(30);
        expect(REPORT.buckets["mana-ability"].accepted).toBeGreaterThan(10);
    });

    it("exercises every grammar-v0 slot against gold", () => {
        const slotKeys = Object.keys(REPORT.slots);
        expect(slotKeys).toContain("keyword-line");
        expect(slotKeys).toContain("mana-ability");
        expect(slotKeys).toContain("vanilla");
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
