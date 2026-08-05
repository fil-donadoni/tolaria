// Issue #2056 defect 3 amplification: `AppHeader` needs to hide this
// decorative frame under `short-viewport:` without touching its four
// existing callers (`panel.tsx`, `player-nameplate.tsx`, `app-header.tsx`,
// the design-system census) — an optional `className` merged onto the
// frame's own root, additive only.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import CornerFiligreeFrame from "../corner-filigree-frame";

afterEach(() => cleanup());

describe("CornerFiligreeFrame — className passthrough (issue #2056)", () => {
    it("merges an extra className onto its own root", () => {
        const { container } = render(
            <CornerFiligreeFrame
                overlay
                size={32}
                subtle
                className="short-viewport:hidden"
            />
        );
        const root = container.querySelector(
            '[data-slot="corner-filigree-frame"]'
        ) as HTMLElement;
        const classes = root.className.split(/\s+/);
        expect(classes).toContain("short-viewport:hidden");
        // Existing overlay-mode classes are preserved, not replaced.
        expect(classes).toContain("absolute");
        expect(classes).toContain("inset-0");
    });

    it("omitting className changes nothing for an existing caller", () => {
        const { container } = render(<CornerFiligreeFrame overlay size={32} />);
        const root = container.querySelector(
            '[data-slot="corner-filigree-frame"]'
        ) as HTMLElement;
        expect(root.className.split(/\s+/)).toEqual([
            "pointer-events-none",
            "absolute",
            "inset-0",
        ]);
    });
});
