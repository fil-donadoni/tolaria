// iOS long-press (issue #9814): Chrome for iOS opens its native image menu
// over the preview unless `-webkit-touch-callout: none` sits on the pressed
// host. The host is the tilt root on the board (a TAPPED permanent's art
// lives in an inert rotated layer, so the inner image can't carry it) and
// the container elsewhere. ADR 0009 (long-press model) is unchanged.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import CardPreview from "../card-preview";
import { resetPreviewSingleton } from "../card-preview-singleton";

const callout = (el: HTMLElement) =>
    el.style.getPropertyValue("-webkit-touch-callout");

function renderOnBoard(tapped: boolean, holdPreview = true) {
    return render(
        <div data-card-tilt-root="" data-testid="tilt">
            <div data-tap-visual={tapped ? "tapped" : undefined}>
                <CardPreview
                    cardId="bolt"
                    cardName="Lightning Bolt"
                    holdPreview={holdPreview}
                >
                    <img alt="face" />
                </CardPreview>
            </div>
        </div>
    );
}

describe("CardPreview touch-callout suppression (issue #9814)", () => {
    afterEach(() => {
        cleanup();
        resetPreviewSingleton();
    });

    it.each([false, true])(
        "board permanent (tapped=%s): tilt-root host carries the rule",
        (tapped) => {
            const { getByTestId } = renderOnBoard(tapped);
            const host = getByTestId("tilt");
            expect(callout(host)).toBe("none");
            expect(host.style.getPropertyValue("user-select")).toBe("none");
        }
    );

    it("off the board: the container itself carries the rule", () => {
        const { container } = render(
            <CardPreview cardId="bolt" cardName="Lightning Bolt">
                <div>face</div>
            </CardPreview>
        );
        expect(callout(container.firstElementChild as HTMLElement)).toBe(
            "none"
        );
    });

    it("editing surface (holdPreview off) is covered too", () => {
        const { getByTestId } = renderOnBoard(false, false);
        expect(callout(getByTestId("tilt"))).toBe("none");
    });
});
