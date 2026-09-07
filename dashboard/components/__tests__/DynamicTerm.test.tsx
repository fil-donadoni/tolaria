// Assertions read the DOM directly rather than through jest-dom's matchers —
// see the note in `Term.test.tsx`.
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DynamicTerm } from "../DynamicTerm";
import { InfoMark } from "../InfoMark";
import { MergeTick } from "../now/MergeTick";
import { GLOSSARY, lookupTerm } from "../../glossary";

/**
 * `<DynamicTerm>` — the glossary's RUNTIME door (PRD #3148 S2), and the
 * component that replaced `scripts/dashboard/tooltip.js` (#2629).
 *
 * ── WHAT THIS FILE INHERITED (PRD #3148 S4) ───────────────────────────────
 *
 * `scripts/__tests__/dashboard-glossary.test.ts` drove the vanilla engine
 * through real pointer, focus and keyboard events, because #2629's acceptance
 * criteria are behavioural: a term must EXPLAIN rather than restate, must be
 * reachable by keyboard, must be dismissible with Escape, must keep the
 * element's own text, and must never paint its label over a control that has
 * none by design. Each of those assertions survives here, against the render
 * site that replaced the scanner. What did not survive is the machinery those
 * assertions needed and the port removed: `enhanceTerms` running twice, a
 * `MutationObserver` picking up a term rendered after install, and
 * `tooltipHtml` escaping glossary text by hand. A React tree has a render
 * site, renders once per state, and escapes text nodes — those three are
 * structural now, not behaviours to guard.
 */

const renderTerm = (term: string, children = "x") =>
    render(
        <TooltipProvider>
            <DynamicTerm term={term}>{children}</DynamicTerm>
        </TooltipProvider>
    );

const hover = (el: HTMLElement) => {
    fireEvent.pointerEnter(el, { pointerType: "mouse" });
    fireEvent.mouseEnter(el);
};

const unhover = (el: HTMLElement) => {
    fireEvent.pointerLeave(el, { pointerType: "mouse" });
    fireEvent.mouseLeave(el);
};

describe("DynamicTerm — labels and explains a term named at runtime", () => {
    it("explains a term on hover, and stops when the pointer leaves", async () => {
        renderTerm("cmd_bucket", "command family");
        const trigger = screen.getByText("command family");
        hover(trigger);
        await waitFor(() =>
            expect(screen.getByText(GLOSSARY.cmd_bucket.tip)).not.toBeNull()
        );
        unhover(trigger);
        await waitFor(() =>
            expect(screen.queryByText(GLOSSARY.cmd_bucket.tip)).toBeNull()
        );
    });

    it("is reachable by keyboard and dismissible with Escape (#2629 AC)", async () => {
        renderTerm("pct", "budget used");
        const trigger = screen.getByText("budget used");
        // A `<span>` is not focusable on its own. The vanilla engine wrote
        // `tabindex="0"` onto every declared term for exactly this reason, and
        // without it the explanation is reachable with a pointer and by
        // nothing else.
        expect(trigger.getAttribute("tabindex")).toBe("0");

        trigger.focus();
        await waitFor(() =>
            expect(screen.getByText(GLOSSARY.pct.tip)).not.toBeNull()
        );

        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() =>
            expect(screen.queryByText(GLOSSARY.pct.tip)).toBeNull()
        );

        // …and blur closes it too, so tabbing through never leaves one open.
        trigger.blur();
        trigger.focus();
        await waitFor(() =>
            expect(screen.getByText(GLOSSARY.pct.tip)).not.toBeNull()
        );
        trigger.blur();
        await waitFor(() =>
            expect(screen.queryByText(GLOSSARY.pct.tip)).toBeNull()
        );
    });

    it("keeps the surface's own text and only adds the explanation", () => {
        renderTerm("cmd_bucket", "cmd");
        // The vanilla engine FILLED an element's textContent with the label.
        // Here the caller's own text is what renders, always.
        expect(screen.getByText("cmd")).not.toBeNull();
        expect(screen.queryByText(GLOSSARY.cmd_bucket.label)).toBeNull();
    });

    it("renders a term it cannot resolve as plain text, with no affordance at all", () => {
        renderTerm("totally_made_up", "made up");
        const el = screen.getByText("made up");
        // An affordance that opens on hover and then says nothing is worse
        // than no affordance. `lookupTerm` returning nothing is the signal.
        expect(lookupTerm("totally_made_up")).toBeUndefined();
        expect(el.getAttribute("tabindex")).toBeNull();
        expect(el.getAttribute("data-slot")).not.toBe("tooltip-trigger");
    });

    it("renders glossary text as TEXT — a tip is data, never markup", async () => {
        // `tooltipHtml` escaped by hand because the vanilla engine built a
        // string of HTML. React escapes text nodes, so the property holds by
        // construction; this is the assertion that says so out loud.
        render(
            <TooltipProvider>
                <DynamicTerm term="cmd_bucket">
                    {"<script>alert(1)</script>"}
                </DynamicTerm>
            </TooltipProvider>
        );
        const trigger = screen.getByText("<script>alert(1)</script>");
        expect(document.querySelectorAll("script").length).toBe(0);
        hover(trigger);
        await waitFor(() =>
            expect(screen.getByText(GLOSSARY.cmd_bucket.tip)).not.toBeNull()
        );
    });
});

describe("a control with no visible label of its own keeps it that way (#2631/#2842)", () => {
    it("the merge tick stays an empty colour mark, named only by its aria-label", () => {
        // A #2842 review measured the OLD behaviour in a real browser: every
        // one of a live day's 40 ticks rendered the literal word "merged" —
        // the glossary label filled into `textContent` because the element was
        // empty — a 45px text run painted over a 5px box, stealing `:hover`
        // from neighbours up to 22px away. A React trigger has no scanner to
        // fill it, so the failure mode is gone by construction; this is the
        // guard that keeps it gone.
        render(
            <TooltipProvider>
                <MergeTick
                    item={{
                        number: 123,
                        title: "fix things",
                        left: 40,
                    }}
                />
            </TooltipProvider>
        );
        const tick = screen.getByRole("button");
        expect(tick.textContent).toBe("");
        expect(tick.getAttribute("aria-label")).toBe(
            "PR #123 merged: fix things"
        );
    });

    it("the section info mark keeps its own glyph and is not overwritten by its label", () => {
        render(
            <TooltipProvider>
                <InfoMark id="section.driver" />
            </TooltipProvider>
        );
        // `ⓘ` is the glyph the vanilla markup had to defend with its own
        // `aria-label` so the engine would not paint "driver" over it.
        expect(screen.getByText("ⓘ")).not.toBeNull();
        expect(screen.queryByText(GLOSSARY["section.driver"].label)).toBeNull();
    });
});
