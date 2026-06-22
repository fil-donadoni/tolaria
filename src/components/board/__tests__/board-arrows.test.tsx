// Slice #257 (PRD #249) — the new board draws its own SVG target arrows fed by
// the shared layout placements (surfaced through the arrow-anchor registry),
// not by `leader-line` sampling the DOM at an instant.
//
// These tests assert observable output: given a set of published anchor points
// (the same data that positions the cards) the SVG layer renders one <path> per
// stack-item→target with endpoints at those points, and the path re-targets
// when a placement moves — proving the arrow tracks an animating card.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useEffect } from "react";
import { ArrowAnchorProvider } from "~/hooks/useArrowAnchors";
import { useArrowAnchors, type AnchorKind } from "~/hooks/arrowAnchorContext";
import type { AnchorPoint } from "~/lib/target-arrow-geometry";
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
