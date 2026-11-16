/**
 * Issue #4856 (PRD #4849, ADR 0113 Amendment IV) — loading the catalogue
 * touches NO Card Definition. Every index it builds at load comes from the
 * Definition Index (`../definitionIndex`); a definition is reached only when
 * someone asks for it.
 *
 * The proof is a load with every definition made untouchable: the catalogue is
 * bundled by esbuild with
 *
 *   - every hand-written definition export (`sets/<code>/<colour>.cards.ts`),
 *     eager object or `defineCard` factory (issue #4857), replaced by a Proxy
 *     whose every trap throws — the module is still
 *     evaluated, its non-definition exports pass through, but reading so much
 *     as `"id" in def` names the definition and fails;
 *   - the rows of the packed compiled corpus
 *     (`data/catalogue/packed-corpus.json`, the server's only rendering since
 *     issue #4168) — its block string and dictionary — replaced by getters
 *     that throw the same error, its Definition Index left real;
 *
 * and imported in a fresh Node. It must load. Then, as the positive control,
 * asking for the hand-written population must throw the stub's error — so a
 * green load means the stubs were live and nothing read them, never that the
 * substitution silently missed. The tree is never edited (the research file's
 * method, `docs/research/convex-server-scale-2026-09-29.md` § Method).
 */
import type esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { bundleModule } from "../../../scripts/lib/convex-heap";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const CATALOGUE = join(REPO_ROOT, "convex/cards/catalogue.ts");
const SET_CARD_MODULE = /convex\/cards\/sets\/[^/]+\/[^/]+\.cards\.ts$/;
const PACKED_CORPUS = /data\/catalogue\/packed-corpus\.json$/;
const REAL = "?real";
const TOUCHED = "definition touched at load";
/** A card declared with `defineCard` (issue #4857). */
const FACTORY_CARD = "Aura Blast";
/** A compiled card: its definition is a packed row. */
const COMPILED_CARD = (
    JSON.parse(
        readFileSync(
            join(REPO_ROOT, "data/catalogue/packed-corpus.json"),
            "utf8"
        )
    ) as { names: string[] }
).names[0]!;

/** A Proxy every one of whose traps throws, naming `what`. */
const THROWING_STUB = `
const stub = (what, target = {}) => new Proxy(target, new Proxy({}, {
    get: (_, trap) => () => {
        throw new Error(${JSON.stringify(TOUCHED)} + ": " + what + " (" + String(trap) + ")");
    },
}));
const isDefinition = (v) =>
    typeof v === "object" && v !== null && "id" in v && "name" in v && "types" in v;
// A \`defineCard\` factory (issue #4857) is stubbed as a FUNCTION, so calling it
// — building the definition — throws like any other touch.
const isFactory = (v) =>
    typeof v === "function" && v[Symbol.for("tolaria.cardFactory")] === true;
const untouchable = (what, v) =>
    isFactory(v) ? stub(what, function () {}) : isDefinition(v) ? stub(what) : v;
`;

/** Counts what the plugin substituted, so a test can refuse a vacuous load. */
const substituted = { definitionModules: 0, packedRows: 0 };

const untouchableDefinitions: esbuild.Plugin = {
    name: "untouchable-definitions",
    setup(build) {
        // The real module, reached by the stub through a `?real` suffix.
        build.onResolve({ filter: /\?real$/ }, (args) => ({
            path: args.path.slice(0, -REAL.length),
            namespace: "real",
        }));
        build.onLoad({ filter: /.*/, namespace: "real" }, (args) => ({
            contents: readFileSync(args.path, "utf8"),
            loader: "ts",
            resolveDir: dirname(args.path),
        }));
        build.onLoad({ filter: SET_CARD_MODULE }, (args) => {
            const source = readFileSync(args.path, "utf8");
            const consts = [...source.matchAll(/^export const (\w+)/gm)];
            const functions = [...source.matchAll(/^export function (\w+)/gm)];
            // A barrel (`index.cards.ts`) only re-exports: its colour modules
            // are substituted on their own.
            if (consts.length === 0 && functions.length === 0) return undefined;
            substituted.definitionModules++;
            const real = JSON.stringify(args.path + REAL);
            const lines = [`import * as real from ${real};`, THROWING_STUB];
            for (const [, name] of consts) {
                lines.push(
                    `export const ${name} = untouchable(${JSON.stringify(name)}, real.${name});`
                );
            }
            for (const [, name] of functions) {
                lines.push(`export { ${name} } from ${real};`);
            }
            return {
                contents: lines.join("\n"),
                loader: "js",
                resolveDir: dirname(args.path),
            };
        });
        build.onLoad({ filter: PACKED_CORPUS }, (args) => {
            // Every compiled row lives in `blocks`, inflated against
            // `dictionary`: reading either is reading a row.
            const corpus = JSON.parse(readFileSync(args.path, "utf8")) as {
                rowCount: number;
                blocks?: string;
                dictionary?: string;
            };
            substituted.packedRows = corpus.rowCount;
            delete corpus.blocks;
            delete corpus.dictionary;
            const touched = (what: string) =>
                `get ${what}() { throw new Error(${JSON.stringify(TOUCHED)} + ": packed ${what}"); }`;
            return {
                contents:
                    `export default { ...${JSON.stringify(corpus)}, ` +
                    `${touched("blocks")}, ${touched("dictionary")} };`,
                loader: "js",
            };
        });
    },
};

/** The child: import the bundle, then the positive control. One line out. */
const PROBE = `
const file = process.argv[2];
let catalogue;
try {
    catalogue = await import(file);
} catch (error) {
    console.log("LOAD-FAILED " + String(error?.stack ?? error).split("\\n").slice(0, 6).join(" | "));
    process.exit(0);
}
// Three controls: the hand-written population, one \`defineCard\` factory
// card by name (issue #4857) — a factory the stub failed to recognise would
// build its real definition here instead of throwing — and one compiled card
// by name, whose packed row must be unreadable.
const control = (what, ask) => {
    try {
        ask();
        return "STUBS-NOT-LIVE " + what;
    } catch (error) {
        const message = String(error?.message ?? error);
        return message.includes(${JSON.stringify(TOUCHED)}) ? null : "CONTROL-FAILED " + what + ": " + message;
    }
};
console.log(
    control("population", () => catalogue.getAllCards()) ??
        control("factory", () => catalogue.getCardByName(${JSON.stringify(FACTORY_CARD)})) ??
        control("compiled", () => catalogue.getCardByName(${JSON.stringify(COMPILED_CARD)})) ??
        "LOADED"
);
`;

const dir = mkdtempSync(join(tmpdir(), "catalogue-load-"));
afterAll(() =>
    rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    })
);

describe("loading the catalogue (issue #4856)", () => {
    it("touches no definition: it loads with every definition a throwing stub", async () => {
        const bundle = join(dir, "catalogue.mjs");
        await bundleModule(CATALOGUE, bundle, [untouchableDefinitions]);
        // Not vacuous: every hand-written colour module and every compiled
        // row was replaced.
        expect(substituted.definitionModules).toBeGreaterThan(300);
        expect(substituted.packedRows).toBeGreaterThan(1000);

        const probe = join(dir, "probe.mjs");
        writeFileSync(probe, PROBE);
        const run = spawnSync("node", [probe, bundle], {
            encoding: "utf8",
            timeout: 120_000,
        });
        expect(run.status, run.stderr.slice(0, 2000)).toBe(0);
        expect(run.stdout.trim()).toBe("LOADED");
    }, 180_000);
});
