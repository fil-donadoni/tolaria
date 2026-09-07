import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    cycleTheme,
    getTheme,
    initTheme,
    onThemeChange,
    resolvedTheme,
    setTheme,
} from "../theme";

/**
 * The theme store (PRD #3148 S1).
 *
 * The property under test is that the toggle has THREE states, because that is
 * what the port added and what a two-state assertion would silently let
 * regress: "system" is a real answer, and a cycle that skipped it would leave
 * an operator who once pressed the button unable to get back to following
 * their OS.
 */

const STORAGE_KEY = "tolaria.dashboard.theme";

/** happy-dom has no `matchMedia`. The tests that care about the SYSTEM half
 *  install their own; the rest just need it not to throw. */
function stubMatchMedia(prefersDark: boolean) {
    vi.stubGlobal(
        "matchMedia",
        (query: string) =>
            ({
                matches: prefersDark && query.includes("dark"),
                media: query,
                addEventListener: () => {},
                removeEventListener: () => {},
            }) as unknown as MediaQueryList
    );
}

beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
    stubMatchMedia(false);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("theme — three states, not two", () => {
    it("cycles light → dark → system → light, and every state is reachable", () => {
        setTheme("light");
        expect(getTheme()).toBe("light");
        cycleTheme();
        expect(getTheme()).toBe("dark");
        cycleTheme();
        expect(getTheme()).toBe("system");
        cycleTheme();
        expect(getTheme()).toBe("light");
    });

    it("expresses `system` as the ABSENCE of data-theme — the CSS reads that, and an attribute of 'system' would match no token block", () => {
        setTheme("system");
        expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
        setTheme("dark");
        expect(document.documentElement.getAttribute("data-theme")).toBe(
            "dark"
        );
    });

    it("resolves `system` against the OS rather than defaulting to light", () => {
        setTheme("system");
        stubMatchMedia(true);
        expect(resolvedTheme()).toBe("dark");
        stubMatchMedia(false);
        expect(resolvedTheme()).toBe("light");
    });
});

describe("theme — the choice survives a reload", () => {
    it("persists the choice and restores it on init", () => {
        setTheme("dark");
        expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
        document.documentElement.removeAttribute("data-theme");
        initTheme(new URLSearchParams(""));
        expect(getTheme()).toBe("dark");
    });

    it("a ?theme= PIN wins for the page but never overwrites the preference — a pasted link must not rewrite the reader's choice", () => {
        setTheme("dark");
        initTheme(new URLSearchParams("theme=light"));
        expect(getTheme()).toBe("light");
        expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    });

    it("ignores a junk ?theme= and a junk stored value rather than applying them", () => {
        localStorage.setItem(STORAGE_KEY, "chartreuse");
        initTheme(new URLSearchParams("theme=chartreuse"));
        expect(getTheme()).toBe("system");
    });

    it("comes up with a working theme when storage throws — a blocked cookie jar must not blank the dashboard", () => {
        const getItem = vi
            .spyOn(Storage.prototype, "getItem")
            .mockImplementation(() => {
                throw new Error("blocked");
            });
        const setItem = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new Error("blocked");
            });
        expect(() => initTheme(new URLSearchParams(""))).not.toThrow();
        expect(() => setTheme("dark")).not.toThrow();
        expect(getTheme()).toBe("dark");
        getItem.mockRestore();
        setItem.mockRestore();
    });
});

describe("theme — History is told", () => {
    it("notifies listeners on every change, so the SVG charts redraw with the new colours", () => {
        const seen: string[] = [];
        const off = onThemeChange(() => seen.push(getTheme()));
        setTheme("dark");
        cycleTheme();
        off();
        setTheme("light");
        expect(seen).toEqual(["dark", "system"]);
    });
});
