// Slice #257 (PRD #249) — the new board draws its own SVG target arrows fed by
// the shared layout placements (surfaced through the arrow-anchor registry),
// not by `leader-line` sampling the DOM at an instant.
//
// These tests assert observable output: given a set of published anchor points
// (the same data that positions the cards) the SVG layer renders one <path> per
// stack-item→target with endpoints at those points, and the path re-targets
// when a placement moves — proving the arrow tracks an animating card.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { ArrowHighlightProvider } from "~/hooks/ArrowHighlightProvider";
import { useArrowHighlight } from "~/hooks/arrowHighlightContext";
import { useEffect } from "react";
import { ArrowAnchorProvider } from "~/hooks/useArrowAnchors";
import {
    ArrowAnchorContext,
    useArrowAnchors,
    type AnchorKind,
    type ArrowAnchorContextValue,
} from "~/hooks/arrowAnchorContext";
import {
    emptyAnchorMap,
    type AnchorMap,
    type AnchorPoint,
} from "~/lib/target-arrow-geometry";
import type { StackItem } from "~/types/game";
import BoardArrows from "../board-arrows";

function stackItem(id: string, targets?: StackItem["targets"]): StackItem {
    return {
        id,
        card: { id: "def" },
        castById: "p1",
        targets,
    } as unknown as StackItem;
}

type Published = { kind: AnchorKind; id: string; point: AnchorPoint };

/** Publishes a fixed set of anchors into the registry on mount/update, so the
 *  arrow layer renders from the same registry the real zones feed. */
function Publisher({ entries }: { entries: Published[] }) {
    const registry = useArrowAnchors();
    useEffect(() => {
        if (!registry) return;
        for (const e of entries) registry.publish(e.kind, e.id, e.point);
    }, [registry, entries]);
    return null;
}

function renderArrows(stack: StackItem[], entries: Published[]) {
    return render(
        // The board root marker so the DOM-anchor publisher resolves a root.
        <div data-board-root>
            <ArrowAnchorProvider>
                <Publisher entries={entries} />
                <BoardArrows stack={stack} />
            </ArrowAnchorProvider>
        </div>
    );
}

/** Pulls the endpoints back out of a path's `d` attribute. */
function endpoints(d: string) {
    const m = d.match(/^M ([-\d.]+) ([-\d.]+) .* ([-\d.]+) ([-\d.]+)$/);
    expect(m).toBeTruthy();
    return {
        from: { x: Number(m![1]), y: Number(m![2]) },
        to: { x: Number(m![3]), y: Number(m![4]) },
    };
}

describe("BoardArrows (#257)", () => {
    beforeEach(() => cleanup());

    it("renders no path when the stack is empty", () => {
        const { container } = renderArrows([], []);
        expect(container.querySelectorAll("path[data-arrow-key]")).toHaveLength(
            0
        );
    });

    it("draws an arrow from a stack item to its permanent target at the published placements", () => {
        const stack = [stackItem("s1", [{ type: "permanent", id: "perm" }])];
        const { container } = renderArrows(stack, [
            { kind: "stack", id: "s1", point: { x: 100, y: 40 } },
            { kind: "permanent", id: "perm", point: { x: 500, y: 320 } },
        ]);
        const paths = container.querySelectorAll<SVGPathElement>(
            "path[data-arrow-key]"
        );
        expect(paths).toHaveLength(1);
        const { from, to } = endpoints(paths[0].getAttribute("d")!);
        expect(from).toEqual({ x: 100, y: 40 });
        expect(to).toEqual({ x: 500, y: 320 });
    });

    it("re-targets the arrow when the target placement moves (card animating)", () => {
        const stack = [stackItem("s1", [{ type: "permanent", id: "perm" }])];
        const { container, rerender } = renderArrows(stack, [
            { kind: "stack", id: "s1", point: { x: 0, y: 0 } },
            { kind: "permanent", id: "perm", point: { x: 200, y: 200 } },
        ]);
        const before = endpoints(
            container
                .querySelector<SVGPathElement>("path[data-arrow-key]")!
                .getAttribute("d")!
        );
        expect(before.to).toEqual({ x: 200, y: 200 });

        // The permanent's placement moves (spring/tilt): re-publish, same id.
        act(() => {
            rerender(
                <div data-board-root>
                    <ArrowAnchorProvider>
                        <Publisher
                            entries={[
                                {
                                    kind: "stack",
                                    id: "s1",
                                    point: { x: 0, y: 0 },
                                },
                                {
                                    kind: "permanent",
                                    id: "perm",
                                    point: { x: 360, y: 260 },
                                },
                            ]}
                        />
                        <BoardArrows stack={stack} />
                    </ArrowAnchorProvider>
                </div>
            );
        });
        const after = endpoints(
            container
                .querySelector<SVGPathElement>("path[data-arrow-key]")!
                .getAttribute("d")!
        );
        expect(after.to).toEqual({ x: 360, y: 260 });
    });

    it("draws one path per target for a multi-target stack item", () => {
        const stack = [
            stackItem("s1", [
                { type: "permanent", id: "a" },
                { type: "player", id: "p2" },
            ]),
        ];
        const { container } = renderArrows(stack, [
            { kind: "stack", id: "s1", point: { x: 0, y: 0 } },
            { kind: "permanent", id: "a", point: { x: 10, y: 10 } },
            { kind: "player", id: "p2", point: { x: 20, y: 20 } },
        ]);
        expect(container.querySelectorAll("path[data-arrow-key]")).toHaveLength(
            2
        );
    });

    it("is a pass-through overlay (pointer-events none, aria-hidden)", () => {
        const { container } = renderArrows([], []);
        const svg = container.querySelector<SVGSVGElement>(
            "[data-testid='board-arrows']"
        )!;
        expect(svg.getAttribute("aria-hidden")).toBe("true");
        expect(svg.getAttribute("class")).toContain("pointer-events-none");
    });
});

/** A fixed-size rect anchored at (x, y) — center is (x + 50, y + 20). */
function fixedRect(x: number, y: number): DOMRect {
    return {
        left: x,
        top: y,
        width: 100,
        height: 40,
        right: x + 100,
        bottom: y + 40,
        x,
        y,
        toJSON: () => ({}),
    } as DOMRect;
}

describe("BoardArrows — sibling zone-chip anchor wiring (#1815 review fixup round 3, finding 2)", () => {
    // `BoardArrows` hardcodes `extraRootSelector="[data-controller-bottom-bar]"`
    // in its own `useDomAnchorPublisher` call (see that call's comment in
    // `board-arrows.tsx`) so the portrait bar's viewer zone chips — mounted as
    // a SIBLING of `data-board-root` in `board.tsx`, not a descendant of it —
    // still get scanned for `data-arrow-anchor-graveyard`. Before this test,
    // removing that argument left all other tests green: the hook itself is
    // covered (`useDomAnchorPublisher.test.tsx`'s "second root" describe
    // block, using a hand-built harness) and `BoardArrows` is covered (this
    // file, using manual `registry.publish` calls, never the DOM scan) — but
    // nothing exercised the two TOGETHER through the real component. Mutation
    // target: delete the `"[data-controller-bottom-bar]"` argument from
    // `board-arrows.tsx`'s `useDomAnchorPublisher` call and THIS test goes
    // red while every other test in this file and in
    // `useDomAnchorPublisher.test.tsx` stays green.
    it("publishes the viewer's graveyard anchor from a data-controller-bottom-bar sibling of data-board-root", () => {
        const anchors: AnchorMap = emptyAnchorMap();
        const value: ArrowAnchorContextValue = {
            publish: (kind, id, point) => {
                anchors[kind][id] = point;
            },
            unpublish: (kind, id) => {
                delete anchors[kind][id];
            },
            anchors,
        };

        render(
            <ArrowAnchorContext.Provider value={value}>
                {/* The board root — `BoardArrows`' own `<svg>` mounts here,
                    and its internal `useDomAnchorPublisher` call resolves
                    THIS element as `board` via `.closest("[data-board-root]")`. */}
                <div
                    data-board-root
                    ref={(el) => {
                        if (el)
                            el.getBoundingClientRect = () => fixedRect(0, 0);
                    }}
                >
                    <BoardArrows stack={[]} />
                </div>
                {/* A SIBLING of `data-board-root`, not a descendant — exactly
                    the shape `ControllerBottomBar` mounts in `board.tsx`
                    (#1815 review fixup round 2). */}
                <div data-controller-bottom-bar>
                    <div
                        data-arrow-anchor-graveyard="me"
                        ref={(el) => {
                            if (el)
                                el.getBoundingClientRect = () =>
                                    fixedRect(150, 250);
                        }}
                    />
                </div>
            </ArrowAnchorContext.Provider>
        );

        // Board root rect is (0,0); the chip's center (150+50, 250+20) is
        // published unchanged — a valid, non-degenerate rect reaching the
        // registry from OUTSIDE the board root.
        expect(anchors.graveyard.me).toEqual({ x: 200, y: 270 });
    });
});

// Issue #5853 — arrows never capture a pointer event: the old invisible
// hit-stroke (`pointer-events-auto`, 18px) sat above the battlefield and
// swallowed left/right clicks on any card it crossed. Hover is now a passive
// proximity hit-test on the board root's `pointermove`.
function NodesProbe() {
    const channel = useArrowHighlight();
    const nodes = channel?.nodes;
    return (
        <output data-testid="nodes">
            {nodes ? [...nodes].sort().join(",") : "none"}
        </output>
    );
}

function CardSeeder({ id }: { id: string }) {
    const channel = useArrowHighlight();
    return (
        <div
            data-testid={`card-${id}`}
            onPointerEnter={() => channel?.setSeed({ nodeId: id })}
            onPointerLeave={() => channel?.setSeed(null)}
        />
    );
}

function renderHoverBoard(stack: StackItem[], entries: Published[]) {
    const ui = (s: StackItem[], e: Published[] = entries) => (
        <div data-board-root data-testid="board-root">
            <ArrowAnchorProvider>
                <ArrowHighlightProvider>
                    <Publisher entries={e} />
                    <CardSeeder id="bear" />
                    <NodesProbe />
                    <BoardArrows stack={s} />
                </ArrowHighlightProvider>
            </ArrowAnchorProvider>
        </div>
    );
    const result = render(ui(stack));
    return {
        ...result,
        rerenderStack: (s: StackItem[]) => result.rerender(ui(s)),
        rerenderAnchors: (e: Published[]) => result.rerender(ui(stack, e)),
    };
}

// s1 (0,0) → perm (200,0): the bezier bows to y = +36 at its control point,
// so the curve's midpoint is (100, 18).
const HOVER_STACK = [stackItem("s1", [{ type: "permanent", id: "perm" }])];
const HOVER_ANCHORS: Published[] = [
    { kind: "stack", id: "s1", point: { x: 0, y: 0 } },
    { kind: "permanent", id: "perm", point: { x: 200, y: 0 } },
];

describe("BoardArrows — arrows never capture pointer events (issue #5853)", () => {
    beforeEach(() => cleanup());

    it("no element of the arrow layer opts back into pointer events or shows a pointer cursor", () => {
        const { container } = renderArrows(HOVER_STACK, HOVER_ANCHORS);
        const svg = container.querySelector("[data-testid='board-arrows']")!;
        expect(svg.querySelectorAll("path[data-arrow-key]")).toHaveLength(1);
        for (const el of svg.querySelectorAll("*")) {
            const cls = el.getAttribute("class") ?? "";
            expect(cls).not.toMatch(/pointer-events-(auto|all|stroke)/);
            expect(cls).not.toContain("cursor-pointer");
            expect(el.getAttribute("pointer-events")).toBeNull();
        }
    });

    it("lights the relationship when the pointer is within reach of the curve, clears it away from it and on leave", () => {
        const { getByTestId } = renderHoverBoard(HOVER_STACK, HOVER_ANCHORS);
        const root = getByTestId("board-root");
        expect(getByTestId("nodes").textContent).toBe("none");

        fireEvent.pointerMove(root, { clientX: 100, clientY: 25 });
        expect(getByTestId("nodes").textContent).toBe("perm,s1");

        fireEvent.pointerMove(root, { clientX: 100, clientY: 40 });
        expect(getByTestId("nodes").textContent).toBe("none");

        fireEvent.pointerMove(root, { clientX: 100, clientY: 18 });
        expect(getByTestId("nodes").textContent).toBe("perm,s1");
        fireEvent.pointerLeave(root);
        expect(getByTestId("nodes").textContent).toBe("none");
    });

    it("arrow hover wins over a hovered card; away from the arrow the card seed is back", () => {
        const { getByTestId } = renderHoverBoard(HOVER_STACK, HOVER_ANCHORS);
        const root = getByTestId("board-root");
        // "bear" has no relationship: its own seed resolves to nothing.
        fireEvent.pointerEnter(getByTestId("card-bear"));
        fireEvent.pointerMove(root, { clientX: 100, clientY: 18 });
        expect(getByTestId("nodes").textContent).toBe("perm,s1");
        fireEvent.pointerMove(root, { clientX: 100, clientY: 60 });
        expect(getByTestId("nodes").textContent).toBe("none");
    });

    it("does not leave a stuck highlight when the hovered arrow disappears (stack item resolved)", () => {
        const { getByTestId, rerenderStack } = renderHoverBoard(
            HOVER_STACK,
            HOVER_ANCHORS
        );
        fireEvent.pointerMove(getByTestId("board-root"), {
            clientX: 100,
            clientY: 18,
        });
        expect(getByTestId("nodes").textContent).toBe("perm,s1");
        act(() => rerenderStack([]));
        expect(getByTestId("nodes").textContent).toBe("none");
    });

    it("re-tests a still pointer when the arrow moves away from it (card animating)", () => {
        const { getByTestId, rerenderAnchors } = renderHoverBoard(
            HOVER_STACK,
            HOVER_ANCHORS
        );
        fireEvent.pointerMove(getByTestId("board-root"), {
            clientX: 100,
            clientY: 18,
        });
        expect(getByTestId("nodes").textContent).toBe("perm,s1");
        act(() =>
            rerenderAnchors([
                HOVER_ANCHORS[0],
                { kind: "permanent", id: "perm", point: { x: 0, y: 300 } },
            ])
        );
        expect(getByTestId("nodes").textContent).toBe("none");
    });
});
