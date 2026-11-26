import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { formatOracleText, withSymbols } from "../oracle-text";

describe("formatOracleText", () => {
    it("replaces {X} tokens with symbol <img> elements named by their spoken name", () => {
        const { container } = render(<>{formatOracleText("{T}: Add {G}.")}</>);
        const imgs = container.querySelectorAll("img");
        expect(imgs.length).toBe(2);
        expect(imgs[0].getAttribute("alt")).toBe("tap");
        expect(imgs[0].getAttribute("data-symbol")).toBe("{T}");
        expect(imgs[1].getAttribute("alt")).toBe("green mana");
        expect(container.textContent).not.toContain("{");
    });

    it("leaves unmappable brace content as plain text, unchanged (issue #9834)", () => {
        const { container } = render(
            <>{formatOracleText("set {foo} then {T}")}</>
        );
        expect(container.querySelectorAll("img").length).toBe(1);
        expect(container.textContent).toBe("set {foo} then ");
    });

    it("gives a symbol-only row a non-empty accessible name", () => {
        const { getByRole } = render(
            <button>{formatOracleText("{2}{R}")}</button>
        );
        // The accessible name is computed from the images' alt; the second
        // symbol's leading space keeps the two names apart.
        expect(
            getByRole("button", { name: "2 generic mana red mana" })
        ).toBeTruthy();
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

describe("withSymbols", () => {
    it("returns content without a mappable token as-is", () => {
        expect(withSymbols("Pass")).toBe("Pass");
        const arr = ["a ", "{foo}"];
        expect(withSymbols(arr)).toBe(arr);
    });

    it("parses the strings among mixed children and keeps the elements", () => {
        const { container } = render(
            <p>{withSymbols(["Pay ", <b key="b">now</b>, " {R}"])}</p>
        );
        expect(container.querySelectorAll("img").length).toBe(1);
        expect(container.querySelector("b")?.textContent).toBe("now");
        expect(container.textContent).toBe("Pay now ");
    });
});
