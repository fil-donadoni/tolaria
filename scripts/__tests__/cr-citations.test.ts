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
 * comment claims. Only a human printing the rule can establish that — 42 ids
 * were "recalled, never printed", and 40 of them existed in no revision of the
 * CR. The scan catches the ones that resolve to nothing; the reviewer catches
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

    it("resolves rules whose text contains a U+2028 paragraph break", () => {
        // WotC's export uses U+2028 inside some rules; JS does not treat it as a
        // line terminator, so a naive line-start match loses them (509.1b).
        expect(ids.has("509.1b")).toBe(true);
        expect(ids.has("205.4c")).toBe(true);
    });
});
