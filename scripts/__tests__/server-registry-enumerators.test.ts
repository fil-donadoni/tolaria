import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createImportGraph } from "../lib/import-graph";

/**
 * The closed list of server modules that may enumerate the whole card registry
 * (issue #4166, PRD #4161, ADR 0113 Amendment IV).
 *
 * With the packed corpus a module that walks every definition inflates ~16 MB
 * inside one request. So every server-side enumerator gets exactly one
 * disposition, and this pins the inventory by static scan: a new module that
 * names an enumerator is refused until it is placed here, and a `script-only`
 * module may not sit in the import closure of any function module.
 *
 * - `definer`: the module that DEFINES the enumerator. The hand-written
 *   walks are fed by the Definition Index (`getAllCards` maps its entries
 *   through the registry; no compiled row is touched), the compiled one
 *   (`getAllCatalogueCards`) has no server request-path caller.
 * - `hand-written-only`: reached from a request, but over the hand-written
 *   population, which is bundled as literals and never lives in a packed
 *   block — behaviour unchanged.
 * - `client-only`: the derivation runs in the browser over the hydrated
 *   corpus; no function module imports it.
 * - `script-only`: scripts, the blade and tests; kept off every request path
 *   by the closure check below.
 */
const REPO_ROOT = resolve(__dirname, "../..");

/** Identifiers that walk a whole population of definitions. The name
 *  enumerators (`getAllCardNames`, `getChooseableCardNames`) are not here:
 *  they read the Definition Index and build no definition. */
const ENUMERATORS = [
    "getAllCards",
    "getAllCatalogueCards",
    "getAllRawCards",
    "walkHandWrittenDefinitions",
    "registeredDefinitions",
    "buildSearchIndex",
    "listTokenCatalogue",
    "getAllTokenKeys",
    "findTokenSpec",
] as const;

type Disposition =
    | "definer"
    | "hand-written-only"
    | "client-only"
    | "script-only";

const CLOSED_LIST: Record<string, { disposition: Disposition; why: string }> = {
    "convex/cards/catalogue.ts": {
        disposition: "definer",
        why: "defines the catalogue walks; getAllCards is fed by the hand-written index, getAllCatalogueCards has no request-path caller",
    },
    "convex/cards/registry.ts": {
        disposition: "definer",
        why: "defines registeredDefinitions over the live map; its only consumers are script-only",
    },
    "convex/cards/tokenCatalogue.ts": {
        disposition: "hand-written-only",
        why: "the token walk reads getAllCards(): hand-written cards, never a packed block",
    },
    "convex/gre/scenarioBuilder.ts": {
        disposition: "hand-written-only",
        why: "token key lookups through the hand-written token catalogue",
    },
    "convex/debugScenarios.ts": {
        disposition: "hand-written-only",
        why: "findTokenSpec over the hand-written token catalogue; card names come from getAllCardNames (the index)",
    },
    "convex/verdicts.ts": {
        disposition: "hand-written-only",
        why: "findTokenSpec over the hand-written token catalogue",
    },
    "convex/gre/ai/blade/setup.ts": {
        disposition: "hand-written-only",
        why: "blade position setup stages tokens through the hand-written token catalogue",
    },
    "convex/cards/searchIndex.ts": {
        disposition: "client-only",
        why: "the deck-builder search index is derived in the browser (src/lib/searchIndex.ts)",
    },
    "convex/gre/ai/botReachSubtypeSweep.ts": {
        disposition: "script-only",
        why: "bot-reach sweep position (oracle:compile, target-bot-reach)",
    },
    "convex/gre/ai/botReachTarget.ts": {
        disposition: "script-only",
        why: "bot-reach sweep position (oracle:compile, target-bot-reach)",
    },
    "convex/oracle/behavioural.ts": {
        disposition: "script-only",
        why: "behavioural twin swap (vitest setup, oracle-behavioural)",
    },
};

const SOURCE_EXCLUDED =
    /(__tests__|_generated|node_modules|\.test\.|\.fixture\.|\.helper\.)/;

function convexSources(dir = "convex"): string[] {
    const out: string[] = [];
    for (const name of readdirSync(join(REPO_ROOT, dir))) {
        const path = `${dir}/${name}`;
        if (SOURCE_EXCLUDED.test(path)) continue;
        if (statSync(join(REPO_ROOT, path)).isDirectory()) {
            out.push(...convexSources(path));
        } else if (path.endsWith(".ts")) {
            out.push(path);
        }
    }
    return out;
}

const stripComments = (source: string): string =>
    source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const read = (path: string): string =>
    readFileSync(join(REPO_ROOT, path), "utf8");

/** Modules that register a Convex function: what a request can execute. */
const REGISTERS_FUNCTION =
    /\b(internalQuery|internalMutation|internalAction|query|mutation|action|httpAction)\(\s*\{/;

describe("server-side whole-registry enumerators (issue #4166)", () => {
    const sources = convexSources();

    it("only the modules on the closed list name an enumerator", () => {
        const pattern = new RegExp(`\\b(${ENUMERATORS.join("|")})\\b`);
        const naming = sources
            .filter((path) => pattern.test(stripComments(read(path))))
            .sort();
        expect(naming).toEqual(Object.keys(CLOSED_LIST).sort());
    });

    it("no function module reaches a script-only enumerator", () => {
        const graph = createImportGraph({ root: REPO_ROOT, aliases: [] });
        const scriptOnly = Object.entries(CLOSED_LIST)
            .filter(([, v]) => v.disposition === "script-only")
            .map(([path]) => path);
        const reached: string[] = [];
        for (const entry of sources.filter((p) =>
            REGISTERS_FUNCTION.test(stripComments(read(p)))
        )) {
            const closure = graph.closureOf(entry);
            for (const path of scriptOnly) {
                if (closure.has(path)) reached.push(`${entry} -> ${path}`);
            }
        }
        expect(reached).toEqual([]);
    });
});
