import { getArtCropImageUrl, resolveCardImageId } from "~/lib/images";

/**
 * The active deck's art as the lobby's ambient (ADR 0103 §6, issue #2726) —
 * blurred hard, desaturated and held at low opacity behind everything, so the
 * screen takes on the colour of whatever the player is about to play.
 *
 * This is the second half of acceptance criterion #3: selecting a deck swaps
 * the Loadout AND the ambient. It sits ON TOP of `LobbyBackground`'s shared
 * page ground (gradient, glows, grain, vignette) rather than replacing it —
 * the ground is what makes an unselected lobby look intentional instead of
 * black, and the deck art is what makes a selected one look like this deck's
 * menu.
 *
 * `data-ambient-art` + `aria-hidden`: decoration on both counts. It is also
 * what keeps the ui-gate card probe from scoring a full-bleed backdrop as an
 * occluded card (`scripts/ui-gate/probe.js`, `isDecorativeArt`) — the exact
 * artifact `budgets.json` carries a `cardsOcc 1` ceiling for today.
 */
export default function LobbyAmbient({
    featuredCardId,
}: {
    featuredCardId: string | null;
}) {
    const scryfallId = featuredCardId
        ? resolveCardImageId(featuredCardId)
        : null;
    if (!scryfallId) return null;

    return (
        <div
            aria-hidden
            data-lobby-ambient
            className="pointer-events-none absolute inset-0 overflow-hidden"
        >
            <img
                data-ambient-art
                src={getArtCropImageUrl(scryfallId)}
                alt=""
                aria-hidden
                draggable={false}
                className="absolute inset-0 h-full w-full scale-110 select-none object-cover opacity-40"
                style={{ filter: "blur(46px) saturate(0.7) brightness(0.4)" }}
            />
            <div
                className="absolute inset-0"
                style={{
                    background:
                        "radial-gradient(80% 60% at 50% 40%, transparent, var(--color-surface-base) 95%), linear-gradient(180deg, color-mix(in oklab, var(--color-surface-base) 60%, transparent), transparent 20%, transparent 70%, var(--color-surface-base) 100%)",
                }}
            />
        </div>
    );
}
