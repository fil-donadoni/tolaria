import { tryGetDefinition } from "@convex/cards";
import { getDisplayAbilities } from "~/lib/card-utils";
import OracleParagraph from "~/components/cards/oracle-paragraph";
import CardPreviewAbilities from "~/components/cards/card-preview-abilities";

/** One card's rules text, inside the Card Profile editor (issue #3597).
 *
 *  Judging whether a creature is `reanimatable`, or whether a spell belongs to
 *  `storm`, is a judgement about the card's TEXT — and a row showing only a
 *  name forces the reviewer to recall it or open a second tab, 285 times. The
 *  printed Oracle text is the primary source (every card of the Vintage Cube
 *  scope carries one), with the structured ability view as the fallback for a
 *  definition that has no printed text on record — the same two-source shape
 *  the card preview panel already uses, reusing its components rather than
 *  re-rendering rules text a second way.
 *
 *  `milestones` is deliberately `null`: the in-game graveyard progress chips
 *  (Delirium/Threshold counts) need a live game, and there is none here. */
export default function CardProfileOracleText({ cardId }: { cardId: string }) {
    const def = tryGetDefinition(cardId);
    const printed = def?.oracleText;

    if (printed) {
        return (
            <div className="flex flex-col gap-1 text-[11px] leading-snug text-text">
                {printed
                    .split("\n")
                    .filter((line) => line.trim() !== "")
                    .map((line, index) => (
                        <p key={index}>
                            <OracleParagraph text={line} milestones={null} />
                        </p>
                    ))}
            </div>
        );
    }

    const abilities = getDisplayAbilities(cardId);
    const hasStructured =
        abilities.keywords.length > 0 ||
        abilities.activated.length > 0 ||
        abilities.triggered.length > 0;
    if (hasStructured) {
        return (
            <div className="text-[11px] leading-snug">
                <CardPreviewAbilities abilities={abilities} />
            </div>
        );
    }

    return (
        <p className="text-[11px] text-text-muted">
            No rules text on record for this card.
        </p>
    );
}
