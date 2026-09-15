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

describe("check:ui surface table — route entries", () => {
    const routed = new Set(
        createImportGraph({ root: REPO_ROOT }).importsOf(ROUTER_MODULE)
    );

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
