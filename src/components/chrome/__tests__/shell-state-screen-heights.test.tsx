// Issue #2274: the full-viewport loading / not-found states that render UNDER
// the shared header.
//
// Before this fix each of them claimed a whole viewport (`h-dvh` / `h-screen`)
// while sitting inside `<main>`, which is the viewport MINUS the header band —
// so each overflowed by exactly the band, at every height. That is the same
// overflow shape issue #2056 removed from the deckbuilder, relocated from the
// document onto `<main>` rather than eliminated.
//
// These tests render the real components, read the height claim OFF THE
// RENDERED ROOT (`deriveHeightClaim`), and run it through the shell's
// arithmetic across desktop heights. Reverting any of these components to
// `h-dvh` flips the derived claim to `viewport` and the overflow assertion goes
// red — the route-level branches that cannot be cheaply mounted
// (`deck-builder.route.tsx`, `deck-detail.route.tsx`) are covered by the
// repo-wide guard in `shell-height-claims.guard.test.tsx` instead.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import LoadingScreen from "@/components/ui/loading-screen";
import JoinAntechamberShell from "@/components/join/join-antechamber-shell";
import {
    SHELL_HEADER_BAND_PX,
    deriveHeightClaim,
    resolveShellLayout,
    type ShellModel,
} from "@/lib/shellLayout";

afterEach(() => cleanup());

/** The shape `app-shell.tsx` ships — asserted against the real DOM in
 *  `app-shell-scroll-contract.test.tsx`. */
const SHELL: ShellModel = {
    rootBounded: true,
    headerPinned: true,
    mainCanShrink: true,
    mainScrolls: true,
};

const DESKTOP_HEIGHTS_PX = [500, 600, 720, 768, 800, 900, 1080, 1200, 1440];

/** A representative height for the centred Panel each of these screens holds. */
const PANEL_CONTENT_PX = 240;

const SCREENS: { name: string; render: () => HTMLElement }[] = [
    {
        name: "LoadingScreen",
        render: () =>
            render(<LoadingScreen />).container
                .firstElementChild as HTMLElement,
    },
    {
        name: "JoinAntechamberShell",
        render: () =>
            render(
                <JoinAntechamberShell>
                    <p>panel</p>
                </JoinAntechamberShell>
            ).container.firstElementChild as HTMLElement,
    },
];

describe.each(SCREENS)(
    "$name claims the shell's remaining height, never a whole viewport (issue #2274)",
    ({ render: renderScreen }) => {
        it("its rendered root does not carry a whole-viewport height claim", () => {
            const root = renderScreen();
            expect(
                deriveHeightClaim(root.className, PANEL_CONTENT_PX).kind
            ).not.toBe("viewport");
        });

        it.each(DESKTOP_HEIGHTS_PX)(
            "at %ipx, under the shared header, it overflows <main> by nothing at all",
            (viewportHeightPx) => {
                const root = renderScreen();
                const layout = resolveShellLayout(
                    SHELL,
                    {
                        viewportHeightPx,
                        headerBandHeightPx: SHELL_HEADER_BAND_PX,
                    },
                    deriveHeightClaim(root.className, PANEL_CONTENT_PX)
                );
                // The pre-fix number here was exactly SHELL_HEADER_BAND_PX.
                expect(layout.mainOverflowPx).toBe(0);
                expect(layout.scrollers).toEqual([]);
                expect(layout.contentHeightPx).toBe(layout.mainHeightPx);
            }
        );

        it("its height claim is a FLOOR — content taller than the remainder still reaches its bottom through <main>", () => {
            const root = renderScreen();
            const layout = resolveShellLayout(
                SHELL,
                {
                    viewportHeightPx: 500,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                },
                deriveHeightClaim(root.className, 2000)
            );
            expect(layout.contentHeightPx).toBe(2000);
            expect(layout.scrollers).toEqual(["main"]);
            expect(layout.bottomReachable).toBe(true);
        });

        it("on /game (no header band) the same claim fills the whole viewport", () => {
            const root = renderScreen();
            const layout = resolveShellLayout(
                SHELL,
                { viewportHeightPx: 1080, headerBandHeightPx: 0 },
                deriveHeightClaim(root.className, PANEL_CONTENT_PX)
            );
            expect(layout.contentHeightPx).toBe(1080);
            expect(layout.mainOverflowPx).toBe(0);
        });
    }
);
