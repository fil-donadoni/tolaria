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
 *   - every row of the compiled pool (`data/oracle-compiled-pool.json`)
 *     replaced by the same throwing Proxy;
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
const COMPILED_POOL = /data\/oracle-compiled-pool\.json$/;
const REAL = "?real";
const TOUCHED = "definition touched at load";

/** A Proxy every one of whose traps throws, naming `what`. */
const THROWING_STUB = `
const stub = (what) => new Proxy({}, new Proxy({}, {
    get: (_, trap) => () => {
        throw new Error(${JSON.stringify(TOUCHED)} + ": " + what + " (" + String(trap) + ")");
    },
}));
const isDefinition = (v) =>
    (typeof v === "object" && v !== null && "id" in v && "name" in v && "types" in v) ||
    (typeof v === "function" && v[Symbol.for("tolaria.cardFactory")] === true);
`;

/** Counts what the plugin substituted, so a test can refuse a vacuous load. */
const substituted = { definitionModules: 0, poolRows: 0 };

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
                    `export const ${name} = isDefinition(real.${name}) ? stub(${JSON.stringify(name)}) : real.${name};`
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
        build.onLoad({ filter: COMPILED_POOL }, (args) => {
            const rows = (
                JSON.parse(readFileSync(args.path, "utf8")) as unknown[]
            ).length;
            substituted.poolRows = rows;
            return {
                contents:
                    THROWING_STUB +
                    `export default Array.from({ length: ${rows} }, (_, i) => stub("compiled row " + i));`,
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
try {
    catalogue.getAllCards();
    console.log("STUBS-NOT-LIVE");
} catch (error) {
    const message = String(error?.message ?? error);
    console.log(message.includes(${JSON.stringify(TOUCHED)}) ? "LOADED" : "CONTROL-FAILED " + message);
}
`;

const dir = mkdtempSync(join(tmpdir(), "catalogue-load-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("loading the catalogue (issue #4856)", () => {
    it("touches no definition: it loads with every definition a throwing stub", async () => {
        const bundle = join(dir, "catalogue.mjs");
        await bundleModule(CATALOGUE, bundle, [untouchableDefinitions]);
        // Not vacuous: every hand-written colour module and every compiled
        // row was replaced.
        expect(substituted.definitionModules).toBeGreaterThan(300);
        expect(substituted.poolRows).toBeGreaterThan(1000);

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
