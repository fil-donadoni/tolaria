// Display label of a Limited Deck Archive group (issue #8410): the derived
// Limited Origin label, or the unclassified group for a deck with no origin.
import { limitedOriginLabel } from "@convex/limited/limitedOrigin";

export const UNCLASSIFIED_LABEL = "Unclassified";

export function originGroupLabel(origin: string | null): string {
    if (origin === null) return UNCLASSIFIED_LABEL;
    return limitedOriginLabel(origin) ?? origin;
}
