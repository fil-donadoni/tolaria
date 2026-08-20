// `/` focuses search (issue #2593, ADR 0101 §6 keyboard model).
//
// The shortcut lives in the component that owns the input, so it cannot drift
// away from its target and every surface mounting a SearchBar gets it without
// opting in. The interesting half is the admission test — a shortcut on a
// printable character is only tolerable if it stays typeable.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import SearchBar from "../search-bar";

function renderBar(value = "") {
    const onChange = vi.fn();
    const result = render(<SearchBar value={value} onChange={onChange} />);
    const input = result.container.querySelector("input")!;
    return { ...result, input, onChange };
}

afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
});

describe("SearchBar keyboard shortcut (issue #2593)", () => {
    it("`/` focuses the search input from anywhere on the surface", () => {
        const { input } = renderBar();
        expect(document.activeElement).not.toBe(input);
        fireEvent.keyDown(window, { key: "/" });
        expect(document.activeElement).toBe(input);
    });

    it("stays typeable — `/` pressed inside a field is just a slash", () => {
        const { input } = renderBar();
        const other = document.createElement("input");
        document.body.append(other);
        other.focus();
        fireEvent.keyDown(other, { key: "/" });
        expect(document.activeElement).toBe(other);
        expect(document.activeElement).not.toBe(input);
    });

    it("defers to an open dialog", () => {
        const { input } = renderBar();
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        document.body.append(dialog);
        fireEvent.keyDown(window, { key: "/" });
        expect(document.activeElement).not.toBe(input);
    });

    it("leaves browser and OS chords alone", () => {
        const { input } = renderBar();
        fireEvent.keyDown(window, { key: "/", metaKey: true });
        fireEvent.keyDown(window, { key: "/", ctrlKey: true });
        expect(document.activeElement).not.toBe(input);
    });

    it("Escape inside the box gives the keyboard back to the surface", () => {
        const { input } = renderBar();
        fireEvent.keyDown(window, { key: "/" });
        expect(document.activeElement).toBe(input);
        fireEvent.keyDown(input, { key: "Escape" });
        expect(document.activeElement).not.toBe(input);
    });

    it("names the input for assistive tech", () => {
        const { input } = renderBar();
        expect(input.getAttribute("aria-label")).toBe("Search cards");
    });

    it("stops listening once unmounted", () => {
        const { input, unmount } = renderBar();
        unmount();
        fireEvent.keyDown(window, { key: "/" });
        expect(document.activeElement).not.toBe(input);
    });
});
