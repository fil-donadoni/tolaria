import { tryGetDefinition } from "@convex/cards";
import {
    getArtCropImageUrl,
    getArtImageUrl,
    getPrintedCardImageUrl,
    resolveCardImageFace,
    resolveCardImageId,
} from "~/lib/images";
import {
    formatTypeLine,
    getDisplayAbilities,
    shouldShowOracleText,
    manaCostToString,
    resolvePreviewAbilities,
    type DisplayAbilities,
} from "~/lib/card-utils";
import { effectivePower, effectiveToughness } from "~/lib/effective-stats";
import { getColorOverrideDisplay } from "~/lib/color-override";
import { getCounterDisplays, type CounterDisplay } from "~/lib/counters";
import { attachmentHostName } from "~/lib/attachment";
import {
    computeGraveyardMilestones,
    hasMilestoneWord,
    type Milestone,
} from "~/lib/graveyard-milestones";
import type { CardInstance, Player } from "~/types/game";
import type { EmblemInstance } from "@convex/cards/types";

// The visual content of one card-preview face — the shape consumed by
// `CardPreviewFace` and, through it, the three preview surfaces (anchored dock,
// hold-zoom dock, mobile overlay). Built by `buildPreviewBody` so the same
// derivation feeds both the CURRENT face (presented identity, live instance)
// and the ORIGINAL face of a copy (printed identity, no instance overrides —
// CR 707.2). See the copy-card-preview design (#-copy-preview).
export type PreviewBodyContent = {
    cardName: string;
    displayName: string;
    /** Primary preview art — the `art` WebP rendition (626×457). Null for a
     *  token with no printed art (the face renders a placeholder instead). */
    imageSrc: string | null;
    /** onError fallback for `imageSrc` — the always-present art_crop JPG.
     *  Old printings lack the `art` WebP rendition (see src/lib/images.ts),
     *  so the face swaps to this on a 404. */
    imageFallbackSrc: string | null;
    /** The printed full card (grid 488w WebP) — the secondary "printed card"
     *  surface of the phase-2 preview toggle. Null for tokens without a
     *  printed identity (the toggle hides then). */
    printedImageSrc: string | null;
    types: string[];
    subtypes: string[];
    staticAbilities: string[];
    manaCost: string | null;
    typeLine: string;
    oracleParagraphs: string[] | null;
    bodyAbilities: DisplayAbilities;
    hasBody: boolean;
    hasPT: boolean;
    effPower?: number;
    effToughness?: number;
    basePower?: number;
    baseToughness?: number;
    ptModified: boolean;
    counterDisplays: CounterDisplay[];
    notedMana?: { mana: Record<string, number>; castableCardId?: string };
    colorName: string | null;
    ownerName: string | null;
    /** Host this permanent is attached to (CR 303.4 Aura / CR 301.5 Equipment)
     *  — a card name, or a player name for an "enchant player" Aura. The
     *  preview prints it as "Attached to: X" so a stacked Aura/Equipment always
     *  states WHAT it enchants, which the board art alone can't (an Aura
     *  enchanting an Aura). Absent for a face with no live instance (the
     *  ORIGINAL face of a copy, emblems, designations). */
    attachedToName?: string | null;
    /** Live graveyard-progress lookup for the controller of this card, keyed by
     *  ability word (delirium / threshold — see graveyard-milestones.ts). Non-
     *  null only in-game for a card whose oracle text carries such a word; the
     *  preview splices a progress chip next to the word. */
    milestones: Map<string, Milestone> | null;
};

// Only the fields of the game context that a preview face reads. Accepting a
// structural subset keeps this pure-ish builder decoupled from the full
// GameContext type (and lets tests pass a minimal object).
type PreviewGameCtx = {
    allPlayers: Player[];
    playerId: string;
    /** CR 114 (issue #1221) — command-zone emblems, so a preview's effective
     *  P/T folds in an owner-scoped emblem anthem. Structurally forwarded from
     *  `GameContext.emblems`. */
    emblems?: EmblemInstance[];
};

// Builds one preview face from a definition id.
//
// - CURRENT face: pass `cardInstance` + `gameCtx` (+ the presented `cardName`)
//   to fold in the live instance — effective P/T (CR 611/613 layer 7c +
//   counters), counters, color override, owner label, granted abilities.
// - ORIGINAL face: pass ONLY the `copiedFrom` def id. With no `cardInstance`
//   and no `gameCtx` every live override falls back to the printed definition,
//   so the result is the original card's pure printed identity (name, art,
//   type line, oracle text, printed P/T) — CR 707.2 copiable-values snapshot.
export function buildPreviewBody(
    defId: string,
    cardInstance?: CardInstance,
    gameCtx?: PreviewGameCtx | null,
    fallbackName?: string
): PreviewBodyContent {
    const def = tryGetDefinition(defId);
    const abilities = def
        ? getDisplayAbilities(defId, cardInstance)
        : { keywords: [], activated: [], triggered: [] };
    const manaCost = manaCostToString(def?.manaCost);
    const typeLine = formatTypeLine(
        cardInstance?.types ?? def?.types,
        cardInstance?.subtypes ?? def?.subtypes,
        def?.supertypes
    );
    const types = cardInstance?.types ?? def?.types ?? [];
    const subtypes = cardInstance?.subtypes ?? def?.subtypes ?? [];
    const isCreatureCard = types.includes("Creature");
    // CR 613.1f — while a "loses all abilities" static applies (Blood Moon on a
    // nonbasic land, Humility, Titania's Song) the PRINTED oracle text states
    // the opposite of the card's current state. Suppressing it hands the rules
    // box to the structured ability block, which `getDisplayAbilities` has
    // already marked row by row: printed abilities and grants that predate the
    // stripper render struck-through, a grant with a later timestamp stays
    // live (CR 613.7). Showing the printed paragraphs instead would tell the
    // player a Moon'd Urza's Saga still has its chapters and its own granted
    // "{T}: Add {C}" — neither of which the engine will honour.
    const abilitiesStripped = !!cardInstance?.abilitiesSuppressedBy?.length;
    const showOracleText =
        shouldShowOracleText(def, types, subtypes) && !abilitiesStripped;
    const oracleParagraphs = showOracleText
        ? resolveChosenMode(
              resolveChosenSubtypes(
                  def!.oracleText!.split("\n").filter((p) => p.length > 0),
                  cardInstance?.chosenSubtypes
              ),
              def ?? undefined,
              cardInstance?.chosenModeId
          )
        : null;
    const basePower = def?.power;
    const baseToughness = def?.toughness;
    // Effective P/T (CR 611, 613 — layer 7c static buffs + counters) only
    // computable under a game context with the full battlefield. Without one
    // (deck builder, or the printed ORIGINAL face) fall back to printed P/T.
    const effPower =
        cardInstance && gameCtx
            ? effectivePower(gameCtx.allPlayers, cardInstance, gameCtx.emblems)
            : (cardInstance?.power ?? basePower);
    const effToughness =
        cardInstance && gameCtx
            ? effectiveToughness(
                  gameCtx.allPlayers,
                  cardInstance,
                  gameCtx.emblems
              )
            : (cardInstance?.toughness ?? baseToughness);
    const ptModified =
        basePower !== undefined &&
        baseToughness !== undefined &&
        (effPower !== basePower || effToughness !== baseToughness);
    const hasPT =
        isCreatureCard &&
        (effPower !== undefined || effToughness !== undefined);
    const bodyAbilities = resolvePreviewAbilities(abilities, showOracleText);
    const hasBody =
        bodyAbilities.keywords.length > 0 ||
        bodyAbilities.activated.length > 0 ||
        bodyAbilities.triggered.length > 0;
    const displayName = def?.name ?? fallbackName ?? defId;
    const imageId = resolveCardImageId(defId);
    // A transformed permanent's `defId` is the registered back-face
    // definition (CR 712); resolve its rendered CDN face (issue #1595) so the
    // hover/zoom preview matches the board art.
    const face = resolveCardImageFace(defId);
    const imageSrc = imageId ? getArtImageUrl(imageId, face) : null;
    const imageFallbackSrc = imageId ? getArtCropImageUrl(imageId, face) : null;
    const printedImageSrc = imageId
        ? getPrintedCardImageUrl(imageId, face)
        : null;
    const showOwner =
        !!cardInstance &&
        !!gameCtx &&
        cardInstance.zone === "battlefield" &&
        cardInstance.controllerId !== gameCtx.playerId;
    const ownerName = showOwner
        ? (gameCtx!.allPlayers.find((p) => p.id === cardInstance!.ownerId)
              ?.name ?? null)
        : null;

    const colorDisplay = cardInstance?.colorOverride?.length
        ? getColorOverrideDisplay(cardInstance.colorOverride)
        : null;

    const counterDisplays = cardInstance
        ? getCounterDisplays(cardInstance)
        : [];

    // Live delirium/threshold progress (CR 702.D / 702.T) for the controller of
    // this card. Only in-game (needs a graveyard) and only for cards whose
    // oracle text carries the ability word — the preview reads the CONTROLLER's
    // graveyard so the conditional clause's on/off state is shown from the
    // perspective of whoever would resolve it. The ORIGINAL face of a copy has
    // no instance/context and thus no chips.
    const milestones =
        oracleParagraphs && cardInstance && gameCtx
            ? oracleParagraphs.some(hasMilestoneWord)
                ? milestonesForController(cardInstance, gameCtx)
                : null
            : null;

    return {
        cardName: displayName,
        displayName,
        imageSrc,
        imageFallbackSrc,
        printedImageSrc,
        types,
        subtypes,
        staticAbilities:
            cardInstance?.staticAbilities ?? def?.staticAbilities ?? [],
        manaCost,
        typeLine,
        oracleParagraphs,
        bodyAbilities,
        hasBody,
        hasPT,
        effPower,
        effToughness,
        basePower,
        baseToughness,
        ptModified,
        counterDisplays,
        notedMana: cardInstance?.notedMana,
        colorName: colorDisplay?.name ?? null,
        ownerName,
        attachedToName:
            cardInstance && gameCtx
                ? attachmentHostName(cardInstance, gameCtx.allPlayers)
                : null,
        milestones,
    };
}

/** Builds a preview face for a command-zone emblem (CR 114, issue #1221).
 *  An emblem is NOT a card registry entry, so `buildPreviewBody` (which
 *  resolves a `CardDefinition`) can't be used — this hand-builds the same
 *  `PreviewBodyContent` struct directly from the wire-denormalized emblem
 *  fields (name, oracle text, art print id). Feeds the exact same preview
 *  surfaces (anchored dock, hover dock, mobile overlay) via
 *  `CardPreview`'s `bodyOverride`. The art uses the same `art` WebP →
 *  `art_crop` JPG fallback as every card face; when the emblem declares no
 *  `imagePrintId` the face renders the in-app placeholder (`imageSrc` null).
 *  No P/T, mana cost, counters, or granted-ability chips — an emblem is pure
 *  continuous/triggered text, shown as its oracle paragraphs. */
export function buildEmblemPreviewBody(
    emblem: EmblemInstance
): PreviewBodyContent {
    const id = emblem.imagePrintId;
    const oracleParagraphs = emblem.text
        .split("\n")
        .filter((p) => p.length > 0);
    return {
        cardName: emblem.name,
        displayName: emblem.name,
        imageSrc: id ? getArtImageUrl(id) : null,
        imageFallbackSrc: id ? getArtCropImageUrl(id) : null,
        printedImageSrc: id ? getPrintedCardImageUrl(id) : null,
        types: [],
        subtypes: [],
        staticAbilities: [],
        manaCost: null,
        typeLine: "Emblem",
        oracleParagraphs: oracleParagraphs.length > 0 ? oracleParagraphs : null,
        bodyAbilities: { keywords: [], activated: [], triggered: [] },
        hasBody: false,
        hasPT: false,
        ptModified: false,
        counterDisplays: [],
        colorName: null,
        ownerName: null,
        milestones: null,
    };
}

/** Preview body for a state designation (The Monarch / City's Blessing) — the
 *  emblem-parallel for a game-state status a player holds (issue #1199 / #1305).
 *  Mirrors {@link buildEmblemPreviewBody}: marker-card art with the same WebP →
 *  JPG fallback, oracle paragraphs, a `Designation` type line, and no P/T /
 *  mana / counters. `imagePrintId` is always present for a designation, so the
 *  in-app placeholder branch is never taken. */
export function buildDesignationPreviewBody(designation: {
    name: string;
    text: string;
    imagePrintId: string;
}): PreviewBodyContent {
    const id = designation.imagePrintId;
    const oracleParagraphs = designation.text
        .split("\n")
        .filter((p) => p.length > 0);
    return {
        cardName: designation.name,
        displayName: designation.name,
        imageSrc: getArtImageUrl(id),
        imageFallbackSrc: getArtCropImageUrl(id),
        printedImageSrc: getPrintedCardImageUrl(id),
        types: [],
        subtypes: [],
        staticAbilities: [],
        manaCost: null,
        typeLine: "Designation",
        oracleParagraphs: oracleParagraphs.length > 0 ? oracleParagraphs : null,
        bodyAbilities: { keywords: [], activated: [], triggered: [] },
        hasBody: false,
        hasPT: false,
        ptModified: false,
        counterDisplays: [],
        colorName: null,
        ownerName: null,
        milestones: null,
    };
}

/** Splices an on-entry ordered pair of basic land types (CR 614.12, ADR 0050 —
 *  Illusionary Terrain's `chosenSubtypes`) into the printed oracle text so the
 *  preview reflects the actual choice: "the first chosen type" → "the Forest
 *  type", "the second chosen type" → "the Island type". Until the pair is
 *  chosen (or on a card without this template) the paragraphs pass through
 *  unchanged. */
function resolveChosenSubtypes(
    paragraphs: string[],
    pair: string[] | undefined
): string[] {
    if (!pair || pair.length < 2) return paragraphs;
    const [first, second] = pair;
    return paragraphs.map((p) =>
        p
            .replace(/first chosen type/g, `${first} type`)
            .replace(/second chosen type/g, `${second} type`)
    );
}

/** CR 700.2c — names the mode a PERMANENT locked in as it entered, in its own
 *  printed oracle text.
 *
 *  "Prevent all damage … by sources of the last chosen color" says nothing
 *  about WHICH colour is currently chosen, and on Chromatic Armor that colour
 *  changes during the game (its `{X}` re-choose). The chosen mode is stored on
 *  the instance as `chosenModeId`, and the definition's matching mode carries
 *  the human label, so the preview annotates the phrase in place — the printed
 *  wording is preserved, the live answer added: "… the last chosen color
 *  (white)".
 *
 *  Falls back to a trailing "Chosen: white" line when the text speaks of a
 *  choice the phrase-match didn't catch. A card whose text never says "chosen"
 *  is left alone — a spell's cast-time mode is not a live characteristic of a
 *  permanent and has no business in its rules box. */
function resolveChosenMode(
    paragraphs: string[],
    def: { modes?: ReadonlyArray<{ id: string; label: string }> } | undefined,
    chosenModeId: string | undefined
): string[] {
    if (!chosenModeId || !def?.modes) return paragraphs;
    const mode = def.modes.find((m) => m.id === chosenModeId);
    if (!mode) return paragraphs;
    const label = mode.label || mode.id;
    const phrase = /chosen colou?r/i;
    if (paragraphs.some((p) => phrase.test(p))) {
        return paragraphs.map((p) =>
            p.replace(
                new RegExp(phrase.source, "gi"),
                (match) => `${match} (${label})`
            )
        );
    }
    if (paragraphs.some((p) => /\bchosen\b/i.test(p))) {
        return [...paragraphs, `Chosen: ${label}`];
    }
    return paragraphs;
}

/** Graveyard milestones (delirium/threshold) read from the CONTROLLER's
 *  graveyard — falling back to owner, then the viewer, so a card in hand (no
 *  distinct controller yet) still reports its holder's progress. */
function milestonesForController(
    cardInstance: CardInstance,
    gameCtx: PreviewGameCtx
): Map<string, Milestone> | null {
    const perspectiveId =
        cardInstance.controllerId ?? cardInstance.ownerId ?? gameCtx.playerId;
    const graveyard = gameCtx.allPlayers.find(
        (p) => p.id === perspectiveId
    )?.graveyard;
    return graveyard ? computeGraveyardMilestones(graveyard) : null;
}
