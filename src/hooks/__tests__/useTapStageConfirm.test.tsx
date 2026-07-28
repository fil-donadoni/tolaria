// Touch tap = stage + confirm (issue #1767, parent #1758). The hook is the
// whole decision: which pointer types get a confirmation step, when a click is
// consumed by staging vs passed through to the commit, and every path that must
// drop a stale stage. Driven here directly (no card, no mutations) so each rule
// is asserted in isolation; the through-the-component interaction tests live in
// `src/components/board/__tests__/board-hand-card.test.tsx`.
import { describe, it, expect } from "vitest";
import { act, render, fireEvent, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import {
    useTapStageConfirm,
    TAP_STAGE_KEEP_ATTR,
} from "~/hooks/useTapStageConfirm";

/** Minimal host: a "card" wired exactly the way BoardHandCard wires it, plus a
 *  committed counter so "did the click reach the commit?" is observable. */
function Host({
    enabled = true,
    resetKey = "k0",
}: {
    enabled?: boolean;
    resetKey?: string;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [committedCount, setCommittedCount] = useState(0);
    const stage = useTapStageConfirm({ enabled, resetKey, rootRef });
    return (
        <div>
            <div
                ref={rootRef}
                data-testid="card"
                data-staged={stage.staged ? "true" : "false"}
                onPointerDown={stage.onPointerDown}
                onClick={() => {
                    if (!enabled) return;
                    if (stage.consumeClick()) return;
                    setCommittedCount((n) => n + 1);
                }}
            >
                card
            </div>
            {stage.staged && (
                <div data-testid="pill" {...{ [TAP_STAGE_KEEP_ATTR]: "" }}>
                    pill
                </div>
            )}
            <div data-testid="outside">outside</div>
            <output data-testid="committed">{committedCount}</output>
        </div>
    );
}

function card() {
    return screen.getByTestId("card");
}
function staged() {
    return card().getAttribute("data-staged") === "true";
}
function committed() {
    return Number(screen.getByTestId("committed").textContent);
}
/** A full tap of the given pointer type: the pointerdown that types the
 *  gesture, then the click it produces. */
function tap(el: Element, pointerType: string) {
    fireEvent.pointerDown(el, { button: 0, pointerType });
    fireEvent.pointerUp(el, { button: 0, pointerType });
    fireEvent.click(el);
}

describe("useTapStageConfirm — touch tap stages, second tap confirms (#1767)", () => {
    it("a first touch tap stages instead of committing", () => {
        render(<Host />);
        tap(card(), "touch");
        expect(staged()).toBe(true);
        expect(committed()).toBe(0);
    });

    it("a second touch tap on the card commits and clears the stage", () => {
        render(<Host />);
        tap(card(), "touch");
        tap(card(), "touch");
        expect(committed()).toBe(1);
        expect(staged()).toBe(false);
    });

    it("a tap elsewhere un-stages without committing", () => {
        render(<Host />);
        tap(card(), "touch");
        fireEvent.pointerDown(screen.getByTestId("outside"), {
            pointerType: "touch",
        });
        expect(staged()).toBe(false);
        expect(committed()).toBe(0);
    });

    it("a press on a portal'd part of the stage does NOT count as tap-away", () => {
        render(<Host />);
        tap(card(), "touch");
        fireEvent.pointerDown(screen.getByTestId("pill"), {
            pointerType: "touch",
        });
        expect(staged()).toBe(true);
    });
});

describe("useTapStageConfirm — mouse and pen are unchanged (#1767)", () => {
    it("a mouse click commits on the FIRST click and never stages", () => {
        render(<Host />);
        tap(card(), "mouse");
        expect(committed()).toBe(1);
        expect(staged()).toBe(false);
    });

    it("a pen click commits on the FIRST click and never stages", () => {
        render(<Host />);
        tap(card(), "pen");
        expect(committed()).toBe(1);
        expect(staged()).toBe(false);
    });

    it("a click with no preceding pointerdown commits (safe default)", () => {
        render(<Host />);
        fireEvent.click(card());
        expect(committed()).toBe(1);
        expect(staged()).toBe(false);
    });

    it("a mouse click after a staged touch tap still commits", () => {
        render(<Host />);
        tap(card(), "touch");
        expect(staged()).toBe(true);
        tap(card(), "mouse");
        expect(committed()).toBe(1);
        expect(staged()).toBe(false);
    });
});

describe("useTapStageConfirm — no stale stage (#1767)", () => {
    it("drops the stage when the resetKey changes (priority / zone / turn)", () => {
        const { rerender } = render(<Host resetKey="k0" />);
        tap(card(), "touch");
        expect(staged()).toBe(true);
        rerender(<Host resetKey="k1" />);
        expect(staged()).toBe(false);
        expect(committed()).toBe(0);
    });

    it("drops the stage when the action stops being legal", () => {
        const { rerender } = render(<Host enabled />);
        tap(card(), "touch");
        expect(staged()).toBe(true);
        rerender(<Host enabled={false} />);
        expect(staged()).toBe(false);
    });

    it("a disabled card never stages and never commits", () => {
        render(<Host enabled={false} />);
        tap(card(), "touch");
        expect(staged()).toBe(false);
        expect(committed()).toBe(0);
    });

    it("unstage() clears the stage without committing", () => {
        function UnstageHost() {
            const rootRef = useRef<HTMLDivElement>(null);
            const stage = useTapStageConfirm({
                enabled: true,
                resetKey: "k",
                rootRef,
            });
            return (
                <div>
                    <div
                        ref={rootRef}
                        data-testid="card"
                        data-staged={stage.staged ? "true" : "false"}
                        onPointerDown={stage.onPointerDown}
                        onClick={() => stage.consumeClick()}
                    />
                    <button
                        data-testid="cancel"
                        onClick={() => stage.unstage()}
                    />
                </div>
            );
        }
        render(<UnstageHost />);
        tap(card(), "touch");
        expect(staged()).toBe(true);
        act(() => {
            screen.getByTestId("cancel").click();
        });
        expect(staged()).toBe(false);
    });
});
