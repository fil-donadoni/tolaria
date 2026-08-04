import { StrictMode } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `useFullCatalogue` derives availability from `api.cardIndex.list`. The query
// itself is irrelevant here — what matters is that it resolves, so `rows` is
// gated only on the fetch.
vi.mock("convex/react", () => ({
    useQuery: () => [{ nameFold: "lightning bolt" }],
}));

const WIRE = {
    names: ["Lightning Bolt", "Sliver Queen"],
    printIds: ["print-1", "print-2"],
    typeLines: ["Instant", "Legendary Creature — Sliver"],
    manaCosts: ["{R}", "{2}{W}{U}{B}{R}{G}"],
    cmcs: [1, 7],
    colourIdentities: ["R", "WUBRG"],
    sets: ["lea", "stf"],
    rarities: ["common", "rare"],
};

function stubFetch(): void {
    vi.stubGlobal("fetch", () =>
        // Uncompressed body — the transport-decompressed shape `decodeCatalogue`
        // passes through. Which branch it takes is covered separately.
        Promise.resolve(
            new Response(new TextEncoder().encode(JSON.stringify(WIRE)))
        )
    );
}

/** Fresh module per test — `loadFullCatalogue` memoises its promise at module
 *  scope, so a shared instance would let one test's resolved catalogue satisfy
 *  the next one and mask exactly the bug under test. */
async function freshHook() {
    vi.resetModules();
    const mod = await import("../fullCatalogue");
    return mod.useFullCatalogue;
}

/**
 * The StrictMode-strand guard.
 *
 * `useFullCatalogue` used to carry a `startedRef` "already started" latch on
 * top of its `cancelled` cleanup flag. Under React StrictMode the two
 * combined to strand the load permanently:
 *
 *   1. mount #1 sets the ref and kicks off `loadFullCatalogue()`
 *   2. StrictMode's simulated unmount runs the cleanup → `cancelled = true`
 *   3. mount #2 early-returns on the ref, so no live closure exists
 *   4. the promise resolves into mount #1's cancelled closure → `setCatalogue`
 *      is never called
 *
 * `rows` then stays `undefined` forever with NOTHING logged: no error, no
 * failed request, just an empty card pool in manual mode and no Unavailable
 * Cards in real mode. Deduplication is the module-level promise cache's job,
 * never a ref's — so the hook must survive a mount/unmount/remount cycle.
 */
describe("useFullCatalogue — StrictMode double-invoke", () => {
    beforeEach(stubFetch);
    afterEach(() => {
        vi.unstubAllGlobals();
        cleanup();
    });

    function Probe({ hook }: { hook: () => { rows?: unknown[] } }) {
        const { rows } = hook();
        return (
            <div data-testid="rows">
                {rows === undefined ? "loading" : String(rows.length)}
            </div>
        );
    }

    it("resolves rows when mounted inside StrictMode", async () => {
        const hook = await freshHook();
        render(
            <StrictMode>
                <Probe hook={hook} />
            </StrictMode>
        );

        await waitFor(() =>
            expect(screen.getByTestId("rows").textContent).toBe("2")
        );
    });

    // Deliberately NOT tested here: "a second consumer mounted after the first
    // load settled". That case passes with the ref bug present — the ref is
    // per-component-instance, so a fresh mount gets a fresh one — which makes
    // it a test that can never go red. StrictMode's double-invoke of a SINGLE
    // instance is the only shape that reproduces the strand.
});
