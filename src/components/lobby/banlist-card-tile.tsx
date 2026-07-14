import { tryGetCardByName } from "@convex/cards";
import CardImage from "~/components/cards/card-image";
import { getImageUrl, getImageSrcSet } from "~/lib/images";

interface BanlistCardTileProps {
    cardName: string;
    status: "banned" | "restricted";
    /** Scryfall id captured at sync (PRD #1138 follow-up). Used only when the
     *  card has no `CardDefinition` in our engine, to still show its image. */
    scryfallId?: string;
}

/**
 * One card in a `BanlistCardsDialog` pile (PRD #1138). The banlist is keyed by
 * NAME and deliberately includes cards with no `CardDefinition` (the point of
 * the DB-backed list — it reads as complete, unlike the built-pool-intersected
 * code lists). Rendering order: our own art when the name resolves via
 * `tryGetCardByName`; else the card's Scryfall image when a synced `scryfallId`
 * is present (so a never-built card like Amulet of Quoz still shows its face);
 * else a name-only placeholder frame. A corner badge tints banned vs restricted.
 */
export default function BanlistCardTile({
    cardName,
    status,
    scryfallId,
}: BanlistCardTileProps) {
    const def = tryGetCardByName(cardName);
    // Same badge tints the sibling `DeckBanlistPanel` uses (proven design
    // tokens): danger for banned, accent for restricted.
    const badgeClass =
        status === "banned"
            ? "bg-danger/20 text-danger"
            : "bg-accent-soft text-accent-strong";

    return (
        <div className="flex w-28 flex-col gap-1">
            <div className="relative aspect-5/7 w-full">
                {def ? (
                    <CardImage card={{ id: def.id }} lazy sizes="112px" />
                ) : scryfallId ? (
                    // Scryfall CDN image (WebP + srcset) via the project's
                    // image authority (`~/lib/images`) — same source CardImage
                    // uses — so a never-built banlist card (e.g. Amulet of Quoz)
                    // still shows its real face.
                    <img
                        src={getImageUrl(scryfallId)}
                        srcSet={getImageSrcSet(scryfallId)}
                        sizes="112px"
                        alt={cardName}
                        loading="lazy"
                        className="h-full w-full rounded-[7%] object-cover"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center rounded-[7%] border border-border-subtle/40 bg-surface-elevated p-2 text-center text-[11px] leading-tight text-text-muted">
                        {cardName}
                    </div>
                )}
                <span
                    className={`absolute right-1 top-1 rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${badgeClass}`}
                >
                    {status}
                </span>
            </div>
            <p
                className="truncate text-center text-[11px] text-text-muted"
                title={cardName}
            >
                {cardName}
            </p>
        </div>
    );
}
