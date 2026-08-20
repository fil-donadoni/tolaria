/// <reference types="node" />
// The axe exemption cannot widen (issue #2593).
//
// `bun run check:ui` excludes `[data-axe-exempt]` subtrees from its axe run so
// that every walked surface can hold the hard floor of 0 serious / 0 critical.
// That is only honest while the attribute stays where it belongs: the
// `/admin/design-system` reference page, whose job includes SHOWING what a
// failing token looks like — a retired hex beside its replacement, the board's
// raw counter fills whose own Specimen note reads "white text ≤3:1".
//
// Anywhere else it is an off switch on the accessibility gate, and an off
// switch nobody can see is worse than the nonzero budget row it replaced. So:
// the attribute is confined to the reference page by this test, every use must
// carry a written reason, and the gate prints the count of exempted subtrees on
// the surface's own line of every run.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const ATTRIBUTE = "data-axe-exempt";

/** Where the attribute is allowed to appear, as path prefixes from the repo
 *  root. The gate script itself defines the selector, so it names it too. */
const ALLOWED_PREFIXES = [
    "src/routes/design-system/",
    "scripts/ui-gate/index.ts",
    // The budget file's own prose explains the mechanism to whoever reads a
    // run; it declares no exemption.
    "scripts/ui-gate/budgets.json",
    "scripts/__tests__/axe-exemption-scope.test.ts",
];

const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "_generated",
    ".claude",
]);

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx|css|json)$/.test(entry)) out.push(full);
    }
    return out;
}

const hits = walk(join(ROOT, "src"))
    .concat(walk(join(ROOT, "scripts")))
    .map((file) => ({ file, text: readFileSync(file, "utf8") }))
    .filter(({ text }) => text.includes(ATTRIBUTE))
    .map(({ file, text }) => ({ path: relative(ROOT, file), text }));

describe("data-axe-exempt scope (issue #2593)", () => {
    it("appears only on the design-system reference page and in the gate", () => {
        const stray = hits
            .map((h) => h.path)
            .filter((p) => !ALLOWED_PREFIXES.some((a) => p.startsWith(a)));
        expect(
            stray,
            `${ATTRIBUTE} is an off switch on the accessibility gate — it belongs ` +
                `only to the deliberate violation specimens on /admin/design-system. ` +
                `Fix the violation instead.`
        ).toEqual([]);
    });

    it("every use carries a written reason", () => {
        // `data-axe-exempt="…"` with a non-trivial explanation, never a bare
        // attribute or an empty string.
        const bare: string[] = [];
        for (const { path, text } of hits) {
            if (!path.startsWith("src/")) continue;
            for (const match of text.matchAll(
                new RegExp(`${ATTRIBUTE}(=(?:"([^"]*)")?)?`, "g")
            )) {
                const reason = match[2];
                if (!reason || reason.trim().length < 20)
                    bare.push(`${path}: ${match[0].slice(0, 60)}`);
            }
        }
        expect(bare).toEqual([]);
    });

    it("the gate still excludes it, and still counts what it excluded", () => {
        const gate = readFileSync(
            join(ROOT, "scripts/ui-gate/index.ts"),
            "utf8"
        );
        expect(gate).toContain(`AXE_EXEMPT_SELECTOR = "[${ATTRIBUTE}]"`);
        expect(gate).toContain("exclude: [[");
        // The count is printed, so an exemption can never be silent.
        expect(gate).toContain("exempt${axe.exempt}");
    });
});
