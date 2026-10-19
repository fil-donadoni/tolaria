// Card fly contract (issue #5395): a pool ↔ deck CLICK in the Limited builder
// flies the card, and the flight is cosmetic — the card is in its destination
// the moment the click returns, whether or not anything animates, and under
// reduced motion no flying element is ever created. Nothing here asserts the
// animation itself (its keyframes, timing or path).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { CARD_FLY_ATTR } from "~/lib/cardFly";
import { paneOf } from "./zoneQueries";
import PoolDeckBuilderForm from "../pool-deck-builder-form";

const useMutationMock = vi.fn();

vi.mock("~/lib/useCardPrintings", async () => ({
    useCardPrintings: (
        await import("~/components/deckbuilder/__tests__/basicLandPrintRows")
    ).useCardPrintingsStub,
}));
vi.mock("~/lib/useScryfallSetNames", async () => ({
    useScryfallSetNames: (
        await import("~/components/deckbuilder/__tests__/basicLandPrintRows")
    ).useScryfallSetNamesStub,
}));
vi.mock("~/lib/useBasicLandPreferenceRows", async () => ({
    useBasicLandPreferenceRows: (
        await import("~/components/deckbuilder/__tests__/basicLandPrintRows")
    ).useBasicLandPreferenceRowsStub,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEventMutations: () => ({
        setPoolArrangementEntry: vi.fn().mockResolvedValue(null),
    }),
}));
vi.mock("convex/react", () => ({
    useMutation: (...args: unknown[]) => useMutationMock(...args),
    // The print resolver's rows query (issue #5550): still loading.
    useQuery: () => undefined,
}));
vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt
const POOL = [
    { scryfallId: "s1", cardId: BOLT_ID, cardName: "Lightning Bolt" },
];

/** Frames queued by `requestAnimationFrame`, flushed by hand so a test can
 *  look at the DOM BEFORE the fly resolves its landing. */
let frames: FrameRequestCallback[] = [];
const animate = vi.fn(() => ({ onfinish: null, oncancel: null }));

function flushFrames() {
    const queued = frames;
    frames = [];
    for (const cb of queued) cb(0);
}

function stubMotion(reduced: boolean) {
    vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
            matches: reduced && query.includes("reduce"),
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }))
    );
}

beforeEach(() => {
    useMutationMock.mockReturnValue(vi.fn().mockResolvedValue("deck-1"));
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
    });
    // happy-dom has no layout and no Web Animations: give every element a
    // real on-screen box and an `animate` so the fly gets as far as it would
    // in a browser.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(10, 10, 100, 140)
    );
    (Element.prototype as unknown as { animate: unknown }).animate = animate;
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    animate.mockClear();
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    delete document.documentElement.dataset.motion;
    document
        .querySelectorAll(`[${CARD_FLY_ATTR}]`)
        .forEach((el) => el.remove());
    window.localStorage.clear();
});

function renderSealed() {
    return render(
        <PoolDeckBuilderForm
            eventId={"event-1" as never}
            seatIndex={0}
            pool={POOL}
            existingDeck={null}
            eventType="sealed"
            poolArrangement={[]}
            packSlots={["lea"]}
        />
    );
}

function clickBoltIn(container: HTMLElement, title: RegExp) {
    const tile = paneOf(container, title).querySelector(
        "[role=button][title]"
    ) as HTMLElement;
    expect(tile, `no tile in ${title}`).toBeTruthy();
    fireEvent.click(tile);
}

function flyingCopies() {
    return document.querySelectorAll(`[${CARD_FLY_ATTR}]`);
}

describe("PoolDeckBuilderForm — card fly is cosmetic (issue #5395)", () => {
    it("motion allowed: the card is in the Maindeck the instant the click returns, before the flight resolves", () => {
        stubMotion(false);
        const { container, getByText } = renderSealed();
        clickBoltIn(container, /^Pool \(Sideboard\)/);
        // No frame has run: the fly has not even measured its landing yet.
        expect(getByText(/^Maindeck 1/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 0/)).toBeTruthy();
        flushFrames();
        expect(flyingCopies()).toHaveLength(1);
        expect(getByText(/^Maindeck 1/)).toBeTruthy();
    });

    it("motion allowed: the move back to the Pool is immediate too", () => {
        stubMotion(false);
        const { container, getByText } = renderSealed();
        clickBoltIn(container, /^Pool \(Sideboard\)/);
        flushFrames();
        clickBoltIn(container, /^Maindeck/);
        expect(getByText(/^Maindeck 0/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 1/)).toBeTruthy();
    });

    it("OS reduced motion: the card moves and no flying element is ever created", () => {
        stubMotion(true);
        const { container, getByText } = renderSealed();
        clickBoltIn(container, /^Pool \(Sideboard\)/);
        expect(getByText(/^Maindeck 1/)).toBeTruthy();
        flushFrames();
        expect(flyingCopies()).toHaveLength(0);
        expect(animate).not.toHaveBeenCalled();
    });

    it("the Settings 'Reduced' choice ([data-motion=reduced]) suppresses the flight the same way", () => {
        stubMotion(false);
        document.documentElement.dataset.motion = "reduced";
        const { container, getByText } = renderSealed();
        clickBoltIn(container, /^Pool \(Sideboard\)/);
        expect(getByText(/^Maindeck 1/)).toBeTruthy();
        flushFrames();
        expect(flyingCopies()).toHaveLength(0);
    });
});
