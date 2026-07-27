import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Client-bundle purity guard.
 *
 * ADR 0074 lets the frontend import PURE engine modules out of `convex/`
 * (the vs-AI Brain and the Draft Lab both do). What it may never do is pull
 * a SERVER module into the browser bundle: `convex/auth.ts` calls
 * `convexAuth({...})` at module scope, and `@convex-dev/auth/server` reads
 * `process.env` while materializing provider defaults. In a Vite dev bundle
 * `process` does not exist, so the whole app dies on cold load with
 *
 *     Uncaught ReferenceError: process is not defined
 *         at materializeAndDefaultProviders (server-*.js)
 *         at convexAuth (server-*.js)
 *         at auth.ts:26
 *
 * The trap is that ONE value import is enough. A `convex/limited/*.ts` module
 * that holds both a pure read-path helper and a `query`/`mutation` shell is
 * fine server-side, but the moment a client file imports the pure half by
 * VALUE, Vite loads the whole module — and with it `../auth`. Nothing in the
 * gate catches this: `tsc` is happy, unit tests run in node where `process`
 * exists, and `vite build` emits the broken bundle without complaint. Only
 * loading the app in a browser reveals it.
 *
 * So this guard walks the real value-import graph from every client entry and
 * fails if it reaches a server-only module. Type-only imports are followed but
 * not counted — they are erased before the bundle exists.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Everything under `src/` is client code; tests are excluded because they run
 *  in node, where importing a server module is legal (and `convex-test`
 *  deliberately does it). */
const CLIENT_ROOT = path.join(REPO_ROOT, "src");

/** Repo-relative, extensionless modules that must never enter the browser
 *  bundle. `convex/auth` is the one that crashes today; `_generated/server`
 *  is listed because reaching it means a Convex function shell (and hence,
 *  sooner or later, `auth`) has been dragged client-side. */
const SERVER_ONLY_MODULES = ["convex/auth", "convex/_generated/server"];

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

function isTestPath(filePath: string): boolean {
    return (
        filePath.includes(`${path.sep}__tests__${path.sep}`) ||
        /\.test\.(ts|tsx)$/.test(filePath)
    );
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
            out.push(full);
        }
    }
    return out;
}

/** One import/export-from specifier, plus whether it survives compilation. */
interface ImportRef {
    specifier: string;
    /** `false` for `import type ...` and for a named clause whose every
     *  binding carries an inline `type` modifier — those vanish at build time
     *  and so cannot drag a module into the bundle. */
    isValue: boolean;
}

const IMPORT_RE =
    /(?:^|\n)\s*(?:import|export)(?<clause>[\s\S]*?)from\s*["'](?<specifier>[^"']+)["']/g;
/** Bare side-effect import — `import "./styles.css"` — always a value import. */
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*["'](?<specifier>[^"']+)["']/g;

function parseImports(source: string): ImportRef[] {
    const refs: ImportRef[] = [];

    for (const match of source.matchAll(IMPORT_RE)) {
        const clause = match.groups!.clause;
        refs.push({
            specifier: match.groups!.specifier,
            isValue: clauseIsValue(clause),
        });
    }
    for (const match of source.matchAll(BARE_IMPORT_RE)) {
        refs.push({ specifier: match.groups!.specifier, isValue: true });
    }
    return refs;
}

function clauseIsValue(clause: string): boolean {
    const trimmed = clause.trim();
    // `import type { X } from` / `import type X from` — fully erased.
    if (/^type\b/.test(trimmed)) return false;

    const named = trimmed.match(/\{([\s\S]*)\}/);
    // A default or namespace binding (`import x from`, `import * as x from`)
    // outside the braces is always a value binding.
    const outsideBraces = named
        ? trimmed.replace(named[0], "").replace(/,/g, "").trim()
        : trimmed;
    if (outsideBraces.length > 0) return true;
    if (!named) return true;

    const bindings = named[1]
        .split(",")
        .map((binding) => binding.trim())
        .filter((binding) => binding.length > 0);
    if (bindings.length === 0) return false;
    // `{ type A, type B }` is erased; `{ type A, B }` is not.
    return bindings.some((binding) => !/^type\s/.test(binding));
}

const ALIASES: Record<string, string> = {
    "@convex/": path.join(REPO_ROOT, "convex") + path.sep,
    "@/": path.join(REPO_ROOT, "src") + path.sep,
    "~/": path.join(REPO_ROOT, "src") + path.sep,
};

/** Resolves a specifier to an on-disk file, or `null` for anything outside the
 *  repo (node_modules, `convex/values`, `react`, …). */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
    let base: string | null = null;

    for (const [alias, target] of Object.entries(ALIASES)) {
        if (specifier.startsWith(alias)) {
            base = target + specifier.slice(alias.length);
            break;
        }
    }
    if (base === null && specifier.startsWith(".")) {
        base = path.resolve(path.dirname(fromFile), specifier);
    }
    if (base === null) return null;

    // Convex's own module refs carry a `.js` extension that maps to `.ts`.
    const withoutJs = base.replace(/\.js$/, "");
    for (const candidate of [
        base,
        ...SOURCE_EXTENSIONS.map((ext) => withoutJs + ext),
        ...SOURCE_EXTENSIONS.map((ext) => path.join(withoutJs, "index" + ext)),
    ]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return null;
}

function toModuleKey(filePath: string): string {
    return path
        .relative(REPO_ROOT, filePath)
        .replace(/\.(ts|tsx|js|jsx)$/, "")
        .split(path.sep)
        .join("/");
}

/** The VALUE-import graph reachable from `entries`, as `file -> imported
 *  files`. Built once (a per-entry walk would re-traverse the shared React/
 *  engine subgraph hundreds of times). */
function buildValueImportGraph(entries: string[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    const queue = [...entries];

    while (queue.length > 0) {
        const file = queue.pop()!;
        if (graph.has(file)) continue;

        const targets: string[] = [];
        for (const ref of parseImports(fs.readFileSync(file, "utf8"))) {
            if (!ref.isValue) continue;
            const resolved = resolveSpecifier(ref.specifier, file);
            if (resolved === null) continue;
            targets.push(resolved);
            queue.push(resolved);
        }
        graph.set(file, targets);
    }
    return graph;
}

/** Every module that reaches a server-only module by value imports, mapped to
 *  the next hop on a shortest path there — walked BACKWARDS from the
 *  server-only modules, so one pass covers every entry. */
function buildOffenderChains(
    graph: Map<string, string[]>
): Map<string, string> {
    const reverse = new Map<string, string[]>();
    for (const [file, targets] of graph) {
        for (const target of targets) {
            const callers = reverse.get(target);
            if (callers) callers.push(file);
            else reverse.set(target, [file]);
        }
    }

    /** file -> the import it should follow to reach a server-only module. */
    const nextHop = new Map<string, string>();
    const queue: string[] = [];
    for (const file of graph.keys()) {
        if (SERVER_ONLY_MODULES.includes(toModuleKey(file))) queue.push(file);
    }
    for (const target of reverse.keys()) {
        if (SERVER_ONLY_MODULES.includes(toModuleKey(target)))
            queue.push(target);
    }

    while (queue.length > 0) {
        const file = queue.shift()!;
        for (const caller of reverse.get(file) ?? []) {
            if (nextHop.has(caller)) continue;
            nextHop.set(caller, file);
            queue.push(caller);
        }
    }
    return nextHop;
}

function formatChain(entry: string, nextHop: Map<string, string>): string {
    const chain = [toModuleKey(entry)];
    let file = entry;
    while (nextHop.has(file)) {
        file = nextHop.get(file)!;
        chain.push(toModuleKey(file));
    }
    return chain.join(" → ");
}

describe("client bundle purity (ADR 0074)", () => {
    it("no client module reaches a server-only module by value import", () => {
        const entries = walk(CLIENT_ROOT).filter(
            (file) => !isTestPath(file) && /\.(ts|tsx)$/.test(file)
        );
        expect(entries.length).toBeGreaterThan(0);

        const graph = buildValueImportGraph(entries);
        const nextHop = buildOffenderChains(graph);
        const violations = entries
            .filter((entry) => nextHop.has(entry))
            .map((entry) => formatChain(entry, nextHop));

        expect(
            violations,
            `Client code value-imports a server-only module. Every chain below ` +
                `puts \`convex/auth\` (or a Convex function shell) into the browser ` +
                `bundle, which crashes the app on load with "process is not ` +
                `defined". Split the pure half of the offending module into a ` +
                `sibling *Core module with no \`_generated/server\` or \`../auth\` ` +
                `import, and point the client at that.\n\n` +
                violations.join("\n")
        ).toEqual([]);
    });
});
