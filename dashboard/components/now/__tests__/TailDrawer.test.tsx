// Assertions read the DOM directly — see the note in `Term.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NowView } from "../NowView";
import { ShortcutsSheet } from "../../ShortcutsSheet";
import { resetLoopStatus } from "../../../lib/loopStatus";
import { getOpenOverlays, resetOverlays } from "../../../lib/overlays";
import { resetWatch } from "../../../lib/watch";
import { requestAction, resetPendingAction } from "../../../lib/confirm";
import { resetSectionFlash } from "../../../lib/sections";
import { openSheet } from "../../../lib/shortcuts";
import { goldenPayload, NOW_MS, stubNowFetch } from "./fixture";

/**
 * The session tail drawer's two long-standing defects (PRD #3148 S2).
 *
 * They are the reason the PRD exists, so they are asserted rather than assumed:
 *
 *   1. `Escape` used to close the drawer only while focus was INSIDE it,
 *      because the listener was bound on the drawer's own element.
 *   2. A click outside did not close it at all — only the easy half of the
 *      dismissal was ever written.
 *
 * Both now come from the primitive, which means the thing left to prove is
 * what a primitive cannot know: which overlay owns `Escape` when several are
 * open, and that another row's Watch is a SWITCH rather than an outside press.
 */

/** base-ui dismisses on a pointer press, which is three events, not one. */
const pressOn = (el: Element) => {
    fireEvent.pointerDown(el);
    fireEvent.mouseDown(el);
    fireEvent.click(el);
};

const renderNow = () =>
    render(
        <TooltipProvider>
            <NowView />
            <ShortcutsSheet />
        </TooltipProvider>
    );

async function openDrawerOnFirstSession() {
    const { fetchStub } = stubNowFetch(goldenPayload());
    vi.stubGlobal("fetch", vi.fn(fetchStub));
    renderNow();
    await screen.findByText("Live sessions");
    const live = document.getElementById("ls-section-live")!;
    const watch = within(live).getByRole("button", {
        name: "Watch porting the Now view",
    });
    pressOn(watch);
    await screen.findByRole("dialog");
    return { watch, live };
}

beforeEach(() => {
    resetLoopStatus();
    resetOverlays();
    resetWatch();
    resetPendingAction();
    resetSectionFlash();
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
});

afterEach(() => {
    resetLoopStatus();
    resetOverlays();
    resetWatch();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("TailDrawer — Escape closes it from anywhere on the page", () => {
    it("closes on Escape while focus is on the page BEHIND it — the exact defect the hand-written drawer shipped", async () => {
        const { watch } = await openDrawerOnFirstSession();

        // Put focus somewhere on the page behind the drawer, which is where a
        // non-modal drawer legitimately leaves it.
        const queueLight = screen.getByRole("button", { name: /Queue/ });
        queueLight.focus();
        expect(document.activeElement).toBe(queueLight);

        fireEvent.keyDown(document, { key: "Escape" });

        await waitFor(() => {
            expect(screen.queryByRole("dialog")).toBeNull();
        });
        // …and focus goes back to the control that opened it.
        expect(document.activeElement).toBe(watch);
    });

    it("yields Escape to the shortcuts sheet while that is open, and stays open itself", async () => {
        await openDrawerOnFirstSession();
        openSheet();
        await screen.findByText("Keyboard shortcuts", {
            selector: "h2, [class*='font-semibold']",
        });
        expect(getOpenOverlays()).toEqual(["shortcuts", "tail"]);

        fireEvent.keyDown(document, { key: "Escape" });

        await waitFor(() => {
            expect(getOpenOverlays()).toEqual(["tail"]);
        });
        // A second Escape now reaches the drawer.
        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() => {
            expect(getOpenOverlays()).toEqual([]);
        });
    });

    it("yields Escape to the action-confirmation dialog while that is open", async () => {
        await openDrawerOnFirstSession();
        // Raised through the store, not by clicking Release: a press on a
        // Release button IS a press outside the drawer, and the drawer is
        // supposed to dismiss on one (the test below). What is under test here
        // is the precedence between two overlays that are genuinely open at
        // once, which is reachable in the real UI by opening the drawer from
        // inside a confirmation-free path and then triggering an action by
        // keyboard.
        act(() => {
            requestAction({
                action: "claim.release",
                issue: 3152,
                opener: null,
            });
        });
        await waitFor(() => {
            expect(getOpenOverlays()).toEqual(["confirm", "tail"]);
        });

        fireEvent.keyDown(document, { key: "Escape" });

        await waitFor(() => {
            expect(getOpenOverlays()).toEqual(["tail"]);
        });
    });
});

describe("TailDrawer — a click outside closes it, but another Watch switches it", () => {
    it("closes on a press on the page behind it", async () => {
        await openDrawerOnFirstSession();
        pressOn(screen.getByRole("button", { name: /Queue/ }));
        await waitFor(() => {
            expect(screen.queryByRole("dialog")).toBeNull();
        });
    });

    it("SWITCHES to another row's session instead of closing — the press is outside the drawer, but it is not a dismissal", async () => {
        const { live } = await openDrawerOnFirstSession();
        expect(
            within(screen.getByRole("dialog")).getByText("porting the Now view")
        ).not.toBeNull();

        pressOn(
            within(live).getByRole("button", { name: "Watch another session" })
        );

        await waitFor(() => {
            expect(
                within(screen.getByRole("dialog")).getByText("another session")
            ).not.toBeNull();
        });
        // Still ONE drawer, still open — not closed and reopened.
        expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });
});

describe("TailDrawer — non-modal means the page behind stays usable", () => {
    it("declares itself non-modal and paints no backdrop over the page", async () => {
        await openDrawerOnFirstSession();
        const dialog = screen.getByRole("dialog");
        expect(dialog.getAttribute("aria-modal")).not.toBe("true");
        // base-ui's Backdrop has no `pointer-events: none` of its own, so a
        // non-modal sheet that painted one would swallow every click behind
        // it — `showOverlay={false}` is what keeps that from happening.
        expect(
            document.querySelector("[data-slot='sheet-overlay']")
        ).toBeNull();
    });

    it("lets a press on the page behind REACH the control it landed on, as well as dismissing the drawer", async () => {
        await openDrawerOnFirstSession();
        const queue = document.getElementById("ls-section-queue")!;
        expect(queue.className).not.toContain("ring-2");

        pressOn(screen.getByRole("button", { name: /Queue/ }));

        // Both halves matter. The drawer dismisses — that is the second of the
        // two defects this slice fixes. And the light still FIRED: with a
        // modal backdrop in the way the click would have been swallowed and
        // the section never marked, which is the failure "non-modal" exists to
        // avoid.
        await waitFor(() => {
            expect(screen.queryByRole("dialog")).toBeNull();
        });
        expect(
            document.getElementById("ls-section-queue")!.className
        ).toContain("ring-2");
    });
});

describe("TailDrawer — following one transcript", () => {
    it("asks the tail route for the watched session and renders its entries", async () => {
        await openDrawerOnFirstSession();
        const dialog = screen.getByRole("dialog");
        await waitFor(() => {
            expect(
                within(dialog).getByText("the transcript says something")
            ).not.toBeNull();
        });
        const calls = (
            globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
        ).mock.calls.map((c) => String(c[0]));
        expect(
            calls.some((u) =>
                u.startsWith(
                    "/api/tail?session=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
                )
            )
        ).toBe(true);
    });
});
