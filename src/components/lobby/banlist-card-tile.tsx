import { tryGetCardByName } from "@convex/cards";
import CardImage from "~/components/cards/card-image";

interface BanlistCardTileProps {
    cardName: string;
    status: "banned" | "restricted";
}

/**
 * One card in a `BanlistCardsDialog` pile (PRD #1138). The banlist is keyed by
 * NAME and deliberately includes cards with no `CardDefinition` yet (the point
 * of the DB-backed list — it reads as complete, unlike the built-pool-intersected
 * code lists). So a name that resolves via `tryGetCardByName` renders its real
 * art; one that doesn't falls back to a name-only placeholder frame rather than
 * being dropped. A corner badge tints banned (danger) vs restricted (accent).
 */
export default function BanlistCardTile({
    cardName,
    status,
}: BanlistCardTileProps) {
    const def = tryGetCardByName(cardName);
    const badgeClass =
        status === "banned"
            ? "bg-danger/20 text-danger"
            : "bg-accent-soft text-accent-strong";

    return (
        <div className="flex w-28 flex-col gap-1">
            <div className="relative aspect-5/7 w-full">
                {def ? (
                    <CardImage card={{ id: def.id }} lazy sizes="112px" />
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
