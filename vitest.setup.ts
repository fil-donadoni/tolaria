import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// base-ui renders overlays (Dialog, Popover, Tooltip, Select, …) through a
// `data-base-ui-portal` root attached to `document.body`, OUTSIDE the React
// Testing Library render container. On close, base-ui defers unmounting the
// popup until its exit animations settle: `useAnimationsFinished` resolves
// `Promise.all(el.getAnimations().map(a => a.finished))` and only then flushes
// the unmount. Under jsdom that promise chain is a microtask with no real
// animation to complete, so a `cleanup()` (synchronous `root.unmount()`) can
// win the race and strand a detached portal subtree in `document.body`. That
// stray subtree survives into later tests, whose global (body-scoped) queries
// then see two copies of a shared label → intermittent "found multiple
// elements" flakes (issue #910).
//
// The root-cause guard is the flag base-ui itself checks: with
// `BASE_UI_ANIMATIONS_DISABLED` set, `useAnimationsFinished` runs the unmount
// synchronously and never enters the deferred `getAnimations()` path, so the
// popup is removed in the same tick as the close. Today's jsdom happens to
// lack `Element.prototype.getAnimations` (which also forces the sync path), but
// the flag makes the guarantee independent of that — surviving a jsdom upgrade
// or a test that polyfills `getAnimations` for animation assertions.
(
    globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }
).BASE_UI_ANIMATIONS_DISABLED = true;

// jsdom lacks ResizeObserver, which @dnd-kit/dom touches at import time. A
// no-op stub is enough for component tests (no real layout to observe).
if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
        ResizeObserverStub;
}

afterEach(() => {
    cleanup();
    // Defense in depth: `cleanup()` unmounts the render container but does not
    // reap base-ui portal roots that were stranded outside it. Remove any that
    // survived so the next test starts from a portal-free `document.body` and
    // its global queries only ever see its own markup. This fixes the whole
    // class (every base-ui overlay portal), not just Dialog. With the animation
    // flag above this should already be empty; the sweep keeps isolation
    // guaranteed even if a future test reintroduces a deferred-unmount path.
    document
        .querySelectorAll("[data-base-ui-portal]")
        .forEach((node) => node.remove());
});
