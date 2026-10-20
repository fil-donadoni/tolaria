import { describe, expect, it } from "vitest";
import {
    baselineAdditions,
    blockKey,
    commentBlocks,
    issueLogBlocks,
    issueLogVerdict,
    issueRefs,
} from "../lib/issue-log-comments";
import { classifyLane } from "../check-lane";

const LOG = [
    "// Does a thing.",
    "// Issue #1 added a; issue #2 fixed b.",
    "// Later, issue #3 changed c.",
    "export const x = 1;",
].join("\n");

describe("issueRefs", () => {
    it("counts distinct `issue #N` refs, not bare #N or repeats", () => {
        const refs = issueRefs("issue #1, issue #1, PR #2, see #3, Issue #4");
        expect([...refs].sort()).toEqual([1, 4]);
    });
});

describe("commentBlocks", () => {
    it("joins a // run and reads /* */ and /** */ as one block each", () => {
        const src = "// a\n// b\nconst x = 1;\n/** c\n * d */\n/* e */\n";
        expect(
            commentBlocks(src).map((b) => b.text.split("\n").length)
        ).toEqual([2, 2, 1]);
    });
});

describe("issueLogVerdict", () => {
    const found = issueLogBlocks("a.ts", LOG);
    it("finds a 3-ref block and ignores a 2-ref one", () => {
        expect(found).toHaveLength(1);
        expect(
            issueLogBlocks("a.ts", LOG.replace(" Later, issue #3", " Later"))
        ).toHaveLength(0);
    });
    it("reds a block the baseline does not hold, greens a held one", () => {
        expect(issueLogVerdict(found, []).ok).toBe(false);
        expect(issueLogVerdict(found, [found[0]!.key]).ok).toBe(true);
    });
    it("reds an EDITED legacy block: the edit changes its key", () => {
        const held = [found[0]!.key];
        const edited = issueLogBlocks(
            "a.ts",
            LOG.replace("changed c", "changed d")
        );
        expect(issueLogVerdict(edited, held).fresh).toHaveLength(1);
    });
    it("is indifferent to whitespace, not to the file", () => {
        expect(blockKey("a.ts", "// x  y")).toBe(blockKey("a.ts", "//  x y"));
        expect(blockKey("a.ts", "// x")).not.toBe(blockKey("b.ts", "// x"));
    });
    it("reds a stale baseline key so the ratchet tightens", () => {
        expect(issueLogVerdict([], ["gone.ts#abc"]).stale).toEqual([
            "gone.ts#abc",
        ]);
    });
});

describe("baselineAdditions", () => {
    it("names a key added against the merge base; a removal is free", () => {
        expect(baselineAdditions(["a", "b"], ["b", "c"])).toEqual(["c"]);
    });
});

describe("check-lane admission", () => {
    const ran = (files: string[]) =>
        classifyLane(files).run.some(
            (c) => c.id === "check:issue-log-comments"
        );
    it("runs on a source edit and on the baseline, not on a non-source file", () => {
        expect(ran(["convex/gre/ai/opValuers.ts"])).toBe(true);
        expect(ran(["data/issue-log-comments-baseline.json"])).toBe(true);
        expect(ran(["data/other.json"])).toBe(false);
    });
});
