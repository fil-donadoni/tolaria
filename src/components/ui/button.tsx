import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * THE button (phase-3 unification): one component, forged-plate tones.
 *
 * Colour lives in the `.btn-tone-*` plate classes (index.css, issue #594);
 * this cva adds sizes, the disabled plate (utility overrides beat the
 * component-layer tones), and a visible focus ring (accent — 8.2:1, was
 * 1.41:1). shadcn/base-ui supplies behaviour only, never colour (ADR 0007).
 *
 * Variant map from the three retired systems:
 *   .btn-tone-primary/secondary/destructive/ghost  → same-named variant
 *   shadcn default → primary · outline → secondary
 *   ad-hoc "Beleren plates" → primary/destructive sm · text-links → link
 *
 * v4 (ADR 0103 §3, issue #2723) changes the MATERIAL behind these names, not
 * the names: `primary` is the one opaque ivory plate with a resting glow;
 * `secondary` and `destructive` become hairline edges (no fill), `ghost` stays
 * text. The unions are unchanged, so no consumer moves — a screen that had a
 * garnet Concede plate beside an ivory Confirm plate now has one plate and one
 * danger edge, which is the hierarchy the ADR is after.
 */
const buttonVariants = cva(
    "btn-base inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap select-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface disabled:text-text-disabled disabled:shadow-none disabled:filter-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    {
        variants: {
            variant: {
                primary: "btn-tone-primary",
                secondary: "btn-tone-secondary",
                destructive: "btn-tone-destructive",
                ghost: "btn-tone-ghost",
                link: "border-transparent bg-transparent font-sans tracking-normal text-text-muted underline-offset-4 shadow-none hover:bg-transparent hover:text-parchment hover:underline",
            },
            // Height comes from the pointer token (ADR 0101 §2, issue #2581):
            // `--control-h` is 44px on a coarse pointer and 32px on a fine
            // one, `--control-h-sm` the dense rung 4px under it. `min-h`, not
            // `h`, so a wrapping label still grows the plate instead of
            // overflowing it. The three icon-only rungs and `xs` are
            // deliberately NOT retargeted here — enlarging every board HUD
            // glyph to a 44px square is a layout change with cross-surface
            // blast radius, tracked separately (#2792), not the token slice.
            //
            // v4 rungs 40 / 48 (ADR 0103, issue #2723). `max(--control-h,40px)`
            // rather than a flat 40px, so the COARSE pointer keeps its 44px
            // WCAG 2.5.8 target and only the fine-pointer rung moves (32 → 40).
            // A flat 40 would have SHRUNK every touch button by 4px, which is
            // the one direction this rung must never go.
            size: {
                default: "min-h-[max(var(--control-h),40px)] px-4 py-2 text-sm",
                sm: "min-h-[var(--control-h-sm)] px-3 py-1.5 text-xs",
                xs: "px-2 py-0.5 text-xs",
                lg: "min-h-12 px-5 py-2.5 text-base",
                icon: "size-8 p-0",
                "icon-sm": "size-7 p-0 [&_svg:not([class*='size-'])]:size-3.5",
                "icon-xs": "size-6 p-0 [&_svg:not([class*='size-'])]:size-3",
            },
        },
        defaultVariants: {
            variant: "primary",
            size: "default",
        },
    }
);

function Button({
    className,
    variant = "primary",
    size = "default",
    ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
    return (
        <ButtonPrimitive
            data-slot="button"
            className={cn(buttonVariants({ variant, size, className }))}
            {...props}
        />
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants };
