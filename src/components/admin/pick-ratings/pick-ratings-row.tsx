import { TableCell, TableRow } from "~/components/ui/table";
import CardImage from "~/components/cards/card-image";
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import { manaCostToString } from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";
import PickRatingsSourceBadge from "./pick-ratings-source-badge";
import {
    effectiveRating,
    RARITY_LABEL,
    ratingSource,
    type RatingSortKey,
} from "./pick-ratings-model";

interface PickRatingsRowProps {
    card: ScopeCardRating;
    columns: readonly RatingSortKey[];
}

/** One card of the Pick Ratings table. Read-only until the rating dialog
 *  (a later slice of PRD #8772) turns the row into its click target. */
export default function PickRatingsRow({ card, columns }: PickRatingsRowProps) {
    const cell = (key: RatingSortKey) => {
        switch (key) {
            case "card":
                return (
                    <TableCell key={key}>
                        <div className="flex items-center gap-3">
                            <div
                                className="relative aspect-5/7 w-11 shrink-0"
                                data-pick-rating-art={card.cardId}
                            >
                                <CardImage
                                    card={{ id: card.cardId }}
                                    lazy
                                    sizes="44px"
                                />
                            </div>
                            <span className="text-sm text-text">
                                {card.name}
                            </span>
                        </div>
                    </TableCell>
                );
            case "cost":
                return (
                    <TableCell key={key} className="text-xs">
                        {card.manaCost
                            ? formatOracleText(manaCostToString(card.manaCost))
                            : "—"}
                    </TableCell>
                );
            case "rarity":
                return (
                    <TableCell key={key} className="text-xs text-text-muted">
                        {card.rarity ? RARITY_LABEL[card.rarity] : "—"}
                    </TableCell>
                );
            case "archetypes":
                return (
                    <TableCell key={key} className="text-xs text-text-muted">
                        {card.archetypes.length === 0
                            ? "—"
                            : card.archetypes.join(", ")}
                    </TableCell>
                );
            case "rating":
                return (
                    <TableCell key={key} className="text-sm tabular-nums">
                        {effectiveRating(card).toFixed(1)}
                    </TableCell>
                );
            case "source":
                return (
                    <TableCell key={key}>
                        <PickRatingsSourceBadge source={ratingSource(card)} />
                    </TableCell>
                );
        }
    };
    return <TableRow>{columns.map(cell)}</TableRow>;
}
