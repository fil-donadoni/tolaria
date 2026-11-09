// Issue #7425 — `C` toggles the view-only promptCollapsed flag; a new prompt
// (key change) re-expands it.
import { describe, it, expect } from "vitest";
import { renderHook, act, fireEvent } from "@testing-library/react";
import { render, screen } from "@testing-library/react";
import {
    usePromptCollapsedState,
    PromptCollapsedContext,
} from "../usePromptCollapsed";
import { usePromptCollapseHotkey } from "../usePromptCollapseHotkey";
import CollapsedPromptPill from "~/components/board/collapsed-prompt-pill";

function Harness({ promptKey }: { promptKey: string }) {
    const state = usePromptCollapsedState(promptKey);
    usePromptCollapseHotkey(state.toggle);
    return (
        <PromptCollapsedContext value={state}>
            {state.collapsed ? (
                <CollapsedPromptPill
                    title="Stack (1)"
                    onExpand={state.expand}
                />
            ) : (
                <div>prompt body</div>
            )}
            <input aria-label="note" />
        </PromptCollapsedContext>
    );
}

describe("promptCollapsed (issue #7425)", () => {
    it("C hides the body and keeps the pill; C again restores", () => {
        render(<Harness promptKey="a" />);
        fireEvent.keyDown(window, { key: "c" });
        expect(screen.queryByText("prompt body")).toBeNull();
        expect(screen.getByText("Stack (1)")).toBeTruthy();
        expect(screen.getByText("C to expand")).toBeTruthy();
        fireEvent.keyDown(window, { key: "C" });
        expect(screen.getByText("prompt body")).toBeTruthy();
    });

    it("ignores modifiers, repeat and editable targets", () => {
        render(<Harness promptKey="a" />);
        fireEvent.keyDown(window, { key: "c", ctrlKey: true });
        fireEvent.keyDown(window, { key: "c", repeat: true });
        fireEvent.keyDown(screen.getByLabelText("note"), { key: "c" });
        expect(screen.getByText("prompt body")).toBeTruthy();
    });

    it("a new prompt key re-expands", () => {
        const { result, rerender } = renderHook(
            ({ k }) => usePromptCollapsedState(k),
            { initialProps: { k: "a" } }
        );
        act(() => result.current.toggle());
        expect(result.current.collapsed).toBe(true);
        rerender({ k: "b" });
        expect(result.current.collapsed).toBe(false);
    });
});
