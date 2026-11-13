// Issue #9500 — a combat arrow (attack or block) starts on a visible origin
// socket, so the player reads where it comes FROM, not only where it ends.
// Spell / ability target arrows keep a bare start.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import BoardArrowPath from "../board-arrow-path";
import type { TargetArrow } from "~/lib/target-arrow-geometry";

afterEach(cleanup);

const IDS = { grad: "g", head: "h", shadow: "s", tail: "t" };

function arrow(kind: TargetArrow["kind"]): TargetArrow {
    return {
        key: `${kind}:a->b`,
        kind,
        fromId: "a",
        toId: "b",
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
        path: "M 0 0 L 100 0",
    };
}

function core(kind: TargetArrow["kind"]) {
    const { container } = render(
        <svg>
            <BoardArrowPath
                arrow={arrow(kind)}
                strength="normal"
                dimmed={false}
                dimOpacity={0.14}
                ids={IDS}
            />
        </svg>
    );
    return container.querySelector("path[data-arrow-key]");
}

describe("BoardArrowPath origin socket (issue #9500)", () => {
    it("a combat arrow starts on the socket marker", () => {
        expect(core("combat")?.getAttribute("marker-start")).toBe("url(#t)");
    });

    it("a target arrow has no socket", () => {
        expect(core("target")?.getAttribute("marker-start")).toBeNull();
    });
});
