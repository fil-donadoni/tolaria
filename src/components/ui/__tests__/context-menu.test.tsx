import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
    ContextMenu,
    ContextMenuTrigger,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuCheckboxItem,
    ContextMenuRadioGroup,
    ContextMenuRadioItem,
    ContextMenuSeparator,
} from "../context-menu";

/** `ContextMenu` backs every board ability menu, hand-card menu, pile browse,
 *  nameplate verb list and selectable-card menu (see
 *  `src/components/__tests__/modal-scrim.guard.test.ts`'s sibling finding on
 *  #2731 review round 1) — the reviewer proved nothing pinned its 44px row
 *  floor by deleting all four `min-h-[var(--menu-row-h)]` occurrences and
 *  watching the whole `dom` project stay green. These tests close that hole:
 *  they render the popup OPEN (`defaultOpen`) via the real exported
 *  components, never a hand-built view, so a future edit that drops the
 *  floor fails here. */

describe("ContextMenu (ADR 0103 §5 — 44px row floor)", () => {
    it("ContextMenuItem carries the 44px min-height floor", () => {
        render(
            <ContextMenu defaultOpen>
                <ContextMenuTrigger>Anchor</ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onClick={vi.fn()}>Cast</ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
        );
        const item = screen.getByText("Cast");
        expect(item.className).toContain("min-h-[var(--menu-row-h)]");
    });

    it("ContextMenuCheckboxItem and ContextMenuRadioItem carry the same floor", () => {
        render(
            <ContextMenu defaultOpen>
                <ContextMenuTrigger>Anchor</ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuCheckboxItem checked onCheckedChange={vi.fn()}>
                        Toggle
                    </ContextMenuCheckboxItem>
                    <ContextMenuRadioGroup value="a">
                        <ContextMenuRadioItem value="a">
                            Option A
                        </ContextMenuRadioItem>
                    </ContextMenuRadioGroup>
                </ContextMenuContent>
            </ContextMenu>
        );
        expect(screen.getByText("Toggle").className).toContain(
            "min-h-[var(--menu-row-h)]"
        );
        expect(screen.getByText("Option A").className).toContain(
            "min-h-[var(--menu-row-h)]"
        );
    });

    it("the popup content lays out rows with the shared menu-row gap", () => {
        render(
            <ContextMenu defaultOpen>
                <ContextMenuTrigger>Anchor</ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onClick={vi.fn()}>Cast</ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
        );
        const popup = screen.getByRole("menu");
        expect(popup.className).toContain("gap-[var(--menu-row-gap)]");
    });

    it("the separator draws the hairline, not the legacy flat border colour", () => {
        render(
            <ContextMenu defaultOpen>
                <ContextMenuTrigger>Anchor</ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onClick={vi.fn()}>Cast</ContextMenuItem>
                    <ContextMenuSeparator data-testid="sep" />
                </ContextMenuContent>
            </ContextMenu>
        );
        const sep = screen.getByTestId("sep");
        expect(sep.className).toContain("bg-[var(--hairline)]");
        expect(sep.className).not.toContain("bg-border");
    });
});
