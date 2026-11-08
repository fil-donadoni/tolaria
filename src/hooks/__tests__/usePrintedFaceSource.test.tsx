// The one printed-face source contract (issue #3553, issue #8321): the 1x
// bitmap first, the measured srcset second, the jpg third — and the `<img>`
// withheld while the bitmap is being made. happy-dom has no layout engine and
// no `createImageBitmap`, so the bitmap module is mocked: what this file pins
// is the WIRING — which source the hook hands out in which state.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const bitmaps = vi.hoisted(() => ({
    supported: true,
    wanted: true,
    resolve: null as null | ((url: string | null) => void),
    released: 0,
}));

vi.mock("~/lib/faceBitmaps", () => ({
    FACE_BITMAP_MAX_DPR: 1.5,
    FACE_RESAMPLE_TIMEOUT_MS: 12_000,
    supportsFaceBitmaps: () => bitmaps.supported,
    faceBitmapWanted: () => bitmaps.wanted,
    faceBitmapKey: (art: string, w: number, h: number) => `${art}|${w}x${h}`,
    acquireFaceBitmap: () => ({
        ready: new Promise<string | null>((r) => {
            bitmaps.resolve = r;
        }),
        release: () => {
            bitmaps.released++;
        },
    }),
}));

import usePrintedFaceSource, {
    PENDING_FACE_SRC,
} from "../usePrintedFaceSource";

const PRINT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const GRID = `https://cards.scryfall.io/grid/front/d/5/${PRINT}.webp`;

const loads = { real: 0 };

function Face({
    bitmap = true,
    lazy = false,
}: {
    bitmap?: boolean;
    lazy?: boolean;
}) {
    const { slotRef, attrs, onError, onLoad } =
        usePrintedFaceSource<HTMLDivElement>({
            imageId: PRINT,
            fallbackSizes: "112px",
            fallbackIncludeThumb: true,
            bitmap,
            lazy,
            onLoad: () => loads.real++,
        });
    return (
        <div ref={slotRef} data-testid="slot">
            {attrs ? (
                <img
                    data-card-face="printed"
                    {...attrs}
                    alt="Lightning Bolt"
                    onError={onError}
                    onLoad={onLoad}
                />
            ) : (
                <span data-testid="unmeasured" />
            )}
        </div>
    );
}

/** What the `<img>` reports as its decoded width at `load`. */
function decodedWidth(img: HTMLImageElement, width: number) {
    Object.defineProperty(img, "naturalWidth", {
        configurable: true,
        get: () => width,
    });
}

/** A measured slot: every element reports a 112×157 layout box and rect. */
function stubLayout() {
    const defs = {
        offsetWidth: Object.getOwnPropertyDescriptor(
            HTMLElement.prototype,
            "offsetWidth"
        ),
        offsetHeight: Object.getOwnPropertyDescriptor(
            HTMLElement.prototype,
            "offsetHeight"
        ),
        rect: Element.prototype.getBoundingClientRect,
    };
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get: () => 112,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get: () => 157,
    });
    Element.prototype.getBoundingClientRect = () =>
        ({ width: 112, height: 157, left: 0, top: 0 }) as DOMRect;
    return () => {
        for (const k of ["offsetWidth", "offsetHeight"] as const) {
            const d = defs[k];
            if (d) Object.defineProperty(HTMLElement.prototype, k, d);
            else
                delete (
                    HTMLElement.prototype as unknown as Record<string, unknown>
                )[k];
        }
        Element.prototype.getBoundingClientRect = defs.rect;
    };
}

describe("usePrintedFaceSource — the 1x bitmap path (issue #8321)", () => {
    let restore: (() => void) | null = null;
    beforeEach(() => {
        bitmaps.supported = true;
        bitmaps.wanted = true;
        bitmaps.resolve = null;
        bitmaps.released = 0;
        restore = stubLayout();
    });
    afterEach(() => {
        cleanup();
        restore?.();
        restore = null;
    });

    it("renders a source-less, pending-marked image while the bitmap is made, then hands out the blob with the art it was made from", async () => {
        const { container } = render(<Face />);
        const pending = container.querySelector("img")!;
        expect(pending.getAttribute("src")).toBe(PENDING_FACE_SRC);
        expect(pending.hasAttribute("data-face-pending")).toBe(true);
        expect(pending.getAttribute("alt")).toBe("Lightning Bolt");
        expect(bitmaps.resolve).not.toBeNull();
        await act(async () => {
            bitmaps.resolve!("blob:test/1");
        });
        const img = container.querySelector("img")!;
        expect(img.getAttribute("src")).toBe("blob:test/1");
        expect(img.getAttribute("data-art-src")).toBe(GRID);
        expect(img.getAttribute("srcset")).toBeNull();
        expect(img.hasAttribute("data-face-pending")).toBe(false);
    });

    it("the placeholder is a transparent image of the card's own aspect — never a square pixel, never the measured box", async () => {
        const { container } = render(<Face />);
        const img = () => container.querySelector("img")!;
        // 488:680 is every Scryfall front rendition; a content-sized slot
        // (hand card, picker tile) keeps its height through the swap.
        expect(PENDING_FACE_SRC).toMatch(/width='488' height='680'/);
        expect(img().getAttribute("src")).toBe(PENDING_FACE_SRC);
        expect(img().hasAttribute("width")).toBe(false);
        expect(img().hasAttribute("height")).toBe(false);
        await act(async () => {
            bitmaps.resolve!("blob:test/4");
        });
        expect(img().hasAttribute("width")).toBe(false);
        expect(img().hasAttribute("height")).toBe(false);
    });

    it("a lazy face waits, source-less, until its slot nears the viewport, then makes its bitmap", async () => {
        const observers: Array<(near: boolean) => void> = [];
        const RealIO = globalThis.IntersectionObserver;
        class FakeIO {
            constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
                observers.push((near) => cb([{ isIntersecting: near }]));
            }
            observe() {}
            disconnect() {}
        }
        globalThis.IntersectionObserver =
            FakeIO as unknown as typeof IntersectionObserver;
        try {
            const { container } = render(<Face lazy />);
            const img = () => container.querySelector("img")!;
            expect(img().getAttribute("src")).toBe(PENDING_FACE_SRC);
            // Not near yet: nothing acquired — the hundreds of faces of a
            // search grid must not resample at mount.
            expect(bitmaps.resolve).toBeNull();
            expect(observers.length).toBeGreaterThan(0);
            await act(async () => {
                for (const fire of observers) fire(true);
            });
            expect(bitmaps.resolve).not.toBeNull();
            await act(async () => {
                bitmaps.resolve!("blob:test/5");
            });
            expect(img().getAttribute("src")).toBe("blob:test/5");
        } finally {
            globalThis.IntersectionObserver = RealIO;
        }
    });

    it("swallows the placeholder's load and forwards the face's", async () => {
        loads.real = 0;
        const { container } = render(<Face />);
        const img = () => container.querySelector("img")!;
        await act(async () => {
            img().dispatchEvent(new Event("load"));
        });
        expect(loads.real).toBe(0);
        await act(async () => {
            bitmaps.resolve!("blob:test/9");
        });
        // happy-dom decodes the 1×1 placeholder and keeps reporting its
        // width after the swap; a browser reports the loaded bitmap's.
        decodedWidth(img(), 112);
        await act(async () => {
            img().dispatchEvent(new Event("load"));
        });
        expect(loads.real).toBe(1);
        expect(img().getAttribute("src")).toBe("blob:test/9");
    });

    it("refuses a bitmap that is not the slot's size and falls to the srcset", async () => {
        loads.real = 0;
        const { container } = render(<Face />);
        const img = () => container.querySelector("img")!;
        await act(async () => {
            bitmaps.resolve!("blob:test/7");
        });
        // A slot measured before its layout settled: a 7px bitmap for a
        // 112px tile must never show stretched.
        decodedWidth(img(), 7);
        await act(async () => {
            img().dispatchEvent(new Event("load"));
        });
        expect(loads.real).toBe(0);
        expect(img().getAttribute("src")).toBe(GRID);
        expect(img().getAttribute("srcset")).toContain("/grid/");
        expect(img().getAttribute("data-art-src")).toBeNull();
    });

    it("falls back to the measured srcset when the bitmap cannot be made", async () => {
        const { container } = render(<Face />);
        await act(async () => {
            bitmaps.resolve!(null);
        });
        const img = container.querySelector("img")!;
        expect(img.getAttribute("src")).toBe(GRID);
        expect(img.getAttribute("srcset")).toContain("/grid/");
        expect(img.getAttribute("sizes")).toBe("112px");
        expect(img.getAttribute("data-art-src")).toBeNull();
    });

    it("steps from a bitmap that would not draw to the srcset, then to the jpg", async () => {
        const { container } = render(<Face />);
        await act(async () => {
            bitmaps.resolve!("blob:test/2");
        });
        const img = () => container.querySelector("img")!;
        expect(img().getAttribute("src")).toBe("blob:test/2");
        await act(async () => {
            img().dispatchEvent(new Event("error"));
        });
        expect(img().getAttribute("srcset")).toContain("/grid/");
        await act(async () => {
            img().dispatchEvent(new Event("error"));
        });
        expect(img().getAttribute("src")).toContain("/normal/");
        expect(img().getAttribute("src")).toMatch(/\.jpg$/);
        expect(img().getAttribute("srcset")).toBeNull();
    });

    it("skips the bitmap for a lazy face and on a display the srcset serves", () => {
        const lazy = render(<Face bitmap={false} />);
        expect(lazy.container.querySelector("img")!.getAttribute("src")).toBe(
            GRID
        );
        cleanup();
        bitmaps.wanted = false;
        const retina = render(<Face />);
        expect(
            retina.container.querySelector("img")!.getAttribute("srcset")
        ).toContain("/grid/");
    });

    it("releases its hold on the bitmap when it unmounts", async () => {
        const { unmount } = render(<Face />);
        await act(async () => {
            bitmaps.resolve!("blob:test/3");
        });
        unmount();
        expect(bitmaps.released).toBe(1);
    });
});
