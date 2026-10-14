// The Formats the setup flow's strict Import deck offers (PRD #5334 stories
// 41–48, issue #5343) — split from `./matchSetupDeckImport` so the Setup flow
// can render its Import deck controls without loading the parser, which
// reads the card catalogue (issue #5584: `/play/constructed` is a light
// surface; the catalogue loads only when the dialog opens).
import { FORMAT_IDS, type FormatId } from "@convex/formats";

/** Formats a pasted list cannot be: Limited is bound to an Event, and Tabletop
 *  (`manual`) resolves names through the Full Catalogue, which this strict
 *  import does not load — it would refuse every card the GRE lacks. */
export const IMPORT_EXCLUDED_FORMATS: readonly FormatId[] = [
    "limited",
    "manual",
];

/** The Formats a Freeform Match Format lets the player import into. */
export const IMPORT_FORMAT_CHOICES: readonly FormatId[] = FORMAT_IDS.filter(
    (f) => !IMPORT_EXCLUDED_FORMATS.includes(f)
);

/** The imported deck's Format: the Match Format itself, except under Freeform,
 *  where the player's select decides (story 46). */
export function importFormat(
    matchFormat: FormatId,
    chosen: FormatId
): FormatId {
    return matchFormat === "freeform" ? chosen : matchFormat;
}
