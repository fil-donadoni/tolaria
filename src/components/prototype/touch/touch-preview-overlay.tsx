// PROTOTYPE — throwaway. The inspect overlay (🔍 / hold-preview): ≤100dvh,
// stacked in portrait, art|text side-by-side in landscape, deck actions.
import { getImageUrl } from "~/lib/images";
import type { ProtoCard } from "./mock-pool";

export default function TouchPreviewOverlay({
    card,
    landscape,
    actions,
    onClose,
    tapAnywhereCloses = false,
}: {
    card: ProtoCard;
    landscape: boolean;
    actions: { label: string; primary?: boolean; onClick: () => void }[];
    onClose: () => void;
    /** Draft: a tap ANYWHERE closes (read → back to picking); only the primary
     *  action is exempt. */
    tapAnywhereCloses?: boolean;
}) {
    return (
        <div
            className="fixed inset-0 z-[9996] flex items-center justify-center bg-scrim p-3 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className={`flex max-h-[100dvh] w-full max-w-[720px] overflow-hidden rounded-xl border border-accent/50 bg-surface shadow-[0_22px_50px_rgba(0,0,0,.7)] ${landscape ? "flex-row" : "flex-col"}`}
                style={{
                    height: landscape
                        ? "min(92dvh, 380px)"
                        : "min(94dvh, 760px)",
                }}
                onClick={(e) => {
                    if (!tapAnywhereCloses) e.stopPropagation();
                }}
            >
                <img
                    src={getImageUrl(card.cardId)}
                    alt={card.name}
                    draggable={false}
                    className={
                        landscape
                            ? "h-full w-auto object-contain"
                            : "mx-auto max-h-[55%] w-auto object-contain pt-3"
                    }
                />
                <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
                    <div className="font-beleren text-lg text-parchment">
                        {card.name}
                    </div>
                    <div className="text-xs text-text-muted">
                        {card.isLand ? "Land" : `MV ${card.mv}`} ·{" "}
                        {card.isCreature ? "Creature" : "Spell"}
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto text-sm text-text">
                        Oracle text would scroll here. The art never crops the
                        text; the overlay never exceeds 100dvh.
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {actions.map((a) => (
                            <button
                                key={a.label}
                                type="button"
                                onClick={(e) => {
                                    if (a.primary) e.stopPropagation();
                                    a.onClick();
                                }}
                                className={`min-h-11 rounded-full border px-4 font-beleren text-sm ${a.primary ? "border-accent bg-accent text-surface-base" : "border-accent/50 bg-surface-elevated text-accent-strong"}`}
                            >
                                {a.label}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={onClose}
                            className="min-h-11 rounded-full px-4 font-beleren text-sm text-text-muted"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
