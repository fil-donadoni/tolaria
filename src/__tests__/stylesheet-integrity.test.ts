/// <reference types="node" />
// Stylesheet structural integrity — `src/index.css` must PARSE the way it reads.
//
// WHY THIS EXISTS (PR #2827 round-1 review, issue #2723).
// The v4 comment block above `.input-field` shipped without its `/*` opener.
// The preceding block's `*/` closed the previous comment, so the orphaned
// fragment was swallowed as part of the NEXT rule's selector:
//
//     SELECTOR>>> "* v4 (ADR 0103, issue #2723): the FIELD is now the recessed
//                  ground … */ .input-field"
//
// Every gate stayed green. `bunx vite build` reports `Invalid dangling
// combinator in selector` as a WARNING, not an error, exits 0, and emits a
// bundle containing ZERO `.input-field` rules — measured on that tree,
// `grep -c input-field dist/assets/*.css` → 0 before the fix, 1 after. All 24
// consumers, the sign-in screen among them (`auth-form.tsx:146,164,180`),
// rendered with no border, no dark field, no padding, no text colour and no
// focus ring.
//
// WHY THE EXISTING TESTS COULD NOT SEE IT. `design-tokens.test.ts` asserts a
// great deal about these same recipes, but through a `ruleBody()` helper that
// regexes the RAW TEXT for `\.input-field\s*{`. That substring is present in a
// stylesheet whose parser has already folded the selector into a comment
// fragment, so a source-text regex is green on a rule that emits nothing. The
// only way to catch this class is to run a real CSS PARSER over the file and
// interrogate the tree it produces — which is what this file does.
//
// WHY POSTCSS AND NOT LIGHTNINGCSS. lightningcss is the compiler that
// downgraded this to a warning, so "assert zero lightningcss warnings" is the
// obvious guard — and it does not work. Run against the RAW Tailwind source it
// reports 21 warnings on a HEALTHY file (`Unknown at rule: @custom-variant`,
// `@apply`, `@theme` — Tailwind syntax it only sees post-expansion) and
// **exactly the same 21 on the broken one**: the dangling combinator surfaces
// only after Tailwind expands, i.e. only in a full build. Measured both ways
// before choosing. postcss parses Tailwind's at-rule syntax without complaint
// and discriminates cleanly: 0 offending selectors on the fixed file, 1 on the
// broken one.
//
// postcss is not a declared dependency — it arrives with vite (a direct
// devDependency) and is version-pinned in `bun.lock`. That is deliberate and
// fail-CLOSED: were it ever to disappear, this import throws and the test goes
// red. It cannot silently stop guarding.
import { describe, it, expect } from "vitest";
import postcss, { type Rule } from "postcss";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS_PATH = "src/index.css";
const css = readFileSync(resolve(process.cwd(), CSS_PATH), "utf8");

/** Every rule in the stylesheet, at any nesting depth, in source order. */
function allRules(source: string): Rule[] {
    const root = postcss.parse(source, { from: CSS_PATH });
    const rules: Rule[] = [];
    root.walkRules((rule) => rules.push(rule));
    return rules;
}

const rules = allRules(css);

/** `.foo` → the rules defining it (a recipe may be re-declared under a
 *  media query or a theme override, so this is a list, not a single rule). */
function rulesFor(selector: string): Rule[] {
    return rules.filter((rule) =>
        rule.selector.split(",").some((part) => part.trim() === selector)
    );
}

function where(rule: Rule): string {
    return `${CSS_PATH}:${rule.source?.start?.line ?? "?"}`;
}

function abbreviate(selector: string): string {
    const flat = selector.replace(/\s+/g, " ").trim();
    return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipes whose disappearance is silent and expensive.
//
// These are the shared class recipes with many consumers each — the shape of
// bug this file exists for is precisely "a recipe emits nothing and the app
// still renders, just wrong". A recipe deliberately retired belongs OUT of
// this list in the same change that retires it; that edit is the point, since
// it is what forces someone to look at the consumers first.
// ─────────────────────────────────────────────────────────────────────────────
const LOAD_BEARING_RECIPES = [
    // Fields — the recipe this guard was written for.
    ".input-field",
    // Buttons (ADR 0103 tones).
    ".btn-base",
    ".btn-tone-primary",
    ".btn-tone-secondary",
    ".btn-tone-destructive",
    ".btn-tone-ghost",
    ".btn-disabled",
    // Panel material.
    ".panel-physical",
    ".panel-header-band",
    ".panel-rule",
    // Segmented control.
    ".segment-pill",
    ".segment-active",
    ".segment-inactive",
    // Card chrome + the hairline primitives everything else is drawn with.
    ".card-ring",
    ".card-corner",
    ".hairline",
    ".hairline-strong",
    ".text-display",
] as const;

describe("src/index.css parses as written (PR #2827 review, issue #2723)", () => {
    it("parses into a non-trivial rule tree", () => {
        // Guards the guard: a parse that silently yields nothing would make
        // every per-rule sweep below vacuously green.
        expect(rules.length).toBeGreaterThan(50);
    });

    it("no selector has swallowed a comment fragment", () => {
        // THE bug. An unopened `/*` (or an unclosed one) leaves comment prose
        // — and its `*/` terminator — inside the following rule's selector.
        const offenders = rules
            .filter(
                (rule) =>
                    rule.selector.includes("*/") || rule.selector.includes("/*")
            )
            .map((rule) => `${where(rule)}  ${abbreviate(rule.selector)}`);

        expect(
            offenders,
            "A selector containing `/*` or `*/` means a comment block above it " +
                "is missing its opener or its closer. The rule it belongs to " +
                "compiles to nothing, and `vite build` reports it only as a " +
                "warning while exiting 0."
        ).toEqual([]);
    });

    it("no selector has a dangling combinator", () => {
        // The shape lightningcss names in its (non-fatal) warning. A selector
        // part may never begin or end with `>`, `+` or `~`, nor double one up.
        const offenders: string[] = [];
        for (const rule of rules) {
            for (const raw of rule.selector.split(",")) {
                const part = raw.trim();
                if (part === "") {
                    offenders.push(`${where(rule)}  <empty selector part>`);
                    continue;
                }
                if (
                    /^[>+~]/.test(part) ||
                    /[>+~]$/.test(part) ||
                    /[>+~]\s*[>+~]/.test(part)
                ) {
                    offenders.push(`${where(rule)}  ${abbreviate(part)}`);
                }
            }
        }

        expect(offenders, "dangling / doubled combinator in selector").toEqual(
            []
        );
    });

    it("no rule is empty", () => {
        // A rule that parses but carries no declaration and no nested rule
        // emits nothing — the same user-visible outcome as the bug above,
        // reached by a different route (an `@apply` line lost to a bad edit).
        const offenders = rules
            .filter((rule) => (rule.nodes?.length ?? 0) === 0)
            .map((rule) => `${where(rule)}  ${abbreviate(rule.selector)}`);

        expect(offenders, "rule with an empty body").toEqual([]);
    });
});

describe("load-bearing recipes survive parsing (PR #2827 review, issue #2723)", () => {
    it.each(LOAD_BEARING_RECIPES)(
        "%s is defined, as its own selector, with a non-empty body",
        (selector) => {
            const defining = rulesFor(selector);

            expect(
                defining.length,
                `${selector} is used across the app but no rule in ${CSS_PATH} ` +
                    `declares it. If the parser folded it into a neighbouring ` +
                    `selector, the class silently stops applying everywhere.`
            ).toBeGreaterThan(0);

            for (const rule of defining) {
                expect(
                    rule.nodes?.length ?? 0,
                    `${selector} at ${where(rule)} has an empty body`
                ).toBeGreaterThan(0);
            }
        }
    );
});
