import { describe, it, expect } from "vitest";
import {
    detectionTerms,
    formatHit,
    keywordIndex,
    scanKeywordCitations,
} from "../cr-keyword-citations.ts";
import { readSources } from "../check-cr-citations.ts";

/**
 * Keyword-citation semantics guard (ADR 0098, follow-up to issue #2429).
 *
 * `cr-citations.test.ts` proves every cited id EXISTS. This proves the CR
 * 701/702 ones mean what the line around them says — the "resolvable but
 * wrong" class that the existence scan is blind to by construction, and that
 * stood at 793 sites in this repo (the whole keyword-action block had been
 * written against a pre-renumbering CR: "701.19 search" is Regenerate,
 * "701.16 sacrifice" is Investigate, "702.13 landwalk" is Intimidate).
 *
 * The scan is also wired into `bun run cr:lint` → `check:guards`; this test is
 * the belt to that braces, exactly as for the existence scan.
 */
describe("CR keyword citations name the section they cite", () => {
    it("no tracked file cites one keyword's section while naming another", () => {
        const index = keywordIndex();
        const { hits } = scanKeywordCitations(readSources(), index);
        const report = hits.map((h) => formatHit(h, index)).join("\n");
        expect(
            report,
            "A CR 701/702 citation points at a different keyword than its line names.\n" +
                "Print both rules with `bun run cr <id>`: either the id is wrong, or the\n" +
                "citation is right and the line simply never names its keyword — in which\n" +
                `case say the keyword on that line.\n${report}`
        ).toBe("");
    });
});

describe("the keyword index tracks the vendored document, not a hardcoded map", () => {
    const index = keywordIndex();

    it("resolves section titles to the CURRENT numbering", () => {
        // The four whose renumbering caused the largest clusters in this repo.
        expect(index.idOf.get("Search")).toBe("701.23");
        expect(index.idOf.get("Sacrifice")).toBe("701.21");
        expect(index.idOf.get("Regenerate")).toBe("701.19");
        expect(index.idOf.get("Landwalk")).toBe("702.14");
    });

    it("throws when a term-table key stops naming a section", () => {
        // What surfaced Wizards renaming "Totem Armor" to "Umbra Armor": a
        // stale key is a table that silently detects nothing, so it is an
        // error, not a no-op.
        const stale = {
            ...index,
            idOf: new Map(
                [...index.idOf].filter(([title]) => title !== "Search")
            ),
        };
        expect(() => detectionTerms(stale)).toThrow(/Search/);
    });
});

describe("the scanner flags a renumbered citation and passes a correct one", () => {
    const index = keywordIndex();
    /**
     * Fixture lines interpolate the id, never write it literally: this file is
     * itself tracked, and a literal `CR <id>` here would be picked up by the
     * repo-wide sweep above and by `bun run cr:lint`.
     */
    const line = (id: string, prose: string) => `// CR ${id} — ${prose}`;
    const scan = (text: string) =>
        scanKeywordCitations([{ file: "fake.ts", text }], index);

    it("flags the pre-renumbering 'search' citation", () => {
        const { hits } = scan(line("701.19", "a genuine library search"));
        expect(hits).toHaveLength(1);
        expect(hits[0].offending).toEqual(["701.19"]);
        expect(formatHit(hits[0], index)).toContain("701.19 = Regenerate");
        expect(formatHit(hits[0], index)).toContain("Search is 701.23");
    });

    it("passes the citation that one should have been", () => {
        expect(scan(line("701.23", "a genuine library search")).hits).toEqual(
            []
        );
    });

    it("checks EVERY id on a line, not just one of them", () => {
        // The slash-list shape: the regeneration half anchors the line, and a
        // line-level rule would wave the stale destroy id through forever.
        const { hits } = scan(
            `// CR ${"701.7"} / ${"701.19c"} — destroy target creature; it can't be regenerated`
        );
        expect(hits).toHaveLength(1);
        expect(hits[0].offending).toEqual(["701.7"]);
    });

    it("passes a line that names no keyword at all", () => {
        // No evidence either way — the scan reports only what it can decide.
        expect(scan(line("701.19", "see the issue for context")).hits).toEqual(
            []
        );
    });

    it("passes when the cited rule's own text uses the term the line names", () => {
        // Annihilator's rule says "defending player sacrifices N permanents",
        // so naming sacrifice beside it is not a mismatch.
        expect(
            scan(line("702.86a", "the defender sacrifices N permanents")).hits
        ).toEqual([]);
    });

    it("takes an ambiguous title as an anchor but never as evidence", () => {
        // "Escape" cannot prove a line MEANS escape (too common a word), yet
        // it still anchors its own citation against the exile it names.
        expect(
            scan(line("702.138a", "Escape — exile five other cards")).hits
        ).toEqual([]);
        // …and a bare "cast"/"player" never accuses a citation of being wrong.
        expect(
            scan(line("701.23a", "the caster is the player who searches")).hits
        ).toEqual([]);
    });

    it("honours the inline suppression marker", () => {
        const suppressed = `${line("701.19", "a genuine library search")} cr-cite-ok`;
        expect(scan(suppressed).hits).toEqual([]);
    });
});
