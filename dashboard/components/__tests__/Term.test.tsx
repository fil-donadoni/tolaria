// Assertions read the DOM directly rather than through jest-dom's
// `toBeInTheDocument` — the `types` array in this project's tsconfig doesn't
// pick up jest-dom's type augmentation, so those matchers type-check as
// missing under `tsc -b` even though they run fine (same workaround as
// `src/components/ui/__tests__/segmented-control.test.tsx`).
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Term } from "../Term";
import { GLOSSARY, lookupTerm, type TermId } from "../../glossary";

/**
 * `<Term>` (PRD #3148 S1).
 *
 * The point of the component is the TYPE: `id` is `TermId`, so a typo is a
 * compile error rather than a tooltip that silently never appears — which is
 * exactly what a mistyped `data-term` string used to be. A test cannot assert
 * a compile error, so what it asserts instead is the other half: that every
 * id the type admits actually resolves, and that the component renders the
 * table's LABEL rather than the raw key.
 */

const renderTerm = (id: TermId, children?: string) =>
    render(
        <TooltipProvider>
            <Term id={id}>{children}</Term>
        </TooltipProvider>
    );

const renderTerm2 = (id: TermId, focusable: boolean) =>
    render(
        <TooltipProvider>
            <Term id={id} focusable={focusable} />
        </TooltipProvider>
    );

describe("Term — the glossary's typed door", () => {
    it("renders the label, not the key — the page prints words, never column names", () => {
        renderTerm("spans");
        expect(screen.getByText(GLOSSARY.spans.label)).not.toBeNull();
        expect(screen.queryByText("spans")).toBeNull();
    });

    it("children override the rendered text, for a surface showing a glyph or an already-formatted value", () => {
        renderTerm("spans", "×");
        expect(screen.getByText("×")).not.toBeNull();
    });

    it("marks itself as explainable — an underlined, help-cursor trigger, so the tooltip is discoverable rather than a hidden affordance", () => {
        renderTerm("spans");
        const trigger = screen.getByText(GLOSSARY.spans.label);
        expect(trigger.className).toContain("cursor-help");
        expect(trigger.className).toContain("underline");
    });

    it("is reachable by KEYBOARD, not only by a pointer (#2629 AC, migrated in PRD #3148 S4)", () => {
        renderTerm("spans");
        // A `<span>` is not focusable on its own, and base-ui opens on focus.
        // The vanilla engine wrote `tabindex="0"` onto every declared term for
        // exactly this reason; without it the explanation is a mouse-only
        // affordance, which is the state #2629 exists to end.
        expect(
            screen.getByText(GLOSSARY.spans.label).getAttribute("tabindex")
        ).toBe("0");
    });

    it("takes NO tab stop where one would be wrong — inside another control, or inside an open tooltip's own popup", () => {
        renderTerm2("spans", false);
        // Interactive content is not permitted inside a `<button>`, and a
        // second tab stop that opens the explanation while the control's own
        // does not is worse than none.
        expect(
            screen.getByText(GLOSSARY.spans.label).getAttribute("tabindex")
        ).toBeNull();
    });

    it("every id the TYPE admits resolves to an entry with a real tip — the runtime half of the guarantee the type gives", () => {
        const ids = Object.keys(GLOSSARY) as TermId[];
        // A floor, not a count: the guard must not go vacuous if the
        // table is ever emptied by a bad merge.
        expect(ids.length).toBeGreaterThan(100);
        const empty = ids.filter((id) => {
            const entry = lookupTerm(id);
            return !entry || !entry.label || !entry.tip;
        });
        expect(empty).toEqual([]);
    });
});
