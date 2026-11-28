import type { AsEntersChoice } from "@convex/cards/types";
import type { CardInstance, Player } from "~/types/game";

/** One persistent as-enters choice (CR 614.12), stated on its own line of the
 *  Live text right under the Oracle paragraph that asks for it (issue #10980).
 *  Structured data, never a string glued into `oracleParagraphs`: the face
 *  renders it with its own style, and the ability-word counter scan never sees
 *  a synthetic paragraph. */
export type PreviewChoiceLine = {
    /** The `AsEntersChoice` kind this line states. */
    kind: ChoiceLineKind;
    /** Index into `oracleParagraphs` the line renders directly under: the
     *  "As this … enters, choose …" paragraph, else the last paragraph. */
    anchorIndex: number;
    /** "Chosen type", "Chosen types", "Chosen name", "Chosen color", … */
    label: string;
    value: string;
};

/** The persistent kinds that leave a field on the instance — the `annotated`
 *  rows of `AS_ENTERS_PREVIEW_COVERAGE`. */
export type ChoiceLineKind = Extract<
    AsEntersChoice["kind"],
    "subtypes" | "name" | "mode" | "opponent"
>;

type ChoiceSource = Pick<
    CardInstance,
    "chosenSubtypes" | "chosenName" | "chosenModeId" | "chosenPlayerId"
>;

type ModesDef = { modes?: ReadonlyArray<{ id: string; label: string }> };

type ChoiceValue = { label: string; value: string } | null;

/** One reader per kind: a `Record` over the kind union makes `tsc` red on a new
 *  `annotated` kind until it has a line (the class guard in
 *  `as-enters-preview.wire.test.ts` asserts the same from the coverage table). */
const CHOICE_LINE_READERS: Record<
    ChoiceLineKind,
    (
        instance: ChoiceSource,
        def: ModesDef | undefined,
        players: ReadonlyArray<Pick<Player, "id" | "name">> | undefined,
        anchorText: string
    ) => ChoiceValue
> = {
    subtypes: (instance) => {
        const chosen = instance.chosenSubtypes;
        if (!chosen || chosen.length === 0) return null;
        return {
            label: chosen.length === 1 ? "Chosen type" : "Chosen types",
            value: chosen.join(", "),
        };
    },
    name: (instance) =>
        instance.chosenName
            ? { label: "Chosen name", value: instance.chosenName }
            : null,
    mode: (instance, def, _players, anchorText) => {
        const id = instance.chosenModeId;
        const mode = id ? def?.modes?.find((m) => m.id === id) : undefined;
        if (!mode) return null;
        const text = mode.label || mode.id;
        return {
            label: /\bcolou?r\b/i.test(anchorText)
                ? "Chosen color"
                : "Chosen mode",
            value: text.charAt(0).toUpperCase() + text.slice(1),
        };
    },
    opponent: (instance, _def, players) => {
        const id = instance.chosenPlayerId;
        const name = id ? players?.find((p) => p.id === id)?.name : undefined;
        return name ? { label: "Chosen player", value: name } : null;
    },
};

const CHOICE_LINE_ORDER: ChoiceLineKind[] = [
    "subtypes",
    "name",
    "mode",
    "opponent",
];

/** The paragraph that makes the choice: "As this land enters, choose a
 *  creature type." (CR 614.12). */
const CHOOSING_PARAGRAPH = /\benters\b.*\bchoose\b/i;

/** The green choice lines for a permanent's persistent as-enters choices.
 *
 *  A line is emitted only when the instance carries a value AND the text is
 *  about a choice — it has a choosing paragraph or speaks of "chosen". A
 *  modal spell's cast-time mode is not a live characteristic of a permanent
 *  and gets no line, exactly as the in-place annotators leave it alone.
 *  No value (never chosen, or cleared by a zone change, CR 400.7) → no line. */
export function buildChoiceLines(
    paragraphs: readonly string[],
    instance: ChoiceSource | undefined,
    def: ModesDef | undefined,
    players: ReadonlyArray<Pick<Player, "id" | "name">> | undefined
): PreviewChoiceLine[] {
    if (!instance || paragraphs.length === 0) return [];
    const choosing = paragraphs.findIndex((p) => CHOOSING_PARAGRAPH.test(p));
    const aboutChoice =
        choosing >= 0 || paragraphs.some((p) => /\bchosen\b/i.test(p));
    if (!aboutChoice) return [];
    const anchorIndex = choosing >= 0 ? choosing : paragraphs.length - 1;
    // The text the mode line reads its noun from ("choose a color" → "Chosen
    // color"): the choosing paragraph, else the whole text.
    const anchorText =
        choosing >= 0 ? paragraphs[choosing] : paragraphs.join("\n");
    const lines: PreviewChoiceLine[] = [];
    for (const kind of CHOICE_LINE_ORDER) {
        const read = CHOICE_LINE_READERS[kind](
            instance,
            def,
            players,
            anchorText
        );
        if (read) lines.push({ kind, anchorIndex, ...read });
    }
    return lines;
}
