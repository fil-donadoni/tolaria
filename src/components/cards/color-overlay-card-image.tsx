import type { CardInstance } from "~/types/game";
import { getEffectiveColorDisplay } from "~/lib/color-override";
import CardImage from "./card-image";

export default function ColorOverlayCardImage({
    card,
    showCopyBadge,
    sizes,
    includeThumb,
}: {
    card: CardInstance;
    /** Spell copy on the stack (CR 707.10) — forwarded to the preview badge. */
    showCopyBadge?: boolean;
    /** `sizes` hint forwarded to CardImage (the stack renders at w-32 → 128px). */
    sizes?: string;
    /** Forwarded to CardImage — the stack is a mid slot, so thumb is excluded. */
    includeThumb?: boolean;
}) {
    const colorDisplay = getEffectiveColorDisplay(card);

    return (
        <div className="relative">
            <CardImage
                card={card}
                showCopyBadge={showCopyBadge}
                sizes={sizes}
                includeThumb={includeThumb}
            />
            {colorDisplay && (
                <div
                    className="absolute inset-0 pointer-events-none card-corner z-[5]"
                    style={{
                        boxShadow: `inset 0 0 0 4px ${colorDisplay.inner}`,
                        background: [
                            `linear-gradient(180deg, ${colorDisplay.inner} 0%, transparent 22%)`,
                            `linear-gradient(0deg, ${colorDisplay.inner} 0%, transparent 22%)`,
                            `linear-gradient(90deg, ${colorDisplay.inner} 0%, transparent 18%)`,
                            `linear-gradient(270deg, ${colorDisplay.inner} 0%, transparent 18%)`,
                        ].join(", "),
                    }}
                />
            )}
        </div>
    );
}
