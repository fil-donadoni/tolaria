// The v4 Button contract (ADR 0103 §3, PRD #2721, issue #2723).
//
// These assert the CLASS CONTRACT, never pixels: which tone recipe a variant
// resolves to, and which height rung a size resolves to. The colours those
// recipes paint are asserted where they are declared — `src/index.css`, parsed
// by `src/__tests__/design-tokens.test.ts` — because happy-dom resolves no
// custom property and would report every one of them as an empty string.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Button } from "../button";

/** Token-exact membership (issue #2666). A bare `toContain` on `className` is
 *  a raw substring match: `"btn-tone-primary"` would be satisfied by a longer
 *  sibling sharing the prefix, and `"min-h-12"` by `"min-h-120"`. */
function classTokens(el: Element): string[] {
    return el.className.split(/\s+/).filter(Boolean);
}

/** Renders into its OWN container and reads back from it — several rows below
 *  render more than one Button inside a single `it`, and a `screen`-scoped
 *  query would then match every button mounted so far in that test. */
function renderButton(props: React.ComponentProps<typeof Button> = {}) {
    const { container } = render(<Button {...props}>Press</Button>);
    return container.querySelector('[data-slot="button"]')!;
}

describe("Button — v4 tones (ADR 0103 §3)", () => {
    // "primary = opaque ivory plate; secondary = hairline; ghost = text;
    // danger = danger hairline". The NAMES are unchanged from v3 — 67 files
    // import this component and none of them moved — only the material each
    // name resolves to.
    it.each([
        ["primary", "btn-tone-primary"],
        ["secondary", "btn-tone-secondary"],
        ["destructive", "btn-tone-destructive"],
        ["ghost", "btn-tone-ghost"],
    ] as const)("variant %s resolves to the %s recipe", (variant, recipe) => {
        expect(classTokens(renderButton({ variant }))).toContain(recipe);
    });

    // `link` is the one variant that is not a plate at all — it carries its
    // utilities inline rather than a `.btn-tone-*` recipe, and must stay
    // chromeless (six call sites: footer legal links, event toolbars).
    it("variant link stays chromeless — no tone plate, transparent border", () => {
        const tokens = classTokens(renderButton({ variant: "link" }));
        expect(tokens.some((t) => t.startsWith("btn-tone-"))).toBe(false);
        expect(tokens).toContain("border-transparent");
        expect(tokens).toContain("bg-transparent");
        expect(tokens).toContain("shadow-none");
    });

    it("defaults to the primary plate when no variant is given", () => {
        expect(classTokens(renderButton())).toContain("btn-tone-primary");
    });

    // Every button, whatever its tone, is on the shared base (the display
    // face, the rounded rectangle, the transition) and carries a VISIBLE
    // focus ring. The ring was 1.41:1 before the accent remap; losing it
    // again is a keyboard-navigation regression no visual review would catch.
    it("every variant keeps the shared base and the accent focus ring", () => {
        for (const variant of [
            "primary",
            "secondary",
            "destructive",
            "ghost",
            "link",
        ] as const) {
            const tokens = classTokens(renderButton({ variant }));
            expect(tokens, variant).toContain("btn-base");
            expect(tokens, variant).toContain("focus-visible:outline-accent");
            expect(tokens, variant).toContain("focus-visible:outline-2");
        }
    });
});

describe("Button — v4 40/48 rungs (ADR 0103)", () => {
    // The rung is `max(--control-h, 40px)`, NOT a flat 40px. `--control-h` is
    // 44px on a coarse pointer (WCAG 2.5.8) and 32px on a fine one, so the
    // `max()` raises the desktop rung to 40 and leaves the touch rung at 44.
    // A flat 40px would have SHRUNK every touch target by 4px — the one
    // direction this rung must never move.
    it("the default rung floors at 40px without shrinking the touch rung", () => {
        expect(classTokens(renderButton({ size: "default" }))).toContain(
            "min-h-[max(var(--control-h),40px)]"
        );
    });

    it("the lg rung is the 48px plate", () => {
        expect(classTokens(renderButton({ size: "lg" }))).toContain("min-h-12");
    });

    it("defaults to the default rung", () => {
        expect(classTokens(renderButton())).toContain(
            "min-h-[max(var(--control-h),40px)]"
        );
    });

    // Deliberately NOT retargeted (see the comment on `size` in button.tsx):
    // enlarging every board HUD glyph to a 44px square is a layout change with
    // cross-surface blast radius, tracked as #2792. This row exists so that
    // widening the v4 rungs to the icon sizes is a conscious edit to a failing
    // test rather than a silent board reflow.
    it.each(["icon", "icon-sm", "icon-xs", "xs"] as const)(
        "size %s is left on its own dense rung, not the v4 plate rung",
        (size) => {
            expect(classTokens(renderButton({ size }))).not.toContain(
                "min-h-[max(var(--control-h),40px)]"
            );
        }
    );

    it("the sm rung stays on the dense control token", () => {
        expect(classTokens(renderButton({ size: "sm" }))).toContain(
            "min-h-[var(--control-h-sm)]"
        );
    });
});

describe("Button — disabled plate", () => {
    // The disabled look is an OPAQUE low-contrast plate, not a faded one:
    // `opacity` on a plate over card art leaks the art through the label.
    it("carries the opaque disabled plate utilities", () => {
        const btn = renderButton({ disabled: true, variant: "primary" });
        const tokens = classTokens(btn);
        expect(tokens).toContain("disabled:bg-surface");
        expect(tokens).toContain("disabled:text-text-disabled");
        expect(tokens).toContain("disabled:shadow-none");
        expect(btn.hasAttribute("disabled")).toBe(true);
    });
});
