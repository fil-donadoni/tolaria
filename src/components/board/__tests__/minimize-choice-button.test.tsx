// #1770 mobile QA sweep touch-target audit: the minimize glyph rendered at
// `h-6 w-6` (24px) — well under the 44px floor. The dialog header it sits in
// is dense (title text right below it), so the fix grows the HIT area via an
// invisible `::before` pseudo rather than the visible glyph.
//
// #1770 second review round: `top-1.5 right-1.5` (6px inset, the ORIGINAL
// real-mount className) clipped 4px off the 10px `before:-inset-2.5` overhang
// against the panel edge, delivering a ~40px hit rather than 44px. Both real
// mounts (`pending-choice-prompt.tsx`, `pile-division-picker.tsx`) now import
// the shared `MINIMIZE_BUTTON_INSET` constant (`top-2.5 right-2.5`, 10px,
// matching the overhang exactly) rather than each hardcoding their own copy —
// this test imports the SAME constant, so a caller regressing back to a
// smaller inset can only happen by editing the shared constant itself, which
// this pairing test would still catch via the overhang comparison below.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import MinimizeChoiceButton, {
    MINIMIZE_BUTTON_INSET,
} from "../minimize-choice-button";

// The real-mount className (`pending-choice-prompt.tsx`,
// `pile-division-picker.tsx`) — built from the SAME shared constant the real
// mounts import, so this test can't drift from production by hardcoding its
// own copy of the inset value.
const REAL_MOUNT_CLASSNAME = `absolute ${MINIMIZE_BUTTON_INSET}`;

function renderButton(minimize = vi.fn()) {
    return render(
        <MinimizedChoiceContext
            value={{ isMinimized: false, minimize, restore: () => {} }}
        >
            <MinimizeChoiceButton className={REAL_MOUNT_CLASSNAME} />
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

    // #1770 second review round: pins the inset/overhang PAIRING itself,
    // not just each side's literal value — a caller inset smaller than the
    // component's own overhang clips the delivered hit target below 44px
    // regardless of which side regresses.
    it("pins the caller inset >= the pseudo-hit overhang (no edge-clip regression)", () => {
        renderButton();
        const btn = screen.getByLabelText("Minimize choice dialog");
        const overhangMatch = btn.className.match(/before:-inset-([\d.]+)/);
        const topMatch = REAL_MOUNT_CLASSNAME.match(/(?:^|\s)top-([\d.]+)\b/);
        const rightMatch = REAL_MOUNT_CLASSNAME.match(
            /(?:^|\s)right-([\d.]+)\b/
        );
        expect(overhangMatch).not.toBeNull();
        expect(topMatch).not.toBeNull();
        expect(rightMatch).not.toBeNull();
        const overhang = Number(overhangMatch![1]);
        const topInset = Number(topMatch![1]);
        const rightInset = Number(rightMatch![1]);
        expect(topInset).toBeGreaterThanOrEqual(overhang);
        expect(rightInset).toBeGreaterThanOrEqual(overhang);
    });
});
