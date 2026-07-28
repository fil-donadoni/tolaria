// #1770 mobile QA sweep touch-target audit: the minimize glyph rendered at
// `h-6 w-6` (24px) — well under the 44px floor. The dialog header it sits in
// is dense (title text right below it), so the fix grows the HIT area via an
// invisible `::before` pseudo rather than the visible glyph.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import MinimizeChoiceButton from "../minimize-choice-button";

function renderButton(minimize = vi.fn()) {
    return render(
        <MinimizedChoiceContext
            value={{ isMinimized: false, minimize, restore: () => {} }}
        >
            <MinimizeChoiceButton className="absolute top-1.5 right-1.5" />
        </MinimizedChoiceContext>
    );
}

describe("MinimizeChoiceButton touch target (#1770 mobile QA sweep)", () => {
    it("expands the hit area via an invisible pseudo, not the visible glyph", () => {
        renderButton();
        const btn = screen.getByLabelText("Minimize choice dialog");
        expect(btn.className).toContain("h-6 w-6");
        expect(btn.className).toContain("before:-inset-2.5");
        expect(btn.className).toContain("before:content-['']");
    });

    it("still dispatches minimize through the expanded target", () => {
        const minimize = vi.fn();
        renderButton(minimize);
        screen.getByLabelText("Minimize choice dialog").click();
        expect(minimize).toHaveBeenCalledTimes(1);
    });
});
