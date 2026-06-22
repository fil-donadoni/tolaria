import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

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
});
