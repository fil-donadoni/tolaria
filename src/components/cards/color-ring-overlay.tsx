import type { ColorOverrideDisplay } from "~/lib/color-override";

/** CR 613.1e layer 5 — the colour ring painted over a card whose CURRENT
 *  colours differ from the ones its printed art conveys (`colorOverride` or
 *  `grantedColors`, read through `getEffectiveColorDisplay`). The ONE drawing
 *  of it: `CardImage` renders it for every zone (battlefield, stack, hand,
 *  graveyard, exile, piles), the card preview over its art. */
export default function ColorRingOverlay({
    display,
    square = false,
}: {
    display: ColorOverrideDisplay;
    /** Square corners — the preview's ART CROP box, which is not a card. */
    square?: boolean;
}) {
    return (
        <div
            data-color-ring={display.name}
            className={`absolute inset-0 pointer-events-none z-[5] ${
                square ? "" : "card-corner"
            }`}
            style={{
                boxShadow: `inset 0 0 0 4px ${display.inner}`,
                background: [
                    `linear-gradient(180deg, ${display.inner} 0%, transparent 22%)`,
                    `linear-gradient(0deg, ${display.inner} 0%, transparent 22%)`,
                    `linear-gradient(90deg, ${display.inner} 0%, transparent 18%)`,
                    `linear-gradient(270deg, ${display.inner} 0%, transparent 18%)`,
                ].join(", "),
            }}
        />
    );
}
