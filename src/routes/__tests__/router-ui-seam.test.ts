// The `check:ui` seam's client gate (issue #9271, ADR 0180): its routes join
// the tree only when `import.meta.env.DEV` is true. Vitest runs with DEV true
// (the lane's bundle carries it too), so the dev half imports the router as
// is; the production half re-imports it fresh with DEV stubbed false — the
// value `vite build` inlines. Route MATCHING only (`getMatchedRoutes`, the
// same pure lookup `router-limited-precedence.test.ts` uses): in production
// the seam path finds no route, which `defaultNotFoundComponent` renders as
// the ordinary not-found page. The bundle-level half (no seam code SHIPS) is
// `bun run check:bundle`'s, on the real build.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    pickUiSeamParams,
    UI_SEAM_ECHO_PARAM,
    UI_SEAM_ECHO_PATH,
    UI_SEAM_MARKER,
    UI_SEAM_PARAM_PREFIX,
    UI_SEAM_ROUTE_PREFIX,
} from "@convex/lib/uiSeamNamespace";

async function freshRouter(dev: boolean) {
    vi.resetModules();
    vi.stubEnv("DEV", dev);
    const mod = await import("~/router");
    return mod.router;
}

describe("router: check:ui seam routes (issue #9271)", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it("registers the echo route in a DEV bundle", async () => {
        const router = await freshRouter(true);
        const result = router.getMatchedRoutes(UI_SEAM_ECHO_PATH);
        expect(result.foundRoute?.id).toBe(UI_SEAM_ECHO_PATH);
    });

    it("leaves every seam path unmatched in a production bundle", async () => {
        const router = await freshRouter(false);
        expect(router.getMatchedRoutes(UI_SEAM_ECHO_PATH).foundRoute).toBe(
            undefined
        );
        const ids = Object.keys(router.routesById);
        expect(ids.filter((id) => id.startsWith(UI_SEAM_ROUTE_PREFIX))).toEqual(
            []
        );
        // The product routes are untouched by the gate.
        expect(router.getMatchedRoutes("/settings").foundRoute?.id).toBe(
            "/settings"
        );
    });

    it("spells every seam path and parameter under the one marker", () => {
        expect(UI_SEAM_ROUTE_PREFIX).toBe(`/${UI_SEAM_MARKER}`);
        expect(UI_SEAM_PARAM_PREFIX).toBe(`${UI_SEAM_MARKER}_`);
        expect(UI_SEAM_ECHO_PATH.startsWith(`${UI_SEAM_ROUTE_PREFIX}/`)).toBe(
            true
        );
        expect(UI_SEAM_ECHO_PARAM.startsWith(UI_SEAM_PARAM_PREFIX)).toBe(true);
    });

    it("keeps only string parameters under the reserved prefix", () => {
        expect(
            pickUiSeamParams({
                [UI_SEAM_ECHO_PARAM]: "ping",
                __uiseam_n: 3,
                status: "history",
                echo: "not reserved",
            })
        ).toEqual({ [UI_SEAM_ECHO_PARAM]: "ping" });
    });
});
