/**
 * The frame backlog classifier (issue #6632): verb → Op, composition bucket,
 * `no Op` row, and the counts over a SYNTHETIC lockfile — no corpus.
 */

import { describe, expect, it } from "vitest";
import {
    buildFrameBacklog,
    classifyGap,
    frameBacklogDelta,
    spanHead,
    tailCut,
} from "../lib/frame-backlog";
import { gapOf, type GrammarGap } from "../lib/grammar-gaps";
import { fragmentRow, type CardRow } from "../lib/oracle-lockfile";

const OPS = new Set([
    "destroy",
    "moveZone",
    "draw",
    "sacrifice",
    "preventDamage",
]);

function effectGap(span: string, path = ["effect clause"]): GrammarGap {
    return gapOf(
        fragmentRow({
            text: span,
            reason: "no slot consumed the line",
            cards: 1,
            attribution: { slot: "spell", path, span },
        })
    );
}

describe("spanHead reads the verb a frame would open", () => {
    it("a leading verb, plural or not", () => {
        expect(spanHead("Destroy target creature")).toEqual({
            kind: "frame",
            verb: "destroy",
            op: "destroy",
        });
        expect(spanHead("Draws two cards")).toMatchObject({ verb: "draw" });
    });

    it("<player> <verb>s and Target <object> <verb> normalise to the verb", () => {
        expect(spanHead("Target player sacrifices a creature")).toMatchObject({
            verb: "sacrifice",
        });
        expect(spanHead("Each opponent discards a card")).toMatchObject({
            verb: "discard",
        });
        expect(spanHead("You may put a card into your hand")).toMatchObject({
            verb: "put",
        });
    });

    it("an opener is a composition head, not a frame", () => {
        expect(spanHead("Whenever you cast a spell")).toEqual({
            kind: "composition",
            head: "whenever",
        });
        expect(spanHead("Enchanted creature gets +1/+1")).toMatchObject({
            kind: "composition",
        });
    });

    it("a verb that needs a companion word waits for it", () => {
        expect(spanHead("Remove a counter from it")).toMatchObject({
            op: "counters",
        });
        expect(spanHead("Remove it from combat")).toMatchObject({ op: null });
        expect(spanHead("You gain 3 life")).toMatchObject({ op: "gainLife" });
    });

    it("an unread span has no head", () => {
        expect(spanHead("Zzz qqq")).toBeNull();
    });
});

describe("classifyGap", () => {
    it("a verb whose Op is registered is a frame keyed by the Op", () => {
        expect(classifyGap(effectGap("Exile target creature"), OPS)).toEqual({
            cls: "frame",
            key: "moveZone",
        });
    });

    it("a verb whose Op is not registered is a `no Op` row, never a frame key", () => {
        const c = classifyGap(effectGap("Mill three cards"), OPS);
        expect(c).toMatchObject({
            cls: "frame",
            key: "no Op › mill",
            noOp: true,
        });
    });

    it("trigger heads and static openers are composition heads", () => {
        const trig = gapOf(
            fragmentRow({
                text: "Whenever you attack, draw.",
                reason: "no slot consumed the line",
                cards: 1,
                attribution: {
                    slot: "triggered",
                    path: ["trigger head"],
                    span: "Whenever you attack",
                },
            })
        );
        expect(classifyGap(trig, OPS).cls).toBe("composition head");
        expect(
            classifyGap(
                effectGap("This creature can't be blocked", ["static clause"]),
                OPS
            )
        ).toEqual({
            cls: "composition head",
            key: "static clause › This <type>",
        });
    });

    it("a leaf sub-grammar failure is an argument class; layout and cost have their own", () => {
        expect(
            classifyGap(
                effectGap("attacking creature", [
                    "effect clause",
                    "target filter",
                    "object descriptor",
                ]),
                OPS
            ).cls
        ).toBe("argument class");
        expect(
            classifyGap(effectGap("{T}, Pay 1 life", ["activation cost"]), OPS)
                .cls
        ).toBe("cost");
        const layout = gapOf(
            fragmentRow({
                text: "x",
                reason: 'layout "saga" is not in grammar v0 (multi-faced cards)',
                cards: 1,
            })
        );
        expect(classifyGap(layout, OPS)).toEqual({
            cls: "layout",
            key: 'layout "saga" is not in grammar v0',
        });
    });
});

describe("buildFrameBacklog counts", () => {
    const DESTROY = fragmentRow({
        text: "Destroy all creatures.",
        reason: "no slot consumed the line",
        cards: 3,
        attribution: {
            slot: "spell",
            path: ["effect clause"],
            span: "Destroy all creatures",
        },
    });
    const WHENEVER = fragmentRow({
        text: "Whenever you attack, x",
        reason: "no slot consumed the line",
        cards: 1,
        attribution: {
            slot: "triggered",
            path: ["trigger head"],
            span: "Whenever you attack",
        },
    });
    const card = (
        id: string,
        gaps: (typeof DESTROY)[],
        poolIn?: CardRow["poolIn"]
    ): CardRow => ({
        oracleId: id,
        name: id,
        state: "unparsed",
        ...(poolIn ? { poolIn } : {}),
        gaps: gaps.map((g) => g.key).sort(),
    });
    // a: destroy only (premodern) · b: destroy + whenever · c: destroy (corpus only)
    const lock = {
        fragments: [DESTROY, WHENEVER],
        cards: [
            card("a", [DESTROY], ["premodern"]),
            card("b", [DESTROY, WHENEVER], ["premodern"]),
            card("c", [DESTROY]),
        ],
    };
    const backlog = buildFrameBacklog(
        lock,
        OPS,
        new Set(["a", "b"]),
        "premodern"
    );
    const row = (key: string) => backlog.rows.find((r) => r.key === key)!;

    it("touches counts every card with a gap in the row, alone only the sole-row cards", () => {
        expect(row("destroy").priority).toEqual({ touches: 2, alone: 1 });
        expect(row("destroy").corpus).toEqual({ touches: 3, alone: 2 });
    });

    it("sorts by priority touches then corpus, and tailCut floors on corpus cards", () => {
        expect(backlog.rows[0]!.key).toBe("destroy");
        expect(tailCut(backlog.rows, 2).map((r) => r.key)).toEqual(["destroy"]);
    });

    it("per-class subtotals count a card once per class", () => {
        expect(backlog.subtotals.get("frame")).toEqual({
            priority: 2,
            corpus: 3,
        });
    });

    it("the delta names the rows that moved, negative = unblocked", () => {
        const after = buildFrameBacklog(
            {
                fragments: lock.fragments,
                cards: [card("b", [WHENEVER], ["premodern"])],
            },
            OPS,
            new Set(["a", "b"]),
            "premodern"
        );
        const move = frameBacklogDelta(backlog, after).find(
            (m) => m.key === "destroy"
        )!;
        expect(move).toMatchObject({ priority: -2, corpus: -3 });
    });
});
