// "Set as featured" affordance for a Maindeck card in the deck builder
// (PRD #589, issue #599). Picking a card stores it as the deck's Featured Card
// override, persisted via the existing deck update mutation (admin-gated for
// presets, ADR 0033). The button overlays the card art and stops click
// propagation so picking the featured card never removes a copy (the card
// itself is click-to-remove).

interface FeaturedCardButtonProps {
    /** Whether this card is the deck's currently-featured card. */
    isFeatured: boolean;
    /** Pick this card as the Featured Card (or clear it, if already featured). */
    onSetFeatured: () => void;
}

export default function FeaturedCardButton({
    isFeatured,
    onSetFeatured,
}: FeaturedCardButtonProps) {
    return (
        <button
            type="button"
            onClick={(e) => {
                // The card art is click-to-remove; the featured pick must not
                // bubble into that handler.
                e.stopPropagation();
                onSetFeatured();
            }}
            aria-pressed={isFeatured}
            title={
                isFeatured
                    ? "Featured card — click to clear"
                    : "Set as featured card"
            }
            className={
                isFeatured
                    ? "absolute top-1 left-1 z-10 rounded-sm border border-accent bg-accent px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-wide text-surface-base shadow-sm"
                    : "absolute top-1 left-1 z-10 rounded-sm border border-border-accent/70 bg-surface-base/80 px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-wide text-text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
            }
        >
            {isFeatured ? "★ Featured" : "★ Feature"}
        </button>
    );
}
