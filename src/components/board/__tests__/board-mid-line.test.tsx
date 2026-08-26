// The mid-board line (ADR 0103 §1, issue #2727).
//
// The load-bearing claim this file guards is NOT "a line renders" — it is that
// drawing the line costs the ADR 0101 band budget nothing. The midline was a
// pure CSS-custom-property boundary before this slice (nothing painted it), so
// the tempting implementation is a flex child between the two battlefield
// bands — which would steal band height, re-derive every reservation in
// `portrait-board-bands.ts` / `landscape-board-bands.ts`, and red the
// "band budget is derived, not hand-tuned" suite. The assertions below pin the
// three properties that make that impossible: `absolute` (out of flow, so no
// parent's layout sees it), `h-px` (never a band-sized box), and
// `pointer-events-none` (a 1px strip across the front row of both battlefields
// must not swallow a tap — the #1760 bug class).
//
// It also pins that the line reads the SAME custom property each viewport
// mode's bands tile against, rather than a hand-picked offset that could drift
// from the boundary it claims to draw.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
    PORTRAIT_MIDLINE_VAR,
    PORTRAIT_VIEWER_BATTLEFIELD_BAND,
} from "~/lib/portrait-board-bands";
import {
    LANDSCAPE_MIDLINE_VAR,
    LANDSCAPE_VIEWER_BATTLEFIELD_BAND,
} from "~/lib/landscape-board-bands";
import BoardMidLine from "../board-mid-line";

afterEach(cleanup);

function renderLine(
    props: Partial<React.ComponentProps<typeof BoardMidLine>> = {}
) {
    const { container } = render(
        <BoardMidLine
            isPortrait={false}
            landscapeCompact={false}
            hot={false}
            {...props}
        />
    );
    return container.querySelector<HTMLElement>("[data-board-mid-line]")!;
}

describe("the line costs the ADR 0101 band budget nothing", () => {
    it("is absolutely positioned, one pixel tall, and never hit-tested", () => {
        const line = renderLine();
        expect(line).toBeTruthy();
        expect(line.className).toContain("absolute");
        expect(line.className).toContain("h-px");
        expect(line.className).toContain("pointer-events-none");
    });
});

describe("the line is drawn ON the boundary its bands tile against", () => {
    it("portrait reads the same --portrait-midline the battlefield bands do", () => {
        const line = renderLine({ isPortrait: true });
        expect(line.className).toContain(`top-[var(${PORTRAIT_MIDLINE_VAR})]`);
        // The same literal the viewer battlefield band anchors its TOP to —
        // if that constant is ever renamed, this fails rather than silently
        // drawing a line at a boundary nothing tiles against.
        expect(PORTRAIT_VIEWER_BATTLEFIELD_BAND).toContain(
            `top-[var(${PORTRAIT_MIDLINE_VAR})]`
        );
    });

    it("landscape-compact reads --landscape-midline, and insets to the same rails", () => {
        const line = renderLine({ landscapeCompact: true });
        expect(line.className).toContain(`top-[var(${LANDSCAPE_MIDLINE_VAR})]`);
        expect(LANDSCAPE_VIEWER_BATTLEFIELD_BAND).toContain(
            `top-[var(${LANDSCAPE_MIDLINE_VAR})]`
        );
        // Never under the seat gutter or the pile/control rail.
        expect(line.className).toContain("left-[var(--landscape-side-gutter)]");
        expect(line.className).toContain("right-[var(--landscape-right-rail)]");
    });

    it("desktop sits at the flat 50% its two h-[32%] bands meet at", () => {
        const line = renderLine();
        expect(line.className).toContain("top-1/2");
        expect(line.className).not.toContain("--portrait-midline");
        expect(line.className).not.toContain("--landscape-midline");
    });
});

describe("the line warms to signal-opponent while an attack is live (CR 508)", () => {
    it("rests as a hairline", () => {
        const line = renderLine({ hot: false });
        expect(line.className).toContain("via-[var(--hairline-strong)]");
        expect(line.className).not.toContain("via-signal-opponent");
        expect(line.getAttribute("data-hot")).toBeNull();
    });

    it("warms, and says so in an attribute the ui-gate probe can read", () => {
        const line = renderLine({ hot: true });
        expect(line.className).toContain("via-signal-opponent");
        expect(line.className).not.toContain("via-[var(--hairline-strong)]");
        expect(line.getAttribute("data-hot")).toBe("true");
    });
});
