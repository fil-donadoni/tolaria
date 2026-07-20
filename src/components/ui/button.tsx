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
            size: {
                default: "px-4 py-2 text-sm",
                sm: "px-3 py-1.5 text-xs",
                xs: "px-2 py-0.5 text-xs",
                lg: "px-5 py-2.5 text-base",
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
