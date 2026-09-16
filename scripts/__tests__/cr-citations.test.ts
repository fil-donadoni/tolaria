import { describe, it, expect } from "vitest";
import {
    knownRuleIds,
    scanCitations,
    scanRepo,
} from "../check-cr-citations.ts";

/**
 * CR-citation regression guard (issue #2429, ADR 0098).
 *
 * `bun run cr:lint` is wired into `check:guards`, but a gate command can be
 * dropped from `package.json` silently. This test runs the SAME scan under
 * `bun run test`, so a citation nobody can look up cannot land either way.
 *
 * What it does NOT prove: that a resolvable citation says what the surrounding
 * comment claims. Only a human printing the rule can establish that — 44 ids
 * were "recalled, never printed", and 40 of the first 42 traced existed in no
 * revision. The scan catches the ones that resolve to nothing; the reviewer catches
 * the ones that resolve to the wrong thing.
 */
describe("CR citations resolve against the vendored document (issue #2429)", () => {
    it("every `CR NNN.Nx` in a tracked file exists in the CR", () => {
        const { bad } = scanRepo();
        const report = [...bad.entries()]
            .sort((a, b) => b[1].length - a[1].length)
            .map(
                ([id, hits]) =>
                    `  ${id} (${hits.length}) — first at ${hits[0].file}:${hits[0].line}`
            )
            .join("\n");
        expect(
            report,
            `Unresolvable CR rule ids. Print the real rule with \`bun run cr <id>\` / ` +
                `\`bun run cr grep "<keyword>"\` and fix the citation — never guess the letter:\n${report}`
        ).toBe("");
    });
});

describe("the scanner itself flags a bad id and passes a good one", () => {
    const ids = knownRuleIds();

    /**
     * Builds a fixture line. The id is INTERPOLATED, never written literally —
     * this file is itself a tracked `.ts`, so a literal `CR <id>` here would be
     * picked up by the repo-wide scan above and by `bun run cr:lint`, and the
     * guard would fail on its own fixtures. (It did, the first time.)
     */
    const cite = (id: string) => `// CR ${id} — fixture`;

    /**
     * The slash-list shape: one `CR ` prefix, several ids. Same interpolation
     * rule as `cite`.
     */
    const citeList = (...list: string[]) =>
        `// CR ${list.join(" / ")} — fixture`;

    it("reports a fabricated subrule letter", () => {
        // `611.1` is real; `611.1b` never existed in any revision — the single
        // most-cited fabrication found in #2429 (163 sites).
        const { bad } = scanCitations(
            [{ file: "fake.ts", text: cite("611.1b") }],
            ids
        );
        expect([...bad.keys()]).toEqual(["611.1b"]);
        expect(bad.get("611.1b")).toEqual([{ file: "fake.ts", line: 1 }]);
    });

    it("accepts the rule that citation should have pointed at", () => {
        const { bad, total } = scanCitations(
            [{ file: "fake.ts", text: cite("611.2a") }],
            ids
        );
        expect(total).toBe(1);
        expect(bad.size).toBe(0);
    });

    it("reports a wholly invented section", () => {
        const { bad } = scanCitations(
            [{ file: "fake.ts", text: cite("999.9z") }],
            ids
        );
        expect([...bad.keys()]).toEqual(["999.9z"]);
    });

    it("does not treat a bare section number as a citation", () => {
        // A section-level reference with no subrule is legitimate.
        const { bad, total } = scanCitations(
            [{ file: "fake.ts", text: cite("611") }],
            ids
        );
        expect(total).toBe(1);
        expect(bad.size).toBe(0);
    });

    it("resolves a BARE id sharing a line with a CR mention", () => {
        // The blind spot that hid two of the 44 bad ids #2429 corrected (10
        // sites): in a slash-list only the FIRST id carries the prefix, so a
        // scan keyed on that prefix never looks at the rest. Below, 112.5
        // exists in no revision; 707.10a is what nine copy-a-spell sites meant.
        // (Ids stay out of any line bearing the prefix, for the same reason
        // `cite` interpolates — this file is scanned by the sweep above.)
        const { bad, total } = scanCitations(
            [{ file: "fake.ts", text: citeList("707.10a", "112.5") }],
            ids
        );
        expect(total).toBe(2);
        expect([...bad.keys()]).toEqual(["112.5"]);
        expect(bad.get("112.5")).toEqual([{ file: "fake.ts", line: 1 }]);
    });

    it("counts a prefixed id once, not once per pass", () => {
        const { bad, total } = scanCitations(
            [{ file: "fake.ts", text: cite("611.2a") }],
            ids
        );
        expect(total).toBe(1);
        expect(bad.size).toBe(0);
    });

    it("ignores a bare id on a line with no CR mention", () => {
        // What keeps the repo's two deliberate negative fixtures unflagged:
        // `cr: "999.99"` (mechanicsRegistry.test.ts) and the `"605.99"` CLI
        // argument (cr-source.test.ts) are data, not citations, and neither
        // line mentions CR.
        const { bad, total } = scanCitations(
            [
                {
                    file: "fake.ts",
                    text: `const fabricated = "999.99";\n${cite("611.2a")}`,
                },
            ],
            ids
        );
        expect(total).toBe(1);
        expect(bad.size).toBe(0);
    });

    it("does not mistake a version string or a dotted date for a rule id", () => {
        // The `\b\d{3}\.` anchor is what buys the bare pass zero false
        // positives: "2026.08.07" has no word boundary three digits before a
        // dot, and "1.2.3" never reaches three.
        const { bad, total } = scanCitations(
            [
                {
                    file: "fake.ts",
                    text: `${cite("611.2a")} (vendored 2026.08.07, tool 1.2.3)`,
                },
            ],
            ids
        );
        expect(total).toBe(1);
        expect(bad.size).toBe(0);
    });

    it("resolves rules whose text contains a U+2028 paragraph break", () => {
        // WotC's export uses U+2028 inside some rules; JS does not treat it as a
        // line terminator, so a naive line-start match loses them (509.1b).
        expect(ids.has("509.1b")).toBe(true);
        expect(ids.has("205.4c")).toBe(true);
    });
});

describe("a citation wrapped across two comment lines is read whole (issue #2514)", () => {
    const ids = knownRuleIds();
    const scan = (text: string) =>
        scanCitations([{ file: "fake.ts", text }], ids);
    // Every fixture interpolates its id and keeps `CR ` off the helper's own
    // line, for the reason `cite` gives above: this file is scanned too.
    const cite = (id: string) => `// CR ${id} — fixture`;
    /** Shape A: the prefix ends one line, the id starts the next. */
    const prefixThenId = (id: string, tail = "— fixture") =>
        `// the rule is CR\n// ${id} ${tail}`;
    /** A wrapped slash-list: the first id ends the line, the next begins it. */
    const wrappedList = (first: string, second: string) =>
        `// CR ${first} /\n// ${second} — fixture`;
    /** The id ends the line; whatever follows starts the next. */
    const idThen = (id: string, next: string) => `// see CR ${id},\n// ${next}`;

    it("resolves a prefix split from its id, at the line the id is on", () => {
        const { total, bad, citations } = scan(prefixThenId("611.2a"));
        expect(total).toBe(1);
        expect(bad.size).toBe(0);
        // Reported and keyed on the PHYSICAL line carrying the id, not on
        // the joined text — the ledger's entry is that line.
        expect(citations[0]).toMatchObject({
            line: 2,
            id: "611.2a",
            text: "// 611.2a — fixture",
        });
    });

    it("reds on a wrapped citation whose id resolves to nothing — the shape that passed green before", () => {
        const { bad } = scan(prefixThenId("611.1b"));
        expect(bad.get("611.1b")).toEqual([{ file: "fake.ts", line: 2 }]);
    });

    it("resolves a bare id on the continuation of a wrapped slash-list", () => {
        const { total, bad } = scan(wrappedList("707.10a", "112.5"));
        expect(total).toBe(2);
        expect([...bad.keys()]).toEqual(["112.5"]);
        expect(bad.get("112.5")).toEqual([{ file: "fake.ts", line: 2 }]);
    });

    it("joins JSDoc, line-comment and prose lines alike, by their own marker", () => {
        expect(
            scan(` * see CR\n *  ${"611.2a"} — fixture`).citations[0]
        ).toMatchObject({ line: 2, id: "611.2a" });
        expect(scan(`see CR\n${"611.2a"} — fixture`).total).toBe(1);
        expect(scan(prefixThenId("611.2a")).total).toBe(1);
    });

    it("chains a continuation that itself ends mid-citation", () => {
        const { total, bad } = scan(
            `// see CR\n// ${"611.2a"} and CR\n// ${"611.1b"} — fixture`
        );
        expect(total).toBe(2);
        expect(bad.get("611.1b")).toEqual([{ file: "fake.ts", line: 3 }]);
    });

    it("joins nothing when the line does not end mid-citation — a prose number after a CR line stays a number", () => {
        // The objection that kept the scans single-line: the line AFTER a CR
        // mention. It is joined only when the CR line ends on the citation.
        const { total, bad } = scan(
            `${cite("611.2a")} for the rule, then\n// 100.5 is the value`
        );
        expect(total).toBe(1);
        expect(bad.size).toBe(0);
    });

    it("does not mistake a version string or a dotted date on a continuation for a rule id", () => {
        const versions = scan(
            prefixThenId("611.2a", "(vendored 2026.08.07, tool 1.2.3)")
        );
        expect(versions.total).toBe(1);
        expect(versions.bad.size).toBe(0);
        const date = scan(idThen("611.2a", "2026.08.07 was the revision"));
        expect(date.total).toBe(1);
        expect(date.bad.size).toBe(0);
    });

    it("does not join across a comment boundary — code after a comment, or a block's closer", () => {
        expect(scan(`// see CR\n${"611.1b"};`).total).toBe(0);
        expect(scan(`/** see CR\n */\n${"611.1b"}`).total).toBe(0);
    });

    it("does not join a sentence that ended on the id with the next sentence", () => {
        // "… (CR 611.2a). 100.5 is …" on one line would resolve 100.5; the
        // wrap is not treated as wider than the line it replaces.
        const { total } = scan(
            `${idThen("611.2a", "100.5 is the value").replace(",\n", ".\n")}`
        );
        expect(total).toBe(1);
    });

    it("joins an id followed by a possessive or a dash — the sentence is still open", () => {
        const { total, citations } = scan(
            `${idThen("611.2a", "100.5 is the value").replace(",\n", "'s\n")}`
        );
        expect(total).toBe(2);
        expect(citations.map((c) => c.line)).toEqual([1, 2]);
        const dash = scan(
            `${idThen("611.2a", "100.5 is the value").replace(",\n", " —\n")}`
        );
        expect(dash.total).toBe(2);
    });
});
