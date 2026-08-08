// PR #2356 follow-up (finding 1/2 — no open issue, referenced from the PR
// body). #2345's click-collision fix added an early return in `CardsPile`:
// `if (!cards.length && (!controlled || hasContextMenu))` renders the
// ordinary empty-zone placeholder and returns BEFORE the `<GameDialog>` at
// the bottom of the component ever mounts. For the `hasContextMenu` half of
// that condition (a Manual Game library tile, whose 8 verbs — including the
// menu's own "Browse pile…" item — are offered unconditionally regardless of
// pile size, `src/lib/manual-pile-actions.ts`), that meant the pile menu's
// "Browse pile…" item lifted `open`/`onOpenChange` state
// (`usePileBrowseMenu`) with nothing left to drive: the dialog was never
// mounted, so flipping `open` to `true` did nothing — a dead menu item on an
// empty library.
//
// Verified empirically by the reviewer via the real `PlayerLibrary` +
// `PileActionsProvider` with `library.count = 0`:
// `{ menuOpened: true, browseItemPresent: true,
//   dialogOpenedAfterBrowseClick: false }`.
//
// This file pins BOTH halves of the fixed branch directly against `CardsPile`
// (no test previously touched either): the fully-uncontrolled empty pile
// (no menu — nothing to browse, no dialog needed) and the
// `controlled && hasContextMenu` empty pile (a menu exists — the dialog must
// stay mounted and drivable even at zero cards).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import CardsPile from "../cards-pile";

vi.mock("../../cards/card-image", () => ({
    default: ({ card }: { card: { id: string } }) => (
        <div data-testid={`card-image-${card.id}`} />
    ),
}));
vi.mock("../../cards/card-back", () => ({
    default: () => <div data-testid="card-back" />,
}));
vi.mock("~/hooks/useInertialScroll", () => ({
    useInertialScroll: () => ({ current: null }),
}));

afterEach(cleanup);

// Same DOM-level check `pile-browse-click-collision.test.tsx` uses — Base
// UI's Dialog only carries `data-open` while genuinely open, and checking the
// DOM directly (rather than an accessibility-role query) is robust to
// top-layer stacking hiding an older popup from the a11y tree.
const isDialogOpen = (container: HTMLElement) =>
    container.ownerDocument.body.querySelector(
        '[data-slot="dialog-content"][data-open]'
    ) !== null;

describe("CardsPile — empty-pile branch (PR #2356 follow-up)", () => {
    it("fully uncontrolled empty pile (no menu): renders only the placeholder, no dialog mounted, no click handler", () => {
        const { baseElement, getByText } = render(
            <CardsPile
                cards={[]}
                isFaceDown={false}
                title="Graveyard"
                emptyLabel="Graveyard is empty"
            />
        );

        expect(getByText("Graveyard is empty")).toBeTruthy();
        expect(isDialogOpen(baseElement as HTMLElement)).toBe(false);

        // No onClick wired at all in this branch — clicking the placeholder
        // must not open anything (nothing to browse, and #336 chip mode
        // wasn't requested).
        fireEvent.click(getByText("Graveyard is empty"));
        expect(isDialogOpen(baseElement as HTMLElement)).toBe(false);
    });

    it("controlled + hasContextMenu empty pile (Manual Game empty library menu): placeholder renders AND the dialog stays mounted, opening when the caller flips `open`", () => {
        const onOpenChange = vi.fn();
        const { rerender, baseElement, getByText } = render(
            <CardsPile
                cards={[]}
                isFaceDown={false}
                title="Library"
                emptyLabel="Library is empty"
                open={false}
                onOpenChange={onOpenChange}
                hasContextMenu
            />
        );

        // The collapsed-stack slot still shows the ordinary placeholder
        // (never an interactive-but-cardless stack) …
        expect(getByText("Library is empty")).toBeTruthy();
        expect(isDialogOpen(baseElement as HTMLElement)).toBe(false);

        // … and — the regression this file exists to pin — flipping the
        // CALLER-owned `open` prop (exactly what the menu's "Browse pile…"
        // item's `onSelect` does via `usePileBrowseMenu`'s lifted state)
        // actually opens the dialog, because it is mounted underneath.
        rerender(
            <CardsPile
                cards={[]}
                isFaceDown={false}
                title="Library"
                emptyLabel="Library is empty"
                open={true}
                onOpenChange={onOpenChange}
                hasContextMenu
            />
        );
        expect(isDialogOpen(baseElement as HTMLElement)).toBe(true);
    });
});
