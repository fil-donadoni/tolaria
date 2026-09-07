import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    DEFAULT_VIEW,
    getView,
    subscribeToView,
    switchView,
    viewFromParams,
} from "../view";

/**
 * The view store (PRD #3148 S1).
 *
 * `?view=` is a link people paste, so the two properties worth guarding are
 * that switching PRESERVES every other parameter and that it does not grow the
 * history stack. Both were true of `tabs.js` and both are the kind of thing a
 * port loses silently: a `history.replaceState(null, "", "?view=now")` reads
 * correctly and throws the whole filter state away.
 */

const FULL_QUERY =
    "?table=agent_runs&metric=total_seconds&split=role&from=2026-06-24&to=2026-09-06&theme=dark&view=now";

beforeEach(() => {
    history.replaceState(null, "", FULL_QUERY);
});

describe("view — the URL is the state", () => {
    it("reads the view out of the query, defaulting to Now", () => {
        expect(viewFromParams(new URLSearchParams("view=history"))).toBe(
            "history"
        );
        expect(viewFromParams(new URLSearchParams(""))).toBe(DEFAULT_VIEW);
        expect(viewFromParams(new URLSearchParams("view=nonsense"))).toBe(
            DEFAULT_VIEW
        );
    });

    it("switching preserves every OTHER parameter — a shared link carries a filter state, not just a tab", () => {
        switchView("history");
        const params = new URLSearchParams(location.search);
        expect(params.get("view")).toBe("history");
        expect(params.get("table")).toBe("agent_runs");
        expect(params.get("metric")).toBe("total_seconds");
        expect(params.get("split")).toBe("role");
        expect(params.get("from")).toBe("2026-06-24");
        expect(params.get("to")).toBe("2026-09-06");
        expect(params.get("theme")).toBe("dark");
    });

    it("replaces rather than pushes — the back button leaves the dashboard, it does not walk a stack of tab clicks", () => {
        const replace = vi.spyOn(history, "replaceState");
        const push = vi.spyOn(history, "pushState");
        switchView("history");
        expect(replace).toHaveBeenCalledTimes(1);
        expect(push).not.toHaveBeenCalled();
        replace.mockRestore();
        push.mockRestore();
    });

    it("notifies subscribers, so a keystroke and a click cannot leave the tabs disagreeing with the URL", () => {
        let notified = 0;
        const off = subscribeToView(() => (notified += 1));
        switchView("history");
        expect(notified).toBe(1);
        expect(getView()).toBe("history");
        off();
        switchView("now");
        expect(notified).toBe(1);
    });
});
