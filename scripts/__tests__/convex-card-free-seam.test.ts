import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bundleModule, reachesCatalogue } from "../lib/convex-heap";

/**
 * The card-free seam of the gameplay graph (issue #4855, PRD #4849).
 *
 * `convex/game.ts` holds the engine, every hand-written definition and the
 * compiled pool (~45 MiB of heap per call), re-materialised on every call and
 * every subscription re-execution. A function whose handler reads no Card
 * Definition does not need any of it, so those functions live in modules that
 * import neither the catalogue nor the GRE — the wake-up tick re-runs on every
 * write of every game, and `myActiveGame` is subscribed by every signed-in
 * user in the lobby.
 *
 * The budget alone (`check:convex-heap`, ≤ 4 MiB) is a report; this pins the cut
 * by CAUSE, the way `convex-node-bundle-seam.test.ts` does for the node graph:
 * the module's own esbuild graph never reaches `convex/gre/`, `convex/cards/`
 * or the compiled pool, so the day someone imports a GRE helper "just for a
 * constant" the failure names the module and the import that did it.
 */

const REPO_ROOT = resolve(__dirname, "../..");

/** Function modules (and the helpers they share) that must stay card-free.
 *  A module that starts reading a definition leaves this list only by moving
 *  its function back to an engine-carrying module — never by editing this. */
const CARD_FREE_MODULES = [
    "convex/gameReads.ts",
    "convex/gameManual.ts",
    "convex/gameTable.ts",
    "convex/gameSeats.ts",
    "convex/gameLifecycle.ts",
];

/** What a card-free graph may never contain: the engine and the catalogue. */
function engineInputs(inputs: string[]): string[] {
    return inputs.filter(
        (i) =>
            i.includes("convex/gre/") ||
            i.includes("convex/cards/") ||
            i.includes("convex/limited/botDrafter") ||
            i.includes("data/oracle-compiled-pool.json")
    );
}

describe("the card-free modules' graph (issue #4855)", () => {
    const outDir = mkdtempSync(join(tmpdir(), "card-free-seam-"));

    it.each(CARD_FREE_MODULES)(
        "%s reaches neither the GRE nor the catalogue",
        async (module) => {
            expect(
                existsSync(join(REPO_ROOT, module)),
                `${module} is listed as card-free but does not exist — this guard measured nothing`
            ).toBe(true);
            const inputs = await bundleModule(
                join(REPO_ROOT, module),
                join(outDir, "out.js")
            );
            // A vacuous pass is the one way this fails silently: an entry point
            // that bundled to nothing holds every assertion below trivially.
            expect(
                inputs.length,
                `${module} bundled to no inputs — this guard measured nothing`
            ).toBeGreaterThan(0);
            expect(
                engineInputs(inputs),
                `${module} reached the engine. A function that reads no Card Definition ` +
                    `must not pay for it: ~45 MiB of heap per call in \`convex/game.ts\`'s ` +
                    `graph (issue #4855). Move the import's function to an engine module, ` +
                    `or move the constant it wanted to a card-free one.`
            ).toEqual([]);
            expect(reachesCatalogue(inputs)).toBe(false);
        },
        60_000
    );

    afterAll(() => rmSync(outDir, { recursive: true, force: true }));
});
