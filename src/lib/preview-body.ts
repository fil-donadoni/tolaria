import { tryGetDefinition } from "@convex/cards";
import {
    getArtCropImageUrl,
    getArtImageUrl,
    getPrintedCardImageUrl,
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
    const showOracleText = shouldShowOracleText(def, types, subtypes);
    const oracleParagraphs = showOracleText
        ? resolveChosenSubtypes(
              def!.oracleText!.split("\n").filter((p) => p.length > 0),
              cardInstance?.chosenSubtypes
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
    const imageSrc = imageId ? getArtImageUrl(imageId) : null;
    const imageFallbackSrc = imageId ? getArtCropImageUrl(imageId) : null;
    const printedImageSrc = imageId ? getPrintedCardImageUrl(imageId) : null;
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
        milestones,
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
