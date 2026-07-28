// Command row geometry (variant D, #1759). The contract these tests protect is
// narrow-viewport REACHABILITY: on a 390px phone (iPhone 12/13/14/15 logical
// width — the narrowest mainstream device) every control the engine offers must
// be fully on screen and tappable.
//
// The regression they lock down: DECLARE_ATTACKERS with a wide board offers
// "Confirm Attackers (12)" in the centre slot, "Attack with all (12)" as a side
// pill and the circular Pass Turn. Laid out as ONE centred non-wrapping row of
// `shrink-0` items that is ~450px wide, which clips BOTH ends of a 390px
// viewport — Pass Turn simply could not be reached (and `justify-center` +
// overflow would have left the left end unreachable even with a scrollbar).
//
// jsdom does no layout, so the assertions are structural + width arithmetic:
// the row WRAPS (so a multi-item overflow is impossible by construction) and no
// single flex item, measured with generous per-character widths on the longest
// realistic labels, is wider than the row.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ControllerAction } from "~/hooks/useControllerActions";
import { selectCommandSlots } from "~/lib/controller-action-slots";
import ControllerCommandRow from "../controller-command-row";

/** iPhone 12/13/14/15 logical width — the narrowest mainstream phone. */
const VIEWPORT = 390;
/** The row's own `mx-3` inset, both sides. */
const ROW_INSET = 2 * 12;
const AVAILABLE = VIEWPORT - ROW_INSET;
/** `gap-2`. */
const GAP = 8;

/** Deliberately generous per-character advances for the two type scales the
 *  row uses (Beleren semibold 14px, uppercase semibold 12px) — over-estimating
 *  is what makes a passing assertion meaningful. */
const CHAR_W = { sm: 8.5, xs: 7 };

/** Estimated laid-out width of one control, from its own classes + label. */
function controlWidth(el: HTMLElement): number {
    const cls = el.className;
    if (cls.includes("w-11")) return 44; // the circular Pass Turn
    const padding = cls.includes("px-6") ? 48 : cls.includes("px-4") ? 32 : 0;
    const charW = cls.includes("text-sm") ? CHAR_W.sm : CHAR_W.xs;
    const floor = cls.includes("min-w-[11rem]") ? 176 : 0;
    return Math.max(floor, padding + (el.textContent ?? "").length * charW);
}

/** Estimated width of a flex item: a leaf control, or a group of controls. */
function itemWidth(el: HTMLElement): number {
    const children = [...el.children].filter(
        (c): c is HTMLElement => c instanceof HTMLElement
    );
    if (el.tagName === "BUTTON" || children.length === 0) {
        return controlWidth(el);
    }
    return (
        children.reduce((sum, c) => sum + itemWidth(c), 0) +
        GAP * (children.length - 1)
    );
}

/** Greedy line packing of the wrapped row, using the same width estimates.
 *  `flex-wrap` breaks to a new line as soon as the next item does not fit the
 *  remaining space — exactly this loop. */
function lineCount(row: HTMLElement): number {
    const items = [...row.children].filter(
        (c): c is HTMLElement => c instanceof HTMLElement
    );
    let lines = 1;
    let used = 0;
    for (const item of items) {
        const w = itemWidth(item);
        const packed = used === 0 ? w : used + GAP + w;
        if (packed > AVAILABLE) {
            lines += 1;
            used = w;
        } else {
            used = packed;
        }
    }
    return lines;
}

function action(over: Partial<ControllerAction> & { key: string }) {
    return {
        label: over.key,
        tone: "primary",
        onClick: () => {},
        disabled: false,
        ...over,
    } as ControllerAction;
}

/** The widest realistic state: 12 attackers declared, so both combat labels
 *  carry a two-digit count, plus the always-mounted Pass Turn. */
const DECLARE_ATTACKERS_ACTIONS: ControllerAction[] = [
    action({ key: "confirm-attackers", label: "Confirm Attackers (12)" }),
    action({ key: "attack-all", label: "Attack with all (12)" }),
    action({ key: "pass", label: "Pass" }),
    action({ key: "pass-turn", label: "Pass Turn", tone: "destructive" }),
];

function renderRow(actions: ControllerAction[]) {
    return render(<ControllerCommandRow slots={selectCommandSlots(actions)} />);
}

describe("ControllerCommandRow — fits a 390px phone (#1759)", () => {
    it("wraps instead of overflowing a centred row", () => {
        const { container } = renderRow(DECLARE_ATTACKERS_ACTIONS);
        const row = container.querySelector(
            "[data-controller-command-row]"
        ) as HTMLElement;
        // Wrapping is what makes a multi-item overflow impossible. A centred
        // NON-wrapping row (or a centred overflow-x container) clips its ends.
        expect(row.className).toContain("flex-wrap");
    });

    it("no side pill is pinned to its intrinsic width", () => {
        const { container } = renderRow(DECLARE_ATTACKERS_ACTIONS);
        const group = container.querySelector(
            "[data-controller-primary-group]"
        ) as HTMLElement;
        const pills = [
            ...(
                container.querySelector(
                    "[data-controller-command-row]"
                ) as HTMLElement
            ).children,
        ].filter((el) => el !== group);
        expect(pills.length).toBeGreaterThan(0);
        for (const pill of pills) {
            // `shrink-0` on a pill is exactly what made the row unshrinkable.
            expect(pill.className).not.toContain("shrink-0");
            expect(pill.className).toContain("truncate");
        }
    });

    it("every flex item fits the row width at the longest realistic labels", () => {
        const { container } = renderRow(DECLARE_ATTACKERS_ACTIONS);
        const row = container.querySelector(
            "[data-controller-command-row]"
        ) as HTMLElement;
        const items = [...row.children].filter(
            (c): c is HTMLElement => c instanceof HTMLElement
        );
        // Sanity: the un-wrapped row really is wider than the viewport, so the
        // wrap is load-bearing and this assertion is not vacuous.
        const flat =
            items.reduce((sum, el) => sum + itemWidth(el), 0) +
            GAP * (items.length - 1);
        expect(flat).toBeGreaterThan(AVAILABLE);

        // With the wrap on, an item is clipped only if it ALONE overflows.
        for (const item of items) {
            expect(itemWidth(item)).toBeLessThanOrEqual(AVAILABLE);
        }
    });

    it("wraps to exactly two lines in the widest state — the bar's height budget", () => {
        // The wrap is what makes the bar GROW: the side-pill line adds `h-11`
        // (#1770 mobile QA sweep touch-target floor) + `gap-2`. Two lines is
        // the height the reservation is sized for, so a future state that
        // silently packs onto a THIRD line (a longer label, an extra
        // secondary action) must fail here rather than on a phone.
        //
        // The reservation itself no longer hard-codes any of this — the bar
        // publishes its measured height as `--controller-bar-h` and the hand /
        // Zones drawer anchor to it (see controller-bar-metrics.ts) — but the
        // line count is still the thing that moves, so it stays pinned.
        const { container } = renderRow(DECLARE_ATTACKERS_ACTIONS);
        const row = container.querySelector(
            "[data-controller-command-row]"
        ) as HTMLElement;
        expect(lineCount(row)).toBe(2);
    });

    it("stays on one line when there is no secondary action", () => {
        // The baseline that makes the assertion above meaningful: with priority
        // and nothing else on offer, the bar is a single-line row.
        const { container } = renderRow([
            action({ key: "pass", label: "Pass" }),
            action({
                key: "pass-turn",
                label: "Pass Turn",
                tone: "destructive",
            }),
        ]);
        const row = container.querySelector(
            "[data-controller-command-row]"
        ) as HTMLElement;
        expect(lineCount(row)).toBe(1);
    });

    it("keeps Pass Turn reachable in the widest state", () => {
        renderRow(DECLARE_ATTACKERS_ACTIONS);
        const passTurn = screen.getByLabelText("Pass Turn");
        expect(passTurn.hasAttribute("disabled")).toBe(false);
        // It rides in the primary group with the CTA, and that group fits.
        const group = passTurn.parentElement as HTMLElement;
        expect(group.hasAttribute("data-controller-primary-group")).toBe(true);
        expect(itemWidth(group)).toBeLessThanOrEqual(AVAILABLE);
    });
});
