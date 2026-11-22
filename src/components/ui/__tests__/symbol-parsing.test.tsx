// Every UI kit primitive renders its STRING content through the symbol parser
// (issue #9834): `{T}: Add {R}.` draws two symbol images and no braces, with
// nothing asked of the call site. One case per primitive, rendered through the
// real exported component.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import ActionSheet from "../action-sheet";
import { Badge } from "../badge";
import { Banner } from "../banner";
import { Button } from "../button";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "../context-menu";
import { ControlTooltip } from "../control-tooltip";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "../dialog";
import GameDialog from "../game-dialog";
import { HotkeyTooltip } from "../hotkey-tooltip";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "../tooltip";
import { HOTKEYS } from "~/lib/hotkeys";

const TEXT = "{T}: Add {R}.";

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/** The rendered copy of TEXT inside `root`: exactly `copies` × two symbol
 *  images, and no literal brace anywhere in the text. */
function expectSymbols(root: ParentNode, copies = 1) {
    const imgs = Array.from(root.querySelectorAll("img[data-symbol]"));
    expect(imgs.map((i) => i.getAttribute("data-symbol"))).toEqual(
        Array.from({ length: copies }, () => ["{T}", "{R}"]).flat()
    );
    expect(imgs.every((i) => (i.getAttribute("alt") ?? "") !== "")).toBe(true);
    expect(root.textContent ?? "").not.toMatch(/\{(T|R)\}/);
}

function hover(trigger: HTMLElement) {
    act(() => {
        fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
        fireEvent.mouseEnter(trigger);
        fireEvent.mouseMove(trigger, { movementX: 4, movementY: 4 });
    });
}

const cases: [string, () => ReactElement, (() => ParentNode)?][] = [
    ["Button", () => <Button>{TEXT}</Button>],
    ["Button (mixed children)", () => <Button>Pay {TEXT}</Button>],
    ["Badge", () => <Badge>{TEXT}</Badge>],
    [
        "Banner title",
        () => (
            <Banner tone="info" title={TEXT}>
                body
            </Banner>
        ),
    ],
    ["Banner body", () => <Banner tone="info">{TEXT}</Banner>],
    [
        "ActionSheet row label",
        () => (
            <ActionSheet
                open
                onClose={() => {}}
                items={[{ key: "a", label: TEXT, onSelect: () => {} }]}
            />
        ),
        () => document.querySelector("[data-action-sheet]")!,
    ],
    [
        "DialogTitle",
        () => (
            <Dialog open>
                <DialogContent>
                    <DialogTitle>{TEXT}</DialogTitle>
                </DialogContent>
            </Dialog>
        ),
        () => document.querySelector('[data-slot="dialog-title"]')!,
    ],
    [
        "DialogDescription",
        () => (
            <Dialog open>
                <DialogContent>
                    <DialogTitle>t</DialogTitle>
                    <DialogDescription>{TEXT}</DialogDescription>
                </DialogContent>
            </Dialog>
        ),
        () => document.querySelector('[data-slot="dialog-description"]')!,
    ],
    [
        "GameDialog title",
        () => (
            <GameDialog open title={TEXT}>
                <p>body</p>
            </GameDialog>
        ),
        () => document.querySelector("h2")!,
    ],
    [
        "GameDialog subtitle",
        () => (
            <GameDialog open title="Ward" subtitle={TEXT}>
                <p>body</p>
            </GameDialog>
        ),
        () => document.querySelector('[data-slot="dialog-description"]')!,
    ],
    [
        "TooltipContent",
        () => (
            <TooltipProvider>
                <Tooltip open>
                    <TooltipTrigger>anchor</TooltipTrigger>
                    <TooltipContent>{TEXT}</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        ),
        () => document.querySelector('[data-slot="tooltip-content"]')!,
    ],
    [
        "ContextMenuItem",
        () => (
            <ContextMenu defaultOpen>
                <ContextMenuTrigger>anchor</ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem>{TEXT}</ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
        ),
        () => document.querySelector('[data-slot="context-menu-item"]')!,
    ],
];

describe("UI primitives render string content through the symbol parser (issue #9834)", () => {
    it.each(cases)("%s", (_name, ui, scope) => {
        const { container } = render(ui());
        expectSymbols(scope ? scope() : container);
    });

    it("ControlTooltip label and description", () => {
        vi.useFakeTimers();
        const view = render(
            <TooltipProvider>
                <ControlTooltip
                    label={TEXT}
                    description={TEXT}
                    trigger={<button type="button">anchor</button>}
                />
            </TooltipProvider>
        );
        hover(view.getByRole("button", { name: "anchor" }));
        act(() => {
            vi.advanceTimersByTime(1100);
        });
        expectSymbols(
            document.querySelector('[data-slot="tooltip-content"]')!,
            2
        );
    });

    it("HotkeyTooltip label", () => {
        vi.useFakeTimers();
        const view = render(
            <TooltipProvider>
                <HotkeyTooltip
                    label={TEXT}
                    hotkey={HOTKEYS.passPriority}
                    trigger={<button type="button">anchor</button>}
                />
            </TooltipProvider>
        );
        hover(view.getByRole("button", { name: "anchor" }));
        act(() => {
            vi.advanceTimersByTime(100);
        });
        expectSymbols(document.querySelector('[data-slot="tooltip-content"]')!);
    });
});
