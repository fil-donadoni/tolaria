import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    clearStorageFacts,
    collectViewportFacts,
    getStorageFacts,
    sampleStorageFacts,
} from "../environment";

// issue #3256 — the layout gate walks five viewports precisely because these
// values change what renders (ADR 0101). A UI report that omits them makes the
// maintainer guess which of the five they are looking at.
//
// And the rule that runs through the whole payload: an unsupported API is
// ABSENT, never zero. `quotaBytes: 0` reads as "no space left", which is a
// different bug report entirely.

describe("environment facts (issue #3256)", () => {
    beforeEach(() => {
        clearStorageFacts();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        clearStorageFacts();
    });

    it("carries viewport, device pixel ratio and the pointer/hover queries", () => {
        const facts = collectViewportFacts();
        expect(typeof facts.width).toBe("number");
        expect(typeof facts.height).toBe("number");
        expect(typeof facts.devicePixelRatio).toBe("number");
        expect(typeof facts.coarsePointer).toBe("boolean");
        expect(typeof facts.canHover).toBe("boolean");
    });

    it("omits the media-query results rather than guessing when matchMedia is missing", () => {
        vi.stubGlobal("matchMedia", undefined);
        const facts = collectViewportFacts();
        expect(facts.width).toBeGreaterThanOrEqual(0);
        expect("coarsePointer" in facts).toBe(false);
        expect("canHover" in facts).toBe(false);
    });

    it("records an unsupported storage API as absent, not as zero", async () => {
        vi.stubGlobal("navigator", {
            userAgent: "test",
            // No `storage`, no `serviceWorker` — an old or locked-down browser.
        });
        vi.stubGlobal("caches", undefined);

        const facts = await sampleStorageFacts();

        expect("quotaBytes" in facts).toBe(false);
        expect("usageBytes" in facts).toBe(false);
        expect("serviceWorker" in facts).toBe(false);
        expect("cardCachePresent" in facts).toBe(false);
        expect(typeof facts.sampledAt).toBe("number");
        // …and a sample with nothing but its own timestamp is not published at
        // all: a `storage` section saying only "we looked" is the empty
        // scaffolding that reads as evidence.
        expect(getStorageFacts()).toBeUndefined();
    });

    it("samples the quota, the service worker and the card cache when supported", async () => {
        vi.stubGlobal("navigator", {
            storage: { estimate: async () => ({ quota: 1234, usage: 56 }) },
            serviceWorker: {
                getRegistration: async () => ({ active: {} }),
            },
        });
        vi.stubGlobal("caches", { has: async () => true });

        const facts = await sampleStorageFacts();

        expect(facts.quotaBytes).toBe(1234);
        expect(facts.usageBytes).toBe(56);
        expect(facts.serviceWorker).toBe("active");
        expect(facts.cardCachePresent).toBe(true);
        // The sample is readable synchronously afterwards — the collector runs
        // in a render path and cannot await.
        expect(getStorageFacts()).toEqual(facts);
    });

    it("never rejects, whatever a probe does", async () => {
        vi.stubGlobal("navigator", {
            storage: {
                estimate: async () => {
                    throw new Error("blocked");
                },
            },
            serviceWorker: {
                getRegistration: async () => {
                    throw new Error("blocked");
                },
            },
        });
        vi.stubGlobal("caches", {
            has: async () => {
                throw new Error("blocked");
            },
        });

        await expect(sampleStorageFacts()).resolves.toMatchObject({});
        expect("quotaBytes" in (getStorageFacts() ?? {})).toBe(false);
    });
});
