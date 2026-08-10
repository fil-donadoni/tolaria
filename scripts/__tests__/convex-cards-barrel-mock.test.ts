import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * `vi.mock("@convex/cards", …)` completeness guard.
 *
 * The failure it exists for (#2339). ~40 frontend suites replace the whole
 * `@convex/cards` barrel with a hand-rolled factory. Nothing checked those
 * factories against the names the modules under test actually reach through the
 * barrel. So #2339 — which moved three `convex/cards/**` modules from
 * re-deriving a mana cost inline to importing `getInstanceManaCost` from the
 * barrel, a behaviour-identical refactor touching no `src/` file — turned 102
 * tests across 12 files red with
 * `No "getInstanceManaCost" export is defined on the "@convex/cards" mock`.
 * Two `opus` reviews and the branch's own gate passed it; the merge-train's full
 * suite was the first thing to see it.
 *
 * Why no other gate catches it: a `vi.mock` factory is an untyped object
 * literal, so `check:ts` is green on a factory missing every export; and the red
 * files are `src/**` suites that mention nothing the diff touched, so no "run
 * the suites of the modules you modified" rule reaches them.
 *
 * The invariant, per suite. Mocking the barrel does not mock what lies BEHIND
 * it: a `convex/cards/**` module that the suite's own import graph reaches
 * still runs its real code, and its `import { x } from "."` now resolves to the
 * factory. So the factory must define every name imported from the barrel by
 * the cards modules that suite can reach — computed here by walking the real
 * import graph from the test file with the barrel edge CUT, which is exactly
 * what the mock does at runtime.
 *
 * Both sides are derived from source, never hand-listed: the requirement grows
 * by itself the next time a name becomes barrel-internal, which is the one
 * shape #2339 took.
 *
 * Static reads only — no rendering, no jsdom — so it lives in the node project
 * and runs inside `check:pr`. That is the point: this class is invisible to the
 * light gate's own test selection, and must not wait for the merge-train.
 */

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const CARDS_DIR = path.join(ROOT, "convex", "cards");
const BARREL = path.join(CARDS_DIR, "index.ts");

function walk(dir: string, keep: (f: string) => boolean, out: string[] = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, keep, out);
        else if (keep(full)) out.push(full);
    }
    return out;
}

const readCache = new Map<string, string>();
function read(file: string): string {
    let src = readCache.get(file);
    if (src === undefined) {
        src = fs.readFileSync(file, "utf8");
        readCache.set(file, src);
    }
    return src;
}

/** Mirrors the `~` / `@` / `@convex` aliases in vitest.config.ts. */
function resolveSpecifier(from: string, spec: string): string | null {
    let base: string | null = null;
    if (spec.startsWith("~/") || spec.startsWith("@/")) {
        base = path.join(SRC, spec.slice(2));
    } else if (spec.startsWith("@convex/")) {
        base = path.join(ROOT, "convex", spec.slice("@convex/".length));
    } else if (spec === "@convex/cards") {
        base = CARDS_DIR;
    } else if (spec.startsWith(".")) {
        base = path.resolve(path.dirname(from), spec);
    }
    if (!base) return null;
    for (const cand of [
        `${base}.ts`,
        `${base}.tsx`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
        base,
    ]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    }
    return null;
}

const importCache = new Map<string, string[]>();
function importedFiles(file: string): string[] {
    let out = importCache.get(file);
    if (out) return out;
    const src = read(file);
    const specs = [
        ...[...src.matchAll(/from\s*"([^"]+)"/g)].map((m) => m[1]),
        ...[...src.matchAll(/import\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]),
    ];
    out = specs
        .map((s) => resolveSpecifier(file, s))
        .filter((f): f is string => f !== null);
    importCache.set(file, out);
    return out;
}

/** Named imports of `file` that resolve to the cards barrel. */
function barrelImportsOf(file: string): string[] {
    const names: string[] = [];
    for (const m of read(file).matchAll(
        /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"([^"]+)"/g
    )) {
        if (resolveSpecifier(file, m[2]) !== BARREL) continue;
        for (const raw of m[1].split(",")) {
            const name = raw
                .trim()
                .split(/\s+as\s+/)[0]
                .trim()
                .replace(/^type\s+/, "");
            if (name) names.push(name);
        }
    }
    return names;
}

/** Every module the suite replaces — `vi.mock("<spec>")` — resolved to a path. */
function mockedModules(entry: string): Set<string> {
    const out = new Set<string>();
    for (const m of read(entry).matchAll(/vi\.mock\(\s*"([^"]+)"/g)) {
        const file = resolveSpecifier(entry, m[1]);
        if (file) out.add(file);
    }
    return out;
}

/**
 * Barrel names the mock must provide for `entry` — the union of barrel imports
 * made by every `convex/cards/**` module reachable from it, with the barrel and
 * every OTHER module the suite mocks cut out of the graph. A mocked module never
 * runs, so its own barrel imports are not the factory's problem; `useControllerActions`
 * suites mock `@convex/cards/attackRestrictions` for exactly that reason.
 */
function requiredNamesFor(entry: string): string[] {
    const cut = mockedModules(entry);
    cut.add(BARREL);
    const seen = new Set<string>([entry]);
    const queue = [entry];
    const names = new Set<string>();
    while (queue.length) {
        const file = queue.pop()!;
        if (file.startsWith(CARDS_DIR) && !file.includes("__tests__")) {
            for (const n of barrelImportsOf(file)) names.add(n);
        }
        for (const next of importedFiles(file)) {
            if (cut.has(next) || seen.has(next)) continue;
            seen.add(next);
            queue.push(next);
        }
    }
    return [...names].sort();
}

/**
 * Index of the `{` opening the object literal the factory yields. Both forms
 * are in use: `() => ({ … })` and `() => { … return { … } }` (the latter when
 * the factory needs local consts — a `vi.mock` factory cannot close over
 * module-scope bindings at hoist time).
 */
function objectLiteralStart(source: string, from: number): number | null {
    const arrow = source.indexOf("=>", from);
    if (arrow === -1) return null;
    let i = arrow + 2;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] === "(") {
        const brace = source.indexOf("{", i);
        return brace === -1 ? null : brace;
    }
    if (source[i] === "{") {
        const ret = source.indexOf("return", i);
        if (ret === -1) return null;
        const brace = source.indexOf("{", ret);
        return brace === -1 ? null : brace;
    }
    return null;
}

/**
 * Top-level keys of the object literal a `vi.mock("@convex/cards", …)` factory
 * returns. A brace-depth scan, not a line regex: these factories nest
 * definition maps several levels deep and a nested `name:` must not count.
 */
function factoryKeys(source: string, from: number): Set<string> | null {
    const open = objectLiteralStart(source, from);
    if (open === null) return null;
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        if (ch === "{" || ch === "(" || ch === "[") depth++;
        else if (ch === "}" || ch === ")" || ch === "]") {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    if (end === -1) return null;

    // Comments first: several factories explain a key on the line above it, and
    // a chunk starting with `//` would hide the key that follows.
    const body = source
        .slice(open + 1, end)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const keys = new Set<string>();
    depth = 0;
    let start = 0;
    for (let i = 0; i <= body.length; i++) {
        const ch = body[i];
        if (ch === "{" || ch === "(" || ch === "[") depth++;
        else if (ch === "}" || ch === ")" || ch === "]") depth--;
        if (i === body.length || (ch === "," && depth === 0)) {
            const chunk = body.slice(start, i).trim();
            if (chunk.startsWith("...")) keys.add("...");
            const key = chunk.match(/^(?:"([\w$]+)"|([\w$]+))\s*[:(,]?/);
            if (key) keys.add(key[1] ?? key[2]);
            start = i + 1;
        }
    }
    return keys;
}

const MOCKERS = walk(SRC, (f) => /\.test\.tsx?$/.test(f))
    .filter((f) => !f.endsWith(".bot.test.ts"))
    .filter((f) => read(f).includes('vi.mock("@convex/cards"'));

describe('vi.mock("@convex/cards") factories are complete (#2339)', () => {
    it("finds the suites that mock the barrel (sanity — the collector is not silently empty)", () => {
        expect(MOCKERS.length).toBeGreaterThan(10);
    });

    it("resolves the barrel through the aliases (sanity — a broken resolver would require nothing)", () => {
        expect(resolveSpecifier(path.join(SRC, "x.ts"), "@convex/cards")).toBe(
            BARREL
        );
        expect(
            requiredNamesFor(path.join(CARDS_DIR, "castRestrictions.ts"))
        ).toContain("getInstanceManaCost");
    });

    it.each(MOCKERS.map((f) => path.relative(ROOT, f)))(
        "%s defines every barrel name its own import graph reaches",
        (rel) => {
            const file = path.join(ROOT, rel);
            const source = read(file);
            const keys = factoryKeys(
                source,
                source.indexOf('vi.mock("@convex/cards"')
            );
            expect(keys, `could not parse the factory in ${rel}`).toBeTruthy();
            if (keys!.has("...")) return; // spread — composed elsewhere, not enumerable here
            const missing = requiredNamesFor(file).filter((n) => !keys!.has(n));
            expect(
                missing,
                `${rel} mocks "@convex/cards" without ${missing.join(", ")}. ` +
                    `A convex/cards module this suite's import graph reaches imports ` +
                    `${missing.join(", ")} from the barrel, and with the barrel mocked the factory ` +
                    `is the only place it can come from — the suite dies with ` +
                    `'No <name> export is defined on the "@convex/cards" mock' as soon as that code ` +
                    `path runs (#2339: 102 tests across 12 files, first seen at the merge-train). ` +
                    `Add the key, resolving it through src/lib/testing/convex-cards-mock.ts.`
            ).toEqual([]);
        }
    );
});
