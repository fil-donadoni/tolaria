import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { tryGetDefinition } from "../../convex/cards";

/**
 * Card-test seam boundary guard (issue #3048).
 *
 * A per-card test is the durable evidence a card behaves as specified, and
 * ADR 0114 §1 makes that test the guard a card keeps AFTER its hand-written
 * closure is retired in favour of a compiled twin. That only works if the test
 * reaches its subject the way the ENGINE does — through the registry seam
 * (`getDefinition(id)`, ADR 0046). A test that reaches it by module import
 * stops compiling the moment the module goes away, so the proof dies in the
 * same commit as the thing it was proving.
 *
 * Two doors, both closed here:
 *
 *  1. `import { fooBar } from "../white"` — the subject is a module import.
 *  2. `getCardByName("Foo Bar")` / `getAllCards().find(…)` — the subject comes
 *     through a SWAP-BLIND reader. `nameRegistry` is a module-load `const`
 *     (`catalogue.ts`) that `preloadDefinitions` never writes, and
 *     `getAllCards()` memoizes `expandedAllCards` on its first call, which
 *     `vitest.setup.node.ts` makes in its freeze loop BEFORE the swap block.
 *     So a test on either reader resolves the hand-written definition no
 *     matter what the gold harness registered — it passes vacuously, and that
 *     green is then used as the evidence to delete the closure.
 *
 * Rule 1 is enforced structurally rather than from a list: a set-module import
 * is a violation exactly when the imported value IS a registry definition.
 * Reprint rows (`CardPrint`: `printId` + `definitionId`, never registered
 * under their own id) are not definitions and stay importable — that is what
 * the 2ED/3ED/FEM/ICE/LEB reprint-wiring tests assert ABOUT, and a list would
 * have to grow a line for every future reprint.
 *
 * Lives under `scripts/` beside the repo's other hygiene guards, whose vitest
 * project allows Node builtins (`convex/`'s bundler does not).
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SETS_ROOT = path.join(REPO_ROOT, "convex", "cards", "sets");

/**
 * Files allowed to import a registry definition from its set module, with the
 * reason. A NEW entry is almost always the wrong call: resolve the card
 * through `getDefinition("<id>")` instead.
 */
const ALLOWLIST = new Map([
    [
        "convex/cards/sets/roe/__tests__/colorless.test.ts::rawEmrakulModuleExport",
        "the annihilator test asserts the DIFFERENCE between the raw module " +
            "export and what the seam serves (CR 702.86a, #2295) — reading " +
            "the unexpanded definition is the assertion",
    ],
]);

/** Every per-card test file, repo-relative, POSIX separators. */
function collectTestFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".test.ts") && p.includes("__tests__"))
                out.push(path.relative(REPO_ROOT, p).split(path.sep).join("/"));
        }
    };
    walk(SETS_ROOT);
    return out.sort();
}

const IMPORT_RE = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)";/g;

type Binding = { file: string; local: string; source: string; spec: string };

/** Value bindings a per-card test pulls from a set module (not a sibling
 *  `__tests__/helpers` module, which is test scaffolding, not a card). */
function setModuleBindings(file: string): Binding[] {
    const abs = path.join(REPO_ROOT, file);
    const src = fs.readFileSync(abs, "utf8");
    const out: Binding[] = [];
    for (const m of src.matchAll(IMPORT_RE)) {
        if (m[1]) continue; // `import type` — a type is never the subject
        const spec = m[3];
        if (!spec.startsWith(".")) continue;
        const target = path.resolve(path.dirname(abs), spec);
        if (!target.startsWith(SETS_ROOT + path.sep)) continue;
        if (target.split(path.sep).includes("__tests__")) continue;
        for (const raw of m[2].split(",")) {
            const t = raw.trim();
            if (!t) continue;
            const parts = t.split(/\s+as\s+/);
            out.push({
                file,
                source: parts[0].trim(),
                local: (parts[1] ?? parts[0]).trim(),
                spec: target,
            });
        }
    }
    return out;
}

const FILES = collectTestFiles();

describe("per-card tests resolve their subject through the registry seam", () => {
    it("finds the per-card test population", () => {
        expect(FILES.length).toBeGreaterThan(300);
    });

    it("imports no registry definition from a set module (ADR 0046)", async () => {
        const modules = new Map<string, Record<string, unknown>>();
        const violations: string[] = [];
        for (const file of FILES) {
            for (const b of setModuleBindings(file)) {
                if (!modules.has(b.spec)) {
                    modules.set(
                        b.spec,
                        (await import(b.spec)) as Record<string, unknown>
                    );
                }
                const value = modules.get(b.spec)![b.source] as
                    | { id?: unknown }
                    | undefined;
                const id = value && typeof value === "object" ? value.id : null;
                if (typeof id !== "string" || !tryGetDefinition(id)) continue;
                const key = `${file}::${b.local}`;
                if (ALLOWLIST.has(key)) continue;
                violations.push(
                    `${key} — a registry definition reached by module import; ` +
                        `use getDefinition("${id}")`
                );
            }
        }
        expect(violations).toEqual([]);
    });

    it("resolves no subject through the swap-blind name/catalogue readers", () => {
        const NAME_LOOKUP = /\b(?:try)?[gG]etCardByName\("[^"]*"\)/g;
        const CATALOGUE_PICK = /\bgetAllCards\(\)\s*\.\s*find\(/g;
        const violations: string[] = [];
        for (const file of FILES) {
            const src = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
            for (const m of src.matchAll(NAME_LOOKUP)) {
                violations.push(
                    `${file} — ${m[0]} resolves nameRegistry, which ` +
                        `preloadDefinitions never writes; use getDefinition(id)`
                );
            }
            for (const m of src.matchAll(CATALOGUE_PICK)) {
                violations.push(
                    `${file} — ${m[0]}…) reads the memoized expandedAllCards ` +
                        `snapshot; use getDefinition(id)`
                );
            }
        }
        expect(violations).toEqual([]);
    });
});
