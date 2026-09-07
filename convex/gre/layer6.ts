// CR 613.1f layer 6 — ability-adding effects, keyword counters, ability-removing
// effects, derived per read from the Continuous Effects Registry
// (`gre/continuousEffects.ts`, ADR 0082, PRD #2064 S3).
//
// WHAT CHANGED. Layer 6 used to be MATERIALISE-AT-ATTACH: a `keyword-grant`
// pushed a keyword STRING onto the target's `staticAbilities[]` at the moment
// its source applied, and only `recomputeContinuousEffects` re-ran the
// predicate afterwards, for counter-gated sources, on SBA passes. Two
// consequences the registry deletes:
//
//   1. A grant's PARAMETER was frozen at materialisation time. Nothing ever
//      recomputed a protection colour set, a landwalk subtype or a rampage N;
//      protection was recovered by regex-parsing the rendered string back out.
//      An entry carries its parameter STRUCTURALLY
//      (`ContinuousEffectKeywordParameter`) and is rendered at every read, so
//      the parameter tracks the board.
//   2. The three grant PROVENANCES had three different shapes on the card
//      instance — a source's static ability (`grantedStaticAbilities.auraId`),
//      a duration-scoped Op's residue (`.duration`), a counter-borne grant
//      (`.counterType`) — and `removedKeywords` split the same way. Here they
//      are one entry type differing only in EXPIRY, which is the only thing the
//      CR ever distinguished them by.
//
// WHAT `staticAbilities[]` IS NOW. Derived OUTPUT, not authoritative input:
// `syncLayer6` overwrites it from the registry at every stable transition and
// at every apply/unapply site, so the ~90 consult sites that read
// `card.staticAbilities.includes("trample")` keep working unchanged while
// reading something the registry produced. PRD #2064 S6 deletes the field and
// points those sites at `deriveLayer6` directly; S5 (#3094) put the registry
// on the wire and pointed the PROJECTION at `deriveLayer6Board` through
// `gre/wireCharacteristics.ts`, so the client derives the same answer. The pre-layer-6 keyword multiset lives in
// `baseStaticAbilities`, the layer-6 twin of `printedSubtypes` (layer 4).
//
// WHAT REVOCATION IS. Nothing. An entry applies while its expiry says it does;
// when the last paralyzation counter comes off, the derivation simply stops
// producing the entry. No `grant*Permanent` primitive needs a revoke sibling —
// PRD #2064's "no revoke-a-permanent-grant primitive is introduced".

import { tryGetDefinition } from "../cards";
import { declaresLayer6StaticEffect } from "../cards/registry";
import { tryGetEmblemDefinition } from "../cards/emblems";
import { sameOrder } from "./constants";
import { compareContinuousEffects, renderKeyword } from "./continuousEffects";
import type { DependencyTemplate } from "./dependency";
import { orderByDependency } from "./dependency";
import type { ContinuousEffect } from "./continuousEffects";
import { emblemAsStaticSource, STATIC_EFFECT_CTX } from "./layers";
import type { LayerStateView } from "./layers";
import type { PermanentView, StaticEffect } from "../cards/types";
import type { CardInstanceState, GameState } from "./state";

/** The `StaticEffect` kinds layer 6 owns (CR 613.1f). Every other kind belongs
 *  to another layer (or, for the CR 611.3 rules-modifying kinds, outside the
 *  layer system entirely — ADR 0082 decision 2) and is left to the
 *  materialising path in `gre/state.ts` until PRD #2064 S4 migrates layers 2-5.
 *
 *  A `Record` over the kinds rather than an array literal, so a reader can ask
 *  "is this kind mine?" in O(1) and a new layer-6 kind is one row. */
export const LAYER_6_STATIC_EFFECT_KINDS: Record<string, true> = {
    "keyword-grant": true,
    "keyword-remove": true,
    "ability-loss": true,
    "activated-grant": true,
    "triggered-grant": true,
};

/** The live source and `StaticEffect` a DERIVED template entry was built from,
 *  kept beside the entry so the resolver never looks either up again — and so
 *  an emblem's effect, which no card-registry lookup can reach, resolves by the
 *  same path as a permanent's. Mirrors layer 7's `DerivedTemplate`. */
type DerivedTemplate = { source: PermanentView; effect: StaticEffect };

/** What one layer-6 entry DOES to the keyword multiset / ability set, once its
 *  payload has been resolved against the live board. The inline payload union
 *  of `ContinuousEffect` minus the layers this module does not own. */
type Layer6Action =
    | { kind: "keyword-grant"; keyword: string }
    | { kind: "keyword-remove"; keyword: string }
    | { kind: "ability-loss" }
    | { kind: "activated-grant"; sourceCardId: string; abilityId: string }
    | { kind: "triggered-grant"; sourceCardId: string; abilityId: string };

/** Everything layer 6 produces for one permanent. Every field is DERIVED — no
 *  caller may feed one of them back in as input. */
export type Layer6Derivation = {
    /** CR 613.1f — the effective keyword multiset. A MULTISET, not a set: two
     *  sources granting flying put two occurrences on, and one
     *  `keyword-remove` takes one back off (CR 113.1 — the abilities are
     *  separate instances). #1715's "Flight then Gravity Sphere" case is
     *  exactly this arithmetic. */
    staticAbilities: string[];
    /** CR 613.1f — the keyword grants a live SOURCE's static ability is
     *  contributing, in the shape `grantedStaticAbilities` has always had.
     *  DERIVED OUTPUT, like `staticAbilities` itself: the client reads the
     *  provenance record (`src/lib/battlefield-stacks.ts`'s altered predicate)
     *  and the bot reads it beside the multiset
     *  (`gre/ai/defensiveGrants.ts`), so the record keeps being written until
     *  PRD #2064 S5/S6 point those consumers at the registry. Nothing reads it
     *  back as input — `layer6EffectsFor` skips every `auraId`-keyed row. */
    grantedStatic: {
        ability: string;
        auraId: string;
        seq: number;
    }[];
    /** CR 113.1 — activated abilities granted by a live SOURCE's static
     *  ability, in timestamp order. Duration- and residue-borne grants stay on
     *  the instance until PRD #2064 S6 and are not reproduced here. */
    grantedActivated: {
        sourceCardId: string;
        abilityId: string;
        auraId: string;
        seq: number;
    }[];
    /** CR 113.1 — the triggered-ability twin of `grantedActivated`. */
    grantedTriggered: {
        sourceCardId: string;
        abilityId: string;
        auraId: string;
        seq: number;
    }[];
    /** CR 613.1f — every ability-loss effect currently applying, both arms:
     *  the CONTINUOUS one derived from a live source's static ability
     *  (Titania's Song, Blood Moon) and the LEDGER one generated by a resolving
     *  ability (`abilityLossHolds`). This is what `abilitiesSuppressedBy`
     *  becomes: derived output, and the single thing
     *  `grantOutrankedByAbilityLoss` compares a grant against. */
    abilitiesSuppressedBy: { sourceId: string; seq: number }[];
    /** CR 613.1f — the removals that are actually taking an occurrence right
     *  now, as the shape `removedKeywords` has always had. Derived output kept
     *  for the consult sites that read the field (`gre/state.ts`'s regenerate
     *  probe, the scenario round-trip validator) until S6 deletes it. */
    removedKeywords: { keyword: string; sourceId: string; seq: number }[];
};

/** CR 613.1f — the pre-layer-6 keyword multiset: everything the permanent has
 *  BEFORE any grant or removal applies. Printed keywords, plus whatever the
 *  lower layers put there (a copy effect's, a face-down 2/2's empty list, a
 *  transformed face's), minus nothing.
 *
 *  Captured lazily from `staticAbilities` on first derivation, exactly as
 *  `capturePrintedSubtypes` captures the layer-4 base: at that moment
 *  `staticAbilities` holds the base and nothing else, because grants no longer
 *  materialise into it. Every path that REWRITES the base from below layer 6
 *  (`gre/copy.ts`, `gre/faceDown.ts`, `gre/transform.ts`, `gre/identitySwap.ts`)
 *  assigns `staticAbilities` wholesale and clears this field with it, so the
 *  next derivation re-captures. */
export function layer6Base(card: CardInstanceState): string[] {
    return card.baseStaticAbilities ?? card.staticAbilities;
}

/** Captures the layer-6 base if it has not been captured yet.
 *
 *  Called at the TOP of every producer (`SpellContext.grantStaticAbility`,
 *  `grantStaticAbilityPermanent`, `removeStaticAbilities`, `animateAsCreature`,
 *  `applyKeywordCounterGrant`) BEFORE it writes its entry, and once per
 *  permanent from `syncLayer6`.
 *
 *  Took a `LayerStateView` between PRD #2064 S6b and S6b-part-2, for a
 *  registry-based reconstruction that no longer exists — see
 *  `captureLayer6Base`. */
export function ensureLayer6Base(card: CardInstanceState): void {
    if (card.baseStaticAbilities !== undefined) return;
    card.baseStaticAbilities = captureLayer6Base(card);
}

/** Snapshots the pre-layer-6 base out of a permanent's `staticAbilities`.
 *
 *  It IS `staticAbilities`, and PRD #2064 S6b-part-2 is where that became true
 *  rather than merely usually true. The capture is only ever reached with an
 *  UNCOMPOSED multiset, because every way a permanent can arrive without a base
 *  now leaves one there:
 *
 *  - a permanent ENTERING the battlefield has a fresh instance id, so no entry
 *    names it and `staticAbilities` is exactly its copiable keyword line;
 *  - every path that rewrites that line from BELOW layer 6 — an identity swap
 *    (`gre/identitySwap.ts`), a CR 614.12c body / anchor choice, the CR 400.7
 *    departure reset — now SETS `baseStaticAbilities` to what it just wrote
 *    instead of deleting it;
 *  - a snapshot PERSISTED BEFORE PRD #2064 S3, whose `staticAbilities` holds the
 *    base plus every grant the old materialising path pushed, is reconstructed
 *    at LOAD by `migrateLegacyInstanceKeywordLedgers` (`gre/serialize.ts`), from
 *    the COMPACT record and before any entry exists.
 *
 *  What stood here until this slice was layer 6's own inverse —
 *  `base = staticAbilities + removals - grants` — reading the `removedKeywords`
 *  and `grantedStaticAbilities` rows the slice deleted. Rebuilding it from the
 *  REGISTRY was tried and is unsound, in both directions at once:
 *
 *  - the registry cannot SEE two of the three removal shapes. A strip derived
 *    from a live SOURCE is a `predicate`-affected template entry, and an
 *    `ability-loss` records no per-keyword removal at all, so an inverse built
 *    from entries silently drops both;
 *  - an entry carries no evidence that its composition has RUN. Adding a
 *    `keyword-remove` back on a permanent whose keyword is still present
 *    invents a second occurrence; gating on absence instead makes a live
 *    grant-and-strip pair eat the PRINTED occurrence. Nothing on the instance
 *    tells the two boards apart.
 *
 *  So the arithmetic lives in the one place its precondition provably holds —
 *  the load — and this is a copy. */
function captureLayer6Base(card: CardInstanceState): string[] {
    return [...card.staticAbilities];
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
    // to avoid a layer6 <-> state import cycle.
    const chosenModeId =
        modeOverride ?? (source as { chosenModeId?: string }).chosenModeId;
    if (!chosenModeId) return cardEffects;
    const mode = def.modes?.find((m) => m.id === chosenModeId);
    const modeEffects = mode?.staticEffects ?? [];
    if (modeEffects.length === 0) return cardEffects;
    if (cardEffects.length === 0) return modeEffects;
    return [...cardEffects, ...modeEffects];
}

/** One (source, static effect) pair that has cleared the whole SOURCE-side half
 *  of layer 6's walk: the effect is one of layer 6's kinds, its source carries a
 *  CR 613.7a timestamp, and the CR 611.2c source-level gate holds against the
 *  board. All that is left to decide per TARGET is the `applies` predicate. */
type Layer6SourceCandidate = {
    source: PermanentView;
    effect: StaticEffect;
    /** Index into the source's own effect list. Half the entry's identity
     *  (`ce6-src-<sourceId>-<index>`) and the `effectIndex` the template
     *  payload is resolved back through (`resolveLayer6Action`). */
    index: number;
    /** CR 613.7a — the source's `staticSeq`, or the derived ordinal that
     *  stands in for one where the engine mints none (an emblem). */
    seq: number;
};

/** The source half of one board's layer-6 derivation. */
export type Layer6SourcePlan = readonly Layer6SourceCandidate[];

/** Walks the battlefield and the command zone ONCE, resolving every object's
 *  layer-6 static effects against a FIXED board (PRD #2064 S7).
 *
 *  The twin of `collectSourceEntries` in `gre/layers2to5.ts`, and it exists for
 *  the same measured reason. This walk used to run inside `layer6EffectsFor`,
 *  i.e. once per TARGET: an n-permanent board paid n² definition resolutions
 *  and n² source-gate evaluations per sync, every sync runs at every apply
 *  site, and the ISMCTS search pays that on every node it expands. Measured on
 *  the blade suite, `syncLayer6` was 13.7% of total search wall clock.
 *
 *  Hoisting the CR 611.2c source gate out of the per-target loop is not an
 *  approximation, it is the invariant `syncLayer6`'s two passes exist to
 *  enforce: `condition(source, state, ctx)` reads the SOURCE and the BOARD and
 *  never the target, and CR 613 composes a layer over a FIXED input, so its
 *  answer is the same for every target of one pass by construction. Evaluating
 *  it once is the only way to state that; evaluating it n times was merely a
 *  way to get the same answer n times, and would stop being the same answer the
 *  moment a mid-walk write made the board move under it — the exact bug the two
 *  passes prevent.
 *
 *  What is deliberately NOT hoisted is `applies(target, source, ctx)`: it reads
 *  the target, so it is genuinely per-pair and stays in `layer6EffectsFor`. */
function collectLayer6Sources(state: LayerStateView): Layer6SourcePlan {
    const candidates: Layer6SourceCandidate[] = [];

    const push = (
        source: PermanentView,
        effects: readonly StaticEffect[]
    ): void => {
        // CR 613.7a — a continuous effect generated by a static ability has the
        // timestamp of the object the ability is on. `staticSeq` is that stamp,
        // minted by `allocStaticTimestamp` the moment the object begins
        // applying (`beginApplyingStaticEffects`, called on EVERY battlefield
        // entry path: `putOnBattlefield`, token creation, aura attach,
        // reanimation, land drop, scenario load).
        //
        // An UNSTAMPED source is one that has not begun applying, and it is
        // skipped rather than derived at 0. CR 613.7 orders a layer by
        // timestamp, so an effect with no timestamp has no position in the
        // layer at all — deriving it at 0 would make it lose every ordering
        // race it should win and, worse, make a source's effects start
        // applying at a moment the engine never recorded. In practice this is
        // reachable only from a hand-built fixture; PRD #2064 S6, where the
        // producers write entries with their own stamps, removes the concept.
        const seq = (source as { staticSeq?: number }).staticSeq;
        if (seq === undefined) return;
        for (let index = 0; index < effects.length; index++) {
            const effect = effects[index];
            if (!LAYER_6_STATIC_EFFECT_KINDS[effect.kind]) continue;
            // CR 611.2c source-level gate ("as long as ..."), evaluated once
            // per source against the whole board (Kavu Runner). Only
            // `keyword-grant` carries one today; reading it off the wider type
            // keeps a future kind that gains one from shipping inert.
            const condition = (
                effect as {
                    condition?: (
                        s: PermanentView,
                        st: LayerStateView,
                        c: typeof STATIC_EFFECT_CTX
                    ) => boolean;
                }
            ).condition;
            if (condition && !condition(source, state, STATIC_EFFECT_CTX)) {
                continue;
            }
            candidates.push({ source, effect, index, seq });
        }
    };

    for (const player of state.players) {
        for (const source of player.battlefield) {
            // PRD #2064 S7 — the registry-derived precheck, the exact twin of
            // the one `gre/layers2to5.ts` runs one layer over. Almost no
            // permanent declares a layer-6 static effect, and a `Set.has` on
            // the id says so without a map lookup plus an `expandDefinition`.
            // Fail-slow by construction: a stale TRUE costs one wasted
            // resolution (`sourceStaticEffects` still reads the live
            // definition and returns nothing), a stale FALSE is impossible
            // because every registry write goes through `setRegistryEntry`.
            const cardId = (source.card as { id?: string }).id;
            if (!cardId || !declaresLayer6StaticEffect(cardId)) continue;
            push(source, sourceStaticEffects(source));
        }
    }
    // CR 114 (issue #1221) — command-zone emblems contribute source-less,
    // owner-scoped statics through the same predicate walk. No precheck: the
    // emblem registry is a different map, and there are single-digit emblems.
    for (const emblem of state.emblems ?? []) {
        // CR 613.7d — an emblem receives a timestamp when it enters the command
        // zone, and `emblemAsStaticSource` carries the one `createEmblem` mints
        // (`gre/state.ts`). PRD #2064 S6b-part-2 replaced the creation-ORDER
        // ordinal that stood in for it here: kept far below every minted stamp,
        // it made an emblem lose every ordering race against a permanent,
        // however much later the emblem was created — a Humility that predates
        // an emblem's keyword grant would still have cleared it (CR 613.1f).
        // Layers 2-5 and layer 7 read the same stamp, so all three agree.
        const synthetic = emblemAsStaticSource(emblem);
        push(synthetic, sourceStaticEffects(synthetic));
    }

    return candidates;
}

/** Every layer-6 registry entry applying to `target`, in CR 613.7 timestamp
 *  order, paired with the live source each source-provenance entry was derived
 *  from.
 *
 *  Four provenances, one entry type, distinguished only by EXPIRY (PRD #2064
 *  S1's `ContinuousEffectExpiry`):
 *
 *  - `source` — a battlefield permanent's or command-zone emblem's static
 *    ability. DERIVED per read by walking the board, so a leave-the-battlefield,
 *    a control change, a phase-out and an `applies` / `condition` that stops
 *    holding need no purge site and cannot drift. Timestamped with the source's
 *    own `staticSeq` (CR 613.7a), which is a REAL minted stamp — unlike layer 7,
 *    which had to invent a derived ordinal because a P/T source carries none.
 *  - `duration` / `indefinite` — residue of a resolved spell or ability
 *    (`SpellContext.grantStaticAbility`, `grantStaticAbilityPermanent`,
 *    `removeStaticAbilities`, `loseAllAbilities`). The spell has LEFT; there is
 *    nothing to walk, which is exactly why the registry exists. STORED entries
 *    since PRD #2064 S6b — their producers write them through
 *    `pushContinuousEffect` and the instance ledgers they used to ride are
 *    gone, so they arrive through the stored-entry walk below.
 *  - `counter` — CR 122.1b keyword counters, gated on the counter still being
 *    there. Neither duration-bounded nor tied to a live source.
 *  - stored `state.continuousEffects` — the channel that is simultaneously
 *    source-INDEPENDENT and condition-GATED, which no pre-registry channel could
 *    be at once (Dread Wight, `cards/sets/ice/black.ts`).
 */
function layer6EffectsFor(
    state: LayerStateView,
    target: PermanentView,
    /** The SOURCE half of the walk, resolved once for the whole board pass —
     *  see `collectLayer6Sources`. A caller deriving ONE permanent passes the
     *  plan for its board; a board pass builds it once and hands it to every
     *  target. */
    sources: Layer6SourcePlan
): {
    entries: ContinuousEffect[];
    templates: ReadonlyMap<string, DerivedTemplate>;
} {
    const entries: ContinuousEffect[] = [];
    const templates = new Map<string, DerivedTemplate>();

    for (const { source, effect, index, seq } of sources) {
        const applies = (
            effect as {
                applies: (
                    t: PermanentView,
                    s: PermanentView,
                    c: typeof STATIC_EFFECT_CTX
                ) => boolean;
            }
        ).applies;
        if (!applies(target, source, STATIC_EFFECT_CTX)) continue;
        const id = `ce6-src-${source.id}-${index}`;
        templates.set(id, { source, effect });
        entries.push({
            id,
            layer: 6,
            timestamp: seq,
            expiry: { kind: "source", sourceId: source.id },
            affected: { kind: "predicate" },
            payload: {
                kind: "template",
                sourceCardId: (source.card as { id?: string }).id ?? "",
                effectIndex: index,
                modeId: (source as { chosenModeId?: string }).chosenModeId,
            },
            // CR 604.3 — no layer-6 static effect in the catalogue is
            // characteristic-defining (a CDA defines P/T, colour, mana cost
            // or subtype; CR 604.3 lists no ability-granting form).
            characteristicDefining: false,
        });
    }

    const instance = target as unknown as CardInstanceState;

    // PRD #2064 S6b — three blocks stood here, synthesising a throwaway
    // registry entry per instance-ledger row at EVERY read: the keyword-counter
    // grant (CR 122.1b), the resolved-ability grants (CR 611.2a / 611.2c) and
    // the duration-scoped removals (CR 611.2a). Their producers now write real
    // entries through `pushContinuousEffect`, so the entries arrive through the
    // stored-entry walk below like every other one and the ledgers they were
    // reading are gone.
    //
    // PRD #2064 S6b-part-2 removed the fourth block, the `trustLedger` LKI
    // read. It existed because `recomposeLayer6ForInstance` derived against a
    // SYNTHETIC one-card board on which no source-provenance effect could be
    // re-walked, so the last sync's derived output (`grantedStaticAbilities`,
    // `abilitiesSuppressedBy`, `removedKeywords`) was the only record of what
    // the real board was contributing. Those fields are gone; the recompose
    // derives against the REAL board instead, which is not last-known
    // information but the answer itself.

    // The resolving arm's LEDGER (CR 611.2b / 611.2c). The CONTINUOUS arm is
    // derived from the board walk above and writes no row here, so no strip is
    // counted twice.
    const holds = instance.abilityLossHolds ?? [];
    for (let index = 0; index < holds.length; index++) {
        const hold = holds[index];
        if (
            hold.sourceId !== INDEFINITE_SOURCE_ID &&
            !findPermanent(state, hold.sourceId)
        ) {
            // Its source has left: the CR 611.2b duration is over.
            continue;
        }
        entries.push({
            id: `ce6-loss-${target.id}-${index}`,
            layer: 6,
            timestamp: hold.seq ?? 0,
            expiry:
                hold.sourceId === INDEFINITE_SOURCE_ID
                    ? { kind: "indefinite", controllerId: target.controllerId }
                    : { kind: "source", sourceId: hold.sourceId },
            affected: { kind: "instances", instanceIds: [target.id] },
            payload: { kind: "ability-loss" },
            characteristicDefining: false,
        });
    }

    // Stored entries. The channel a `source` entry cannot be and a `duration`
    // entry cannot be: source-INDEPENDENT and condition-GATED at once. Dread
    // Wight's untap lock and its granted "{4}: Remove a paralyzation counter"
    // are both `counter`-expiry stored entries, so both outlive Dread Wight and
    // both stop the moment the last counter comes off.
    for (const stored of state.continuousEffects ?? []) {
        if (stored.layer !== 6) continue;
        if (!layer6EntryApplies(stored, target)) continue;
        if (!layer6ExpiryLive(state, stored)) continue;
        entries.push(stored);
    }

    entries.sort(compareLayer6Entries);
    // CR 613.8 — dependency overrides the timestamp system. The comparator
    // handed over is `compareLayer6Entries`, not the registry's own: CR 613.8b
    // sends both a dependency loop and a tie between ready effects back to
    // "timestamp order", and layer 6's timestamp order is the one that puts a
    // removal before a grant at an equal stamp so the walk agrees with
    // `grantOutrankedByAbilityLoss` (ADR 0115 decision 6).
    return {
        entries: orderByDependency(entries, {
            compare: compareLayer6Entries,
            template: (entry) => resolveLayer6Template(state, entry, templates),
            ctx: STATIC_EFFECT_CTX,
        }),
        templates,
    };
}

/** The live source and `StaticEffect` behind a template entry, for the CR 613.8
 *  dependency pass — layer 6's twin of layers 2-5's `resolveTemplate`. */
function resolveLayer6Template(
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

/** CR 613.7 plus the ONE tie-break layer 6 needs.
 *
 *  Timestamps cannot tie through the real apply path (`allocStaticTimestamp`
 *  mints strictly greater), but they CAN through the instance-borne records a
 *  slice may still write by hand, and the readers already committed to an
 *  answer: `grantOutrankedByAbilityLoss` is STRICTLY less, so a grant sharing a
 *  stripper's timestamp survives it. That is only true if the stripper is
 *  applied FIRST at an equal timestamp, so removals rank before grants and the
 *  walk agrees with the reader by construction rather than by luck. Everything
 *  else defers to the registry's own comparison. */
function compareLayer6Entries(
    a: ContinuousEffect,
    b: ContinuousEffect
): number {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    const rank = layer6TieRank(a) - layer6TieRank(b);
    if (rank !== 0) return rank;
    return compareContinuousEffects(a, b);
}

/** Removals (and ability loss) before grants at an equal timestamp. A template
 *  payload's kind is not known without resolving it against the live board, so
 *  it ranks with the grants — a source-provenance effect always carries a
 *  minted, unique `staticSeq` and can never reach this tie-break. */
function layer6TieRank(entry: ContinuousEffect): number {
    const kind = entry.payload.kind;
    return kind === "keyword-remove" || kind === "ability-loss" ? 0 : 1;
}

/** The sentinel `sourceId` a hold generated by a RESOLVING ability carries
 *  (CR 611.2c): no live permanent's instance id can ever match it, so nothing
 *  releases it. Mirrors the constant `gre/state.ts` writes. */
export const INDEFINITE_SOURCE_ID = "indefinite";

/** Whether a STORED entry applies to `target`. A `predicate`-affected entry is
 *  pinned by its type to `source` expiry and a template payload, so its
 *  predicate is the template's `applies` — resolved in `resolveLayer6Action`,
 *  which returns `undefined` when it does not match. */
function layer6EntryApplies(
    entry: ContinuousEffect,
    target: PermanentView
): boolean {
    if (entry.affected.kind === "predicate") return true;
    return entry.affected.instanceIds.includes(target.id);
}

/** CR 611.2 — is a stored entry's expiry still unmet? The whole of what
 *  "revocation" used to be: an entry whose condition has stopped holding is
 *  simply not produced, so no primitive revokes anything.
 *
 *  `duration` / `instance-duration` are NOT checked here: their countdown is
 *  ticked by the phase-boundary cleanup (`gre/phases.ts`), which splices the
 *  entry out, so a surviving entry is by construction still live. */
function layer6ExpiryLive(
    state: LayerStateView,
    entry: ContinuousEffect
): boolean {
    const expiry = entry.expiry;
    switch (expiry.kind) {
        case "source":
            return findPermanent(state, expiry.sourceId) !== undefined;
        case "counter": {
            // CR 122.1 — ends when the last counter of that kind is removed.
            const bearer = findPermanent(state, expiry.permanentId);
            return (bearer?.counters?.[expiry.counterType] ?? 0) > 0;
        }
        case "while-source-tapped": {
            const source = findPermanent(state, expiry.sourceId);
            return Boolean(source?.isTapped);
        }
        case "duration":
            // Not checked HERE because it is checked at the boundary instead:
            // `tickContinuousEffectDurations` (`gre/phases.ts`) splices an
            // expired entry out of `state.continuousEffects` (PRD #2064 S6), so
            // an entry this walk can still see is by construction one whose
            // boundary has not come. A liveness re-derivation here would be a
            // second implementation of CR 611.2a's countdown, which is exactly
            // the duplication the registry exists to end.
            return true;
        case "indefinite":
            return true;
    }
}

/** The battlefield permanent with `id`, if any. */
function findPermanent(
    state: LayerStateView,
    id: string
): PermanentView | undefined {
    for (const player of state.players) {
        const found = player.battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    return undefined;
}

/** What one entry DOES, resolved against the LIVE board — or `undefined` when
 *  it contributes nothing to this target (a template whose predicate no longer
 *  matches, or a payload from another layer).
 *
 *  This is where a grant's parameter stops being frozen: a template payload
 *  keeps its closures on the card definition and is re-read here at EVERY
 *  derivation, and an inline payload renders its structured
 *  `ContinuousEffectKeywordParameter` here rather than carrying a string some
 *  earlier board state produced. */
function resolveLayer6Action(
    state: LayerStateView,
    target: PermanentView,
    entry: ContinuousEffect,
    templates: ReadonlyMap<string, DerivedTemplate>
): Layer6Action | undefined {
    const payload = entry.payload;
    if (payload.kind !== "template") {
        switch (payload.kind) {
            case "keyword-grant":
                return {
                    kind: "keyword-grant",
                    keyword: renderKeyword(payload),
                };
            case "keyword-remove":
                return { kind: "keyword-remove", keyword: payload.keyword };
            case "ability-loss":
                return { kind: "ability-loss" };
            case "activated-grant":
            case "triggered-grant":
                return {
                    kind: payload.kind,
                    sourceCardId: payload.sourceCardId,
                    abilityId: payload.abilityId,
                };
            default:
                // A payload from another layer on a layer-6 entry: nothing.
                return undefined;
        }
    }
    const derived = templates.get(entry.id);
    const source =
        derived?.source ??
        (entry.expiry.kind === "source"
            ? findPermanent(state, entry.expiry.sourceId)
            : undefined);
    if (!source) return undefined;
    let effect = derived?.effect;
    if (!effect) {
        // A stored entry names its source by INSTANCE id, which an id reused
        // across games would resolve to the wrong object; `sourceCardId` is the
        // entry's own record of what it was written against.
        if ((source.card as { id?: string }).id !== payload.sourceCardId) {
            return undefined;
        }
        // `payload.modeId`, not the live mode: `effectIndex` was computed
        // against the mode the entry recorded (CR 700.2).
        effect = sourceStaticEffects(source, payload.modeId)[
            payload.effectIndex
        ];
    }
    if (!effect || !LAYER_6_STATIC_EFFECT_KINDS[effect.kind]) return undefined;
    // A STORED template entry has not been through the board walk's predicate
    // gate, so it runs it here. A DERIVED one has, and re-running it is a pure
    // repeat rather than a second, provenance-dependent rule: `layer6EffectsFor`
    // emits an entry only when `applies(target, source)` held, and
    // `collectLayer6Sources` offers a candidate only when the CR 611.2c gate
    // held — both against THIS pass's fixed board, which CR 613 forbids moving
    // mid-walk. PRD #2064 S7 stopped paying for the repeat: two closure calls
    // per applying entry per target, on the derivation the ISMCTS search runs
    // at every apply site of every node it expands.
    if (!derived) {
        const applies = (
            effect as {
                applies: (
                    t: PermanentView,
                    s: PermanentView,
                    c: typeof STATIC_EFFECT_CTX
                ) => boolean;
            }
        ).applies;
        if (!applies(target, source, STATIC_EFFECT_CTX)) return undefined;
        const condition = (
            effect as {
                condition?: (
                    s: PermanentView,
                    st: LayerStateView,
                    c: typeof STATIC_EFFECT_CTX
                ) => boolean;
            }
        ).condition;
        if (condition && !condition(source, state, STATIC_EFFECT_CTX)) {
            return undefined;
        }
    }
    switch (effect.kind) {
        case "keyword-grant": {
            // The parameter is RE-DERIVED here, at read time: `keywordFor`
            // computes the keyword from the live source and target (a
            // protection colour set that follows a board change), while a
            // fixed-output grant returns its declared `keyword` (ADR 0050's
            // fixed / computed pair, as `subtype-set` already has).
            if (!effect.keywordFor) {
                return { kind: "keyword-grant", keyword: effect.keyword };
            }
            // `null` is the computed form's "grant NOTHING this evaluation",
            // exactly as `subtypesFor` returning null leaves the target
            // untouched — distinguished from `undefined` (no computed form at
            // all) so it cannot silently fall back to the fixed keyword.
            const computed = effect.keywordFor(
                target,
                source,
                STATIC_EFFECT_CTX
            );
            if (computed === null) return undefined;
            return { kind: "keyword-grant", keyword: computed };
        }
        case "keyword-remove":
            return { kind: "keyword-remove", keyword: effect.keyword };
        case "ability-loss":
            return { kind: "ability-loss" };
        case "activated-grant":
        case "triggered-grant":
            return {
                kind: effect.kind,
                sourceCardId: (source.card as { id?: string }).id ?? "",
                abilityId: effect.abilityId,
            };
        default:
            return undefined;
    }
}

/** CR 613.1f / 613.7 — layer 6 for one permanent, applied in timestamp order.
 *
 *  ONE ordered walk decides everything, which is why no site needs to compare
 *  `staticSeq` by hand any more (#1715 had to harden four such sites
 *  separately):
 *
 *  - a GRANT pushes one occurrence of its keyword;
 *  - a REMOVAL takes one occurrence back off (CR 113.1 — two grants of flying
 *    are two abilities, and "loses flying" removes one of them);
 *  - an ABILITY LOSS clears everything applied SO FAR, which is precisely
 *    "everything with an earlier timestamp" (Humility, then Fire Whip: the
 *    Whip's grant is later in the walk and survives).
 *
 *  Order of the result is base-first then grants in timestamp order, so a
 *  permanent's printed keywords keep the position every existing assertion
 *  reads them at. */
export function deriveLayer6(
    state: LayerStateView,
    target: PermanentView,
    opts?: {
        /** The board's source plan, when the caller already built one for this
         *  pass (`deriveLayer6Board`). Omitted, this derivation builds its own
         *  — one target, one board walk, exactly as before PRD #2064 S7. */
        sources?: Layer6SourcePlan;
    }
): Layer6Derivation {
    const { entries, templates } = layer6EffectsFor(
        state,
        target,
        opts?.sources ?? collectLayer6Sources(state)
    );
    const instance = target as unknown as CardInstanceState;
    const staticAbilities = [...layer6Base(instance)];
    const grantedStatic: Layer6Derivation["grantedStatic"] = [];
    const grantedActivated: Layer6Derivation["grantedActivated"] = [];
    const grantedTriggered: Layer6Derivation["grantedTriggered"] = [];
    const removedKeywords: Layer6Derivation["removedKeywords"] = [];
    const abilitiesSuppressedBy: Layer6Derivation["abilitiesSuppressedBy"] = [];

    for (const entry of entries) {
        const action = resolveLayer6Action(state, target, entry, templates);
        if (!action) continue;
        switch (action.kind) {
            case "keyword-grant":
                staticAbilities.push(action.keyword);
                if (entry.expiry.kind === "source") {
                    grantedStatic.push({
                        ability: action.keyword,
                        auraId: entry.expiry.sourceId,
                        seq: entry.timestamp,
                    });
                }
                break;
            case "keyword-remove": {
                const idx = staticAbilities.indexOf(action.keyword);
                if (idx === -1) break;
                staticAbilities.splice(idx, 1);
                // Keep the provenance record in step with the multiset: the
                // occurrence a removal takes is the one a consumer must no
                // longer see attributed to a source (`defensiveGrants.ts`
                // documents exactly this hazard).
                const grantIdx = grantedStatic.findIndex(
                    (g) => g.ability === action.keyword
                );
                if (grantIdx !== -1) grantedStatic.splice(grantIdx, 1);
                removedKeywords.push({
                    keyword: action.keyword,
                    sourceId:
                        entry.expiry.kind === "source"
                            ? entry.expiry.sourceId
                            : INDEFINITE_SOURCE_ID,
                    seq: entry.timestamp,
                });
                break;
            }
            case "ability-loss":
                for (const keyword of staticAbilities) {
                    removedKeywords.push({
                        keyword,
                        sourceId:
                            entry.expiry.kind === "source"
                                ? entry.expiry.sourceId
                                : INDEFINITE_SOURCE_ID,
                        seq: entry.timestamp,
                    });
                }
                staticAbilities.length = 0;
                grantedStatic.length = 0;
                // A later grant is applied after this point in the walk and
                // survives, so the stamp is recorded rather than acted on
                // again: `getEffectiveActivatedAbilities` needs it to make the
                // same call for NATIVE abilities, which are not in this walk.
                abilitiesSuppressedBy.push({
                    sourceId:
                        entry.expiry.kind === "source"
                            ? entry.expiry.sourceId
                            : INDEFINITE_SOURCE_ID,
                    seq: entry.timestamp,
                });
                grantedActivated.length = 0;
                grantedTriggered.length = 0;
                break;
            case "activated-grant":
                grantedActivated.push({
                    sourceCardId: action.sourceCardId,
                    abilityId: action.abilityId,
                    auraId:
                        entry.expiry.kind === "source"
                            ? entry.expiry.sourceId
                            : INDEFINITE_SOURCE_ID,
                    seq: entry.timestamp,
                });
                break;
            case "triggered-grant":
                grantedTriggered.push({
                    sourceCardId: action.sourceCardId,
                    abilityId: action.abilityId,
                    auraId:
                        entry.expiry.kind === "source"
                            ? entry.expiry.sourceId
                            : INDEFINITE_SOURCE_ID,
                    seq: entry.timestamp,
                });
                break;
        }
    }

    return {
        staticAbilities,
        grantedStatic,
        grantedActivated,
        grantedTriggered,
        abilitiesSuppressedBy,
        removedKeywords,
    };
}

/** CR 400.7 / 613.1f — recomposes layer 6 for ONE permanent whose copiable
 *  values just changed (copy, transform, turn face down / face up), against a
 *  synthetic one-card board.
 *
 *  An identity swap makes no new object, so every continuous effect applying to
 *  the permanent is still applying — but the swap sites (`gre/copy.ts`,
 *  `gre/transform.ts`, `gre/faceDown.ts`) carry no `GameState`, so there is no
 *  board to walk. What they DO have is the permanent, and with it every
 *  INSTANCE-BORNE entry: a duration-scoped grant, an indefinite one, a keyword
 *  counter, a duration-scoped removal, a "loses all abilities" hold. Those are
 *  recomposed here, immediately, over the new base.
 *
 *  A SOURCE-provenance effect (an anthem's keyword grant, a live Gravity
 *  Sphere) is not — it is re-derived by the next `syncLayer6`, which every real
 *  swap path reaches before the state is read again (a swap happens inside a
 *  resolution, and the SBA loop syncs at the top of every iteration). This is
 *  not a narrowing: the replay it replaces read the same instance-borne records
 *  and no board either. PRD #2064 S5/S6, which put the registry on the state
 *  itself, remove the need for the synthetic view. */
export function recomposeLayer6ForInstance(
    state: LayerStateView,
    card: CardInstanceState
): void {
    // PRD #2064 S6b-part-2 — the REAL board, not a synthetic one-card view.
    //
    // The synthetic view existed to keep the source-provenance half out of a
    // one-card walk, and it cost an LKI read: the last sync's derived output was
    // the only surviving record of what the real board contributed, so
    // `trustInstanceLedger` unioned it back in. Those fields are gone, and the
    // real board answers the same question directly and correctly — the
    // permanent need not be in a battlefield array for this, since the walk
    // matches sources against the TARGET it is handed (`layer6EffectsFor`), not
    // against the array it finds it in.
    card.staticAbilities = deriveLayer6(
        state,
        card as unknown as PermanentView
    ).staticAbilities;
}

/** One-shot migration for a state persisted BEFORE PRD #2064 S3, where
 *  `abilitiesSuppressedBy` was the LEDGER of every "loses all abilities" hold
 *  rather than derived output.
 *
 *  Called from `expandState` (`gre/serialize.ts`) since PRD #2064 S6b-part-2,
 *  with the rows read off the COMPACT record: the field no longer exists on
 *  `CardInstanceState`, so `expandCard` drops it and this is the only moment it
 *  is readable. It stays HERE because telling the two arms apart needs the
 *  board and the card registry, which is this module's half of the split.
 *
 *  The two arms have to be told apart, and only the board can do it:
 *
 *  - a hold whose source is a live permanent with an `ability-loss` static
 *    ability (Titania's Song, Blood Moon) is the CONTINUOUS arm. It is
 *    re-derived from the board at every read, so it must NOT be seeded — a
 *    ledger row would make it outlive its own `applies` predicate, and the
 *    Song would keep an artifact blank after it stopped being a creature.
 *  - every other hold is the RESOLVING arm (CR 611.2c's `"indefinite"`
 *    sentinel, or CR 611.2b keyed to a resolving permanent that declares no
 *    such static ability — Tishana's Tidebinder). Nothing re-derives those, so
 *    the ledger is the only place they can live.
 *
 *  Runs exactly once per permanent, in the window where `baseStaticAbilities`
 *  was still absent: afterwards `abilitiesSuppressedBy` is this module's own
 *  output and re-seeding from it would make every continuous strip indefinite. */
export function migrateLegacyAbilityLossHolds(
    state: GameState,
    card: CardInstanceState,
    holds: readonly { sourceId: string; seq: number }[] | undefined
): void {
    if (!holds?.length || card.abilityLossHolds) return;
    const view = state as unknown as LayerStateView;
    const resolvingArm = holds.filter(
        (hold) => !declaresApplyingAbilityLoss(view, hold.sourceId, card)
    );
    if (resolvingArm.length > 0) card.abilityLossHolds = resolvingArm;
}

/** Whether `sourceId` names a live battlefield permanent whose `ability-loss`
 *  static ability currently applies to `target` — i.e. whether the board walk
 *  reproduces this hold on its own. */
function declaresApplyingAbilityLoss(
    state: LayerStateView,
    sourceId: string,
    target: CardInstanceState
): boolean {
    const source = findPermanent(state, sourceId);
    if (!source) return false;
    return sourceStaticEffects(source).some(
        (effect) =>
            effect.kind === "ability-loss" &&
            effect.applies(
                target as unknown as PermanentView,
                source,
                STATIC_EFFECT_CTX
            )
    );
}

/** Writes layer 6's derivation onto every battlefield permanent as DERIVED
 *  OUTPUT (PRD #2064 S3; S6 deletes the fields and the consult sites read
 *  `deriveLayer6` directly).
 *
 *  Replaces `recomputeContinuousEffects`, whose narrow "re-run only the
 *  counter-gated sources" sweep existed because a materialised grant could not
 *  be recomputed cheaply. It can now: this is the recompute, and it runs at
 *  every stable transition (`convex/game.ts`), at every SBA pass
 *  (`gre/sba.ts`), around combat (`gre/combat.ts`) and at every apply/unapply
 *  site in `gre/state.ts`, so the ~90 sites that read `staticAbilities` never
 *  see a stale multiset.
 *
 *  Two passes, not one: the derivation reads other permanents' live
 *  characteristics through `applies` / `condition`, so writing into the board
 *  mid-walk would let one permanent's new keyword change the next permanent's
 *  answer within a single recompute — CR 613 composes layers over a FIXED input
 *  per layer, not over a partially-updated board. */
export function syncLayer6(
    state: GameState,
    /** CR 611.2 — source ids whose static abilities have STOPPED applying as of
     *  this recompute, though the permanent is still in the battlefield array.
     *  The one moment board presence and "is applying" disagree:
     *  `stopApplyingStaticEffects` runs BEFORE the permanent is spliced out
     *  (destroy, exile, detach, phase out, re-attach to a different host), and
     *  the effect must be gone from that instant, not from whenever the array
     *  catches up. */
    opts?: { stoppedSourceIds?: ReadonlySet<string> }
): void {
    for (const { card, result } of deriveLayer6Board(state, opts)) {
        Object.assign(card, layer6DerivedFields(card, result));
    }
}

/** One board pass of the CR 613.1f derivation, as a PURE result list: what
 *  every battlefield permanent's layer-6 keyword multiset and granted-ability
 *  rows are, computed from the registry against one fixed board, applied to
 *  nothing.
 *
 *  Split out of `syncLayer6` so the wire projection reads the SAME derivation
 *  the engine writes (PRD #2064 S5, `gre/wireCharacteristics.ts`) rather than
 *  the field the sync happened to leave behind. The twin of
 *  `deriveLayers2to5Board`, and it carries the same caveat: the one-shot base
 *  capture and legacy migration below mutate the cards they are given, so the
 *  wire path hands this function CLONES. */
export function deriveLayer6Board(
    state: GameState,
    opts?: {
        stoppedSourceIds?: ReadonlySet<string>;
        /** Derive EVERY permanent, including the ones the fast path below can
         *  prove are already at their base. The sync skips those because the
         *  fields it would write already hold the answer; a consumer that reads
         *  the RESULT rather than the fields has nothing to read for a skipped
         *  permanent, so the wire path asks for all of them (the same contract
         *  `deriveLayers2to5Board` has carried since PRD #2064 S5). */
        deriveAll?: boolean;
    }
): { card: CardInstanceState; result: Layer6Derivation }[] {
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

    // PASS 0 — base capture for EVERY permanent, before any derivation reads
    // the board. The pre-S3 ledger migration that used to run beside it moved
    // to `expandState` (`gre/serialize.ts`) with PRD #2064 S6b-part-2: the rows
    // it reads no longer survive `expandCard`, so deserialization is the only
    // moment they exist.
    //
    // Split off from the derivation loop by PRD #2064 S7. It was interleaved
    // with it, which meant permanent k was derived against a board where
    // k+1..n had not been captured yet — the very "fixed input per layer"
    // (CR 613) the two-pass shape of `syncLayer6` exists to guarantee. Nothing
    // observable changes today (both writes land on the card's own fields, and
    // only its own derivation reads them), but the SOURCE PLAN below is built
    // once for the whole pass, so "the board does not move mid-walk" stops
    // being a property nothing depends on.
    for (const player of state.players) {
        for (const card of player.battlefield) {
            ensureLayer6Base(card);
        }
    }

    // PASS 1 — ONE board scan of the source half (CR 613.1 — one recompute, one
    // board), rather than one per permanent.
    const sources = collectLayer6Sources(view);
    const noSourceEffects = sources.length === 0 && !hasStoredLayer6Entry(view);

    const derived: { card: CardInstanceState; result: Layer6Derivation }[] = [];
    for (const player of state.players) {
        for (const card of player.battlefield) {
            // FAST PATH — nothing anywhere can change this permanent's layer 6,
            // and nothing did last time either, so its derived answer IS its
            // base and the fields already hold it: `deriveLayer6` over an empty
            // entry list returns exactly `layer6Base`. Skipping is therefore not
            // an approximation of the answer, it is the answer.
            //
            // Load-bearing for the ISMCTS search, which syncs at every apply
            // site on every node it expands. Most boards declare no layer-6
            // static effect at all, and without this each of those pays a full
            // per-permanent derivation plus the field patch it writes back.
            if (
                opts?.deriveAll !== true &&
                noSourceEffects &&
                !carriesLayer6State(card)
            ) {
                continue;
            }
            derived.push({
                card,
                result: deriveLayer6(view, card as unknown as PermanentView, {
                    sources,
                }),
            });
        }
    }
    return derived;
}

/** True when any STORED registry entry belongs to layer 6. Cheap and
 *  board-wide, so the fast path can ask it once per pass. */
function hasStoredLayer6Entry(state: LayerStateView): boolean {
    const stored = state.continuousEffects;
    if (!stored?.length) return false;
    for (const entry of stored) if (entry.layer === 6) return true;
    return false;
}

/** True when the permanent carries ANY layer-6 state: an instance-borne ledger
 *  row this derivation would read, or an output row a PREVIOUS one wrote and
 *  this one might have to clear.
 *
 *  The last clause asks whether the OUTPUT still differs from the BASE, which
 *  is not the same question. An effect that has just ENDED leaves no row behind
 *  — a source leaving the battlefield is how a keyword grant ends — but the
 *  keyword it granted is still sitting in `staticAbilities`. "Nothing applies"
 *  is only a licence to skip when the multiset already SAYS nothing applies.
 *
 *  Deliberately conservative on the five ledger/output arrays: presence, not
 *  emptiness. An EMPTY array is a value `layer6DerivedFields` would rewrite to
 *  `undefined`, so skipping on one would leave the instance in a shape the sync
 *  never produces — one wasted derivation is the cheaper mistake. */
function carriesLayer6State(card: CardInstanceState): boolean {
    return (
        card.abilityLossHolds !== undefined ||
        card.abilitiesSuppressedBy !== undefined ||
        card.grantedActivatedAbilities !== undefined ||
        card.grantedTriggeredAbilities !== undefined ||
        !sameOrder(layer6Base(card), card.staticAbilities)
    );
}

/** The layer-6 derived output as a plain FIELD PATCH — the single mapping from
 *  a `Layer6Derivation` to the instance fields that still hold it.
 *
 *  Since PRD #2064 S6b-part-2 that is the COMPOSED multiset and the two
 *  granted-ability arrays, and nothing else: `grantedStaticAbilities`,
 *  `removedKeywords` and `abilitiesSuppressedBy` are gone from
 *  `CardInstanceState`. They survive on the WIRE (ADR 0082 decision 4), which
 *  is `layer6WireFields` below — the wire's snapshot, never an engine input.
 *
 *  Reads `card` for the half of the granted-ability rows that is NOT derived:
 *  source-provenance grants are derived output, duration- and residue-borne
 *  ones stay on the instance, so the derived rows replace only the
 *  `auraId`-keyed half. */
export function layer6DerivedFields(
    card: CardInstanceState,
    result: Layer6Derivation
): Partial<CardInstanceState> {
    const keptActivated = (card.grantedActivatedAbilities ?? []).filter(
        (g) => !g.auraId
    );
    const activated = [...keptActivated, ...result.grantedActivated];
    const keptTriggered = (card.grantedTriggeredAbilities ?? []).filter(
        (g) => !g.auraId
    );
    const triggered = [...keptTriggered, ...result.grantedTriggered];
    return {
        staticAbilities: result.staticAbilities,
        // The one derived-output field that stays on the instance — see its doc
        // on `CardInstanceState`: its consult sites are board-less hot paths.
        abilitiesSuppressedBy:
            result.abilitiesSuppressedBy.length > 0
                ? result.abilitiesSuppressedBy
                : undefined,
        grantedActivatedAbilities: activated.length > 0 ? activated : undefined,
        grantedTriggeredAbilities: triggered.length > 0 ? triggered : undefined,
    };
}

/** The three layer-6 provenance arrays the WIRE still carries, in the exact
 *  shapes the client has always read (ADR 0082 decision 4, PRD #2064 S5 AC 3 —
 *  the client call sites stay untouched). Derived output here, exactly like
 *  every field in `layer6DerivedFields`; the difference is only that no engine
 *  consult site reads them any more, so they are not written onto the
 *  instance. */
export function layer6WireFields(result: Layer6Derivation): {
    grantedStaticAbilities?: {
        ability: string;
        auraId?: string;
        seq?: number;
    }[];
    removedKeywords?: { keyword: string; sourceId: string; seq?: number }[];
} {
    return {
        grantedStaticAbilities:
            result.grantedStatic.length > 0 ? result.grantedStatic : undefined,
        removedKeywords:
            result.removedKeywords.length > 0
                ? result.removedKeywords
                : undefined,
    };
}
