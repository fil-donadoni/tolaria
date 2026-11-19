// The between-games Sideboarding window (issue #395, revamped by issue #9820):
// the Ready gate (blocked under the Maindeck's starting size), the visual
// deck's moves (click / Shift+click / drag & drop / inspector / phone
// long-press), the Changes row, the Ready dock and the persisted preview mode.
// See `../sideboarding-dialog` and `../sideboarding/`.
import type { ComponentProps, ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, within, act } from "@testing-library/react";
import type { PublicMatch } from "@convex/matches";
import { GameContext } from "~/hooks/useGameContext";
import { resetSessionPreviewViewForTests } from "~/lib/preview-view-session-store";
import SideboardingDialog from "../sideboarding-dialog";

const submitSideboard = vi.fn<
    (args: { maindeck: unknown[]; sideboard: unknown[] }) => Promise<undefined>
>(() => Promise.resolve(undefined));
const setReady = vi.fn(() =>
    Promise.resolve({ gameId: null as string | null })
);
const onSwitchGame = vi.fn();

// SideboardingDialog reads `onSwitchGame` from GameContext (entering G2/G3 is an
// in-place session swap, not a full-page reload — see the component). Only that
// field is exercised here, so the provider value is a minimal cast.
type GameCtxValue = ComponentProps<typeof GameContext>["value"];
function wrap(ui: ReactElement) {
    return (
        <GameContext value={{ onSwitchGame } as unknown as GameCtxValue}>
            {ui}
        </GameContext>
    );
}
function renderDialog(ui: ReactElement) {
    return render(wrap(ui));
}

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "submitSideboard" ? submitSideboard : setReady,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            setReady: { _name: "setReady" },
        },
        gameTable: { submitSideboard: { _name: "submitSideboard" } },
    },
}));

// Real Cards (the preview body is empty for an unknown id).
const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const SIDE = "b1623d57-4729-4796-b3f7-f1837a05c6ed";
const DISENCHANT = "2722d7e2-61c6-4934-9c21-875ee78fd06c";

function copies(n: number, cardId: string, cardName: string) {
    return Array.from({ length: n }, () => ({ cardId, cardName }));
}

/** Maindeck: 3 Alpha + 1 Beta (starting size 4); Sideboard: 2 Gamma. */
function baseMatch(overrides: Partial<PublicMatch> = {}): PublicMatch {
    return {
        matchId: "m1" as PublicMatch["matchId"],
        bestOf: 3,
        status: "sideboarding",
        currentGameNumber: 1,
        solo: false,
        vsAi: false,
        players: [
            {
                id: "me",
                name: "Me",
                bgColor: "#000",
                score: 0,
                ready: false,
                deck: {
                    id: "d",
                    name: "Deck",
                    format: "vintage",
                    maindeck: [
                        ...copies(3, BOLT, "Alpha"),
                        ...copies(1, DISENCHANT, "Beta"),
                    ],
                    sideboard: copies(2, SIDE, "Gamma"),
                },
            },
            {
                id: "opp",
                name: "Opp",
                bgColor: "#111",
                score: 1,
                ready: false,
            },
        ],
        ...overrides,
    };
}

/** The tile of `cardId` in `zone`, or null when the card left that zone. */
function tile(cardId: string, zone: "main" | "side") {
    return document.querySelector<HTMLButtonElement>(
        `[data-sideboard-card="${cardId}"][data-zone="${zone}"]`
    );
}
const readyButton = () =>
    document.querySelector<HTMLButtonElement>("[data-ready-state]")!;
const zoneCount = (zone: "main" | "side") =>
    document
        .querySelector(`[data-drop-zone="${zone}"] [data-zone-count]`)!
        .textContent!.trim();

beforeEach(() => {
    submitSideboard.mockClear();
    setReady.mockClear();
    onSwitchGame.mockClear();
    resetSessionPreviewViewForTests();
});

describe("SideboardingDialog Ready gate (issue #395)", () => {
    it("Ready is enabled at the locked size and dispatches submit + ready", async () => {
        const { getByRole } = renderDialog(
            <SideboardingDialog match={baseMatch()} viewerId="me" />
        );
        const ready = getByRole("button", {
            name: /Ready for game 2/,
        }) as HTMLButtonElement;
        expect(ready.disabled).toBe(false);
        expect(ready.dataset.readyGlow).toBe("true");
        fireEvent.click(ready);
        await Promise.resolve();
        expect(submitSideboard).toHaveBeenCalledOnce();
        expect(setReady).toHaveBeenCalledOnce();
    });

    it("enters the next Game by switching session in-place, not reloading", async () => {
        // When all seats are ready `setReady` returns the built next Game's id.
        // The dialog MUST re-point the session via onSwitchGame (client-side
        // state swap) — a full-page reload re-requests the static `/game` route
        // and 404s on hosts without an SPA fallback (the entering-G2/G3 bug).
        setReady.mockResolvedValueOnce({ gameId: "g2" });
        renderDialog(<SideboardingDialog match={baseMatch()} viewerId="me" />);
        fireEvent.click(readyButton());
        await Promise.resolve();
        await Promise.resolve();
        expect(onSwitchGame).toHaveBeenCalledWith("g2", "me");
    });

    it("under the starting size the CTA turns into a red 'Add N more' statement", () => {
        const { getByRole, getByText } = renderDialog(
            <SideboardingDialog match={baseMatch()} viewerId="me" />
        );
        fireEvent.click(tile(BOLT, "main")!);
        const cta = getByRole("button", {
            name: /Add 1 more to Maindeck/,
        }) as HTMLButtonElement;
        expect(cta.disabled).toBe(true);
        expect(cta.dataset.readyState).toBe("blocked");
        expect(cta.dataset.readyGlow).toBeUndefined();
        expect(getByText(/1 card short — bring one back in/)).toBeTruthy();
        expect(
            document
                .querySelector("[data-ready-dock]")!
                .getAttribute("data-ready-dock")
        ).toBe("short");
    });

    it("bringing a Sideboard card in re-enables Ready, and the Maindeck may grow", async () => {
        renderDialog(<SideboardingDialog match={baseMatch()} viewerId="me" />);
        fireEvent.click(tile(BOLT, "main")!);
        fireEvent.click(tile(SIDE, "side")!);
        expect(readyButton().disabled).toBe(false);
        fireEvent.click(tile(SIDE, "side")!);
        expect(zoneCount("main")).toBe("5");
        expect(readyButton().disabled).toBe(false);
        fireEvent.click(readyButton());
        await Promise.resolve();
        const sent = submitSideboard.mock.calls[0][0];
        expect(sent.maindeck).toHaveLength(5);
        expect(sent.sideboard).toHaveLength(1);
    });

    it("shows the Play first / Draw first switch only for the previous Game's loser", () => {
        const { queryByRole, rerender } = renderDialog(
            <SideboardingDialog
                match={baseMatch({ playDrawChooserId: "opp" })}
                viewerId="me"
            />
        );
        expect(queryByRole("radio", { name: "Play first" })).toBeNull();
        rerender(
            wrap(
                <SideboardingDialog
                    match={baseMatch({ playDrawChooserId: "me" })}
                    viewerId="me"
                />
            )
        );
        const draw = queryByRole("radio", { name: "Draw first" })!;
        expect(draw).not.toBeNull();
        fireEvent.click(draw);
        expect(draw.getAttribute("aria-checked")).toBe("true");
    });

    it("shows a waiting notice when the viewer has no seat to sideboard", () => {
        // The projection strips the opponent's deck contents; a viewer whose own
        // seat carries no deck copy has nothing to edit → waiting state.
        const m = baseMatch();
        m.players = m.players.map((p) => ({ ...p, deck: undefined }));
        const { getByText } = renderDialog(
            <SideboardingDialog match={m} viewerId="me" />
        );
        expect(getByText(/waiting/i)).toBeTruthy();
        expect(document.querySelector("[data-ready-state]")).toBeNull();
    });
});

describe("SideboardingDialog opponent ready-state (issue #397)", () => {
    it("shows the opponent's 'sideboarding…' indicator in a 2-player Match", () => {
        const { getAllByText } = renderDialog(
            <SideboardingDialog match={baseMatch()} viewerId="me" />
        );
        expect(getAllByText(/sideboarding…/i).length).toBeGreaterThan(0);
        expect(getAllByText(/Opp:/).length).toBeGreaterThan(0);
    });

    it("shows the opponent's 'ready' indicator once they have readied", () => {
        const m = baseMatch();
        m.players = m.players.map((p) =>
            p.id === "opp" ? { ...p, ready: true } : p
        );
        const { getAllByText, queryByText } = renderDialog(
            <SideboardingDialog match={m} viewerId="me" />
        );
        expect(getAllByText("ready").length).toBeGreaterThan(0);
        expect(queryByText(/sideboarding…/i)).toBeNull();
    });

    it("once the viewer readies, the window locks and the dock waits for the opponent", () => {
        const m = baseMatch();
        m.players = m.players.map((p) =>
            p.id === "me" ? { ...p, ready: true } : p
        );
        const { getByRole } = renderDialog(
            <SideboardingDialog match={m} viewerId="me" />
        );
        const cta = getByRole("button", {
            name: /Ready — waiting for Opp…/,
        }) as HTMLButtonElement;
        expect(cta.disabled).toBe(true);
        expect(cta.dataset.readyState).toBe("waiting");
        // The swap can't change post-ready.
        expect(tile(BOLT, "main")!.disabled).toBe(true);
        fireEvent.click(tile(BOLT, "main")!);
        expect(zoneCount("main")).toBe("4");
    });

    it("does NOT show an opponent indicator in Solo", () => {
        const m = baseMatch({ solo: true });
        m.players = m.players.map((p, i) => ({
            ...p,
            id: `u-p${i + 1}`,
            deck: baseMatch().players[0].deck,
        }));
        const { queryByText } = renderDialog(
            <SideboardingDialog match={m} viewerId="u" />
        );
        expect(queryByText(/sideboarding…/i)).toBeNull();
    });
});

describe("SideboardingDialog visual deck (issue #9820)", () => {
    it("click moves one copy; a card whose last copy leaves disappears from its zone", () => {
        renderDialog(<SideboardingDialog match={baseMatch()} viewerId="me" />);
        fireEvent.click(tile(DISENCHANT, "main")!);
        expect(tile(DISENCHANT, "main")).toBeNull();
        expect(tile(DISENCHANT, "side")).not.toBeNull();
        expect(zoneCount("main")).toBe("3");
        expect(zoneCount("side")).toBe("3");
    });

    it("Shift+click moves every copy", () => {
        renderDialog(<SideboardingDialog match={baseMatch()} viewerId="me" />);
        fireEvent.click(tile(BOLT, "main")!, { shiftKey: true });
        expect(tile(BOLT, "main")).toBeNull();
        expect(zoneCount("side")).toBe("5");
    });

    it("the ×N badge is green where copies arrived and red-ringed where some left", () => {
        renderDialog(<SideboardingDialog match={baseMatch()} viewerId="me" />);
        fireEvent.click(tile(BOLT, "main")!);
        const badge = (zone: "main" | "side") =>
            tile(BOLT, zone)!.querySelector("[data-copy-badge]")!;
        expect(badge("main").getAttribute("data-copy-badge")).toBe("reduced");
        expect(badge("main").textContent).toBe("×2");
        expect(badge("side").getAttribute("data-copy-badge")).toBe("gained");
        expect(badge("side").textContent).toBe("×1");
        expect(
            tile(SIDE, "side")!
                .querySelector("[data-copy-badge]")!
                .getAttribute("data-copy-badge")
        ).toBe("same");
    });

    it("the inspector's four moves act on the hovered card", () => {
        const { getByRole } = renderDialog(
            <SideboardingDialog match={baseMatch()} viewerId="me" />
        );
        fireEvent.pointerEnter(tile(BOLT, "main")!);
        fireEvent.click(
            getByRole("button", { name: "Move all 3 Alpha to the Sideboard" })
        );
        expect(zoneCount("side")).toBe("5");
        fireEvent.click(
            getByRole("button", { name: "Move 1 Alpha to the Maindeck" })
        );
        expect(zoneCount("main")).toBe("2");
        fireEvent.click(
            getByRole("button", { name: "Move all 2 Alpha to the Maindeck" })
        );
        expect(zoneCount("main")).toBe("4");
        fireEvent.click(
            getByRole("button", { name: "Move 1 Alpha to the Sideboard" })
        );
        expect(zoneCount("main")).toBe("3");
    });
});

describe("SideboardingDialog Changes row (issue #9820)", () => {
    it("reads 'No changes' until a card moves", () => {
        const { getByText } = renderDialog(
            <SideboardingDialog match={baseMatch()} viewerId="me" />
        );
        expect(getByText("No changes — same deck as last game")).toBeTruthy();
        expect(getByText("Same deck as last game")).toBeTruthy();
    });

    it("one chip per changed card; its X undoes that card only", () => {
        const { getByRole, getByText } = renderDialog(
            <SideboardingDialog match={baseMatch()} viewerId="me" />
        );
        fireEvent.click(tile(BOLT, "main")!);
        fireEvent.click(tile(BOLT, "main")!);
        fireEvent.click(tile(SIDE, "side")!);
        fireEvent.click(tile(SIDE, "side")!);
        const chip = (id: string) =>
            document.querySelector(`[data-change-chip="${id}"]`)!;
        expect(chip(BOLT).textContent).toContain("−2");
        expect(chip(SIDE).textContent).toContain("+2");
        expect(getByText("2 in · 2 out · Sideboard 2")).toBeTruthy();
        fireEvent.click(
            getByRole("button", {
                name: "Undo: Alpha back to 3 in the Maindeck",
            })
        );
        expect(
            document.querySelector(`[data-change-chip="${BOLT}"]`)
        ).toBeNull();
        expect(chip(SIDE)).not.toBeNull();
        expect(zoneCount("main")).toBe("6");
    });

    it("Reset restores the whole window", () => {
        const { getByRole, getByText } = renderDialog(
            <SideboardingDialog match={baseMatch()} viewerId="me" />
        );
        fireEvent.click(tile(BOLT, "main")!, { shiftKey: true });
        fireEvent.click(tile(SIDE, "side")!);
        fireEvent.click(getByRole("button", { name: "Reset" }));
        expect(zoneCount("main")).toBe("4");
        expect(zoneCount("side")).toBe("2");
        expect(getByText("No changes — same deck as last game")).toBeTruthy();
    });
});

describe("SideboardingDialog drag & drop (issue #9820)", () => {
    // happy-dom has no layout: the drop probe's `elementFromPoint` is pointed
    // at the element the test means the pointer to be over.
    let under: Element | null = null;
    beforeEach(() => {
        under = null;
        (
            document as unknown as {
                elementFromPoint: (x: number, y: number) => Element | null;
            }
        ).elementFromPoint = () => under;
    });

    const zoneEl = (zone: "main" | "side") =>
        document.querySelector(`[data-drop-zone="${zone}"]`)!;
    const pad = (zone: "main" | "side", all: boolean) =>
        document.querySelector(
            `[data-drop-zone="${zone}"] [data-drop-zone="${zone}"]${all ? "[data-drop-all]" : ":not([data-drop-all])"}`
        );

    /** Press on a tile, travel, hover `target()` (resolved once the drag
     *  is live, so drop pads exist), release. */
    function dragTo(
        from: HTMLElement,
        target: () => Element | null,
        opts: { escape?: boolean } = {}
    ) {
        fireEvent.pointerDown(from, {
            button: 0,
            pointerType: "mouse",
            clientX: 10,
            clientY: 10,
        });
        fireEvent.pointerMove(window, { clientX: 40, clientY: 12 });
        under = target();
        fireEvent.pointerMove(window, { clientX: 60, clientY: 14 });
        if (opts.escape) fireEvent.keyDown(window, { key: "Escape" });
        fireEvent.pointerUp(window, { clientX: 60, clientY: 14 });
    }

    it.each([
        [
            "Maindeck → Sideboard, '1 copy' pad",
            BOLT,
            "main",
            "side",
            false,
            "3",
            "3",
        ],
        [
            "Maindeck → Sideboard, 'All N' pad",
            BOLT,
            "main",
            "side",
            true,
            "1",
            "5",
        ],
        [
            "Sideboard → Maindeck, '1 copy' pad",
            SIDE,
            "side",
            "main",
            false,
            "5",
            "1",
        ],
        [
            "Sideboard → Maindeck, 'All N' pad",
            SIDE,
            "side",
            "main",
            true,
            "6",
            "0",
        ],
    ] as const)("%s", (_name, cardId, from, to, all, mainAfter, sideAfter) => {
        renderDialog(<SideboardingDialog match={baseMatch()} viewerId="me" />);
        dragTo(tile(cardId, from)!, () => pad(to, all));
        expect(zoneCount("main")).toBe(mainAfter);
        expect(zoneCount("side")).toBe(sideAfter);
    });

    it("a single copy drops on the zone itself (no pads for a pile of one)", () => {
        renderDialog(<SideboardingDialog match={baseMatch()} viewerId="me" />);
        dragTo(tile(DISENCHANT, "main")!, () => {
            expect(pad("side", true)).toBeNull();
            return zoneEl("side");
        });
        expect(tile(DISENCHANT, "side")).not.toBeNull();
    });

    it("the ghost states the drop while dragging", () => {
        renderDialog(<SideboardingDialog match={baseMatch()} viewerId="me" />);
        fireEvent.pointerDown(tile(BOLT, "main")!, {
            button: 0,
            pointerType: "mouse",
            clientX: 10,
            clientY: 10,
        });
        fireEvent.pointerMove(window, { clientX: 40, clientY: 12 });
        const ghost = () =>
            document.querySelector("[data-sideboard-drag-ghost]")!.textContent;
        expect(ghost()).toBe("Drag to Sideboard");
        under = pad("side", true);
        fireEvent.pointerMove(window, { clientX: 50, clientY: 12 });
        expect(ghost()).toBe("All 3 → Sideboard");
        under = zoneEl("side");
        fireEvent.pointerMove(window, {
            clientX: 55,
            clientY: 12,
            shiftKey: true,
        });
        expect(ghost()).toBe("All 3 → Sideboard");
        fireEvent.pointerMove(window, { clientX: 56, clientY: 12 });
        expect(ghost()).toBe("1 copy → Sideboard");
        fireEvent.pointerUp(window, { clientX: 56, clientY: 12 });
        expect(
            document.querySelector("[data-sideboard-drag-ghost]")
        ).toBeNull();
    });

    it("Escape cancels the drag", () => {
        renderDialog(<SideboardingDialog match={baseMatch()} viewerId="me" />);
        dragTo(tile(BOLT, "main")!, () => pad("side", true), { escape: true });
        expect(zoneCount("main")).toBe("4");
    });

    it("dropping outside a zone, or back on its own zone, does nothing", () => {
        renderDialog(<SideboardingDialog match={baseMatch()} viewerId="me" />);
        dragTo(tile(BOLT, "main")!, () => null);
        dragTo(tile(BOLT, "main")!, () => zoneEl("main"));
        expect(zoneCount("main")).toBe("4");
    });
});

describe("SideboardingDialog touch gestures (issue #9820)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const touchDown = (el: HTMLElement) =>
        fireEvent.pointerDown(el, {
            button: 0,
            pointerType: "touch",
            clientX: 100,
            clientY: 100,
        });

    it("a vertical swipe stays a scroll: no drag, no long-press", () => {
        renderDialog(<SideboardingDialog match={baseMatch()} viewerId="me" />);
        touchDown(tile(BOLT, "main")!);
        fireEvent.pointerMove(window, { clientX: 102, clientY: 130 });
        act(() => void vi.advanceTimersByTime(500));
        expect(
            document.querySelector("[data-sideboard-drag-ghost]")
        ).toBeNull();
        expect(document.querySelector("[data-inspect-overlay]")).toBeNull();
    });

    it("a sideways swipe lifts the card", () => {
        renderDialog(<SideboardingDialog match={baseMatch()} viewerId="me" />);
        touchDown(tile(BOLT, "main")!);
        fireEvent.pointerMove(window, { clientX: 130, clientY: 102 });
        expect(
            document.querySelector("[data-sideboard-drag-ghost]")
        ).not.toBeNull();
        fireEvent.pointerCancel(window);
        expect(
            document.querySelector("[data-sideboard-drag-ghost]")
        ).toBeNull();
    });

    it("a long-press opens the Inspect Overlay with the four moves and stepping", () => {
        const { getByRole } = renderDialog(
            <SideboardingDialog match={baseMatch()} viewerId="me" />
        );
        touchDown(tile(BOLT, "main")!);
        act(() => void vi.advanceTimersByTime(400));
        fireEvent.pointerUp(window, { clientX: 100, clientY: 100 });
        const overlay = document.querySelector<HTMLElement>(
            "[data-inspect-overlay]"
        )!;
        expect(overlay).not.toBeNull();
        const o = within(overlay);
        // The primary action moves the card OUT of where it is.
        for (const label of [
            "All 3 → Sideboard",
            "1 → Sideboard",
            "1 → Maindeck",
            "All → Maindeck",
        ])
            expect(o.getByRole("button", { name: label })).toBeTruthy();
        fireEvent.click(o.getByRole("button", { name: "1 → Sideboard" }));
        expect(zoneCount("side")).toBe("3");
        // ‹ › walk the visible pool: Alpha → Beta.
        fireEvent.click(o.getByRole("button", { name: "Next card" }));
        expect(
            within(
                document.querySelector<HTMLElement>("[data-inspect-overlay]")!
            ).getByRole("button", { name: "1 → Sideboard" })
        ).toBeTruthy();
        fireEvent.click(getByRole("button", { name: "Close inspect overlay" }));
        expect(document.querySelector("[data-inspect-overlay]")).toBeNull();
        // The long-press release did not also tap-move a copy.
        expect(zoneCount("main")).toBe("3");
    });
});

describe("SideboardingDialog preview mode persists (issue #9820)", () => {
    const printedTab = () =>
        within(
            document.querySelector<HTMLElement>(
                '[data-testid="sideboard-preview"]'
            )!
        ).getByRole("tab", { name: /printed card/i });

    it("choose Printed, change card, reopen the window → still Printed", () => {
        const first = renderDialog(
            <SideboardingDialog match={baseMatch()} viewerId="me" />
        );
        fireEvent.pointerEnter(tile(BOLT, "main")!);
        fireEvent.click(printedTab());
        expect(printedTab().getAttribute("aria-selected")).toBe("true");
        fireEvent.pointerEnter(tile(SIDE, "side")!);
        expect(printedTab().getAttribute("aria-selected")).toBe("true");
        first.unmount();
        renderDialog(<SideboardingDialog match={baseMatch()} viewerId="me" />);
        expect(printedTab().getAttribute("aria-selected")).toBe("true");
    });

    it("the Inspect Overlay opens on the same choice", () => {
        vi.useFakeTimers();
        try {
            renderDialog(
                <SideboardingDialog match={baseMatch()} viewerId="me" />
            );
            fireEvent.click(printedTab());
            fireEvent.pointerDown(tile(BOLT, "main")!, {
                button: 0,
                pointerType: "touch",
                clientX: 1,
                clientY: 1,
            });
            act(() => void vi.advanceTimersByTime(400));
            const overlay = document.querySelector<HTMLElement>(
                "[data-inspect-overlay]"
            )!;
            expect(
                within(overlay)
                    .getByRole("tab", { name: /printed/i })
                    .getAttribute("aria-selected")
            ).toBe("true");
        } finally {
            vi.useRealTimers();
        }
    });
});
