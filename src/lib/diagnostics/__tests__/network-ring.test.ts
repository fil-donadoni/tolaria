import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    NETWORK_RING_LIMIT,
    clearFailedRequests,
    getFailedRequests,
    installNetworkRing,
    pathShape,
    recordFailedRequest,
} from "../network-ring";

// issue #3256 — failed backend requests, REDUCED at the point of capture.
//
// The reduction is not a formatting choice: a request or response body is where
// a token, a decklist or another player's hidden zone would be, and the only
// way to guarantee none of it travels is for the ring to never hold it. A
// redaction step at the send site is a step someone can forget.

const BACKEND = "https://example.convex.cloud";

describe("network ring (issue #3256)", () => {
    let uninstall: () => void = () => {};
    const realFetch = window.fetch;

    beforeEach(() => {
        clearFailedRequests();
    });
    afterEach(() => {
        uninstall();
        uninstall = () => {};
        window.fetch = realFetch;
        clearFailedRequests();
    });

    it("masks ids and drops the query string from a path", () => {
        expect(pathShape(`${BACKEND}/api/storage/k17abcdefghijklmnop`)).toBe(
            "/api/storage/:id"
        );
        expect(
            pathShape(
                "https://app.test/api/games/550e8400-e29b-41d4-a716-446655440000/state?token=SECRET"
            )
        ).toBe("/api/games/:id/state");
        expect(pathShape("https://app.test/api/decks/42")).toBe(
            "/api/decks/:id"
        );
    });

    it("records a failed backend request as method, path and status only", async () => {
        window.fetch = vi.fn(
            async () =>
                new Response("the body nobody may keep", { status: 500 })
        ) as typeof window.fetch;
        uninstall = installNetworkRing(BACKEND);

        await fetch(`${BACKEND}/api/action/run?token=SECRET`, {
            method: "POST",
            body: JSON.stringify({ password: "hunter2" }),
        });

        const [record] = getFailedRequests();
        expect(Object.keys(record!).sort()).toEqual([
            "at",
            "method",
            "path",
            "status",
        ]);
        expect(record).toMatchObject({
            method: "POST",
            path: "/api/action/run",
            status: 500,
        });
        const dumped = JSON.stringify(getFailedRequests());
        expect(dumped).not.toContain("hunter2");
        expect(dumped).not.toContain("SECRET");
        expect(dumped).not.toContain("the body nobody may keep");
    });

    it("records a network error as status 0, distinct from a 500", async () => {
        window.fetch = vi.fn(async () => {
            throw new TypeError("Failed to fetch");
        }) as unknown as typeof window.fetch;
        uninstall = installNetworkRing(BACKEND);

        await expect(fetch(`${BACKEND}/api/sync`)).rejects.toThrow();
        expect(getFailedRequests()[0]).toMatchObject({
            method: "GET",
            path: "/api/sync",
            status: 0,
        });
    });

    it("ignores a third party and a successful backend call", async () => {
        window.fetch = vi.fn(async (input: RequestInfo | URL) =>
            String(input).includes("scryfall")
                ? new Response("", { status: 404 })
                : new Response("", { status: 200 })
        ) as unknown as typeof window.fetch;
        uninstall = installNetworkRing(BACKEND);

        await fetch("https://cards.scryfall.io/large/front/a/b/c.jpg");
        await fetch(`${BACKEND}/api/query`);

        expect(getFailedRequests()).toEqual([]);
    });

    it("drops the oldest failure past its capacity", () => {
        for (let i = 0; i < NETWORK_RING_LIMIT + 5; i++) {
            recordFailedRequest({
                method: "GET",
                path: `/p/${i}`,
                status: 500,
            });
        }
        const ring = getFailedRequests();
        expect(ring).toHaveLength(NETWORK_RING_LIMIT);
        expect(ring[0]!.path).toBe("/p/5");
    });
});
