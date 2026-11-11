import { Badge } from "~/components/ui/badge";
import { SOURCE_LABEL, type RatingSource } from "./pick-ratings-model";

const VARIANT = {
    override: "default",
    seed: "secondary",
    median: "outline",
} as const;

/** Where a row's rating comes from. An Override stays loud even when it
 *  equals the seed: it is the mark of a rating a human wrote. */
export default function PickRatingsSourceBadge({
    source,
}: {
    source: RatingSource;
}) {
    return <Badge variant={VARIANT[source]}>{SOURCE_LABEL[source]}</Badge>;
}
