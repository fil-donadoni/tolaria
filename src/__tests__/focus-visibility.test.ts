/// <reference types="node" />
// Visible focus, everywhere (issue #2593, WCAG 2.2 AA — 2.4.7 focus visible,
// 2.4.11 focus not obscured).
//
// Before this issue the repo had ZERO `:focus-visible` rules and several tab
// stops carrying Tailwind's `outline-none`, which removes the UA ring: the
// deckbuilder card tile (`role="button" tabIndex={0}`, every zone surface) and
// the Draft Room pack card (the one surface with a documented keyboard model,
// #2587) both had a tab stop a keyboard user could not see.
//
// The remedy is one unlayered `:focus-visible` rule — unlayered on purpose, so
// it outranks every utility, since a rule in `@layer base` loses to
// `outline-none` — plus this guard, which is what stops the next component from
// re-introducing the utility. Asserted against the source text because
// happy-dom has no cascade to interrogate and no layout to paint a ring in.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const css = readFileSync(join(ROOT, "src/index.css"), "utf8");

/** The interactive surfaces this issue is responsible for. */
const SURFACE_DIRS = [
    "src/components/editing",
    "src/components/deckbuilder",
    "src/components/limited",
    "src/components/lobby",
];

/** `outline-none` is legitimate only where the component paints its OWN
 *  focus-visible indicator in the same class string. One entry, one reason. */
const OWN_INDICATOR_ALLOWLIST: Record<string, string> = {
    "src/components/deckbuilder/pool-split-divider.tsx":
        "A 6px-wide col-resize handle: an outline on a 6px box is unreadable, so it " +
        "paints `focus-visible:bg-accent/50` on the handle itself instead.",
    "src/components/limited/limited-pick-context-menu.tsx":
        "Menu items paint `focus-visible:bg-accent` — a full-row fill, which is the " +
        "conventional menu focus cue and stronger than a 2px outline inside a popup.",
};

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === "__tests__") continue;
            walk(full, out);
        } else if (/\.tsx$/.test(entry)) out.push(full);
    }
    return out;
}

describe("focus is visible on every interactive surface (issue #2593)", () => {
    it("declares a :focus-visible outline OUTSIDE every cascade layer", () => {
        const at = css.indexOf(":focus-visible {");
        expect(at, "a bare `:focus-visible` rule exists").toBeGreaterThan(-1);
        const rule = css.slice(at, css.indexOf("}", at));
        expect(rule).toMatch(/outline:\s*2px solid/);
        expect(rule).toContain("outline-offset");

        // Unlayered: at the point the rule is declared, no block of any kind
        // is open — an `@layer base { … }` around it would rank it below the
        // utilities it exists to beat, and `@media`/`@supports` would narrow
        // it. Brace depth is the whole test; comments in this stylesheet carry
        // no braces.
        let depth = 0;
        for (let i = 0; i < at; i++) {
            if (css[i] === "{") depth++;
            else if (css[i] === "}") depth--;
        }
        expect(
            depth,
            "`:focus-visible` must be unlayered — inside `@layer base` it loses to `outline-none`"
        ).toBe(0);
    });

    it("no interactive surface kills the outline without replacing it", () => {
        const offenders: string[] = [];
        for (const dir of SURFACE_DIRS)
            for (const file of walk(join(ROOT, dir))) {
                const path = relative(ROOT, file);
                if (path in OWN_INDICATOR_ALLOWLIST) continue;
                const text = readFileSync(file, "utf8");
                // Only class strings, not prose: a comment explaining why the
                // utility is absent is not the utility.
                const stripped = text
                    .replace(/\/\*[\s\S]*?\*\//g, "")
                    .replace(/^\s*\/\/.*$/gm, "");
                if (/\boutline-none\b/.test(stripped)) offenders.push(path);
            }
        expect(
            offenders,
            "`outline-none` removes the keyboard cursor. Either drop it and let the " +
                "global `:focus-visible` outline paint, or add the file to " +
                "OWN_INDICATOR_ALLOWLIST with the indicator it paints instead."
        ).toEqual([]);
    });
});
