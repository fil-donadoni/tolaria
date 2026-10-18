import { describe, it, expect } from "vitest";
import {
    BRAIN_WORKER_DEV_URL,
    brainWorkerModuleSource,
    workerSafePreloadDependencies,
} from "../lib/vite-brain-worker-chunk";

/**
 * The Brain worker as a chunk of the page's build (issue #5617, ADR 0113
 * Amendment VII). The built half — one worker entry chunk, its closure the
 * game route's — is asserted over a built `dist/` by `brainWorkerViolations`
 * (`client-bundle-lazy-routes.test.ts`, `check:bundle`); this pins the two
 * pieces that need no build.
 */
describe("vite-brain-worker-chunk", () => {
    it("drops the preload list of a Set chunk's dynamic import — a Worker has no `document` to preload through", () => {
        expect(
            workerSafePreloadDependencies("assets/card-set-lea-GGGG7777.js", [
                "assets/card-set-lea-GGGG7777.js",
                "assets/shared-AAAA1111.js",
            ])
        ).toEqual([]);
    });

    it("keeps every other dynamic import's preload list", () => {
        const deps = ["assets/lobby.route-BBBB2222.js", "assets/x-CCCC3333.js"];
        expect(
            workerSafePreloadDependencies(
                "assets/lobby.route-BBBB2222.js",
                deps
            )
        ).toEqual(deps);
    });

    it("names the source module under the dev server, the emitted chunk beside the importer under a build", () => {
        expect(brainWorkerModuleSource(false)).toContain(
            JSON.stringify(BRAIN_WORKER_DEV_URL)
        );
        const built = brainWorkerModuleSource(true);
        expect(built).toContain("new URL(file, import.meta.url)");
        // Never a literal `new URL("./…", import.meta.url)`: Vite's asset
        // plugin would try to resolve the placeholder as a file.
        expect(built).not.toMatch(/new URL\(\s*["'`]/);
    });
});
