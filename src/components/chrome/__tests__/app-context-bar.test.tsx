// The Immersive contextual bar (issue #2582), shrunk on a landscape phone
// (issue #2662).
//
// 44px (`min-h-11`) is the coarse-POINTER comfort target (ADR 0101 §2), not a
// viewport rule, and on a ~390px-tall landscape phone it alone ate ~11% of the
// screen before the surface below it drew anything. `short-viewport:` trims
// the band to 36px (`SHELL_CONTEXTUAL_COMPACT_BAND_PX`) and its Exit/overflow
// controls to `--control-h-xs` (28px — above the WCAG 2.2 AA floor of 24x24
// CSS px, SC 2.5.8) — the same height-driven split `AppHeader` already
// applies to the Browse bar (`app-header.test.tsx`).
//
// jsdom resolves no pixel height, so these assert the CLASSES that carry the
// band, plus the one thing the height model would silently disagree with: a
// height class here that does not match the constants `shellBands` subtracts
// from `<main>` (`shellLayout.test.ts`).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
    Link: ({
        to,
        children,
        ...props
    }: React.PropsWithChildren<{ to?: string } & Record<string, unknown>>) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));

import AppContextBar from "../app-context-bar";
import {
    SHELL_CONTEXTUAL_BAND_PX,
    SHELL_CONTEXTUAL_COMPACT_BAND_PX,
} from "@/lib/shellLayout";
import { CONTROL_HEIGHT_TOKENS, pxValue } from "@/lib/design-tokens";

afterEach(() => cleanup());

/** Tailwind's `min-h-N` scale is 0.25rem per step at the app's 16px root. */
const REM_STEP_PX = 4;

describe("AppContextBar — the band (issue #2662)", () => {
    it("is a min-h-11 floor that shrinks to short-viewport:min-h-9, matching the shell's own constants", () => {
        const { container } = render(
            <AppContextBar title="Edit deck" exitTo="/decks/goblins" />
        );
        const bar = container.querySelector(
            '[data-slot="app-context-bar"]'
        ) as HTMLElement;
        const classes = bar.className.split(/\s+/);
        expect(classes).toContain(
            `min-h-${SHELL_CONTEXTUAL_BAND_PX / REM_STEP_PX}`
        );
        expect(classes).toContain(
            `short-viewport:min-h-${SHELL_CONTEXTUAL_COMPACT_BAND_PX / REM_STEP_PX}`
        );
    });

    it("keeps the safe-area inset as a FLOOR-growing pt, never a fixed height (issue #2594)", () => {
        // The band must be able to grow past both min-h floors by the inset —
        // a fixed `h-*` at either viewport would squeeze Exit/title/overflow
        // under a notch/dynamic island in a standalone PWA launch.
        const { container } = render(
            <AppContextBar title="Edit deck" exitTo="/decks/goblins" />
        );
        const bar = container.querySelector(
            '[data-slot="app-context-bar"]'
        ) as HTMLElement;
        const classes = bar.className.split(/\s+/);
        expect(classes).toContain("pt-[env(safe-area-inset-top)]");
        expect(classes.some((c) => /^h-\d/.test(c))).toBe(false);
    });
});

describe("AppContextBar — controls shrink with the band (issue #2662)", () => {
    it("Exit drops to --control-h-xs under short-viewport", () => {
        const { getByRole } = render(
            <AppContextBar title="Edit deck" exitTo="/decks/goblins" />
        );
        const exit = getByRole("link", { name: /exit/i });
        const classes = exit.className.split(/\s+/);
        expect(classes).toContain("min-h-[var(--control-h)]");
        expect(classes).toContain("short-viewport:min-h-[var(--control-h-xs)]");
    });

    it("the overflow trigger drops both dimensions to --control-h-xs under short-viewport", () => {
        const { getByRole } = render(
            <AppContextBar title="Edit deck" exitTo="/decks/goblins" />
        );
        const trigger = getByRole("button", { name: "More" });
        const classes = trigger.className.split(/\s+/);
        expect(classes).toContain("min-h-[var(--control-h)]");
        expect(classes).toContain("min-w-[var(--control-h)]");
        expect(classes).toContain("short-viewport:min-h-[var(--control-h-xs)]");
        expect(classes).toContain("short-viewport:min-w-[var(--control-h-xs)]");
    });

    it("still opens the overflow menu at the shrunk size", () => {
        const { getByRole, getByLabelText } = render(
            <AppContextBar title="Edit deck" exitTo="/decks/goblins" />
        );
        fireEvent.click(getByRole("button", { name: "More" }));
        expect(getByLabelText("Overflow")).not.toBeNull();
    });

    it("--control-h-xs clears the WCAG 2.2 AA minimum target size (24x24 CSS px, SC 2.5.8)", () => {
        const token = CONTROL_HEIGHT_TOKENS.find(
            (t) => t.name === "--control-h-xs"
        );
        expect(
            token,
            "--control-h-xs is registered in the token mirror"
        ).not.toBeUndefined();
        expect(pxValue(token!.value)).toBeGreaterThanOrEqual(24);
        // And strictly below the coarse-pointer comfort target it replaces
        // here — this is a trade DOWN, not a second coarse rung.
        expect(pxValue(token!.value)).toBeLessThan(44);
    });
});
