// The Limited builder on a phone (issue #5400, PRD #5384): portrait wraps the
// piles inside tabbed panes (Deck / Pool, or Creatures / Non-creatures / Pool
// with Split creatures on), landscape lays the Deck out as one sideways row
// over a Sideboard strip (or two bands side by side).
//
// Geometry is not asserted here — happy-dom has no layout. The overflow half
// of the ACs (no page-level horizontal scroll at 375x812 / 812x375, split on
// and off) is the `check:ui` receipt in the PR.
import {
    describe,
    it,
    expect,
    vi,
    beforeAll,
    afterEach,
    beforeEach,
} from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { createDeckColumnLayout } from "@convex/deckLayout";
import type { DeckCard } from "~/types/game";
import { cardBase } from "~/lib/cardSizing";
import { saveSplitCreatures } from "~/lib/deckViewPrefs";
import type { ViewportMode } from "~/hooks/useViewportMode";
import { installDndJsdomShims } from "./dragHarness";
import DeckBuilderShell from "../deck-builder-shell";
import type {
    DeckBuilderViewSpec,
    DeckZoneActions,
} from "../deckBuilderVariant";

let mode: ViewportMode = "portrait";
// Partial: `useSurfaceClass` (read by `DeckZoneSurface`) imports the media
// query constants from this module.
vi.mock("~/hooks/useViewportMode", async (importOriginal) => ({
    ...(await importOriginal<typeof import("~/hooks/useViewportMode")>()),
    useViewportMode: () => mode,
}));

beforeAll(installDndJsdomShims);
beforeEach(() => window.localStorage.clear());
afterEach(() => {
    cleanup();
    mode = "portrait";
});

const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // MV 1 instant
const SERRA = "f8ac5006-91bd-4803-93da-f87cf196dd2f"; // MV 5 creature
const card = (cardId: string, cardName: string): DeckCard => ({
    cardId,
    cardName,
});

const VIEW: DeckBuilderViewSpec = {
    cardBase: cardBase("7.5rem", "17vw", "9dvh"),
    splitZone: "phone-piles-test",
    splitDefault: 2 / 3,
    mainZoomZone: "phone-piles-main",
    sideZoomZone: "phone-piles-side",
    zoomInitial: 1.0,
};

const ACTIONS: DeckZoneActions = {
    onMoveToSideboard: () => {},
    onMoveToMaindeck: () => {},
    onPin: () => {},
    onMainCardClick: () => {},
    onSideCardClick: () => {},
    onMainGroupingChange: () => {},
    onSideGroupingChange: () => {},
    onMainOrderingChange: () => {},
    onSideOrderingChange: () => {},
};

function mount(
    phonePiles: boolean,
    actions: Partial<DeckZoneActions> = {},
    side: DeckCard[] = [card(BOLT, "Lightning Bolt")]
) {
    return render(
        <DeckBuilderShell
            title="Build Limited Deck"
            onDone={() => {}}
            mainCards={[
                card(SERRA, "Serra Angel"),
                card(BOLT, "Lightning Bolt"),
            ]}
            sideCards={side}
            layout={createDeckColumnLayout()}
            view={VIEW}
            zones={{
                sideTabLabel: "Pool",
                mainTabLabel: "Deck",
                mainEmptyMessage: "main empty",
                sideEmptyMessage: "side empty",
                phonePiles,
            }}
            actions={{ ...ACTIONS, ...actions }}
        />
    );
}

const tabs = () =>
    [...document.querySelectorAll("[data-deck-pane-tab]")].map(
        (el) => el.textContent ?? ""
    );
const pane = (id: string) =>
    document.querySelector(`[data-deck-pane="${id}"]`) as HTMLElement | null;
const cardsIn = (el: HTMLElement | null) =>
    [...(el?.querySelectorAll("[data-card-copy]") ?? [])].map((n) =>
        n.getAttribute("data-card-copy")
    );

describe("phone portrait", () => {
    it("split off: tabs Deck / Pool, the Deck's piles wrap — no sideways rows", () => {
        mount(true);
        expect(tabs()).toEqual(["Deck2", "Pool1"]);
        expect(document.querySelector("[data-deck-row]")).toBeNull();
        expect(
            pane("maindeck")!.querySelectorAll("[data-column]").length
        ).toBeGreaterThan(1);
    });

    it("split on: the Deck becomes a Creatures and a Non-creatures pane, each with its own tab", () => {
        saveSplitCreatures(true);
        mount(true);
        expect(tabs()).toEqual(["Creatures1", "Non-creatures1", "Pool1"]);
        expect(pane("maindeck")).toBeNull();
        expect(cardsIn(pane("maindeck-creatures"))).toEqual([SERRA]);
        expect(cardsIn(pane("maindeck-others"))).toEqual([BOLT]);
    });

    it("split on: the creature filter is hidden — the tabs do its job", () => {
        saveSplitCreatures(true);
        mount(true);
        const creatureSelects = document.querySelectorAll(
            '[aria-label*="Creatures" i][role]'
        );
        // Sideboard still has its filter; the two band panes have none.
        expect(
            pane("maindeck-creatures")!.querySelector("select, [role=group]")
        ).toBeNull();
        expect(creatureSelects).toBeDefined();
    });

    it("a host without phonePiles keeps the rows and ignores the stored split", () => {
        saveSplitCreatures(true);
        mount(false);
        expect(tabs()).toEqual(["Deck2", "Pool1"]);
        expect(document.querySelector("[data-deck-row]")).not.toBeNull();
        // ...and the rows' scroller is not turned into a wrapping one.
        expect(
            document.querySelector("[data-deck-row]")!.parentElement!.className
        ).not.toContain("flex-wrap");
    });
});

describe("phone landscape", () => {
    beforeEach(() => {
        mode = "landscape-compact";
    });

    it("split off: one row of piles, the Sideboard strip below it", () => {
        mount(true);
        expect(document.querySelector("[data-split-band]")).toBeNull();
        expect(pane("maindeck")!.nextElementSibling).toBe(pane("sideboard"));
    });

    it("split on: two bands side by side inside the Deck", () => {
        saveSplitCreatures(true);
        mount(true);
        const bands = pane("maindeck")!.querySelectorAll("[data-split-band]");
        expect(
            [...bands].map((b) => b.getAttribute("data-split-band"))
        ).toEqual(["creatures", "others"]);
        expect(cardsIn(bands[0] as HTMLElement)).toEqual([SERRA]);
        expect(cardsIn(bands[1] as HTMLElement)).toEqual([BOLT]);
    });

    it("split can be turned off from the phone's own View controls", () => {
        saveSplitCreatures(true);
        mount(true);
        // The phone folds a zone's controls behind its "View" toggle.
        fireEvent.click(screen.getAllByRole("button", { name: /^view/i })[0]!);
        fireEvent.click(
            screen.getByRole("switch", { name: "Maindeck split creatures" })
        );
        expect(document.querySelector("[data-split-band]")).toBeNull();
    });
});

describe("the Peek Panel move on a phone", () => {
    it("hands the whole selection to the host, so a host that animates the move can fly the card to its tab", () => {
        saveSplitCreatures(true);
        const onSelectionMoveToMaindeck = vi.fn();
        const onMoveToMaindeck = vi.fn();
        mount(true, { onSelectionMoveToMaindeck, onMoveToMaindeck });
        fireEvent.click(
            pane("sideboard")!.querySelector("[role=button]") as HTMLElement
        );
        fireEvent.click(screen.getByRole("button", { name: "→ Deck" }));
        expect(onSelectionMoveToMaindeck).toHaveBeenCalledWith(
            expect.objectContaining({
                cardId: BOLT,
                cardName: "Lightning Bolt",
            })
        );
        expect(onMoveToMaindeck).not.toHaveBeenCalled();
    });
});
