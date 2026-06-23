// Shared ambient page ground (PRD #589, issue #596). Generalises the
// Battlefield ambient recipe so the Lobby and other pages share one
// ambient-vs-signal split: a stack of inert atmosphere layers behind the
// opaque signal panels. These assertions guard the load-bearing invariants —
// it must be inert to pointer events (never intercept foreground interaction),
// hidden from assistive tech, and carry the art frame from the lobby pool.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import AmbientPageGround from "../ambient-page-ground";

afterEach(cleanup);

describe("AmbientPageGround (issue #596)", () => {
    it("is inert to pointer events so foreground panels stay interactive", () => {
        const { container } = render(<AmbientPageGround />);
        const root = container.querySelector("[data-ambient-ground]");
        expect(root).not.toBeNull();
        expect(root!.className).toContain("pointer-events-none");
    });

    it("is hidden from assistive tech (decorative atmosphere only)", () => {
        const { container } = render(<AmbientPageGround />);
        const root = container.querySelector("[data-ambient-ground]")!;
        expect(root.getAttribute("aria-hidden")).toBe("true");
    });

    it("paints a faint, decorative fantasy art frame from the lobby pool", () => {
        const { container } = render(<AmbientPageGround />);
        const img = container.querySelector("img")!;
        expect(img.getAttribute("src")).toMatch(/^\/img\/lobby-bg\/\d+\.webp$/);
        // empty alt + aria-hidden ⇒ decorative, not announced
        expect(img.getAttribute("alt")).toBe("");
        expect(img.getAttribute("aria-hidden")).toBe("true");
    });

    it("renders the arcane ring by default but omits it when ring={false}", () => {
        const { container: withRing } = render(<AmbientPageGround ring />);
        const { container: noRing } = render(
            <AmbientPageGround ring={false} />
        );
        // The ring is the only conic-gradient layer; count children.
        const ringChildren = withRing.querySelector("[data-ambient-ground]")!
            .children.length;
        const noRingChildren = noRing.querySelector("[data-ambient-ground]")!
            .children.length;
        expect(ringChildren).toBe(noRingChildren + 1);
    });
});
