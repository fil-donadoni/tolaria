// The compiler's SPLIT layout gate (CR 709, ADR 0121 §5).
//
// `layout: "split"` is not one class but three, and the Scryfall string
// cannot tell them apart: two instant/sorcery halves (84 cards in the
// vendored corpus), a PERMANENT face (30 — every one an `Enchantment — Room`,
// CR 709.5), and Fuse (23, CR 702.102). The gate is CR-shaped: a permanence
// test on the type line, never a card-name list that rots as sets ship; a Fuse
// card compiles like the instant/sorcery class plus its `fuse` keyword.
//
// Asserted on SYNTHESIZED rows in the exact shape `scripts/oracle-corpus.ts`
// reduces the real ones to, because the corpus cache is gitignored and a test
// that needed it would be skipped in every fresh worktree. What the corpus
// itself proves is in the lockfile, where both refusal reasons appear
// verbatim.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { deriveSplitCombination } from "../../cards/splitCard";
import type { OracleCard, OracleFace } from "../types";

function face(overrides: Partial<OracleFace>): OracleFace {
    return {
        name: "Left",
        manaCost: "{G}",
        typeLine: "Instant",
        oracleText: "Destroy target enchantment.",
        ...overrides,
    };
}

function splitCard(faces: OracleFace[]): OracleCard {
    return {
        oracleId: "00000000-0000-0000-0000-000000000001",
        name: faces.map((f) => f.name).join(" // "),
        manaCost: faces.map((f) => f.manaCost).join(" // "),
        typeLine: faces.map((f) => f.typeLine).join(" // "),
        oracleText: faces.map((f) => f.oracleText).join("\n"),
        layout: "split",
        faces,
    };
}

const reasonsOf = (card: OracleCard): string => {
    const outcome = compileCard(card);
    return outcome.state === "unparsed"
        ? outcome.gaps.map((g) => g.reason).join(" | ")
        : `(${outcome.state})`;
};

describe("CR 709.1–709.4 — two instant/sorcery halves are ADMITTED", () => {
    const card = splitCard([
        face({
            name: "Wax",
            manaCost: "{G}",
            oracleText: "Target creature gets +2/+2 until end of turn.",
        }),
        face({ name: "Wane", manaCost: "{W}" }),
    ]);

    it("compiles, and its characteristics ARE the derivation (CR 709.4)", () => {
        const outcome = compileCard(card);
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        const halves = outcome.definition.splitHalves;
        expect(halves).toBeDefined();
        expect(halves!.map((h) => h.name)).toEqual(["Wax", "Wane"]);
        // The lowering must go THROUGH `deriveSplitCombination`, not around
        // it — a second copy of the combination could disagree with CR 709.4b
        // and the round trip would still be green (ADR 0121 §5).
        const derived = deriveSplitCombination(halves!);
        expect(outcome.definition.name).toBe(derived.name);
        expect(outcome.definition.manaCost).toEqual(derived.manaCost);
        expect(outcome.definition.types).toEqual(derived.types);
        // CR 709.4b — {G} + {W} is a two-colour card, and neither half is.
        expect(outcome.definition.manaCost).toEqual({ G: 1, W: 1 });
    });
});

describe("CR 709.5 — a split card with a PERMANENT face is refused", () => {
    it("refuses a Room (the whole 30-card class), naming the type", () => {
        const room = splitCard([
            face({
                name: "Walk-In Closet",
                manaCost: "{2}{B}",
                typeLine: "Enchantment — Room",
                oracleText:
                    "When you unlock this door, return target creature card from your graveyard to your hand.",
            }),
            face({
                name: "Forgotten Cellar",
                manaCost: "{4}{B}",
                typeLine: "Enchantment — Room",
                oracleText:
                    "At the beginning of your end step, return target creature card from your graveyard to the battlefield.",
            }),
        ]);
        expect(reasonsOf(room)).toContain("CR 709.5");
        expect(reasonsOf(room)).toContain("Enchantment");
    });

    it("refuses on PERMANENCE, not on a card name — one permanent half is enough", () => {
        // The property that makes the gate 30-for-30 with no list to
        // maintain: an ordinary instant half beside ANY permanent half is
        // still 709.5's shape.
        const oneSided = splitCard([
            face({ name: "Left", typeLine: "Instant" }),
            face({
                name: "Right",
                typeLine: "Artifact — Equipment",
                oracleText: "Equipped creature gets +1/+1.",
            }),
        ]);
        expect(reasonsOf(oneSided)).toContain("CR 709.5");
        expect(reasonsOf(oneSided)).toContain("Artifact");
    });
});

const FUSE_REMINDER =
    "Fuse (You may cast one or both halves of this card from your hand.)";

describe("CR 702.102 — a FUSE split card compiles with its fuse keyword", () => {
    const fused = splitCard([
        face({
            name: "Wear",
            manaCost: "{1}{R}",
            oracleText: `Destroy target artifact.\n${FUSE_REMINDER}`,
        }),
        face({
            name: "Tear",
            manaCost: "{W}",
            oracleText: `Destroy target enchantment.\n${FUSE_REMINDER}`,
        }),
    ]);

    it("lifts the fuse line off both halves onto the card (CR 702.102a)", () => {
        const outcome = compileCard(fused);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.staticAbilities).toEqual(["fuse"]);
        const halves = outcome.definition.splitHalves!;
        // Each half keeps its printed face text (the round-trip's input) and
        // compiles to its own instruction alone.
        expect(halves[0].oracleText).toContain("Fuse (");
        expect(halves[0].effects).toEqual([
            { op: "destroy", target: { target: 0 } },
        ]);
        expect(halves[1].targetRequirement?.type).toBe("Enchantment");
    });

    it("refuses halves that cannot be fused positionally (CR 702.102d)", () => {
        // An "any number of targets" left half before a targeting right half:
        // the right half's slot has no fixed position on the fused spell.
        const variable = splitCard([
            face({
                name: "Left",
                manaCost: "{1}{U}",
                oracleText: `Return any number of target creatures to their owners' hands.\n${FUSE_REMINDER}`,
            }),
            face({
                name: "Right",
                manaCost: "{W}",
                oracleText: `Destroy target enchantment.\n${FUSE_REMINDER}`,
            }),
        ]);
        const outcome = compileCard(variable);
        if (outcome.state !== "unparsed") {
            throw new Error(
                "the variable-count left half should not have compiled"
            );
        }
        // Either the grammar or the fuse shape refuses it — never a ready
        // card whose right half reads the left half's targets.
        expect(outcome.gaps.length).toBeGreaterThan(0);
    });

    it("a split card WITHOUT the fuse line carries no fuse keyword", () => {
        const plain = compileCard(
            splitCard([
                face({
                    name: "Wear",
                    manaCost: "{1}{R}",
                    oracleText: "Destroy target artifact.",
                }),
                face({ name: "Tear", manaCost: "{W}" }),
            ])
        );
        if (plain.state === "unparsed") throw new Error("should compile");
        expect(plain.definition.staticAbilities).toBeUndefined();
    });
});

describe("the layout gate fails CLOSED on a shape it cannot read", () => {
    it("refuses a split row with anything but two faces", () => {
        // "Who // What // When // Where // Why" is one printed card with five
        // faces; a two-half model has no reading for it.
        const five = splitCard(
            ["Who", "What", "When", "Where", "Why"].map((name) =>
                face({ name })
            )
        );
        expect(reasonsOf(five)).toContain("exactly two faces");
    });

    it("refuses a half whose compiled shape a SplitHalf cannot hold", () => {
        // A keyword on a half compiles to `staticAbilities`, which is not a
        // `SplitHalf` field. Truncating it would produce a card that looks
        // playable and plays wrong — the invariant the whole module exists
        // for — so the card is refused instead.
        // An INSTANT half, deliberately: a creature half would be refused by
        // the CR 709.5 permanence loop above, which runs first — the fixture
        // would then test that gate twice and this one not at all.
        const keyworded = splitCard([
            face({
                name: "Left",
                oracleText: "Destroy target enchantment.\nFlashback {1}{G}",
            }),
            face({ name: "Right", manaCost: "{W}" }),
        ]);
        expect(reasonsOf(keyworded)).toContain("a SplitHalf cannot hold");
        expect(reasonsOf(keyworded)).not.toContain("CR 709.5");
    });
});
