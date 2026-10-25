import { useState } from "react";
import type { Color } from "@convex/cards/types";
import { MANA_COLORS } from "@convex/gre/constants";
import ManaSymbol from "~/components/cards/mana-symbol";
import { Button } from "~/components/ui/button";
import ZoneColorFilterSheet from "./zone-color-filter-sheet";

export interface ZoneColorFilterTriggerProps {
    value: ReadonlySet<Color>;
    onToggle: (color: Color) => void;
    zoneLabel: string;
}

/**
 * The ONE Zone-header control for the colour filter on `phone` and
 * `roomy-coarse` surfaces (issue #3678) — the coarse-pointer twin of
 * `ZoneColorFilterToggles`. A `Button` sized by `--control-h` (44px on a
 * coarse pointer) showing the active colours as mana glyphs, or the word
 * "Colors" when none is active; it opens `ZoneColorFilterSheet`.
 */
export default function ZoneColorFilterTrigger({
    value,
    onToggle,
    zoneLabel,
}: ZoneColorFilterTriggerProps) {
    const [open, setOpen] = useState(false);
    const active = MANA_COLORS.filter((color) => value.has(color));
    return (
        <>
            <Button
                type="button"
                variant="secondary"
                size="sm"
                style={{ minHeight: "var(--control-h)" }}
                aria-haspopup="dialog"
                aria-label={`${zoneLabel} colour filter: ${
                    active.length > 0 ? active.join(", ") : "none"
                }`}
                onClick={() => setOpen(true)}
            >
                {active.length > 0 ? (
                    <span className="flex items-center gap-0.5">
                        {active.map((color) => (
                            <ManaSymbol
                                key={color}
                                symbol={color}
                                className="size-4"
                            />
                        ))}
                    </span>
                ) : (
                    "Colors"
                )}
            </Button>
            <ZoneColorFilterSheet
                open={open}
                onClose={() => setOpen(false)}
                value={value}
                onToggle={onToggle}
                zoneLabel={zoneLabel}
            />
        </>
    );
}
