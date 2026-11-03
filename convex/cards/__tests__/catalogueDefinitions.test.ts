// Issue #7873 — a catalogue census measures the catalogue, whatever ran
// before it in the worker.
//
// The node projects run `isolate: false`: the resident registry map is shared
// by every file a worker runs, and a file that registers synthetic definitions
// (`interpreter.test.ts`'s `test-op-*` cards) leaves them there.
// `registeredDefinitions()` yields the catalogue AND every resident entry, so a
// census over it went red or green by scheduling. `catalogueDefinitions()` is
// the census population; this file pins both halves of that contract.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CardDefinition } from "../types";
import {
    catalogueDefinitions,
    registeredDefinitions,
    withTemporaryDefinition,
} from "../registry";
import "../catalogue";

const SYNTHETIC: CardDefinition = {
    id: "test-catalogue-census-leak",
    name: "Catalogue Census Leak",
    manaCost: { generic: 1 },
    types: ["Sorcery"],
    effects: [],
} as unknown as CardDefinition;

describe("catalogueDefinitions — the census population (issue #7873)", () => {
    it("never yields a definition that is merely resident in the registry", () => {
        withTemporaryDefinition(SYNTHETIC, () => {
            const catalogue = new Set(
                [...catalogueDefinitions()].map((d) => d.id)
            );
            const registered = new Set(
                [...registeredDefinitions()].map((d) => d.id)
            );
            // Premise: the synthetic card IS resident — the registry-wide
            // walk sees it, so the census walk's silence is a choice.
            expect(registered.has(SYNTHETIC.id)).toBe(true);
            expect(catalogue.has(SYNTHETIC.id)).toBe(false);
            // Premise: the catalogue loaded (a vacuous census passes).
            expect(catalogue.size).toBeGreaterThan(1000);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, "../../..");

/** Test files that read `registeredDefinitions()` ON PURPOSE: they test the
 *  registry seam itself, or need the population WIDER than the catalogue
 *  (sentinel, runtime tokens, twins). Every other test enumerating the
 *  catalogue reads `catalogueDefinitions()`. */
const REGISTRY_SEAM_TESTS = new Set([
    "convex/cards/__tests__/catalogueDefinitions.test.ts",
    "convex/cards/__tests__/definitionIndexEquivalence.test.ts",
    "convex/cards/__tests__/packedCorpusLookup.test.ts",
    "convex/cards/__tests__/registrySeam.test.ts",
    "convex/cards/__tests__/searchIndex.test.ts",
    "scripts/__tests__/server-registry-enumerators.test.ts",
    "src/lib/__tests__/images.test.ts",
]);

const SKIPPED_DIRS = new Set(["node_modules", "_generated"]);

function testFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(join(REPO_ROOT, dir))) {
        if (SKIPPED_DIRS.has(name)) continue;
        const path = `${dir}/${name}`;
        if (statSync(join(REPO_ROOT, path)).isDirectory()) {
            out.push(...testFiles(path));
        } else if (/\.test\.tsx?$/.test(name)) {
            out.push(path);
        }
    }
    return out;
}

describe("no census test enumerates the resident registry (issue #7873)", () => {
    it("only registry-seam tests name registeredDefinitions", () => {
        const naming = ["convex", "src", "scripts"]
            .flatMap((dir) => testFiles(dir))
            .filter((path) =>
                /\bregisteredDefinitions\b/.test(
                    readFileSync(join(REPO_ROOT, path), "utf8")
                )
            )
            .filter((path) => !REGISTRY_SEAM_TESTS.has(path))
            .sort();
        expect(naming).toEqual([]);
    });
});
