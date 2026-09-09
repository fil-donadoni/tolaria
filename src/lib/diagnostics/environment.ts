/**
 * What the reporter's browser looked like when they filed (issue #3256).
 *
 * Two halves, split by what the platform will answer synchronously.
 *
 * The VIEWPORT half is a sync read. The layout gate walks five viewports
 * precisely because these values change what renders (ADR 0101), so a UI report
 * that omits them makes a maintainer guess which of the five they are looking
 * at — and `pointer: coarse` / `hover` decide entire branches of the control
 * chrome, not just its size.
 *
 * The STORAGE half is async (`navigator.storage.estimate`,
 * `navigator.serviceWorker.getRegistration`) and is therefore SAMPLED at app
 * start into a module-level snapshot the collector reads synchronously. The
 * Worker failure this work came out of was plausibly a module that never
 * loaded; a registered-but-unactivated service worker, or an evicted cache, is
 * the field that would have said so.
 *
 * Every value is optional and ABSENT when the platform does not support it —
 * never zero. `quotaBytes: 0` reads as "no space left", which is a bug report of
 * its own; the honest answer for a browser without the Storage API is silence.
 */

/** The card-image service worker's cache (`public/sw-cards.js`). Named here so
 *  a report can say whether the cache exists at all, which is the difference
 *  between "images are slow" and "images never cached". */
const CARD_CACHE_NAME = "tolaria-card-images-v1";

export type ViewportFacts = {
    width: number;
    height: number;
    devicePixelRatio: number;
    /** `(pointer: coarse)` — touch. Drives the 44px control branch. */
    coarsePointer?: boolean;
    /** `(hover: hover)` — a real pointer that can hover. */
    canHover?: boolean;
};

export type StorageFacts = {
    /** `navigator.storage.estimate()`. Absent when unsupported. */
    quotaBytes?: number;
    usageBytes?: number;
    /** Whether a service worker is registered, and how far it got. */
    serviceWorker?: "active" | "installing" | "waiting" | "none";
    /** Whether the card-image cache exists. */
    cardCachePresent?: boolean;
    /** When this snapshot was taken. A stale sample is still evidence; a sample
     *  that cannot say how stale it is, is not. */
    sampledAt: number;
};

export function collectViewportFacts(): ViewportFacts {
    return {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        ...matchMediaFact("coarsePointer", "(pointer: coarse)"),
        ...matchMediaFact("canHover", "(hover: hover)"),
    };
}

/** `matchMedia` is absent in some test and embedded environments, and a throw
 *  here would cost the reporter the whole payload. Absent, never guessed. */
function matchMediaFact(
    key: "coarsePointer" | "canHover",
    query: string
): Record<string, boolean> {
    try {
        if (typeof window.matchMedia !== "function") return {};
        return { [key]: window.matchMedia(query).matches };
    } catch {
        return {};
    }
}

let sampled: StorageFacts | undefined;

/** The last sample, or `undefined` when none has completed. */
export function getStorageFacts(): StorageFacts | undefined {
    return sampled;
}

/** Test seam — the module-level snapshot is the one piece of state here. */
export function clearStorageFacts(): void {
    sampled = undefined;
}

/**
 * Takes one sample. Called at app start (`main.tsx`); every individual probe is
 * independently guarded, so an unsupported or throwing API costs its own field
 * and nothing else. Never rejects — a diagnostics probe that can fail the app
 * is worse than no probe.
 */
function hasSubstance(facts: StorageFacts): boolean {
    return (
        facts.quotaBytes !== undefined ||
        facts.usageBytes !== undefined ||
        facts.serviceWorker !== undefined ||
        facts.cardCachePresent !== undefined
    );
}

export async function sampleStorageFacts(): Promise<StorageFacts> {
    const facts: StorageFacts = { sampledAt: Date.now() };

    try {
        const estimate = await navigator.storage?.estimate?.();
        if (estimate) {
            if (typeof estimate.quota === "number") {
                facts.quotaBytes = estimate.quota;
            }
            if (typeof estimate.usage === "number") {
                facts.usageBytes = estimate.usage;
            }
        }
    } catch {
        // Unsupported or blocked — absent, not zero.
    }

    try {
        if (navigator.serviceWorker?.getRegistration) {
            const reg = await navigator.serviceWorker.getRegistration();
            facts.serviceWorker = !reg
                ? "none"
                : reg.active
                  ? "active"
                  : reg.installing
                    ? "installing"
                    : reg.waiting
                      ? "waiting"
                      : "none";
        }
    } catch {
        // Absent.
    }

    try {
        if (typeof caches !== "undefined" && caches.has) {
            facts.cardCachePresent = await caches.has(CARD_CACHE_NAME);
        }
    } catch {
        // Absent.
    }

    // A section with nothing but its own timestamp is the empty scaffolding the
    // issue forbids: it reads as "we looked at storage and this is what it
    // said". On a browser that supports none of the three probes, the honest
    // answer is silence.
    sampled = hasSubstance(facts) ? facts : undefined;
    return facts;
}
