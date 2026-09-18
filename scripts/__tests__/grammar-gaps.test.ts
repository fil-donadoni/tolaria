/**
 * Grammar Gap ranking over a SYNTHETIC lockfile (issue #3822): the counts,
 * the Target restriction, the order, and the gap key's shape folding — no
 * corpus, no committed lockfile, so every number below is derivable by hand.
 */

import { describe, expect, it } from "vitest";
import {
    CARD_LEVEL,
    gapOf,
    gapShape,
    NO_SLOT,
    poolTarget,
    rankGrammarGaps,
    setTargetFromMtgjson,
} from "../lib/grammar-gaps";
import type { CardRow, FragmentRow } from "../lib/oracle-lockfile";

const EQUIP_2: FragmentRow = {
    text: "Equip {2}",
    reason: "no slot consumed the line",
    cards: 2,
    attribution: {
        slot: "keyword-line",
        path: ["keyword ability"],
        span: "Equip {2}",
    },
};
const EQUIP_3: FragmentRow = {
    ...EQUIP_2,
    text: "Equip {3}",
    cards: 1,
    attribution: { ...EQUIP_2.attribution!, span: "Equip {3}" },
};
const HEAD: FragmentRow = {
    text: "Whenever you gain life, draw a card.",
    reason: "no slot consumed the line",
    cards: 2,
    attribution: {
        slot: "triggered",
        path: ["trigger head"],
        span: "Whenever you gain life",
    },
};
const TRANSFORM: FragmentRow = {
    text: "Creature — Werewolf // Creature — Werewolf",
    reason: 'layout "transform" is not in grammar v0 (multi-faced cards)',
    cards: 1,
};
const UNENTERED: FragmentRow = {
    text: "Totally unreadable text 3",
    reason: "no slot consumed the line",
    cards: 1,
};

const FRAGMENTS = [EQUIP_2, EQUIP_3, HEAD, TRANSFORM, UNENTERED];

function unparsed(
    id: string,
    gaps: number[],
    poolIn?: CardRow["poolIn"]
): CardRow {
    return {
        oracleId: id,
        name: `Card ${id}`,
        state: "unparsed",
        ...(poolIn ? { poolIn } : {}),
        gaps,
    };
}

// a: only Equip {2}            → Equip compiles a
// b: Equip {3} + trigger head  → refuses both, compiles neither
// c: only trigger head         → head compiles c
// d: Equip {2} + head          → refuses both
// e: transform                 → card-level gap compiles e
// f: unentered line            → (no slot) gap compiles f
// g: ready, never counted
const CARDS: CardRow[] = [
    unparsed("a", [0], ["premodern"]),
    unparsed("b", [1, 2], ["premodern", "legacy"]),
    unparsed("c", [2], ["legacy"]),
    unparsed("d", [0, 2]),
    unparsed("e", [3]),
    unparsed("f", [4]),
    { oracleId: "g", name: "Card g", state: "ready", poolIn: ["premodern"] },
];
const LOCK = { fragments: FRAGMENTS, cards: CARDS };

describe("gapShape folds only what cannot change the missing rule", () => {
    it("folds a mana cost and a number, keeps the words", () => {
        expect(gapShape("Equip {2}")).toBe("Equip {…}");
        expect(gapShape("Cycling {1}{W}")).toBe("Cycling {…}");
        expect(gapShape("Crew 3")).toBe("Crew N");
        expect(gapShape("-2")).toBe("-N");
        expect(gapShape("gets +1/+1")).toBe("gets +N/+N");
    });

    it("keeps the name marker and the non-mana symbols, which are not amounts", () => {
        expect(gapShape("When {self} enters")).toBe("When {self} enters");
        expect(gapShape("{T}, Sacrifice a land")).toBe("{T}, Sacrifice a land");
        expect(gapShape("{2}{G}, {T}")).toBe("{…}, {T}");
    });
});

describe("gapOf attributes every fragment kind", () => {
    it("an attributed fragment keys on slot, path and shape", () => {
        expect(gapOf(EQUIP_2)).toEqual(gapOf(EQUIP_3));
        expect(gapOf(EQUIP_2)).toMatchObject({
            slot: "keyword-line",
            path: ["keyword ability"],
            shape: "Equip {…}",
        });
    });

    it("an unentered line is its own gap; a card-level refusal keys on its reason", () => {
        expect(gapOf(UNENTERED)).toMatchObject({
            slot: NO_SLOT,
            shape: "Totally unreadable text N",
        });
        expect(gapOf(TRANSFORM)).toMatchObject({
            slot: CARD_LEVEL,
            shape: TRANSFORM.reason,
        });
    });
});

describe("rankGrammarGaps", () => {
    it("ranks the corpus by compiles, then refuses, with every count", () => {
        const ranked = rankGrammarGaps(LOCK, null);
        expect(
            ranked.map((g) => [g.shape, g.target.compiles, g.target.refuses])
        ).toEqual([
            // Equip and the head both compile one card and refuse three; the
            // corpus count ties too, so the KEY decides — a total order.
            ["Equip {…}", 1, 3],
            ["Whenever you gain life", 1, 3],
            [TRANSFORM.reason, 1, 1],
            ["Totally unreadable text N", 1, 1],
        ]);
        // With no Target, the Target IS the corpus.
        for (const g of ranked) expect(g.corpus).toEqual(g.target);
    });

    it("restricts to the Target, keeping the corpus count beside it", () => {
        const ranked = rankGrammarGaps(LOCK, new Set(["a", "b"]));
        expect(
            ranked.map((g) => [
                g.shape,
                g.target.compiles,
                g.target.refuses,
                g.corpus.compiles,
                g.corpus.refuses,
            ])
        ).toEqual([
            ["Equip {…}", 1, 2, 1, 3],
            ["Whenever you gain life", 0, 1, 1, 3],
        ]);
    });

    it("puts the gap that COMPILES more before the one that merely refuses more", () => {
        // Equip refuses three cards and is the last gap of none of them; the
        // trigger head refuses two and is the last gap of one. Landing the head
        // rule compiles a card, landing Equip compiles nothing.
        const ranked = rankGrammarGaps(
            {
                fragments: FRAGMENTS,
                cards: [
                    unparsed("p", [0, 2]),
                    unparsed("q", [0, 3]),
                    unparsed("r", [0, 4]),
                    unparsed("s", [2]),
                ],
            },
            null
        );
        expect(
            ranked
                .slice(0, 2)
                .map((g) => [g.shape, g.target.compiles, g.target.refuses])
        ).toEqual([
            ["Whenever you gain life", 1, 2],
            ["Equip {…}", 0, 3],
        ]);
    });

    it("breaks a Target tie on the corpus count (the leverage tie-break)", () => {
        // Target {b}: both gaps refuse b and compile nothing; Equip refuses 3 in
        // the corpus, the head 3 too — make the head's corpus count larger.
        const extra = unparsed("h", [2]);
        const ranked = rankGrammarGaps(
            { fragments: FRAGMENTS, cards: [...CARDS, extra] },
            new Set(["b"])
        );
        expect(ranked.map((g) => g.shape)).toEqual([
            "Whenever you gain life",
            "Equip {…}",
        ]);
    });

    it("counts a card once per gap, however many of its lines fail there", () => {
        const twice = unparsed("x", [0, 1]); // Equip {2} AND Equip {3}
        const ranked = rankGrammarGaps(
            { fragments: FRAGMENTS, cards: [twice] },
            null
        );
        expect(ranked).toHaveLength(1);
        // One gap, one card — and it is the card's ONLY gap, so it compiles it.
        expect(ranked[0]!.target).toEqual({ refuses: 1, compiles: 1 });
    });

    it("takes the example from a Target card when there is one", () => {
        const [head] = rankGrammarGaps(LOCK, new Set(["c"]));
        expect(head!.example).toEqual({ line: HEAD.text, card: "Card c" });
    });
});

describe("Targets are sets of oracle ids", () => {
    it("a format pool reads the lockfile's poolIn", () => {
        expect([...poolTarget(LOCK, "premodern")].sort()).toEqual([
            "a",
            "b",
            "g",
        ]);
    });

    it("a set reads an MTGJSON set file's oracle ids", () => {
        const ids = setTargetFromMtgjson({
            data: {
                cards: [
                    { identifiers: { scryfallOracleId: "a" } },
                    { identifiers: { scryfallOracleId: "a" } },
                    { identifiers: {} },
                    { identifiers: { scryfallOracleId: "b" } },
                ],
            },
        });
        expect([...ids].sort()).toEqual(["a", "b"]);
    });
});
