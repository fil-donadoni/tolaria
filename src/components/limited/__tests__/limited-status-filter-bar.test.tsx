// The status chips live in ONE non-wrapping horizontal scroller (issue #3684)
// so 44px chips never stack into a multi-row band on a phone.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import LimitedStatusFilterBar from "../limited-status-filter-bar";
import { LIMITED_EVENT_STATUS_CHIPS } from "~/lib/limitedEventStatus";

afterEach(() => {
    cleanup();
});

const counts = Object.fromEntries(
    LIMITED_EVENT_STATUS_CHIPS.map((c) => [c, 1])
) as Record<(typeof LIMITED_EVENT_STATUS_CHIPS)[number], number>;

describe("LimitedStatusFilterBar — one scrollable row (issue #3684)", () => {
    it("is a non-wrapping, x-scrolling group holding every chip", () => {
        render(
            <LimitedStatusFilterBar
                value={undefined}
                counts={counts}
                onChange={vi.fn()}
            />
        );
        const group = screen.getByRole("group", { name: "Filter by status" });
        expect(group.className).toContain("flex-nowrap");
        expect(group.className).toContain("overflow-x-auto");
        expect(group.className).toContain("overscroll-x-contain");
        expect(group.className).not.toContain("flex-wrap ");
        expect(group.querySelectorAll("button")).toHaveLength(
            LIMITED_EVENT_STATUS_CHIPS.length
        );
    });

    it("keeps single-select semantics: pressing the active chip clears", () => {
        const onChange = vi.fn();
        const first = LIMITED_EVENT_STATUS_CHIPS[0]!;
        render(
            <LimitedStatusFilterBar
                value={first}
                counts={counts}
                onChange={onChange}
            />
        );
        const pressed = screen.getAllByRole("button", { pressed: true });
        expect(pressed).toHaveLength(1);
        fireEvent.click(pressed[0]!);
        expect(onChange).toHaveBeenCalledWith(undefined);
    });
});
