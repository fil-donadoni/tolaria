import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { formatOracleText } from "../oracle-text";

describe("formatOracleText", () => {
    it("replaces {X} tokens with symbol <img> elements", () => {
        const { container } = render(<>{formatOracleText("{T}: Add {G}.")}</>);
        const imgs = container.querySelectorAll("img");
        expect(imgs.length).toBe(2);
        expect(imgs[0].getAttribute("alt")).toBe("{T}");
        expect(imgs[1].getAttribute("alt")).toBe("{G}");
    });

    it("renders embedded \\n as a <br/> so multi-clause text stays multi-line", () => {
        // Brushland-style dual-mode mana ability: two clauses joined by \n.
        const { container } = render(
            <>
                {formatOracleText(
                    "{T}: Add {C}.\n{T}: Add {G} or {W}. This land deals 1 damage to you."
                )}
            </>
        );
        expect(container.querySelectorAll("br").length).toBe(1);
    });

    it("inserts a <br/> for each newline in plain multi-line text", () => {
        const { container } = render(<>{formatOracleText("a\nb\nc")}</>);
        expect(container.querySelectorAll("br").length).toBe(2);
        expect(container.textContent).toBe("abc");
    });

    it("returns an empty array for empty input", () => {
        expect(formatOracleText("")).toEqual([]);
    });
});
