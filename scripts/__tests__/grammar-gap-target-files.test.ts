/**
 * A Grammar Gap issue declares the module its rule lands in (issue #6921), so
 * two sibling gaps one rule closes overlap for the planner instead of running
 * in parallel.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    blamedName,
    GRAMMAR_BLAME_FILES,
    grammarGapTargetFiles,
    renderGrammarGapTargetFiles,
} from "../lib/grammar-gap-target-files";
import { NO_SLOT, opGapKey } from "../lib/grammar-gaps";
import { parseTargetFiles } from "../lib/queue-plan";

const EFFECT_CLAUSE_FILE = "convex/oracle/grammar/shared/effectClause.ts";

describe("each blamed name maps to the module that declares it", () => {
    it.each(Object.entries(GRAMMAR_BLAME_FILES))("`%s` → %s", (name, file) => {
        expect(existsSync(file), `${file} is gone`).toBe(true);
        // `(no slot)` is the router's refusal; it never names itself.
        const declared =
            name === NO_SLOT ? "no slot consumed the line" : `"${name}"`;
        expect(readFileSync(file, "utf8")).toContain(declared);
        expect(grammarGapTargetFiles(`${name} › some span`)).toEqual([file]);
    });

    it("every name the compiled lockfile blames has a row", () => {
        const { fragments } = JSON.parse(
            readFileSync("data/oracle-compiled.json", "utf8")
        ) as {
            fragments: { attribution?: { slot: string; path: string[] } }[];
        };
        const blamed = new Set<string>();
        for (const { attribution: a } of fragments) {
            if (a === undefined) continue;
            blamed.add(a.path.length > 0 ? a.path[a.path.length - 1]! : a.slot);
        }
        const missing = [...blamed].filter(
            (name) => GRAMMAR_BLAME_FILES[name] === undefined
        );
        expect(missing).toEqual([]);
    });
});

describe("a gap key's Target files", () => {
    it("two sibling gaps one rule closes declare the same file (issue #6379, issue #6395)", () => {
        const one =
            "triggered › effect clause › You draw a card and lose N life";
        const two =
            "triggered › effect clause › You draw X cards and lose X life";
        expect(grammarGapTargetFiles(one)).toEqual([EFFECT_CLAUSE_FILE]);
        expect(grammarGapTargetFiles(two)).toEqual([EFFECT_CLAUSE_FILE]);
    });

    it("blames the innermost sub-grammar, never the slot or an outer one", () => {
        expect(
            blamedName(
                "spell › effect clause › target filter › object descriptor › nonwhite"
            )
        ).toBe("object descriptor");
    });

    it("blames the slot when the path is empty", () => {
        expect(blamedName("spell › Draw a card")).toBe("spell");
        expect(blamedName(`${NO_SLOT} › a widespread line`)).toBe(NO_SLOT);
    });

    it("declares nothing for a card-level refusal, an Op gap, or an unknown name", () => {
        expect(
            grammarGapTargetFiles('(card) › layout "saga" is not in grammar v0')
        ).toBeNull();
        expect(grammarGapTargetFiles(opGapKey("drawCards"))).toBeNull();
        expect(grammarGapTargetFiles("brand-new slot › a line")).toBeNull();
        expect(renderGrammarGapTargetFiles(opGapKey("drawCards"))).toEqual([]);
    });

    it("renders a section the planner reads back", () => {
        const body = [
            "Some prose.",
            ...renderGrammarGapTargetFiles(
                "triggered › effect clause › You draw a card and lose N life"
            ),
        ].join("\n");
        expect(parseTargetFiles(body)).toEqual([EFFECT_CLAUSE_FILE]);
    });
});
