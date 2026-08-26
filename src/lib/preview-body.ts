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
import { getEffectiveColorDisplay } from "~/lib/color-override";
import { getCounterDisplays, type CounterDisplay } from "~/lib/counters";
import { attachmentHostName } from "~/lib/attachment";
import {
    computeGraveyardMilestones,
    hasMilestoneWord,
    type Milestone,
} from "~/lib/graveyard-milestones";
import type { CardInstance, Player } from "~/types/game";
import type {
    CardDefinition,
    EffectOp,
    EmblemInstance,
} from "@convex/cards/types";

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
    /** CR 302.6 / 502.1 — true while this permanent's one-shot "doesn't untap
     *  during its controller's next untap step" flag is armed (Tangle, Barl's
     *  Cage, Goblin Rock Sled). Shown unconditionally (not folded into
     *  `oracleParagraphs`, which is null for a card with no reason to print
     *  its full oracle text) so the player always sees the pending
     *  restriction regardless of whether the permanent's own printed text
     *  happens to be visible. */
    skipNextUntap?: boolean;
    /** Live graveyard-progress lookup for the controller of this card, keyed by
     *  ability word (delirium / threshold — see graveyard-milestones.ts). Non-
     *  null only in-game for a card whose oracle text carries such a word; the
     *  preview splices a progress chip next to the word. */
    milestones: Map<string, Milestone> | null;
    /** True only in a Manual Game (ADR 0080, issue #2346) — forwarded from
     *  `gameCtx.isManualGame`. A manual card is a bare `card: { id }` with no
     *  hydrated `CardDefinition`, so every computed field above (oracle text,
     *  granted abilities, effective P/T) is genuinely empty rather than merely
     *  unavailable; `CardPreviewBody` uses this to render ONLY the printed
     *  card image and hide the Live text / Printed card toggle, instead of
     *  showing an empty "live text" face. Always `false` for the GRE board
     *  (its `GameContext` never sets `isManualGame`) and for a face built with
     *  no game context at all (the ORIGINAL face of a copy, emblems,
     *  designations). */
    isManualGame: boolean;
    /** How the ENGINE implements this card's effect (ADR 0103 §9, issue
     *  #2728) — drives the Card Preview's "Engine view" slot, which #2704
     *  fills with the real keyword/target/effect tree; until then the slot
     *  renders only this badge. `null` when there is no `CardDefinition` to
     *  read (an emblem/designation face, or a definition-less id) — the slot
     *  renders nothing rather than a misleading badge. Optional (not just
     *  nullable) so existing hand-built `PreviewBodyContent` fixtures
     *  predating this field keep compiling unchanged. */
    engineView?: EngineViewBadge | null;
};

/** How the engine implements a card's effect, read off the real
 *  `CardDefinition` — never a projected/wire field. `tryGetDefinition` is a
 *  client-side registry lookup (`convex/cards/registry.ts`) and
 *  `projectPublicState` never touches `CardDefinition`, so this is safe to
 *  compute purely client-side (ADR 0045/0046, issue #2728). */
export type EngineViewBadge =
    /** At least one resolution body on the card is HAND-WRITTEN TypeScript —
     *  `resolve()`, `resolveSteps[]`, or an ability's mana-ability `effect`
     *  closure. Wins outright over any Effect Script elsewhere on the same
     *  card: the badge is a claim about how the engine READS the card, and
     *  "some of it is imperative" is the honest reading. */
    | { kind: "protocol" }
    /** Every resolution body is declarative — an Effect Script (`effects[]`)
     *  or the registry `effect` shorthand — and there is at least one. */
    | { kind: "dsl"; opCount: number }
    /** No resolution body at all: a vanilla/French-vanilla creature, a basic
     *  land, a pure-`staticEffects[]` anthem. 24.6% of the catalogue. The
     *  slot still renders (it is #2704's mount point) but shows NO chip —
     *  a `DSL` chip here would assert a script the card does not have. */
    | { kind: "none" };

/** One site on a `CardDefinition` that can carry a resolution body. Structural
 *  (not the nominal `SpellMode`/`ActivatedAbility`/… union) because all four
 *  shapes are read identically here, and because `effect` means two different
 *  things depending on the owner — see {@link hasHandWrittenBody}. */
type ResolutionSite = {
    resolve?: unknown;
    resolveSteps?: unknown[];
    effect?: unknown;
    effects?: readonly EffectOp[];
};

/** Every site on `def` that can carry a resolution body — the single census
 *  both the imperative check and the Op count walk, so the two can never
 *  disagree about which producers exist (`convex/cards/types.ts`):
 *
 *  | site                                  | bodies it can carry                      |
 *  | ------------------------------------- | ---------------------------------------- |
 *  | the card itself                       | `resolve`, `resolveSteps`, `effect`(*), `effects` |
 *  | `modes[]` (modal spell, CR 700.2)     | `resolve`, `resolveSteps`, `effects`     |
 *  | `triggeredAbilities[]` + their modes  | `resolve`, `resolveSteps`, `effects`     |
 *  | `activatedAbilities[]` + their modes  | + the mana-ability `effect` CLOSURE      |
 *  | `grantTemplates[]` + their modes      | idem — a granted activated ability       |
 *  | `triggeredGrantTemplates[]` + modes   | idem — a granted triggered ability       |
 *  | `delayedTriggers[]` (CR 603.7a)       | `resolve`, `resolveSteps`, `effects`     |
 *
 *  (*) on the CARD, `effect` is the declarative `EffectShorthand` registry key,
 *  never a closure — see {@link hasHandWrittenBody}.
 *
 *  `chapterAbilities[]` (CR 714) is deliberately absent: `expandDefinition`
 *  (`convex/cards/registry.ts`) desugars it into `triggeredAbilities[]` before
 *  any registry lookup returns, and every path into this module goes through
 *  `tryGetDefinition`, so the chapters are already in the array above. */
function resolutionSites(def: CardDefinition): ResolutionSite[] {
    const sites: ResolutionSite[] = [def];
    for (const mode of def.modes ?? []) sites.push(mode);
    for (const ability of [
        ...(def.triggeredAbilities ?? []),
        ...(def.activatedAbilities ?? []),
        // Granted abilities (Urza's Saga chapter II, Splinter Twin, Zombie
        // Master) live in their own template arrays and never appear in the
        // two above — omitting them read Urza's Saga, whose granted ability
        // is a documented protocol-like `resolve()`, as `DSL · 5`.
        ...(def.grantTemplates ?? []),
        ...(def.triggeredGrantTemplates ?? []),
    ]) {
        sites.push(ability);
        for (const mode of ability.modes ?? []) sites.push(mode);
    }
    for (const t of def.delayedTriggers ?? []) sites.push(t);
    return sites;
}

/** True when this site's body is hand-written TypeScript rather than data —
 *  the DSL-first escape hatch a card earns only with a recorded justification
 *  (ADR 0045, `.claude/rules/gre-development.md` § DSL-first authoring, which
 *  names all three of `resolve()` / `resolveSteps` / `effect`).
 *
 *  The `typeof === "function"` test on `effect` is load-bearing, because the
 *  field is overloaded: on an `ActivatedAbility` it is the mana-ability
 *  CLOSURE (`(ctx: ActivatedAbilityContext) => void`, `types.ts` — Black
 *  Lotus, Sol Ring, Birds of Paradise, every dual land), while on the
 *  `CardDefinition` it is `EffectShorthand`, a declarative registry key the
 *  engine compiles at lookup time (Disenchant, Stone Rain). Same name,
 *  opposite verdicts. */
function hasHandWrittenBody(site: ResolutionSite): boolean {
    return (
        typeof site.resolve === "function" ||
        typeof site.effect === "function" ||
        (Array.isArray(site.resolveSteps) && site.resolveSteps.length > 0)
    );
}

/** Counts Effect Script Ops, walking every structural nesting shape the DSL
 *  admits (ADR 0045/0046): a plain list, `if`'s `then`/`else` branches, a
 *  `choice`/modal Op's `modes[]`, and the inline bodies of `forEach` /
 *  `delayedTrigger` / `reflexiveTrigger` — all keyed `effects`
 *  (`convex/cards/types.ts`). A presence count, not the interpreter-coverage
 *  `n/n` the real Engine View tree (#2704) computes. */
function countEffectOps(effects: readonly EffectOp[] | undefined): number {
    if (!effects) return 0;
    let count = 0;
    for (const op of effects) {
        count += 1;
        const nested = op as unknown as {
            effects?: EffectOp[];
            then?: EffectOp[];
            else?: EffectOp[];
            modes?: { effects?: EffectOp[] }[];
        };
        count += countEffectOps(nested.effects);
        count += countEffectOps(nested.then);
        count += countEffectOps(nested.else);
        for (const mode of nested.modes ?? [])
            count += countEffectOps(mode.effects);
    }
    return count;
}

/** Declarative Ops contributed by ONE site: its Effect Script, plus 1 for the
 *  `EffectShorthand` (a single registered primitive — `effectRegistry.ts`)
 *  when the site carries one. A closure-valued `effect` is never counted here
 *  — {@link hasHandWrittenBody} has already ruled the whole card `protocol`. */
function countSiteOps(site: ResolutionSite): number {
    const shorthand =
        site.effect !== undefined && typeof site.effect !== "function" ? 1 : 0;
    return shorthand + countEffectOps(site.effects);
}

/** Reads the DSL/protocol badge straight off the real `CardDefinition` (see
 *  {@link EngineViewBadge}). Protocol wins over DSL when a card carries both
 *  (Mishra's Factory: an imperative mana closure beside two Effect Scripts) —
 *  the fail-safe direction, since the alternative advertises a purity the
 *  card does not have. */
export function computeEngineViewBadge(def: CardDefinition): EngineViewBadge {
    const sites = resolutionSites(def);
    if (sites.some(hasHandWrittenBody)) return { kind: "protocol" };
    const opCount = sites.reduce((n, site) => n + countSiteOps(site), 0);
    return opCount > 0 ? { kind: "dsl", opCount } : { kind: "none" };
}

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
    /** Manual Game discriminator (issue #2346) — structurally forwarded from
     *  `GameContext.isManualGame`. Only `makeManualGameContext`
     *  (`~/lib/manual-game-context`) ever sets it; the GRE's own context value
     *  never declares the field, so it reads `undefined` there, same as
     *  `false`. Optional here (rather than required) is exactly what lets
     *  `GameContext` — which has no such field — satisfy this structural
     *  subset without changing `useGameContext.ts`. */
    isManualGame?: boolean;
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
        ? resolveChosenName(
              resolveChosenMode(
                  resolveChosenSubtypes(
                      def!.oracleText!.split("\n").filter((p) => p.length > 0),
                      cardInstance?.chosenSubtypes
                  ),
                  def ?? undefined,
                  cardInstance?.chosenModeId
              ),
              cardInstance?.chosenName
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

    const colorDisplay = cardInstance
        ? getEffectiveColorDisplay(cardInstance)
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
        skipNextUntap: !!cardInstance?.skipNextUntap,
        milestones,
        isManualGame: !!gameCtx?.isManualGame,
        engineView: def ? computeEngineViewBadge(def) : null,
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
        // Emblems are GRE-only (CR 114 command zone) — a Manual Game has no
        // GRE state to emit one from, so this is never true in practice; kept
        // explicit rather than defaulted so the field's meaning stays uniform
        // across every `PreviewBodyContent` producer.
        isManualGame: false,
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
        // Designations (Monarch, City's Blessing) are GRE-only status the
        // Manual Board never tracks — see buildEmblemPreviewBody above.
        isManualGame: false,
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

/** CR 614.12 / 201.3 — names the card a PERMANENT locked in as it entered, in
 *  its own printed oracle text.
 *
 *  "Spells with the chosen name can't be cast" (Meddling Mage) says nothing
 *  about WHICH name is chosen, and the name is per-instance: two Mages on the
 *  same board lock different cards. The pick is stored on the instance as
 *  `chosenName` (forwarded intact by `slimCard`), so the preview annotates the
 *  phrase in place — printed wording preserved, live answer added: "… the
 *  chosen name (Lightning Bolt)".
 *
 *  Falls back to a trailing "Chosen: <name>" line when the text speaks of a
 *  choice the phrase-match didn't catch, exactly like `resolveChosenMode`. A
 *  permanent with no name locked in (never chosen, or cleared by a zone change
 *  per CR 400.7) is left alone. */
function resolveChosenName(
    paragraphs: string[],
    chosenName: string | undefined
): string[] {
    if (!chosenName) return paragraphs;
    const phrase = /chosen name/i;
    if (paragraphs.some((p) => phrase.test(p))) {
        return paragraphs.map((p) =>
            p.replace(
                new RegExp(phrase.source, "gi"),
                (match) => `${match} (${chosenName})`
            )
        );
    }
    if (paragraphs.some((p) => /\bchosen\b/i.test(p))) {
        return [...paragraphs, `Chosen: ${chosenName}`];
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
