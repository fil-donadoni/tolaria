/**
 * Grammar residue ledger over a SYNTHETIC pair of lockfiles (issue #5222):
 * which considered cards stay `unparsed`, how each residual gap is tracked,
 * and which are HOLES. Every number is derivable by hand.
 */

import { describe, expect, it } from "vitest";
import {
    buildResidue,
    parseClusterKeys,
    renderLedger,
    trackingOf,
} from "../lib/grammar-residue";
import type { CardRow, FragmentRow } from "../lib/oracle-lockfile";
import type { ClaimRow, ClusterRow } from "../lib/targets";

const frag = (span: string, slot = "triggered", path = ["trigger head"]) =>
    ({
        text: `${span}.`,
        reason: "no slot consumed the line",
        cards: 1,
        attribution: { slot, path, span },
    }) satisfies FragmentRow;

// before: the head gap refuses A and B. after: the head reads, A graduates,
// B is refused by a BODY gap the head used to mask, C by another one.
const HEAD = frag("Whenever you cast a spell");
const BODY_X = frag("Sacrifice this creature", "triggered", ["effect clause"]);
const BODY_Y = frag("Counter it", "triggered", ["effect clause"]);
const KEY_HEAD = "triggered › trigger head › Whenever you cast a spell";
const KEY_X = "triggered › effect clause › Sacrifice this creature";
const KEY_Y = "triggered › effect clause › Counter it";

const unparsed = (id: string, gaps: number[]): CardRow => ({
    oracleId: id,
    name: `Card ${id}`,
    state: "unparsed",
    gaps,
});
const ready = (id: string): CardRow => ({
    oracleId: id,
    name: `Card ${id}`,
    state: "ready",
});

const before = {
    fragments: [HEAD],
    cards: [unparsed("A", [0]), unparsed("B", [0])],
};
const after = {
    fragments: [BODY_X, BODY_Y],
    cards: [ready("A"), unparsed("B", [0]), unparsed("C", [1])],
};

const claim = (key: string, issue: number): ClaimRow => ({
    kind: "grammar",
    key,
    issue,
});
const open =
    (...issues: number[]) =>
    (n: number) =>
        issues.includes(n);

describe("parseClusterKeys", () => {
    it("reads the backticked first column of the Grammar Gaps table only", () => {
        const body = [
            "## Parent",
            "| `not this` | x |",
            "## Grammar Gaps",
            "| Key | c/r |",
            "| --- | --- |",
            `| \`${KEY_HEAD}\` | 2/2 |`,
            `| \`${KEY_X}\` | 1/1 |`,
            "## What to build",
            "| `nor this` | x |",
        ].join("\n");
        expect(parseClusterKeys(body)).toEqual([KEY_HEAD, KEY_X]);
    });

    it("returns [] for an issue that is not a Grammar Cluster", () => {
        expect(parseClusterKeys("## What\nnothing")).toEqual([]);
    });
});

describe("buildResidue", () => {
    it("considers the cards the keys refused BEFORE, not the ones that fail later", () => {
        const r = buildResidue({
            before,
            after,
            keys: [KEY_HEAD],
            claims: [claim(KEY_X, 10)],
            clusters: [],
            isOpen: open(10),
        });
        expect(r.cards.map((c) => c.oracleId)).toEqual(["A", "B"]);
        expect(r.graduated).toEqual(["Card A"]);
    });

    it("an unmasked body gap with an open claim is tracked, not a hole", () => {
        const r = buildResidue({
            before,
            after,
            keys: [KEY_HEAD],
            claims: [claim(KEY_X, 10)],
            clusters: [],
            isOpen: open(10),
        });
        expect(r.cards[1]!.residual).toEqual([
            { key: KEY_X, tracking: { via: "claim", issue: 10 } },
        ]);
        expect(r.holes).toEqual([]);
    });

    it("a residual gap with NO claim is a hole naming its cards", () => {
        const r = buildResidue({
            before,
            after,
            keys: [KEY_HEAD],
            claims: [],
            clusters: [],
            isOpen: open(),
        });
        expect(r.holes).toEqual([
            { key: KEY_X, tracking: { via: "none" }, cards: ["Card B"] },
        ]);
    });

    it("a claim whose issue is CLOSED is a hole too", () => {
        const r = buildResidue({
            before,
            after,
            keys: [KEY_HEAD],
            claims: [claim(KEY_X, 10)],
            clusters: [],
            isOpen: open(),
        });
        expect(r.holes).toEqual([
            {
                key: KEY_X,
                tracking: { via: "closed", issue: 10 },
                cards: ["Card B"],
            },
        ]);
    });

    it("a gap outside every enforced Target is long tail, listed but never a hole", () => {
        const r = buildResidue({
            before,
            after,
            keys: [KEY_HEAD],
            claims: [],
            clusters: [],
            isOpen: open(),
            target: new Set(["A"]),
        });
        expect(r.holes).toEqual([]);
        expect(r.cards[1]!.residual[0]!.tracking).toEqual({ via: "tail" });
    });

    it("renders HOLE rows and the marker", () => {
        const r = buildResidue({
            before,
            after,
            keys: [KEY_HEAD],
            claims: [],
            clusters: [],
            isOpen: open(),
        });
        const text = renderLedger(r, 1, 2);
        expect(text).toContain("<!-- grammar:residue ledger -->");
        expect(text).toContain("**HOLE** — no issue");
        expect(text).toContain("1 hole(s)");
    });
});

describe("trackingOf — cluster signatures", () => {
    const cluster: ClusterRow = {
        issue: 77,
        kind: "grammar",
        match: ["triggered › effect clause › *"],
    };

    it("an open cluster whose signature matches tracks the key", () => {
        expect(
            trackingOf(KEY_Y, {
                claims: [],
                clusters: [cluster],
                isOpen: open(77),
            })
        ).toEqual({ via: "cluster", issue: 77 });
    });

    it("a closed cluster does not", () => {
        expect(
            trackingOf(KEY_Y, {
                claims: [],
                clusters: [cluster],
                isOpen: open(),
            })
        ).toEqual({ via: "none" });
    });
});
