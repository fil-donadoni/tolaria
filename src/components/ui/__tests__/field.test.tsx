// The v4 text-field contract (ADR 0103 / PRD #2721 story 32, issue #2723):
// "text inputs in the quiet skin with a clear focus ring" — a DARK FIELD
// (`surface-base`, a hole cut in the panel rather than a plate raised off it),
// a control-edge border and the accent focus ring.
//
// `Input` and `Textarea` are asserted TOGETHER, on purpose. They are the same
// control family and they had drifted: `Textarea` was still on the raw shadcn
// remap (`border-input` / `ring-ring` / `dark:bg-input/30` / `rounded-lg`),
// so the bug-report dialog painted two different edges, two different focus
// rings and two different corners on two fields three rows apart. A per-file
// test would have passed on both of those.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Input } from "../input";
import { Textarea } from "../textarea";

function classTokens(el: Element): string[] {
    return el.className.split(/\s+/).filter(Boolean);
}

function fields(): Array<[string, string[]]> {
    const single = render(<Input />).container.querySelector(
        '[data-slot="input"]'
    )!;
    const multi = render(<Textarea />).container.querySelector(
        '[data-slot="textarea"]'
    )!;
    return [
        ["Input", classTokens(single)],
        ["Textarea", classTokens(multi)],
    ];
}

describe("text fields — v4 skin (ADR 0103)", () => {
    it("both sit on the recessed dark field", () => {
        for (const [name, tokens] of fields()) {
            expect(tokens, name).toContain("bg-surface-base");
        }
    });

    // The edge is `border-strong`, NOT the decorative `--hairline` pair.
    // ivory/30 is 2.37:1 on `surface`; an input's only boundary has to clear
    // WCAG 1.4.11's 3:1, which is the invariant design-tokens.test.ts holds
    // with "border-strong is brighter than the strong hairline (a control edge
    // is not decoration)".
    it("both draw a control edge, not a decorative hairline", () => {
        for (const [name, tokens] of fields()) {
            expect(tokens, name).toContain("border-border-strong");
            expect(tokens, name).not.toContain("border-[var(--hairline)]");
            expect(tokens, name).not.toContain(
                "border-[var(--hairline-strong)]"
            );
        }
    });

    it("both take the accent focus ring", () => {
        for (const [name, tokens] of fields()) {
            expect(tokens, name).toContain("focus-visible:border-accent");
            expect(tokens, name).toContain("focus-visible:ring-2");
            expect(tokens, name).toContain("focus-visible:ring-accent/50");
        }
    });

    it("both share the control corner", () => {
        for (const [name, tokens] of fields()) {
            expect(tokens, name).toContain("rounded-sm");
        }
    });

    // The shadcn remap tokens are what the two fields used to disagree on.
    // Naming them explicitly means a future `npx shadcn add` that re-emits a
    // default recipe over one of these files reds this test instead of quietly
    // reintroducing the drift.
    it("neither field falls back to the raw shadcn remap tokens", () => {
        for (const [name, tokens] of fields()) {
            for (const shadcn of [
                "border-input",
                "focus-visible:border-ring",
                "focus-visible:ring-ring/50",
                "dark:bg-input/30",
            ]) {
                expect(tokens, `${name} · ${shadcn}`).not.toContain(shadcn);
            }
        }
    });

    it("both signal aria-invalid with the danger edge and ring", () => {
        for (const [name, tokens] of fields()) {
            expect(tokens, name).toContain("aria-invalid:border-danger");
            expect(tokens, name).toContain("aria-invalid:ring-danger/40");
        }
    });

    it("both render the disabled field as an opaque plate, not a faded one", () => {
        for (const [name, tokens] of fields()) {
            expect(tokens, name).toContain("disabled:bg-surface");
            expect(tokens, name).toContain("disabled:text-text-disabled");
            expect(tokens, name).not.toContain("disabled:opacity-50");
        }
    });

    it("merges a caller className without losing the recipe", () => {
        const { container } = render(<Input className="my-custom" />);
        const tokens = classTokens(
            container.querySelector('[data-slot="input"]')!
        );
        expect(tokens).toContain("my-custom");
        expect(tokens).toContain("bg-surface-base");
    });
});
