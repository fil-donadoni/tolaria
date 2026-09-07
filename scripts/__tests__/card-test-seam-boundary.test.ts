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
 *     (`catalogue.ts`) that `preloadDefinitions` never writes, and the
 *     `getAll*Cards()` family memoizes its expanded array on first call, which
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
 * have to grow a line for every future reprint. The structural read is
 * deliberately shallow — a top-level `.id` on the imported value — because no
 * set module today exports an array or object CONTAINING definitions; a module
 * that starts doing so needs this test taught about it, not an allowlist row.
 *
 * The scan covers every `.ts` under a set `__tests__` directory, not only
 * `*.test.ts`: `mh2/__tests__/urzasSagaFixtures.ts`, `bng/__tests__/courserBoard.ts`
 * and `war/__tests__/citadelBoard.ts` each build the board for the card their
 * sibling test file is ABOUT, so an import there dies on retirement exactly
 * like an import in the test file itself.
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
    [
        "convex/cards/sets/3ed/__tests__/colorless.test.ts::* as revised",
        "sweeps the set's own exports to assert every REPRINT row wires to a " +
            "definition — the namespace IS the subject, and it holds no " +
            "definitions of its own",
    ],
]);

/**
 * Files where the printed NAME is the key the assertion is about, not the way
 * a subject was obtained — a print-list sweep asking WHICH DEFINITIONS a set's
 * reprint rows map onto. There is no card under test in these, so nothing
 * here can survive its closure's retirement vacuously.
 */
const NAME_KEYED_SWEEPS = new Map([
    [
        "convex/cards/sets/3ed/__tests__/colorless.test.ts",
        "maps basic-land and ante NAMES to definition ids to partition the " +
            "288-print Revised list (ADR 0010); the names are the assertion",
    ],
]);

/** Every file under a set `__tests__` directory, repo-relative, POSIX seps. */
function collectScanFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string, inTests: boolean): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p, inTests || e.name === "__tests__");
            else if (inTests && e.name.endsWith(".ts"))
                out.push(path.relative(REPO_ROOT, p).split(path.sep).join("/"));
        }
    };
    walk(SETS_ROOT, false);
    return out.sort();
}

const NAMED_IMPORT_RE = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)";/g;
const NAMESPACE_IMPORT_RE = /import\s+\*\s+as\s+(\w+)\s+from\s+"([^"]+)";/g;

/** Does `spec`, resolved from `file`, name a set module (not sibling test
 *  scaffolding, which is not a card and dies with nothing)? */
function resolvesToSetModule(file: string, spec: string): string | null {
    if (!spec.startsWith(".")) return null;
    const target = path.resolve(path.dirname(path.join(REPO_ROOT, file)), spec);
    if (!target.startsWith(SETS_ROOT + path.sep)) return null;
    if (target.split(path.sep).includes("__tests__")) return null;
    return target;
}

type Binding = { file: string; local: string; source: string; target: string };

/** Value bindings a scanned file pulls from a set module. */
function setModuleBindings(file: string): Binding[] {
    const src = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
    const out: Binding[] = [];
    for (const m of src.matchAll(NAMED_IMPORT_RE)) {
        if (m[1]) continue; // `import type` — a type is never the subject
        const target = resolvesToSetModule(file, m[3]);
        if (!target) continue;
        for (const raw of m[2].split(",")) {
            const t = raw.trim();
            if (!t) continue;
            const parts = t.split(/\s+as\s+/);
            out.push({
                file,
                source: parts[0].trim(),
                local: (parts[1] ?? parts[0]).trim(),
                target,
            });
        }
    }
    return out;
}

const FILES = collectScanFiles();

describe("per-card tests resolve their subject through the registry seam", () => {
    it("finds the per-card test population", () => {
        expect(
            FILES.filter((f) => f.endsWith(".test.ts")).length
        ).toBeGreaterThan(300);
        expect(FILES.some((f) => !f.endsWith(".test.ts"))).toBe(true);
    });

    it("imports no registry definition from a set module (ADR 0046)", async () => {
        const modules = new Map<string, Record<string, unknown>>();
        const load = async (target: string) => {
            if (!modules.has(target))
                modules.set(
                    target,
                    (await import(target)) as Record<string, unknown>
                );
            return modules.get(target)!;
        };
        const violations: string[] = [];
        for (const file of FILES) {
            for (const b of setModuleBindings(file)) {
                const value = (await load(b.target))[b.source] as
                    | { id?: unknown }
                    | undefined;
                const id = value && typeof value === "object" ? value.id : null;
                if (typeof id !== "string" || !tryGetDefinition(id)) continue;
                if (ALLOWLIST.has(`${file}::${b.local}`)) continue;
                violations.push(
                    `${file}::${b.local} — a registry definition reached by ` +
                        `module import; use getDefinition("${id}")`
                );
            }
            // A namespace import hands over EVERY export, so it cannot be
            // classified binding by binding — it is a violation whenever the
            // module holds any definition at all.
            const src = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
            for (const m of src.matchAll(NAMESPACE_IMPORT_RE)) {
                const target = resolvesToSetModule(file, m[2]);
                if (!target) continue;
                if (ALLOWLIST.has(`${file}::* as ${m[1]}`)) continue;
                const holdsDefinition = Object.values(await load(target)).some(
                    (v) =>
                        !!v &&
                        typeof v === "object" &&
                        typeof (v as { id?: unknown }).id === "string" &&
                        !!tryGetDefinition((v as { id: string }).id)
                );
                if (holdsDefinition)
                    violations.push(
                        `${file}::* as ${m[1]} — a namespace import of a set ` +
                            `module holding registry definitions; use getDefinition(id)`
                    );
            }
        }
        expect(violations).toEqual([]);
    });

    it("resolves no subject through the swap-blind name/catalogue readers", () => {
        const NAME_READER = /\b(?:try)?[gG]etCardByName\(/g;
        // The ONE shape the name map may legitimately appear in: an assertion
        // ABOUT name registration (`seedScenario` resolves a preset's cards by
        // name), comparing identity or throwing. `.id` / `.name` are the two
        // identity fields; any other chain is a definition FIELD read, which is
        // the swap-blind subject lookup this rule exists to stop.
        const PARITY = new RegExp(
            String.raw`expect\(\s*(?:\(\)\s*=>\s*)?(?:try)?[gG]etCardByName\([^()]*\)!?(?:\s*\??\.\s*(?:id|name))?\s*\)`,
            "g"
        );
        // Every catalogue-population reader memoizes an expanded array that
        // `preloadDefinitions` never rewrites. Membership assertions on them
        // are fine — a pick that YIELDS a definition is not.
        const CATALOGUE_PICK =
            /\b(?:getAllCards|getAllCatalogueCards|getAllRawCards)\(\)\s*\.\s*find\(/g;
        const violations: string[] = [];
        for (const file of FILES) {
            const src = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
            const exempt = [...src.matchAll(PARITY)].map((m) => [
                m.index,
                m.index + m[0].length,
            ]);
            if (NAME_KEYED_SWEEPS.has(file)) continue;
            for (const m of src.matchAll(NAME_READER)) {
                if (exempt.some(([a, b]) => m.index >= a && m.index < b))
                    continue;
                const line = src.slice(0, m.index).split("\n").length;
                violations.push(
                    `${file}:${line} — ${m[0]}…) resolves nameRegistry, which ` +
                        `preloadDefinitions never writes; use getDefinition(id)`
                );
            }
            for (const m of src.matchAll(CATALOGUE_PICK)) {
                const line = src.slice(0, m.index).split("\n").length;
                violations.push(
                    `${file}:${line} — ${m[0]}…) reads a memoized catalogue ` +
                        `snapshot; use getDefinition(id)`
                );
            }
        }
        expect(violations).toEqual([]);
    });
});
