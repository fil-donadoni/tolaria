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

describe("Term — the glossary's typed door", () => {
    it("renders the label, not the key — the page prints words, never column names", () => {
        renderTerm("spans");
        expect(screen.getByText(GLOSSARY.spans.label)).toBeInTheDocument();
        expect(screen.queryByText("spans")).not.toBeInTheDocument();
    });

    it("children override the rendered text, for a surface showing a glyph or an already-formatted value", () => {
        renderTerm("spans", "×");
        expect(screen.getByText("×")).toBeInTheDocument();
    });

    it("marks itself as explainable — an underlined, help-cursor trigger, so the tooltip is discoverable rather than a hidden affordance", () => {
        renderTerm("spans");
        const trigger = screen.getByText(GLOSSARY.spans.label);
        expect(trigger.className).toContain("cursor-help");
        expect(trigger.className).toContain("underline");
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
