import { describe, it, expect } from "vitest";
import { keywordIndex } from "../cr-keyword-citations.ts";
import { knownRuleIds, scanCitations } from "../check-cr-citations.ts";
import { emptyLedger } from "../lib/cr-ledger.ts";
import { loadRules } from "../lib/cr-rules.ts";
import {
    formatProseSweep,
    proseSweep,
    sharesNoWord,
} from "../lib/cr-prose-sweep.ts";

/**
 * `cr:lint --all-prose` (issue #8724): reads every `CR <id>` under docs/**
 * regardless of the diff. Drives the pure sweep over in-memory sources against
 * the vendored rules; reads no repo document.
 */
const rules = loadRules();
const index = keywordIndex();

function sweep(files: Record<string, string>) {
    const sources = Object.entries(files).map(([file, text]) => ({
        file,
        text,
    }));
    const { bad, citations } = scanCitations(sources, knownRuleIds());
    return proseSweep({
        sources,
        citations,
        unresolved: bad,
        rules,
        ledger: emptyLedger(),
        index,
    });
}

describe("proseSweep (issue #8724)", () => {
    it("reports an unresolvable id in docs prose", () => {
        const s = sweep({ "docs/adr/9999-x.md": "see CR 999.99 for this.\n" });
        expect([...s.unresolved.keys()]).toEqual(["999.99"]);
    });

    it("reports a keyword citation whose section names another keyword", () => {
        // 701.39 is Bolster; the sentence is about regeneration.
        const s = sweep({
            "docs/adr/9999-x.md": "A regenerated creature stays (CR 701.39).\n",
        });
        expect(s.keyword.map((h) => h.offending)).toEqual([["701.39"]]);
    });

    it("flags a renumbered id that resolves but shares no word with its line", () => {
        // 502.1 is phasing now; the sentence means the untap step (502.3).
        const stale = sweep({
            "docs/adr/9999-x.md": "The untap step (CR 502.1) is automatic.\n",
        });
        expect(stale.suspects.map((x) => x.id)).toEqual(["502.1"]);
        const fixed = sweep({
            "docs/adr/9999-x.md": "The untap step (CR 502.3) is automatic.\n",
        });
        expect(fixed.suspects).toEqual([]);
    });

    it("reads only markdown under docs/", () => {
        const s = sweep({
            "convex/gre/x.ts": "// CR 999.99\n",
            "docs/adr/9999-x.md": "fine, no citation\n",
        });
        expect(s.files).toBe(1);
        expect(s.unresolved.size).toBe(0);
    });

    it("never takes the id as evidence for itself", () => {
        expect(sharesNoWord("untap step CR 502.1", "502.1. First, phase")).toBe(
            true
        );
    });

    it("prints the four counts", () => {
        const text = formatProseSweep(
            sweep({ "docs/adr/9999-x.md": "see CR 999.99\n" }),
            false
        );
        expect(text).toContain("a. unresolved ids:            1");
    });
});
