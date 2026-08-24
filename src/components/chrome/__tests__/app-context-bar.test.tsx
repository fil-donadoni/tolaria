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
//
// EPISTEMIC LIMIT (issue #2662 review round 2): happy-dom cannot resolve
// `calc()` / `env()` — `getComputedStyle` returns the literal string, not a
// pixel value — so no unit test here can observe whether the safe-area inset
// is ADDED to the band or ABSORBED by it (`min-height` + a border-box
// `padding-top` land on `max(band, content + padding + border)`, not
// `band + padding`, unless the inset is folded INTO the min-height itself).
// A prior round of this test asserted only the CLASS STRING contained the
// inset-bearing min-height and called that a safe-area guard; it passed
// unchanged through the exact regression the review caught (folding the
// inset out of `min-height` back into a flat `min-h-9`/`min-h-11` keeps
// EVERY assertion below green, because none of them compute a height). The
// real guard is the browser measurement in this PR's receipt — a non-zero
// `env(safe-area-inset-top)` injected at 844x390x3 and at a non-short
// viewport, band height read off `getBoundingClientRect()`, compared against
// band + inset. What follows is class-shape coverage only: it catches an
// accidental class typo or an accidental drop of the `calc(...)` wrapper, not
// the box-model property itself.
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

/** px → the rem-token Tailwind's arbitrary-value scale would print, at the
 *  app's 16px root — e.g. 44 -> "2.75rem", 36 -> "2.25rem". Computed from the
 *  shell's own constants (never a literal) so a future change to either band
 *  constant flips this test instead of silently drifting from the class. */
function remToken(px: number): string {
    return `${(px / 16).toString().replace(/^0\./, ".")}rem`;
}

describe("AppContextBar — the band (issue #2662)", () => {
    it("is a min-height floor that FOLDS the safe-area inset in (not a bare min-h), shrinking to the compact rung under short-viewport, matching the shell's own constants", () => {
        // Round-2 fix (review finding): `min-h-11` / `short-viewport:min-h-9`
        // alone do NOT make the inset ADD to the band — on a border-box
        // element, `min-height` and a `padding-top` inset both feed the same
        // `max(natural, min-height)` comparison, so a min-height that doesn't
        // itself carry the inset lets the inset get ABSORBED into the
        // band's slack instead (issue #2662 review round 2; verified in a
        // real browser, not here — see this file's header comment). Folding
        // the inset into the min-height via `calc()` is what makes the
        // rendered floor `band + inset` rather than `max(band, content +
        // inset + border)`.
        const { container } = render(
            <AppContextBar title="Edit deck" exitTo="/decks/goblins" />
        );
        const bar = container.querySelector(
            '[data-slot="app-context-bar"]'
        ) as HTMLElement;
        const classes = bar.className.split(/\s+/);
        expect(classes).toContain(
            `min-h-[calc(${remToken(SHELL_CONTEXTUAL_BAND_PX)}_+_env(safe-area-inset-top))]`
        );
        expect(classes).toContain(
            `short-viewport:min-h-[calc(${remToken(SHELL_CONTEXTUAL_COMPACT_BAND_PX)}_+_env(safe-area-inset-top))]`
        );
    });

    it("keeps the safe-area inset as a padding-driven content offset, and never falls back to a fixed height (issue #2594)", () => {
        // The band must be able to grow past both min-h floors by the inset —
        // a fixed `h-*` at either viewport would squeeze Exit/title/overflow
        // under a notch/dynamic island in a standalone PWA launch. Checked at
        // BOTH viewports: a prefixed `short-viewport:h-9` is just as much a
        // fixed height as a bare `h-9`, and a regex anchored to the start of
        // the string (`/^h-\d/`) is blind to the variant prefix.
        const { container } = render(
            <AppContextBar title="Edit deck" exitTo="/decks/goblins" />
        );
        const bar = container.querySelector(
            '[data-slot="app-context-bar"]'
        ) as HTMLElement;
        const classes = bar.className.split(/\s+/);
        expect(classes).toContain("pt-[env(safe-area-inset-top)]");
        expect(classes.some((c) => /^(?:[a-z-]+:)*h-\d/.test(c))).toBe(false);
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
