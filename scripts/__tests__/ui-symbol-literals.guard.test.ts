// lane-scans: src/**/*.tsx src/lib/symbol-names.ts
// lane-cost: 1 s (vitest "tests" 0.9 s, 1 run, 2026-11-22; the transform/setup wall is shared with the other guards(diff) files)
import { describe, it, expect } from "vitest";
import * as path from "path";
import {
    scanUiSymbolLiterals,
    scanUiSymbolLiteralSource,
} from "../lib/ui-symbol-literal-scan";

/**
 * Raw symbol-token literal guard (issue #9834). A brace-token literal that
 * reaches raw DOM text or a plain-text attribute without the symbol parser
 * renders as "{T}" on screen — see `scripts/lib/ui-symbol-literal-scan.ts`
 * for the two shapes and why a call argument is never one.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

describe("UI symbol-literal guard (issue #9834)", () => {
    it("no src/ component renders a mappable {…} literal past the parser", () => {
        const hits = scanUiSymbolLiterals(REPO_ROOT);
        expect(
            hits,
            hits
                .map(
                    (h) =>
                        `${h.file}:${h.line} — ${h.kind === "dom-text" ? `raw DOM text ${JSON.stringify(h.text)}: wrap it in withSymbols(…) or render it through a ui primitive` : `plain-text attribute ${JSON.stringify(h.text)}: say the spoken name, or symbolsToSpokenText(…)`}`
                )
                .join("\n")
        ).toEqual([]);
    });

    it("reds both bypass shapes and passes parser calls, primitives and unmappable braces", () => {
        const src = [
            `const a = <p>Pay {"{2}{R}"}?</p>;`,
            "const b = <span title={`${n} counters ({E})`} />;",
            `const c = <div aria-label="Tap {T}" />;`,
            `const d = <p>{withSymbols("Pay {G}")}</p>;`,
            `const e = <Button>{"Pay {G}"}</Button>;`,
            `const f = <p>{"config {foo}"}</p>;`,
            `// <p>{"{T}"}</p> in a comment`,
        ].join("\n");
        const hits = scanUiSymbolLiteralSource("fixture.tsx", src);
        expect(hits.map((h) => [h.line, h.kind])).toEqual([
            [1, "dom-text"],
            [2, "attribute"],
            [3, "attribute"],
        ]);
    });
});
