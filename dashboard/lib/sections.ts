import { useSyncExternalStore } from "react";

/**
 * Jumping to a section, and the landing mark (PRD #3148 S2), ported from
 * `scripts/dashboard/now-nav.js` (#2630): clicking a traffic light scrolls to
 * its detail section and highlights it.
 *
 * The HIGHLIGHT is state, not a class poked onto a node. The vanilla version
 * had to remove-reflow-re-add `.ls-flash` by hand to restart the animation on
 * a repeated click, and to keep a `WeakMap` of timers so a second click did
 * not clear the first one's mark early. Rendering it from a store instead
 * makes a repeated jump a state change like any other, and makes "which
 * section is marked" something a test can read.
 *
 * A jump with no visible landing point is exactly what the mark exists to
 * prevent, which is why it is not dropped under `prefers-reduced-motion` —
 * only the SMOOTH scroll is.
 *
 * ONE mark at a time, deliberately. The vanilla version kept a `WeakMap` of
 * per-node timers, so clicking Driver and then Queue left BOTH sections marked
 * until each one's own timer expired. That is a faithful description of "two
 * animations are running", not of what the mark means: it answers "where did
 * my jump land", and there is exactly one answer at any moment. A second mark
 * on a section the operator has already scrolled away from is noise pointing
 * at the wrong place.
 */

/** How long a jumped-to section stays marked. */
export const FLASH_MS = 1600;

let flashed: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function publish(next: string | null): void {
    flashed = next;
    for (const fn of listeners) fn();
}

export const getFlashedSection = (): string | null => flashed;

export function subscribeToFlash(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    return () => {
        listeners.delete(onStoreChange);
    };
}

const prefersReducedMotion = (): boolean =>
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Scroll a section into view and mark it. Returns whether the section was
 * found — a light can never point at an id nothing renders (`SECTION_IDS` is
 * emitted by the same map the lights read), and this reports it rather than
 * failing silently if that ever stops being true.
 */
export function jumpToSection(id: string): boolean {
    const target = document.getElementById(id);
    if (!target) return false;
    target.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
    });
    if (timer) clearTimeout(timer);
    publish(id);
    timer = setTimeout(() => publish(null), FLASH_MS);
    return true;
}

export const useFlashedSection = (): string | null =>
    useSyncExternalStore(subscribeToFlash, getFlashedSection);

/** Test-only. */
export function resetSectionFlash(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    flashed = null;
    listeners.clear();
}
