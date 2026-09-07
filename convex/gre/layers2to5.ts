// CR 613.1b-e layers 2-5 — control, text-changing, type-changing and colour
// effects, derived per read from the Continuous Effects Registry
// (`gre/continuousEffects.ts`, ADR 0082, PRD #2064 S4).
//
// This is the slice that completes ADR 0082's "all CR 613 layers, one model"
// bound: after it, no characteristic-changing continuous effect in ANY layer is
// derived outside the registry. Layer 7 came first (S2, #3003), layer 6 second
// (S3, #3004); the four layers here are the remainder.
//
// WHAT CHANGED. Layers 2-5 used to be MATERIALISE-AT-APPLY, and worse than
// layer 6 was: three separate walks over `staticEffects[]`
// (`beginApplyingStaticEffects`, `applyExistingGrantsTo`,
// `stopApplyingStaticEffects`) each pushed provenance rows onto the affected
// permanent and each had to know how to hand an occupancy back. The rows were
// the authority, so an `applies` predicate that stopped holding was invisible
// until something happened to re-walk. Here the rows are DERIVED OUTPUT — the
// same trade S3 made for `staticAbilities`.
//
// LEDGER vs OUTPUT. The split S3 introduced for layer 6 (`abilityLossHolds` the
// ledger, `abilitiesSuppressedBy` the derived output) is the shape of every
// layer here. A field that records what a RESOLVED spell or ability left behind
// is a ledger and stays authoritative input; a field a reader consults for the
// current answer is output and is overwritten at every sync:
//
//   layer | ledger (input)                          | output
//   ------|------------------------------------------|--------------------------
//     2   | `controlChanges`                         | `controllerId` + battlefield placement
//     3   | `textChangeHolds`                        | `textChanges`
//     4   | `typeLineHolds`, `indefiniteSubtypeSet`, | `types`, `subtypes`,
//         | `temporarySubtypeChange`, `animation`    | `grantedTypes`, `suppressedTypes`,
//         |                                          | `grantedSubtypes`, `grantedSubtypesAdd`,
//         |                                          | `grantedSupertypes`, `removedSupertypes`,
//         |                                          | `printedSubtypes`
//     5   | `colorOverride`, `temporaryColorOverride`| `grantedColors`
//
// and the pre-layer bases — `baseControllerId` (layer 2), `baseTypes` /
// `baseSubtypes` (layer 4) — are the twins of `baseStaticAbilities` (layer 6)
// and `printedSubtypes` (which they supersede): captured lazily at the first
// derivation, when the output field still holds nothing but the base.
//
// Two things re-seat a base. An IDENTITY SWAP (copy / face-down / transform)
// routes through `rebuildCopiableValuesAndReplayOverlays`
// (`gre/identitySwap.ts`), which assigns the layer-4 bases from the new face
// directly — `baseControllerId` is deliberately untouched there, because a
// controller is not a copiable value (CR 613.1a). A rewrite of the object's OWN
// printed characteristics from below the layer system (a CR 614.12c body
// choice) calls `clearLayers2to5Base`, which drops them so the next derivation
// re-captures.
//
// LAYER ORDER (CR 613.7). The four layers are applied 2 → 3 → 4 → 5 in ONE
// walk, so each sees what the earlier ones produced:
//   - layer 2 first, because control decides whose battlefield the permanent is
//     on and therefore which "creatures you control" predicate matches it;
//   - layer 3 before layer 4, because a text change rewrites the very subtype
//     words layer 4 reads (Magical Hack turning `Island` into `Swamp` changes
//     what a "each Island is a 1/1" predicate sees);
//   - layer 4 before layer 5, per the CR's own order.
// Within each layer, entries apply in CR 613.7 timestamp order through the S1
// ordering comparator — never an inline `staticSeq` comparison (#1715).
//
// CR 613.8 dependency ordering runs over each layer's entries before this walk
// consumes them (`gre/dependency.ts`, ADR 0115, issue #2068). Layer 4 is where
// the classic cases live — Blood Moon + Urborg, Conspiracy + Life and Limb — and
// the reordering happens inside one layer's run of the sorted array, never
// across the 2 -> 3 -> 4 -> 5 boundary.

import { tryGetDefinition } from "../cards";
import { declaresLayer2to5StaticEffect } from "../cards/registry";
import { tryGetEmblemDefinition } from "../cards/emblems";
import { applyLandTypeReplacement, sameOrder } from "./constants";
import { compareContinuousEffects } from "./continuousEffects";
import type { DependencyTemplate } from "./dependency";
import { CDA_STATIC_EFFECT_KINDS } from "./dependency";
import { orderByDependency } from "./dependency";
import { applySubstitution } from "./textChanges";
import type { ContinuousEffect } from "./continuousEffects";
import type { Duration } from "./state";
import { emblemAsStaticSource, STATIC_EFFECT_CTX } from "./layers";
import type { LayerStateView } from "./layers";
import type {
    CardSupertype,
    CardType,
    Color,
    PermanentView,
    StaticEffect,
    TextChange,
} from "../cards/types";
import type { CardInstanceState, GameState } from "./state";

/** The `StaticEffect` kinds layers 2-5 own, each mapped to ITS layer
 *  (CR 613.1b-e). A `Record` rather than a set, because the layer is the thing
 *  the walk needs: an entry is built with the layer its kind belongs to, and a
 *  kind that belongs to no layer here is not ours.
 *
 *  Layer 3 has no row: no card declares a text-changing STATIC ability. Every
 *  text change in the engine is left behind by a resolving spell
 *  (`SpellContext.addTextChange` — Magical Hack, Sleight of Mind), which is a
 *  ledger provenance, not a source one. */
export const LAYER_2_5_STATIC_EFFECT_KINDS: Record<string, 2 | 4 | 5> = {
    "control-change": 2,
    "type-add": 4,
    "type-remove": 4,
    "subtype-set": 4,
    "subtype-add": 4,
    "supertype-set": 4,
    "color-grant": 5,
};

/** The sentinel source id every non-source-bound mutation is keyed to — the
 *  `"indefinite"` string `SpellContext.setSupertype` / `applyCardTypeSet` have
 *  always written. Re-exported shape-compatibly with `gre/layer6.ts`'s. */
export const INDEFINITE_SOURCE_ID = "indefinite";

/** The live source and `StaticEffect` a DERIVED template entry was built from,
 *  kept beside the entry so the resolver never looks either up again — and so
 *  an emblem's effect, which no card-registry lookup can reach, resolves by the
 *  same path as a permanent's. Mirrors layer 6's and layer 7's. */
type DerivedTemplate = { source: PermanentView; effect: StaticEffect };

/** Everything layers 2-5 produce for one permanent. Every field is DERIVED —
 *  no caller may feed one of them back in as input. */
export type Layers2to5Derivation = {
    /** CR 613.1b layer 2 — the effective controller. `syncLayers2to5` is what
     *  moves the permanent into that player's battlefield array; the
     *  derivation only says who it is. */
    controllerId: string;
    /** CR 613.1c layer 3 — the text changes applying, in timestamp order, in
     *  the shape `applySubstitution` (`gre/textChanges.ts`) reads. */
    textChanges: TextChange[];
    /** CR 613.1d layer 4 — the effective card types and subtypes. */
    types: CardType[];
    subtypes: string[];
    /** CR 613.1d layer 4 — the provenance rows layers 2-5 used to author
     *  directly, kept as DERIVED OUTPUT for the consult sites that still read
     *  them (the client projection, `revertTypeProvenance`, the scenario
     *  round-trip validator) until PRD #2064 S6 deletes them. */
    grantedTypes: { type: string; auraId: string }[];
    suppressedTypes: { type: string; sourceId: string }[];
    grantedSubtypes: { subtypes: string[]; sourceId: string; seq?: number }[];
    grantedSubtypesAdd: { subtype: string; auraId: string; seq?: number }[];
    /** CR 205.4a layer 4 — supertype markers, read live by `hasSupertypeLive`
     *  (`gre/snow.ts`). Derived output like every other row here. */
    grantedSupertypes: { supertype: string; sourceId: string }[];
    removedSupertypes: { supertype: string; sourceId: string }[];
    /** CR 613.1e layer 5 — the colour grants applying, in the shape
     *  `getEffectiveColors` (`cards/effectiveColors.ts`) unions onto the
     *  mana-cost-derived colours. The colour SET (`colorOverride`) is a ledger,
     *  not output: CR 105.3 makes a set replace every colour, and the only
     *  writers are resolving spells (`applyColorOverrideToPermanent`). */
    grantedColors: { color: string; sourceId: string }[];
};

/** CR 613.1b layer 2 — the pre-layer-2 controller: the player who put the
 *  permanent onto the battlefield (CR 108.3), before any control-change effect
 *  applies. Captured lazily from `controllerId` at the first derivation, when
 *  no control change has been materialised into it yet. */
export function layer2Base(card: CardInstanceState): string {
    return card.baseControllerId ?? card.controllerId;
}

/** CR 613.1d layer 4 — the pre-layer-4 card types: everything the permanent has
 *  before any type-changing effect applies (printed, or whatever a copy /
 *  face-down / transform put there). */
export function layer4TypeBase(card: CardInstanceState): CardType[] {
    return card.baseTypes ?? card.types;
}

/** CR 613.1d layer 4 — the pre-layer-4 subtypes. Superseded `printedSubtypes`,
 *  which was captured only when a `subtype-set` first fired and therefore could
 *  not be trusted as a base once `subtypes` became derived output: its fallback
 *  read `target.subtypes`, which would be the derivation's OWN answer. That is
 *  precisely the feedback loop `baseStaticAbilities` was introduced to break for
 *  layer 6. PRD #2064 S6b-part-2 deleted the field. */
export function layer4SubtypeBase(card: CardInstanceState): string[] {
    return card.baseSubtypes ?? card.subtypes;
}

/** Captures every pre-layer base for `card` if it has none yet.
 *
 *  Called at the top of every derivation and by each site that puts a permanent
 *  onto the battlefield, for the same reason `ensureLayer6Base` is: the capture
 *  is only correct while the output fields still hold nothing but the base, and
 *  that is true exactly once. */
export function ensureLayers2to5Base(card: CardInstanceState): void {
    ensureLayer4Base(card);
    if (card.baseControllerId === undefined) {
        // A control change already materialised into `controllerId` (a state
        // persisted before this slice, or a scenario fixture) is recoverable:
        // the bottom of the `controlChanges` stack records who held the
        // permanent before the first change (CR 108.3).
        const stack = card.controlChanges ?? [];
        card.baseControllerId =
            stack.length > 0
                ? stack[0].previousControllerId
                : card.controllerId;
    }
    // One-shot migration for rows persisted before PRD #2064 S4, which recorded
    // only where a change came FROM. The stack is a chain: row i installed the
    // controller row i+1 came from, and the last row installed the controller
    // the permanent is recorded under right now.
    const stack = card.controlChanges;
    if (stack?.some((row) => row.controllerId === undefined)) {
        card.controlChanges = stack.map((row, i) => ({
            ...row,
            controllerId:
                row.controllerId ??
                (i + 1 < stack.length
                    ? stack[i + 1].previousControllerId
                    : card.controllerId),
        }));
    }
}

/** CR 613.1d — the layer-4 half of the base capture, on its own.
 *
 *  Split out because a producer can run on a card that is NOT on the
 *  battlefield yet ("return it to the battlefield. It's an enchantment." stamps
 *  the type line while the card is still mid-flight, `applyEntryTypeLine`), and
 *  such a card's `controllerId` is not its controller yet — the entry funnel
 *  assigns that immediately afterwards. Capturing a layer-2 base there would
 *  freeze the WRONG controller and the next derivation would hand the permanent
 *  straight back to whoever last controlled it (CR 108.3 / 400.7 — the DSK
 *  "Enduring" cycle returning under its owner's control, not the thief's). */
export function ensureLayer4Base(card: CardInstanceState): void {
    // PRD #2064 S6b-part-2 — `types` is the base by construction here. The
    // granted / suppressed provenance rows this capture used to unwind are gone
    // from `CardInstanceState`; a state persisted while they held something is
    // unwound at load, in `migrateLegacyLayer2to5Ledgers` (`gre/serialize.ts`),
    // which is the only moment they are readable at all.
    if (card.baseTypes === undefined) card.baseTypes = [...card.types];
    if (card.baseSubtypes === undefined) {
        card.baseSubtypes = captureSubtypeBase(card);
    }
}

/** CR 613.1d — the layer-4 subtype base for a card that has none captured yet.
 *
 *  Carries the #1715 guard verbatim from the `capturePrintedSubtypes` this
 *  replaces: a subtype that is only present because a live `subtype-add` put it
 *  there is EXCLUDED. The derivation replays those adds from their own records,
 *  so a base that already contained one would make the add immortal — it would
 *  survive its own source leaving play. A subtype the card is actually PRINTED
 *  with is kept even when an add duplicates it. */
function captureSubtypeBase(card: CardInstanceState): string[] {
    const base = [...card.subtypes];
    const adds = (card.subtypeAddHolds ?? []).map((a) => a.subtype);
    if (adds.length === 0) return base;
    const cardId = (card.card as { id?: string }).id;
    const printed = cardId ? (tryGetDefinition(cardId)?.subtypes ?? []) : [];
    return base.filter((s) => printed.includes(s) || !adds.includes(s));
}

/** The static effects a source contributes, resolved through the card registry
 *  (or the emblem registry for a synthetic emblem source).
 *
 *  `modeOverride` resolves a STORED registry entry, whose `effectIndex` was
 *  computed against the mode recorded in its own payload (CR 700.2) — not
 *  against whatever mode the permanent carries now. */
function sourceStaticEffects(
    source: PermanentView,
    modeOverride?: string
): readonly StaticEffect[] {
    const cardId = (source.card as { id?: string }).id;
    if (!cardId) return [];
    const emblem = tryGetEmblemDefinition(cardId);
    if (emblem) return emblem.staticEffects ?? [];
    const def = tryGetDefinition(cardId);
    if (!def) return [];
    const cardEffects = def.staticEffects ?? [];
    // CR 700.2c — a modal permanent also contributes its chosen mode's static
    // effects. Mirrors `getEffectiveStaticEffects` (`gre/state.ts`), kept local
    // to avoid a layers2to5 <-> state import cycle.
    const chosenModeId =
        modeOverride ?? (source as { chosenModeId?: string }).chosenModeId;
    if (!chosenModeId) return cardEffects;
    const mode = def.modes?.find((m) => m.id === chosenModeId);
    const modeEffects = mode?.staticEffects ?? [];
    if (modeEffects.length === 0) return cardEffects;
    if (cardEffects.length === 0) return modeEffects;
    return [...cardEffects, ...modeEffects];
}

/** Every layer-2-to-5 registry entry applying to `target`, in CR 613.7 order
 *  (layer first, then timestamp), paired with the live source each
 *  source-provenance entry was derived from.
 *
 *  This is the ONE place layers 2-5 read a `staticEffects[]` declaration or a
 *  characteristic ledger off a card instance; every consumer below reads
 *  `ContinuousEffect` entries and nothing else.
 *
 *  Three provenances, one entry type, distinguished only by EXPIRY:
 *
 *  - `source` — a battlefield permanent's or command-zone emblem's static
 *    ability, DERIVED per read by walking the board. A leave-the-battlefield, a
 *    control change, a phase-out and an `applies` predicate that stops holding
 *    therefore need no purge site and cannot drift (CR 613.1: characteristics
 *    are recomputed every time they are checked). This is what deletes the
 *    three-walk materialisation the slice replaces.
 *  - `indefinite` / `instance-duration` — residue of a resolved spell or
 *    ability, read out of the instance's LEDGER fields. The spell has left;
 *    there is nothing to walk, which is exactly why the registry exists. The
 *    remaining boundary countdown stays on the instance until PRD #2064 S6, so
 *    the entry says `instance-duration` rather than claiming a boundary it does
 *    not hold.
 *  - stored `state.continuousEffects` — source-independent AND condition-gated
 *    at once, which no pre-registry channel could be.
 */
/** CR 611.2a — the expiry of an ANIMATION's layer-4 entries. An animation with
 *  a stored boundary ends at it; one without ends only with the game
 *  (CR 611.2a's "if no duration is stated"). Derived per read, so the countdown
 *  it names is still the instance ledger's — see the note in
 *  `layers2to5EffectsFor` on why that cannot double-tick. */
function animationExpiry(
    instance: CardInstanceState,
    animation: { duration?: Duration }
): ContinuousEffect["expiry"] {
    return animation.duration
        ? {
              kind: "duration",
              duration: animation.duration,
              controllerId: instance.controllerId,
          }
        : { kind: "indefinite", controllerId: instance.controllerId };
}

function layers2to5EffectsFor(
    state: LayerStateView,
    target: PermanentView,
    /** The board's source-provenance entries, collected ONCE per sync by
     *  `collectSourceEntries`. They are target-INDEPENDENT — a template entry
     *  carries a `predicate` affected-set, and the predicate is evaluated later,
     *  in `resolveAction`, against the running view — so recollecting them per
     *  target is pure waste: it costs one card-registry lookup per (target,
     *  source) pair, which is quadratic in the board and is paid on every node
     *  the ISMCTS search expands. */
    collected?: SourceEntries
): {
    entries: ContinuousEffect[];
    templates: ReadonlyMap<string, DerivedTemplate>;
} {
    const board = collected ?? collectSourceEntries(state);
    const instance = target as unknown as CardInstanceState;
    // A permanent that contributes NO entries of its own reads the board's
    // list in place: it is already in CR 613.7 order and it is the same list
    // for every target, so copying and re-sorting it per target is allocation
    // with no answer attached.
    if (!carriesLayer2to5State(instance) && !hasStoredLayer2to5Entry(state)) {
        return {
            entries: board.entries as ContinuousEffect[],
            templates: board.templates,
        };
    }
    return finishEffectsFor(
        state,
        target,
        instance,
        [...board.entries],
        new Map(board.templates)
    );
}

/** The board's source-provenance entries and the live source each was derived
 *  from — everything about a sync that does not depend on WHICH permanent is
 *  being derived. */
type SourceEntries = {
    entries: readonly ContinuousEffect[];
    templates: ReadonlyMap<string, DerivedTemplate>;
};

/** True when any STORED registry entry belongs to layers 2-5. Cheap and
 *  board-wide, so the fast paths can ask it once. */
function hasStoredLayer2to5Entry(state: LayerStateView): boolean {
    const stored = state.continuousEffects;
    if (!stored?.length) return false;
    for (const entry of stored) {
        if (entry.layer >= 2 && entry.layer <= 5) return true;
    }
    return false;
}

/** True when the permanent carries ANY layer-2-to-5 state: a ledger row this
 *  derivation would read, or an output row a PREVIOUS one wrote and this one
 *  might have to clear. Either way it owes a real derivation.
 *
 *  It also asks whether the permanent's OUTPUT still differs from its BASE,
 *  which is not the same question. An effect that has just ENDED leaves no row
 *  behind — dropping the row IS how a control change, a type-line set or a
 *  subtype replacement ends — but the answer it produced is still sitting in
 *  the field. A permanent whose Aladdin has left carries no `controlChanges`
 *  and is still on the thief's battlefield; skipping it would strand it there
 *  (CR 108.3). "Nothing applies" is only a licence to skip when the fields
 *  already SAY nothing applies. */
function carriesLayer2to5State(card: CardInstanceState): boolean {
    if (
        card.baseControllerId !== undefined &&
        card.baseControllerId !== card.controllerId
    ) {
        return true;
    }
    if (card.baseTypes && !sameOrder(card.baseTypes, card.types)) return true;
    if (card.baseSubtypes && !sameOrder(card.baseSubtypes, card.subtypes)) {
        return true;
    }
    return (
        card.controlChanges !== undefined ||
        card.textChangeHolds !== undefined ||
        card.typeLineHolds !== undefined ||
        card.subtypeAddHolds !== undefined ||
        card.supertypeHolds !== undefined ||
        card.animation !== undefined ||
        card.indefiniteSubtypeSet !== undefined ||
        card.temporarySubtypeChange !== undefined ||
        // The three DERIVED-OUTPUT rows that stayed on the instance (PRD #2064
        // S6b-part-2). Their presence is exactly the "the output still differs
        // from the base" case the doc above describes: a source that has just
        // STOPPED applying leaves no entry behind, but the row it wrote is still
        // sitting here, and skipping the permanent would leave Melting's
        // un-snow marker on a land whose Melting is gone.
        card.grantedSupertypes !== undefined ||
        card.removedSupertypes !== undefined ||
        card.grantedColors !== undefined
    );
}

/** Walks the battlefield and the command zone once, building one template entry
 *  per layer-2-to-5 static effect each object declares. */
function collectSourceEntries(state: LayerStateView): SourceEntries {
    const entries: ContinuousEffect[] = [];
    const templates = new Map<string, DerivedTemplate>();

    const pushSourceEffects = (
        source: PermanentView,
        effects: readonly StaticEffect[]
    ): void => {
        // CR 613.7a — a continuous effect generated by a static ability has the
        // timestamp of the object the ability is on. `staticSeq` is that stamp,
        // minted by `allocStaticTimestamp` the moment the object begins
        // applying (`beginApplyingStaticEffects`, called on EVERY battlefield
        // entry path).
        //
        // An UNSTAMPED source derives at 0 — "earliest in the layer", which is
        // what the three materialising walks this module replaces did
        // (`source.staticSeq ?? 0`). PRD #2064 S6b-part-2 deleted the FLOOR it
        // used to sort at (`UNSTAMPED_SOURCE_TIMESTAMP`, a constant a mint could
        // never reach) and kept the semantics: reachable only from a hand-built
        // fixture — production stamps before it syncs, and a pre-#1730 board is
        // stamped by `backfillLegacyStaticSeq` (`gre/serialize.ts`) before
        // anything reads it — and preserving it is the difference between this
        // slice changing WHERE the answer comes from and changing WHAT it is.
        const seq = (source as { staticSeq?: number }).staticSeq ?? 0;
        for (let index = 0; index < effects.length; index++) {
            const effect = effects[index];
            const layer = LAYER_2_5_STATIC_EFFECT_KINDS[effect.kind];
            if (layer === undefined) continue;
            const sourceCardId = (source.card as { id?: string }).id;
            if (!sourceCardId) continue;
            const id = `ce-src-${source.id}-${index}`;
            templates.set(id, { source, effect });
            entries.push({
                id,
                layer,
                timestamp: seq,
                expiry: { kind: "source", sourceId: source.id },
                affected: { kind: "predicate" },
                payload: {
                    kind: "template",
                    sourceCardId,
                    effectIndex: index,
                    ...((source as { chosenModeId?: string }).chosenModeId
                        ? {
                              modeId: (source as { chosenModeId?: string })
                                  .chosenModeId,
                          }
                        : {}),
                },
                // CR 604.3 — read from the ONE naming authority
                // (`CDA_STATIC_EFFECT_KINDS`, `gre/dependency.ts`) rather than
                // hardcoded, so CR 613.8a clause (c) cannot fail open the day a
                // layer-4 kind becomes characteristic-defining. No layer-2-5
                // kind is one today — a CDA defines a characteristic of the
                // object it is ON, and every kind here changes another
                // object's — but CR 702.73 Changeling is exactly such an
                // ability and is `planned` in the Mechanics Registry.
                characteristicDefining: CDA_STATIC_EFFECT_KINDS.has(
                    effect.kind
                ),
            });
        }
    };

    for (const player of state.players) {
        for (const source of player.battlefield) {
            // The registry-derived precheck (`cards/registry.ts`) answers
            // "declares nothing here" from a `Set.has` on the id, so the
            // overwhelming majority of permanents cost no lookup at all. See
            // `declaresLayer2to5StaticEffect` for why this scan is worth
            // prechecking.
            const cardId = (source.card as { id?: string }).id;
            if (!cardId || !declaresLayer2to5StaticEffect(cardId)) continue;
            const view = source as unknown as PermanentView;
            pushSourceEffects(view, sourceStaticEffects(view));
        }
    }
    // CR 114 — command-zone emblems generate continuous effects like any other
    // object (issue #1221).
    for (const emblem of state.emblems ?? []) {
        const synthetic = emblemAsStaticSource(emblem);
        // CR 613.7d — an emblem receives a timestamp when it enters the command
        // zone, which is what `createEmblem` (`gre/state.ts`) mints on it. PRD
        // #2064 S6b-part-2 replaced the creation-order ordinal that stood in for
        // one; an emblem persisted without a stamp is backfilled on load
        // (`gre/serialize.ts`) and, failing that, skipped like any other
        // unstamped source.
        pushSourceEffects(synthetic, sourceStaticEffects(synthetic));
    }
    // CR 613.7 — sorted ONCE here, not once per target: the board's own order
    // does not depend on which permanent is being derived.
    entries.sort((a, b) => a.layer - b.layer || compareContinuousEffects(a, b));
    return { entries, templates };
}

/** The per-TARGET half: the instance's own ledger rows, plus the stored
 *  registry entries that name it, unioned with the board's entries and sorted
 *  into CR 613.7 order. */
function finishEffectsFor(
    state: LayerStateView,
    target: PermanentView,
    instance: CardInstanceState,
    entries: ContinuousEffect[],
    templates: Map<string, DerivedTemplate>
): {
    entries: ContinuousEffect[];
    templates: ReadonlyMap<string, DerivedTemplate>;
} {
    // --- Instance-borne ledgers (CR 611.2a residue of a resolved spell) -----
    //
    // Every row carries the CR 613.7 stamp its producer minted through
    // `allocStaticTimestamp`. A row without one has no position in its layer
    // and is SKIPPED, the same rule the source half above applies (PRD #2064
    // S6b-part-2): the array-order ordinal that used to stand in for a stamp is
    // gone, and the pre-S4 rows that had none are stamped on load by
    // `migrateLegacyLayer2to5Ledgers` (`gre/serialize.ts`).

    // CR 613.1b layer 2 — control changes left by a RESOLVING spell or ability
    // (Aladdin, Old Man of the Sea, Ghazbán Ogre, Ray of Command). An AURA's
    // control change is not here and never writes a row: it is generated by a
    // static ability, so the board walk above derives it, and it ends the
    // moment the aura leaves or unattaches with nothing to unwind.
    for (const change of instance.controlChanges ?? []) {
        // `controllerId` is filled in for every row by `ensureLayers2to5Base`,
        // including a legacy row persisted before S4; a row without one here
        // would be a row the base capture never saw, which cannot happen.
        const installed = change.controllerId;
        if (installed === undefined || change.seq === undefined) continue;
        entries.push({
            id: `ce-control-${instance.id}-${change.auraId}`,
            layer: 2,
            timestamp: change.seq,
            expiry: change.duration
                ? {
                      kind: "duration",
                      duration: change.duration,
                      controllerId: installed,
                  }
                : { kind: "indefinite", controllerId: installed },
            affected: { kind: "instances", instanceIds: [instance.id] },
            payload: { kind: "control-change", controllerId: installed },
            characteristicDefining: false,
        });
    }

    // CR 612 layer 3 — text changes left by a resolved spell (Magical Hack,
    // Sleight of Mind). No static-ability provenance exists for this layer.
    for (const hold of instance.textChangeHolds ?? []) {
        entries.push({
            id: `ce-text-${instance.id}-${hold.seq}`,
            layer: 3,
            timestamp: hold.seq,
            expiry: { kind: "indefinite", controllerId: instance.controllerId },
            affected: { kind: "instances", instanceIds: [instance.id] },
            payload: { kind: "text-change", change: hold.change },
            characteristicDefining: false,
        });
    }

    // CR 205.1a / 613.1d layer 4 — the one-shot card-type SET (issue #2084,
    // `SpellContext.setCardTypes` / the DSK "Enduring" cycle's entry type
    // line). CR 611.2a: no duration stated, so it lasts until the end of the
    // game — or, in practice, until the permanent leaves and becomes a new
    // object (CR 400.7), which drops the ledger with the instance.
    for (const hold of instance.typeLineHolds ?? []) {
        entries.push({
            id: `ce-typeline-${instance.id}-${hold.seq}`,
            layer: 4,
            timestamp: hold.seq,
            expiry: { kind: "indefinite", controllerId: instance.controllerId },
            affected: { kind: "instances", instanceIds: [instance.id] },
            payload: { kind: "type-change", set: [...hold.types] },
            characteristicDefining: false,
        });
    }

    // CR 208.2 / 611.1 layer 4 — an animation ("becomes a 3/2 Elemental
    // creature", Mishra's Factory / Creeping Tar Pit). Its P/T half is layer 7's
    // (`gre/layers.ts` reads the same record); its TYPE half is this one.
    const animation = instance.animation;
    if (animation) {
        const added: CardType[] = [
            ...(animation.addedCreatureType
                ? (["Creature"] as CardType[])
                : []),
            ...(animation.addedTypes ?? []),
        ];
        if (added.length > 0 && animation.seq !== undefined) {
            entries.push({
                id: `ce-animate-types-${instance.id}`,
                layer: 4,
                timestamp: animation.seq,
                expiry: animationExpiry(instance, animation),
                affected: { kind: "instances", instanceIds: [instance.id] },
                payload: { kind: "type-change", add: added },
                characteristicDefining: false,
            });
        }
        if (
            animation.addedSubtype !== undefined &&
            animation.seq !== undefined
        ) {
            entries.push({
                id: `ce-animate-subtype-${instance.id}`,
                layer: 4,
                timestamp: animation.seq,
                expiry: animationExpiry(instance, animation),
                affected: { kind: "instances", instanceIds: [instance.id] },
                payload: {
                    kind: "subtype-change",
                    add: [animation.addedSubtype],
                },
                characteristicDefining: false,
            });
        }
    }

    // CR 205.1a / 611.2a layer 4 — an INDEFINITE subtype replacement
    // (`SpellContext.setSubtypes` — Figure of Destiny, Living Lands). A staged
    // respec keeps only the LATEST value, which is what the ledger holds.
    const indefiniteSet = instance.indefiniteSubtypeSet;
    if (indefiniteSet?.subtypes && indefiniteSet.seq !== undefined) {
        entries.push({
            id: `ce-subtypeset-${instance.id}`,
            layer: 4,
            timestamp: indefiniteSet.seq,
            expiry: { kind: "indefinite", controllerId: instance.controllerId },
            affected: { kind: "instances", instanceIds: [instance.id] },
            payload: {
                kind: "subtype-change",
                set: [...indefiniteSet.subtypes],
            },
            characteristicDefining: false,
        });
    }

    // CR 305.7 / 611.2a layer 4 — a DURATION-scoped subtype replacement
    // (`SpellContext.setSubtypesUntil` — Orcish Farmer's "target land becomes a
    // Swamp until end of turn"). Layers 2-5 keep their instance-borne
    // countdown for now — PRD #2064 S6 moved layers 6 and 7's into the registry
    // entry, and the layers-2-5 ledgers follow in the slice that deletes the
    // syncs — but the entry states the boundary it actually ends at, because
    // that is a fact about the effect, not about where the counter is stored.
    // These entries are DERIVED per read and never enter
    // `state.continuousEffects`, so the registry's own tick
    // (`tickContinuousEffectDurations`, `gre/phases.ts`) cannot see them and
    // cannot double-count the boundary the instance ledger is already counting.
    const temporarySet = instance.temporarySubtypeChange;
    if (temporarySet && temporarySet.seq !== undefined) {
        entries.push({
            id: `ce-subtypeset-timed-${instance.id}`,
            layer: 4,
            timestamp: temporarySet.seq,
            expiry: {
                kind: "duration",
                duration: temporarySet.duration,
                controllerId: instance.controllerId,
            },
            affected: { kind: "instances", instanceIds: [instance.id] },
            payload: {
                kind: "subtype-change",
                set: [...temporarySet.subtypes],
            },
            characteristicDefining: false,
        });
    }

    // CR 305.7 / 611.2a layer 4 — an INDEFINITE subtype ADD
    // (`SpellContext.addSubtype` — "target land is a Swamp in addition to its
    // other types"). Stamped with a real minted timestamp by its producer
    // (issue #1750), so it orders against a live `subtype-set` by WHEN it
    // resolved rather than as an automatic earliest.
    for (const hold of instance.subtypeAddHolds ?? []) {
        entries.push({
            id: `ce-subtypeadd-${instance.id}-${hold.seq}-${hold.subtype}`,
            layer: 4,
            timestamp: hold.seq,
            expiry: { kind: "indefinite", controllerId: instance.controllerId },
            affected: { kind: "instances", instanceIds: [instance.id] },
            payload: { kind: "subtype-change", add: [hold.subtype] },
            characteristicDefining: false,
        });
    }

    // CR 205.4a layer 4 — indefinite supertype mutations (Arcum's Weathervane's
    // "becomes snow" / "is no longer snow"), keyed to the `"indefinite"`
    // sentinel by `gre/snow.ts`.
    for (const hold of instance.supertypeHolds ?? []) {
        entries.push({
            id: `ce-supertype-${instance.id}-${hold.seq}`,
            layer: 4,
            timestamp: hold.seq,
            expiry: { kind: "indefinite", controllerId: instance.controllerId },
            affected: { kind: "instances", instanceIds: [instance.id] },
            payload: {
                kind: "supertype-change",
                ...(hold.add ? { add: [...hold.add] } : {}),
                ...(hold.remove ? { remove: [...hold.remove] } : {}),
            },
            characteristicDefining: false,
        });
    }

    // Stored entries (`state.continuousEffects`) — the channel that is
    // simultaneously source-INDEPENDENT and condition-GATED.
    for (const stored of state.continuousEffects ?? []) {
        if (stored.layer < 2 || stored.layer > 5) continue;
        if (!entryApplies(stored, target)) continue;
        entries.push(stored);
    }

    // CR 613.7 — layer first (2 → 3 → 4 → 5), then timestamp within the layer.
    // The comparator is the S1 ordering authority; the layer key in front of it
    // is the CR 613 order itself, which no comparator over one layer can carry.
    entries.sort((a, b) => a.layer - b.layer || compareContinuousEffects(a, b));
    // CR 613.8 — dependency overrides the timestamp system, WITHIN a layer.
    // Reordering happens inside each layer's run of the sorted array and never
    // across the layer boundary, so the 2 → 3 → 4 → 5 walk below is untouched.
    return {
        entries: orderByDependency(entries, {
            compare: compareContinuousEffects,
            template: (entry) => resolveTemplate(state, entry, templates),
            ctx: STATIC_EFFECT_CTX,
        }),
        templates,
    };
}

/** The live source and `StaticEffect` behind a template entry, for the CR 613.8
 *  dependency pass. The derived half is already in `templates`; a STORED
 *  template entry names its source by id only, so it is resolved the same way
 *  `resolveAction` resolves it — one lookup, on the entries of one layer. */
function resolveTemplate(
    state: LayerStateView,
    entry: ContinuousEffect,
    templates: ReadonlyMap<string, DerivedTemplate>
): DependencyTemplate | undefined {
    const derived = templates.get(entry.id);
    if (derived) return derived;
    if (entry.payload.kind !== "template") return undefined;
    if (entry.expiry.kind !== "source") return undefined;
    const source = findPermanent(state, entry.expiry.sourceId);
    if (!source) return undefined;
    const effect = sourceStaticEffects(source, entry.payload.modeId)[
        entry.payload.effectIndex
    ];
    return effect ? { source, effect } : undefined;
}

/** Whether a STORED entry applies to `target`. A `predicate`-affected entry is
 *  pinned by its type to `source` expiry and a template payload, so its
 *  predicate is the template's `applies` — resolved in `resolveAction`, which
 *  returns `undefined` when it does not match. */
function entryApplies(entry: ContinuousEffect, target: PermanentView): boolean {
    if (entry.affected.kind === "predicate") return true;
    return entry.affected.instanceIds.includes(target.id);
}

/** What one entry DOES to a permanent's characteristics, once its payload has
 *  been resolved against the live board. The inline payload union of
 *  `ContinuousEffect` restricted to the layers this module owns. */
type Layer2to5Action =
    | { kind: "control-change"; controllerId: string }
    | { kind: "text-change"; change: TextChange }
    | {
          kind: "type-change";
          add?: readonly CardType[];
          remove?: readonly CardType[];
          set?: readonly CardType[];
      }
    | {
          kind: "subtype-change";
          add?: readonly string[];
          set?: readonly string[];
      }
    | {
          kind: "supertype-change";
          add?: readonly CardSupertype[];
          remove?: readonly CardSupertype[];
      }
    | { kind: "color-change"; add?: readonly Color[]; set?: readonly Color[] };

/** Resolves one entry into the action it performs on `target`, or `undefined`
 *  when it performs none — a template whose `applies` predicate does not match
 *  the target, whose CR 611.2c `condition` does not hold on the board, or a
 *  payload belonging to a layer this module does not own.
 *
 *  `target` is the CURRENT view: layer 2's answer is already in its
 *  `controllerId` by the time a layer-3-to-5 predicate is evaluated against it,
 *  and layer 4's running type/subtype line is already in its `types` /
 *  `subtypes` by the time a later layer-4 or layer-5 predicate reads them. That
 *  is CR 613's composition rule made literal: each layer sees what the earlier
 *  ones produced, in the same read. */
function resolveAction(
    state: LayerStateView,
    target: PermanentView,
    entry: ContinuousEffect,
    templates: ReadonlyMap<string, DerivedTemplate>
): Layer2to5Action | undefined {
    if (entry.payload.kind !== "template") {
        const payload = entry.payload;
        switch (payload.kind) {
            case "control-change":
            case "text-change":
            case "type-change":
            case "subtype-change":
            case "supertype-change":
            case "color-change":
                return payload as Layer2to5Action;
            default:
                // A layer-6 or layer-7 payload that reached this walk. Not
                // ours; the owning module reads it.
                return undefined;
        }
    }
    const derived = templates.get(entry.id);
    const source =
        derived?.source ??
        findPermanent(
            state,
            entry.expiry.kind === "source" ? entry.expiry.sourceId : ""
        );
    if (!source) return undefined;
    const effect =
        derived?.effect ??
        sourceStaticEffects(source, entry.payload.modeId)[
            entry.payload.effectIndex
        ];
    if (!effect) return undefined;
    if (LAYER_2_5_STATIC_EFFECT_KINDS[effect.kind] !== entry.layer) {
        return undefined;
    }
    // CR 611.2c — the source-level "as long as ..." gate, evaluated against the
    // whole board (the same `condition` layer 6 and layer 7 read).
    const condition = (
        effect as {
            condition?: (s: LayerStateView, src: PermanentView) => boolean;
        }
    ).condition;
    if (condition && !condition(state, source)) return undefined;
    switch (effect.kind) {
        case "control-change": {
            if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                return undefined;
            }
            // CR 613.1b — the effect grants control to the SOURCE's controller,
            // read LIVE. A snapshot would go stale the moment a second control
            // change moved the source itself.
            return {
                kind: "control-change",
                controllerId: source.controllerId,
            };
        }
        case "type-add":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? { kind: "type-change", add: effect.types }
                : undefined;
        case "type-remove":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? { kind: "type-change", remove: effect.types }
                : undefined;
        case "subtype-add":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? { kind: "subtype-change", add: effect.subtypes }
                : undefined;
        case "subtype-set": {
            // Two forms (ADR 0050): the fixed-output form (Blood Moon) gates
            // with `applies` and replaces with the literal `subtypes`; the
            // computed-output form (Illusionary Terrain) asks `subtypesFor` for
            // the replacement, reading per-source stored state
            // (`source.chosenSubtypes`) and returning null to leave the target
            // untouched. Both read `target` mid-layer-4, so both see the
            // earlier-timestamp effects of this same walk (CR 613 composition).
            const computed = effect.subtypesFor
                ? effect.subtypesFor(target, source, STATIC_EFFECT_CTX)
                : effect.applies!(target, source, STATIC_EFFECT_CTX)
                  ? effect.subtypes!
                  : null;
            return computed === null
                ? undefined
                : { kind: "subtype-change", set: computed };
        }
        case "supertype-set":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? {
                      kind: "supertype-change",
                      ...(effect.add ? { add: effect.add } : {}),
                      ...(effect.remove ? { remove: effect.remove } : {}),
                  }
                : undefined;
        case "color-grant":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? { kind: "color-change", add: effect.colors }
                : undefined;
        default:
            return undefined;
    }
}

/** The battlefield permanent with `id`, as a `PermanentView`, or `undefined`. */
function findPermanent(
    state: LayerStateView,
    id: string
): PermanentView | undefined {
    if (!id) return undefined;
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.id === id) return card as unknown as PermanentView;
        }
    }
    return undefined;
}

/** The source id an entry attributes its effect to, for the provenance rows
 *  that are still derived output. A ledger-borne entry has no source, and has
 *  always been recorded under the `"indefinite"` sentinel. */
function attributionOf(entry: ContinuousEffect): string {
    return entry.expiry.kind === "source"
        ? entry.expiry.sourceId
        : INDEFINITE_SOURCE_ID;
}

/** CR 613.1b-e — everything layers 2-5 produce for one permanent, in CR 613.7
 *  order, from registry entries and nothing else.
 *
 *  ONE walk over the ordered entries, not four: the entries are sorted by layer
 *  and then by timestamp, and the running answer is fed back into the view each
 *  later predicate is evaluated against. That is what makes AC 3 of PRD #2064
 *  S4 ("a control change is visible to every later layer's derivation in the
 *  same read") true by construction rather than by call ordering. */
export function deriveLayers2to5(
    state: LayerStateView,
    target: PermanentView,
    /** The board scan, collected once per sync (see `layers2to5EffectsFor`). */
    collected?: SourceEntries
): Layers2to5Derivation {
    const instance = target as unknown as CardInstanceState;
    const { entries, templates } = layers2to5EffectsFor(
        state,
        target,
        collected
    );

    const result: Layers2to5Derivation = {
        controllerId: layer2Base(instance),
        textChanges: [],
        types: [...layer4TypeBase(instance)],
        subtypes: [...layer4SubtypeBase(instance)],
        grantedTypes: [],
        suppressedTypes: [],
        grantedSubtypes: [],
        grantedSubtypesAdd: [],
        grantedSupertypes: [],
        removedSupertypes: [],
        grantedColors: [],
    };

    // The view every predicate is evaluated against. Rebuilt from the running
    // answer before each entry, so an effect never reads the permanent's
    // PRE-layer state when an earlier-timestamp effect has already changed it.
    let working: PermanentView = viewOf(instance, result);

    for (const entry of entries) {
        const action = resolveAction(state, working, entry, templates);
        if (!action) continue;
        switch (action.kind) {
            case "control-change":
                // CR 613.1b — last timestamp wins; the walk is already ordered,
                // so the final assignment is the latest-applied one.
                result.controllerId = action.controllerId;
                break;
            case "text-change":
                // CR 612.6 — text changes apply in timestamp order, which is
                // the order they are pushed in here. `applySubstitution`
                // (`gre/textChanges.ts`) replays them in array order.
                result.textChanges.push(action.change);
                break;
            case "type-change": {
                const attribution = attributionOf(entry);
                if (action.set) {
                    // CR 205.1a (issue #2084) — a SET replaces the whole card
                    // type line. Recorded through the same granted/suppressed
                    // rows an add/remove writes, so `revertTypeProvenance` and
                    // the client projection see one shape, not two.
                    const next = [...new Set(action.set)];
                    for (const type of next) {
                        if (result.types.includes(type)) continue;
                        result.grantedTypes.push({ type, auraId: attribution });
                    }
                    for (const type of result.types) {
                        if (next.includes(type)) continue;
                        result.suppressedTypes.push({
                            type,
                            sourceId: attribution,
                        });
                    }
                    result.types = next;
                    break;
                }
                for (const type of action.add ?? []) {
                    result.grantedTypes.push({ type, auraId: attribution });
                    if (!result.types.includes(type)) result.types.push(type);
                }
                for (const type of action.remove ?? []) {
                    // Only record a suppression that actually took a type: an
                    // "isn't a creature while attached" on a noncreature
                    // removes nothing, and a row claiming otherwise would make
                    // the type reappear on revert (CR 702.151b, issue #1311).
                    const idx = result.types.indexOf(type);
                    if (idx === -1) continue;
                    result.types.splice(idx, 1);
                    result.suppressedTypes.push({
                        type,
                        sourceId: attribution,
                    });
                }
                break;
            }
            case "subtype-change": {
                const attribution = attributionOf(entry);
                if (action.set) {
                    // CR 305.7 (issue #1883) — a set on a LAND replaces only
                    // the land types; a subtype belonging to another card type
                    // (Saga on `Enchantment Land — Urza's Saga`) survives. A
                    // non-land target has no CR 305.7 analogue and keeps the
                    // wholesale replace.
                    result.subtypes = result.types.includes("Land")
                        ? applyLandTypeReplacement(result.subtypes, [
                              ...action.set,
                          ])
                        : [...action.set];
                    result.grantedSubtypes.push({
                        subtypes: [...action.set],
                        sourceId: attribution,
                        seq: entry.timestamp,
                    });
                    break;
                }
                for (const subtype of action.add ?? []) {
                    result.grantedSubtypesAdd.push({
                        subtype,
                        auraId: attribution,
                        seq: entry.timestamp,
                    });
                    if (!result.subtypes.includes(subtype)) {
                        result.subtypes.push(subtype);
                    }
                }
                break;
            }
            case "supertype-change": {
                const attribution = attributionOf(entry);
                // CR 205.4a / 613.7 — LAST TIMESTAMP WINS, and the walk is
                // already ordered, so an entry's contribution cancels every
                // earlier OPPOSITE one for the same supertype before recording
                // its own. Without the cancel both lists end up holding the
                // supertype at once and `hasSupertypeLive` (`cards/snowReads.ts`)
                // — which checks GRANTED first — answers `true` forever: Arcum's
                // Weathervane could turn a land snow but never turn it back.
                // The pre-migration `applyIndefiniteSupertypeMutation` did this
                // by dropping the opposite marker at write time; a derivation
                // does it by ordering.
                for (const supertype of action.remove ?? []) {
                    result.grantedSupertypes = result.grantedSupertypes.filter(
                        (g) => g.supertype !== supertype
                    );
                    result.removedSupertypes.push({
                        supertype,
                        sourceId: attribution,
                    });
                }
                for (const supertype of action.add ?? []) {
                    result.removedSupertypes = result.removedSupertypes.filter(
                        (r) => r.supertype !== supertype
                    );
                    result.grantedSupertypes.push({
                        supertype,
                        sourceId: attribution,
                    });
                }
                break;
            }
            case "color-change":
                // CR 105.3 — a colour SET replaces every colour the object had.
                // The only writers of a set are resolving spells, whose value
                // lives in the `colorOverride` LEDGER and is applied by
                // `getEffectiveColors`; nothing here produces one today, and a
                // stored entry that did would be handled by the same authority.
                for (const color of action.add ?? []) {
                    result.grantedColors.push({
                        color,
                        sourceId: attributionOf(entry),
                    });
                }
                break;
        }
        working = viewOf(instance, result);
    }

    return result;
}

/** The view a predicate is evaluated against, built from the running answer.
 *
 *  CR 612 / 613.7 — the layer-3 substitution is applied HERE and not to the
 *  derivation's `subtypes` output. Layer 4 must read the text a layer-3 effect
 *  produced (Magical Hack turning `Island` into `Swamp` changes what an "each
 *  Island is a 1/1" predicate matches), which is what this view gives it. The
 *  OUTPUT stays unsubstituted because `applySubstitution` is a READ-TIME
 *  transform every consult site already performs (ADR 0011): baking it into the
 *  stored field as well would apply a chained rewrite twice. */
function viewOf(
    instance: CardInstanceState,
    result: Layers2to5Derivation
): PermanentView {
    const base = {
        ...(instance as unknown as PermanentView),
        controllerId: result.controllerId,
        types: result.types,
        subtypes: result.subtypes,
        // The three provenance rows a PREDICATE reads back off the working view
        // (`hasSupertypeLive`, `getEffectiveColors`). They are no longer
        // instance fields, so they ride the synthetic view alone — which is
        // where the derivation's running answer belongs anyway (CR 613.7: each
        // entry is evaluated against everything already applied).
        grantedSupertypes: result.grantedSupertypes,
        removedSupertypes: result.removedSupertypes,
        grantedColors: result.grantedColors,
    } as unknown as CardInstanceState;
    if (result.textChanges.length === 0) {
        return base as unknown as PermanentView;
    }
    // CR 613.7 — only the changes applied SO FAR, which is what the running
    // answer holds; the instance ledger holds every one of them.
    const substituted = applySubstitution(base, result.textChanges);
    return {
        ...base,
        subtypes: substituted.subtypes,
        staticAbilities: substituted.staticAbilities,
    } as unknown as PermanentView;
}

/** What `syncLayers2to5` must do when layer 2's answer for a permanent differs
 *  from the controller it is currently recorded under: move it into the new
 *  controller's battlefield array, break its control continuity (CR 702.10c),
 *  remove it from combat (CR 506.4c) and re-check Ascend (CR 702.131b).
 *
 *  Injected rather than imported because every one of those lives in
 *  `gre/state.ts`, which imports THIS module — the same cycle
 *  `setCardManaCostLookup` (`cards/colors.ts`) is registered to break. The
 *  registration is unconditional at `gre/state.ts` module scope, so a sync that
 *  ran without it would be a load-order bug, not a silent no-op: the default
 *  throws. */
export type ControlRelocation = (
    state: GameState,
    card: CardInstanceState,
    previousControllerId: string,
    nextControllerId: string
) => void;

let relocateControl: ControlRelocation = () => {
    throw new Error(
        "layers2to5: control relocation hook not registered (gre/state.ts must call setControlRelocation at module scope)"
    );
};

export function setControlRelocation(fn: ControlRelocation): void {
    relocateControl = fn;
}

/** CR 613.1b-e — recomputes layers 2-5 for the WHOLE board from the registry
 *  and writes the derived output onto every permanent.
 *
 *  The twin of `syncLayer6` (`gre/layer6.ts`), called from the same sites and
 *  for the same reason: the output fields are what ~200 consult sites read, so
 *  they are refreshed at every stable transition and at every apply/unapply
 *  site rather than only at the next SBA pass. PRD #2064 S5 puts the registry
 *  on the wire and S6 deletes the fields, at which point this becomes a no-op
 *  and the consult sites call `deriveLayers2to5` directly. */
export function syncLayers2to5(
    state: GameState,
    /** CR 611.2 — source ids whose static abilities have STOPPED applying as of
     *  this recompute, though the permanent is still in the battlefield array
     *  (`stopApplyingStaticEffects` runs BEFORE the permanent is spliced out).
     *  Same contract as `syncLayer6`'s. */
    opts?: { stoppedSourceIds?: ReadonlySet<string> }
): void {
    const derived = deriveLayers2to5Board(state, opts);
    for (const { card, result } of derived) {
        writeDerivedCharacteristics(card, result);
    }
    // Layer 2 LAST, and in its own pass: relocating a permanent mutates the
    // battlefield arrays the derivation walk above is iterating, and the CR
    // 613.7 answer for every permanent was computed against the board as it
    // stood at the top of this sync (CR 613.1 — one recompute, one board).
    for (const { card, result } of derived) {
        if (card.controllerId === result.controllerId) continue;
        const previous = card.controllerId;
        card.controllerId = result.controllerId;
        relocateControl(state, card, previous, result.controllerId);
    }
}

/** One board pass of the CR 613.1b-e derivation, as a PURE result list: what
 *  every battlefield permanent's layers 2-5 answer is, computed from the
 *  registry against one fixed board, applied to nothing.
 *
 *  Split out of `syncLayers2to5` so the wire projection can read the SAME
 *  derivation the engine writes (PRD #2064 S5, `gre/wireCharacteristics.ts`)
 *  instead of the fields the sync happened to leave behind. One derivation
 *  authority, two consumers — a second walk here is a second answer.
 *
 *  Base capture (`ensureLayers2to5Base`) is deliberately still performed on the
 *  cards it is given: it is the one-shot pre-S4 migration, and it is only
 *  correct while the output fields still hold nothing but the base. The wire
 *  path hands this function CLONES for exactly that reason. */
export function deriveLayers2to5Board(
    state: GameState,
    opts?: {
        stoppedSourceIds?: ReadonlySet<string>;
        /** Derive EVERY permanent, including the ones the fast path below can
         *  prove are already at their base. The sync skips those because the
         *  fields it would write already hold the answer; a consumer that reads
         *  the RESULT rather than the fields has nothing to read for a skipped
         *  permanent, so the wire path asks for all of them (PRD #2064 S5 AC 1:
         *  no projected characteristic is read out of a field `sync*` wrote). */
        deriveAll?: boolean;
    }
): { card: CardInstanceState; result: Layers2to5Derivation }[] {
    const stopped = opts?.stoppedSourceIds;
    const view = (stopped?.size
        ? {
              ...state,
              players: state.players.map((p) => ({
                  ...p,
                  battlefield: p.battlefield.filter((c) => !stopped.has(c.id)),
              })),
          }
        : state) as unknown as LayerStateView;

    const derived: { card: CardInstanceState; result: Layers2to5Derivation }[] =
        [];
    // ONE board scan for the whole sync (CR 613.1 — one recompute, one board),
    // rather than one per permanent.
    const collected = collectSourceEntries(view);
    const noSourceEffects =
        collected.entries.length === 0 && !hasStoredLayer2to5Entry(view);
    for (const player of state.players) {
        for (const card of player.battlefield) {
            ensureLayers2to5Base(card);
            // FAST PATH — nothing anywhere can change this permanent's layers
            // 2-5, and nothing did last time either, so its derived answer IS
            // its base and the fields already hold it: `deriveLayers2to5` on an
            // empty entry list returns exactly the base. Skipping is therefore
            // not an approximation of the answer, it is the answer.
            //
            // Load-bearing for the ISMCTS search, which syncs at every apply
            // site on every node it expands. Most boards declare no layer-2-5
            // static effect at all, and without this each of those pays a full
            // per-permanent derivation.
            if (
                opts?.deriveAll !== true &&
                noSourceEffects &&
                !carriesLayer2to5State(card)
            ) {
                continue;
            }
            derived.push({
                card,
                result: deriveLayers2to5(
                    view,
                    card as unknown as PermanentView,
                    collected
                ),
            });
        }
    }
    return derived;
}

/** The layer-4 derived output as a plain FIELD PATCH — the single mapping from
 *  a `Layers2to5Derivation` to the instance fields that still hold it.
 *
 *  Since PRD #2064 S6b-part-2 that is the effective type line and nothing else.
 *  Every provenance row this used to write (`grantedTypes`, `suppressedTypes`,
 *  `grantedSubtypes`, `grantedSubtypesAdd`, `grantedSupertypes`,
 *  `removedSupertypes`, `grantedColors`, `printedSubtypes`, `textChanges`, and
 *  the `layers2to5Derived` marker) is gone from `CardInstanceState`; they
 *  survive on the WIRE (ADR 0082 decision 4), which is `layers2to5WireFields`
 *  below.
 *
 *  Layer 2 is not here: its output is the permanent's PLACEMENT, which only the
 *  board-level pass can perform, and its `controllerId` half is applied
 *  separately by each consumer. */
export function layers2to5DerivedFields(
    result: Layers2to5Derivation
): Partial<CardInstanceState> {
    return {
        types: result.types,
        subtypes: result.subtypes,
        // The three layer-4/5 provenance rows whose consult sites have no board
        // — see their docs on `CardInstanceState`. Derived output like the type
        // line above; nothing reads them back as input.
        grantedColors:
            result.grantedColors.length > 0 ? result.grantedColors : undefined,
        grantedSupertypes:
            result.grantedSupertypes.length > 0
                ? result.grantedSupertypes
                : undefined,
        removedSupertypes:
            result.removedSupertypes.length > 0
                ? result.removedSupertypes
                : undefined,
    };
}

/** The layer-3-to-5 provenance rows the WIRE still carries, in the exact shapes
 *  the client has always read (ADR 0082 decision 4, PRD #2064 S5 AC 3 — the
 *  client call sites stay untouched). Derived output here, exactly like the two
 *  fields above; the difference is only that no engine consult site reads them
 *  any more, so they are not written onto the instance.
 *
 *  `printedSubtypes` is the pre-slice name for the layer-4 subtype base and is
 *  shipped as such: `baseSubtypes` IS what it named. */
export function layers2to5WireFields(
    card: CardInstanceState,
    result: Layers2to5Derivation
): {
    textChanges?: TextChange[];
    types: CardType[];
    subtypes: string[];
    grantedTypes?: { type: string; auraId: string }[];
    suppressedTypes?: { type: string; sourceId: string }[];
    grantedSubtypes?: { subtypes: string[]; sourceId: string; seq?: number }[];
    grantedSubtypesAdd?: { subtype: string; auraId: string; seq?: number }[];
    grantedSupertypes?: { supertype: string; sourceId: string }[];
    removedSupertypes?: { supertype: string; sourceId: string }[];
    grantedColors?: { color: string; sourceId: string }[];
    printedSubtypes?: string[];
} {
    return {
        textChanges:
            result.textChanges.length > 0 ? result.textChanges : undefined,
        types: result.types,
        subtypes: result.subtypes,
        grantedTypes:
            result.grantedTypes.length > 0 ? result.grantedTypes : undefined,
        suppressedTypes:
            result.suppressedTypes.length > 0
                ? result.suppressedTypes
                : undefined,
        grantedSubtypes:
            result.grantedSubtypes.length > 0
                ? result.grantedSubtypes
                : undefined,
        grantedSubtypesAdd:
            result.grantedSubtypesAdd.length > 0
                ? result.grantedSubtypesAdd
                : undefined,
        grantedSupertypes:
            result.grantedSupertypes.length > 0
                ? result.grantedSupertypes
                : undefined,
        removedSupertypes:
            result.removedSupertypes.length > 0
                ? result.removedSupertypes
                : undefined,
        grantedColors:
            result.grantedColors.length > 0 ? result.grantedColors : undefined,
        printedSubtypes: card.baseSubtypes,
    };
}

/** Writes the layer-3-to-5 derived output onto one permanent. */
function writeDerivedCharacteristics(
    card: CardInstanceState,
    result: Layers2to5Derivation
): void {
    Object.assign(card, layers2to5DerivedFields(result));
}

/** CR 400.7 / 613.1b-e — recomposes layers 2-5 for ONE permanent whose copiable
 *  values just changed (copy, transform, turn face down / face up), against a
 *  synthetic one-card board.
 *
 *  The twin of `recomposeLayer6ForInstance`, and it exists for the same reason:
 *  an identity swap makes no new object, so every continuous effect applying to
 *  the permanent is still applying, but the swap sites (`gre/copy.ts`,
 *  `gre/transform.ts`, `gre/faceDown.ts`) carry no `GameState`. What they DO
 *  have is the permanent and its LEDGERS — a one-shot type-line set, an
 *  indefinite subtype replacement, an animation, a text change — which are
 *  recomposed here over the new base. A SOURCE-provenance effect is re-derived
 *  by the next `syncLayers2to5`, which every real swap path reaches before the
 *  state is read again. */
export function recomposeLayers2to5ForInstance(card: CardInstanceState): void {
    const view = {
        players: [{ id: card.controllerId, battlefield: [card] }],
    } as unknown as LayerStateView;
    ensureLayers2to5Base(card);
    const result = deriveLayers2to5(view, card as unknown as PermanentView);
    writeDerivedCharacteristics(card, result);
    // Layer 2 is deliberately NOT applied here: the synthetic board holds no
    // source to derive a control change from, and `controllerId` is already
    // whatever the real board's last sync made it. Rewriting it from a
    // one-card view would silently hand a stolen permanent back.
}

/** CR 400.7 — drops every pre-layer base capture, so the NEXT derivation
 *  re-captures from the freshly-written copiable values. Called by every path
 *  that rewrites a permanent's characteristics from BELOW layer 2
 *  (`gre/copy.ts`, `gre/faceDown.ts`, `gre/transform.ts`,
 *  `gre/identitySwap.ts`) — the twin of clearing `baseStaticAbilities`. */
export function clearLayers2to5Base(card: CardInstanceState): void {
    card.baseTypes = undefined;
    card.baseSubtypes = undefined;
}
