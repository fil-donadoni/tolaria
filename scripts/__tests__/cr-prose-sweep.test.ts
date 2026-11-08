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
/**
 * Fixture citations are built at run time: a literal `CR` + id in a tracked
 * file is a real citation to the tree-wide gate (a made-up id fails it, a real
 * one needs a ledger entry for text that cites it only as a fixture).
 */
const NO_SUCH_ID = ["999", "99"].join(".");
const BOLSTER = ["701", "39"].join(".");
const PHASING = ["502", "1"].join(".");
const UNTAP = ["502", "3"].join(".");
const cite = (id: string) => `CR ${id}`;
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
        const s = sweep({
            "docs/adr/9999-x.md": `see ${cite(NO_SUCH_ID)} for this.\n`,
        });
        expect([...s.unresolved.keys()]).toEqual([NO_SUCH_ID]);
    });

    it("reports a keyword citation whose section names another keyword", () => {
        // 701.39 is Bolster; the sentence is about regeneration.
        const s = sweep({
            "docs/adr/9999-x.md": `A regenerated creature stays (${cite(BOLSTER)}).\n`,
        });
        expect(s.keyword.map((h) => h.offending)).toEqual([[BOLSTER]]);
    });

    it("flags a renumbered id that resolves but shares no word with its line", () => {
        // 502.1 is phasing now; the sentence means the untap step (502.3).
        const stale = sweep({
            "docs/adr/9999-x.md": `The untap step (${cite(PHASING)}) is automatic.\n`,
        });
        expect(stale.suspects.map((x) => x.id)).toEqual([PHASING]);
        const fixed = sweep({
            "docs/adr/9999-x.md": `The untap step (${cite(UNTAP)}) is automatic.\n`,
        });
        expect(fixed.suspects).toEqual([]);
    });

    it("reads only markdown under docs/", () => {
        const s = sweep({
            "convex/gre/x.ts": `// ${cite(NO_SUCH_ID)}\n`,
            "docs/adr/9999-x.md": "fine, no citation\n",
        });
        expect(s.files).toBe(1);
        expect(s.unresolved.size).toBe(0);
    });

    it("never takes the id as evidence for itself", () => {
        expect(
            sharesNoWord(
                `untap step ${cite(PHASING)}`,
                `${PHASING}. First, phase`
            )
        ).toBe(true);
    });

    it("prints the four counts", () => {
        const text = formatProseSweep(
            sweep({ "docs/adr/9999-x.md": `see ${cite(NO_SUCH_ID)}\n` }),
            false
        );
        expect(text).toContain("a. unresolved ids:            1");
    });
});
