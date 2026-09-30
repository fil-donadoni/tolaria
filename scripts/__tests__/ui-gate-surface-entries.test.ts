// Every `check:ui` surface declares the route module(s) it measures, and each
// is a real route module (issue #3627). Without this, renaming a route leaves a
// surface pointing at nothing: its closure is empty, no diff ever selects it,
// and it drops out of every scoped run with no red anywhere.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createImportGraph } from "../lib/import-graph";
import { isRouteModulePath, ROUTER_MODULE } from "../lib/ui-scope";
import { SURFACES } from "../ui-gate/surfaces";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const graph = createImportGraph({ root: REPO_ROOT });

describe("check:ui surface table — route entries", () => {
    const routed = new Set(graph.importsOf(ROUTER_MODULE));

    it.each(SURFACES.map((s) => [s.id, s.entries] as const))(
        "%s declares at least one entry, each an existing route module the router imports",
        (id, entries) => {
            expect(entries.length, `${id} declares no entry`).toBeGreaterThan(
                0
            );
            for (const entry of entries) {
                expect(
                    fs.existsSync(path.join(REPO_ROOT, entry)),
                    `${id}: entry ${entry} does not exist`
                ).toBe(true);
                expect(
                    isRouteModulePath(entry),
                    `${id}: entry ${entry} is not a src/routes/**/*.route.tsx module`
                ).toBe(true);
                expect(
                    routed.has(entry),
                    `${id}: entry ${entry} is not imported by ${ROUTER_MODULE}`
                ).toBe(true);
            }
        }
    );
});

// A specimen row is scoped by its section and its mounts instead of its route
// entries (issue #4913, `scripts/lib/ui-scope.ts`). The scoper's model is
// "the section mounts it": a section outside the entries' closure is a frame
// the page never renders, and a mount the section does not itself import is
// opened by something the section-level closure does not see — either way
// the row would be selected for the wrong diffs, and nothing else reds.
describe("check:ui surface table — specimen rows (issue #4913)", () => {
    const specimens = SURFACES.filter((s) => s.specimen !== undefined);

    it("the table declares specimen rows", () => {
        expect(specimens.length).toBeGreaterThan(0);
    });

    it.each(specimens.map((s) => [s.id, s] as const))(
        "%s: its section is a module its entries render, and it imports every mount",
        (id, surface) => {
            const { section } = surface.specimen!;
            expect(
                fs.existsSync(path.join(REPO_ROOT, section)),
                `${id}: section ${section} does not exist`
            ).toBe(true);
            const rendered = surface.entries.some((entry) =>
                graph.closureOf(entry).has(section)
            );
            expect(
                rendered,
                `${id}: section ${section} is in no entry's closure`
            ).toBe(true);
            expect(
                surface.mounts?.length ?? 0,
                `${id}: a specimen row declares at least one mount`
            ).toBeGreaterThan(0);
            const opened = new Set(graph.importsOf(section));
            for (const mount of surface.mounts ?? []) {
                expect(
                    opened.has(mount),
                    `${id}: ${section} does not import its mount ${mount}`
                ).toBe(true);
            }
        }
    );
});
