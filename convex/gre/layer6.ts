// CR 613.1f layer 6 — ability-adding effects, keyword counters, ability-removing
// effects, derived per read from the Continuous Effects Registry
// (`gre/continuousEffects.ts`, ADR 0082, PRD #2064 S3).
//
// WHAT CHANGED. Layer 6 used to be MATERIALISE-AT-ATTACH: a `keyword-grant`
// pushed a keyword STRING onto the target's `staticAbilities[]` at the moment
// its source applied, and only `refreshCounterGatedStatics` re-ran the
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
// points those sites at `deriveLayer6` directly; S5 puts the registry on the
// wire so the client can do the same. The pre-layer-6 keyword multiset lives in
// `baseStaticAbilities`, the layer-6 twin of `printedSubtypes` (layer 4).
//
// WHAT REVOCATION IS. Nothing. An entry applies while its expiry says it does;
// when the last paralyzation counter comes off, the derivation simply stops
// producing the entry. No `grant*Permanent` primitive needs a revoke sibling —
// PRD #2064's "no revoke-a-permanent-grant primitive is introduced".

import { tryGetDefinition } from "../cards";
import { tryGetEmblemDefinition } from "../cards/emblems";
import { getKeywordCounterGrant } from "../cards/mechanicsRegistry";
import { compareContinuousEffects, renderKeyword } from "./continuousEffects";
import type { ContinuousEffect } from "./continuousEffects";
import { STATIC_EFFECT_CTX } from "./layers";
import type { LayerStateView } from "./layers";
import type {
    EmblemInstance,
    PermanentView,
    StaticEffect,
} from "../cards/types";
import type { CardInstanceState, GameState } from "./state";

/** The `StaticEffect` kinds layer 6 owns (CR 613.1f). Every other kind belongs
 *  to another layer (or, for the CR 611.3 rules-modifying kinds, outside the
 *  layer system entirely — ADR 0082 decision 2) and is left to the
 *  materialising path in `gre/state.ts` until PRD #2064 S4 migrates layers 2-5.
 *
 *  A `Record` over the kinds rather than an array literal, so a reader can ask
 *  "is this kind mine?" in O(1) and a new layer-6 kind is one row. */
const LAYER_6_STATIC_EFFECT_KINDS: Record<string, true> = {
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
 *  Called at the TOP of every ledger writer (`SpellContext.grantStaticAbility`,
 *  `grantStaticAbilityPermanent`, `removeStaticAbilities`, `animateAsCreature`,
 *  `applyKeywordCounterGrant`) BEFORE it adds its row, and once per permanent
 *  from `syncLayer6`. */
export function ensureLayer6Base(card: CardInstanceState): void {
    if (card.baseStaticAbilities !== undefined) return;
    card.baseStaticAbilities = captureLayer6Base(card);
}

/** Snapshots the pre-layer-6 base out of a permanent's `staticAbilities`.
 *
 *  Layer 6's own inverse, and it needs BOTH halves:
 *
 *      base = staticAbilities + removals - grants
 *
 *  `staticAbilities` is the COMPOSED result, so an occurrence a live grant put
 *  there is not part of the base and comes back off, and an occurrence a live
 *  removal took away IS part of the base and goes back on. Subtracting the
 *  grants alone — the first cut of this function — silently ATE the base of any
 *  permanent captured while a removal was applying: an Air Elemental captured
 *  under a Gravity Sphere came out as `[]` and never flew again, however long
 *  after the Sphere died. Same for a Shelkin Brownie strip, and for every
 *  keyword a continuous `ability-loss` had cleared.
 *
 *  Two moments reach it, and the formula is exact at both:
 *
 *  - a state PERSISTED BEFORE PRD #2064 S3, whose `staticAbilities` still holds
 *    the base plus every grant the old materialising path had pushed, with
 *    `removedKeywords` / `temporaryRemovedKeywords` holding what the strippers
 *    had spliced out of it;
 *  - a permanent whose base was CLEARED from below layer 6 (an identity swap, a
 *    CR 614.12c body / anchor choice) while grants and removals were live. Here
 *    the records are this module's own derived output, which is the same
 *    arithmetic read the other way.
 *
 *  A `suppressed` grant — a pre-slice row that never reached the multiset — took
 *  no occurrence and gives none back. Layer 4 has the same shape and the same
 *  reason: `capturePrintedSubtypes` (`gre/state.ts`) filters out subtypes a live
 *  `subtype-add` put there. This goes with the field when S6 deletes it. */
function captureLayer6Base(card: CardInstanceState): string[] {
    const base = [...card.staticAbilities];
    // Removals first, then grants: a removal and a grant of the SAME keyword
    // must not cancel each other out of the reconstruction by ordering
    // accident (the grant's `splice` would otherwise eat the occurrence the
    // removal just restored, leaving the base one short).
    for (const removal of card.removedKeywords ?? []) {
        base.push(removal.keyword);
    }
    for (const removal of card.temporaryRemovedKeywords ?? []) {
        base.push(removal.keyword);
    }
    for (const grant of card.grantedStaticAbilities ?? []) {
        if (grant.suppressed) continue;
        const index = base.indexOf(grant.ability);
        if (index !== -1) base.splice(index, 1);
    }
    return base;
}

/** CR 114 — a source-less synthetic `PermanentView` standing in for a
 *  command-zone emblem, so its owner-scoped continuous static effects flow
 *  through the same `applies(target, source, ctx)` predicates as a battlefield
 *  source. Twin of `emblemAsStaticSource` in `gre/layers.ts` (issue #1221);
 *  duplicated rather than exported across because the two modules would
 *  otherwise import each other. */
function emblemAsStaticSource(emblem: EmblemInstance): PermanentView {
    return {
        id: emblem.id,
        controllerId: emblem.ownerId,
        ownerId: emblem.ownerId,
        types: [],
        subtypes: [],
        isTapped: false,
        card: { id: emblem.emblemId },
    } as PermanentView;
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
 *    nothing to walk, which is exactly why the registry exists. Still borne by
 *    the instance until PRD #2064 S6 moves the countdown in here.
 *  - `counter` — CR 122.1b keyword counters, gated on the counter still being
 *    there. Neither duration-bounded nor tied to a live source.
 *  - stored `state.continuousEffects` — the channel that is simultaneously
 *    source-INDEPENDENT and condition-GATED, which no pre-registry channel could
 *    be at once (Dread Wight, `cards/sets/ice/black.ts`).
 */
function layer6EffectsFor(
    state: LayerStateView,
    target: PermanentView,
    trustLedger: boolean
): {
    entries: ContinuousEffect[];
    templates: ReadonlyMap<string, DerivedTemplate>;
} {
    const entries: ContinuousEffect[] = [];
    const templates = new Map<string, DerivedTemplate>();

    const pushSourceEffects = (
        source: PermanentView,
        effects: readonly StaticEffect[],
        /** CR 114.3 — an emblem has abilities like any other object but is not
         *  a permanent, so the engine mints it no `staticSeq` (`EmblemInstance`
         *  has no such field). Without a stamp of its own it would be skipped
         *  by the gate below and every emblem-granted keyword would ship inert,
         *  with no test to red. Emblems are created by a resolution and never
         *  leave, so array order IS their timestamp — the same derived-ordinal
         *  proxy layer 7 uses for the provenances that carry no minted stamp
         *  (`gre/layers.ts`'s `DERIVED_TIMESTAMP_BASE`). Kept far below every
         *  minted stamp so an emblem never outranks a real one. */
        derivedSeq?: number
    ): void => {
        // CR 613.7a — a continuous effect generated by a static ability has the
        // timestamp of the object the ability is on. `staticSeq` is that stamp,
        // minted by `allocStaticTimestamp` the moment the object begins
        // applying (`applySourceStaticEffects`, called on EVERY battlefield
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
        const seq = derivedSeq ?? (source as { staticSeq?: number }).staticSeq;
        if (seq === undefined) return;
        for (let index = 0; index < effects.length; index++) {
            const effect = effects[index];
            if (!LAYER_6_STATIC_EFFECT_KINDS[effect.kind]) continue;
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
    };

    for (const player of state.players) {
        for (const source of player.battlefield) {
            pushSourceEffects(source, sourceStaticEffects(source));
        }
    }
    // CR 114 (issue #1221) — command-zone emblems contribute source-less,
    // owner-scoped statics through the same predicate walk.
    let emblemOrdinal = EMBLEM_TIMESTAMP_BASE;
    for (const emblem of state.emblems ?? []) {
        const synthetic = emblemAsStaticSource(emblem);
        pushSourceEffects(
            synthetic,
            sourceStaticEffects(synthetic),
            emblemOrdinal++
        );
    }

    const instance = target as unknown as CardInstanceState;
    const granted = instance.grantedStaticAbilities ?? [];

    // CR 122.1b — a keyword counter causes the object to gain that keyword. The
    // gate IS the counter: no unapply site is needed, because a count of zero
    // stops producing the entry. The ledger row (`grantedStaticAbilities` with
    // a `counterType`) survives only to carry the CR 613.7c timestamp, which
    // nothing else records.
    for (const [counterType, count] of Object.entries(target.counters ?? {})) {
        if (count <= 0) continue;
        const keyword = getKeywordCounterGrant(counterType);
        if (!keyword) continue;
        const ledger = (instance.grantedStaticAbilities ?? []).find(
            (g) => g.counterType === counterType
        );
        entries.push({
            id: `ce6-counter-${target.id}-${counterType}`,
            layer: 6,
            timestamp: ledger?.seq ?? 0,
            expiry: { kind: "counter", permanentId: target.id, counterType },
            affected: { kind: "instances", instanceIds: [target.id] },
            payload: { kind: "keyword-grant", keyword },
            characteristicDefining: false,
        });
    }

    // CR 611.2a / 611.2c — residue of a resolved spell or ability: an
    // until-end-of-turn grant (`duration`) and an indefinite one (neither
    // duration nor source nor counter). Entries keyed by `auraId` are NOT read
    // here: those are the source provenance, re-derived from the live board
    // above, and a persisted state written before this slice can still carry
    // them.
    for (let index = 0; index < granted.length; index++) {
        const grant = granted[index];
        if (grant.auraId || grant.counterType) continue;
        entries.push({
            id: `ce6-grant-${target.id}-${index}`,
            layer: 6,
            timestamp: grant.seq ?? 0,
            expiry: grant.duration
                ? {
                      kind: "duration",
                      duration: grant.duration,
                      controllerId: target.controllerId,
                  }
                : { kind: "indefinite", controllerId: target.controllerId },
            affected: { kind: "instances", instanceIds: [target.id] },
            payload: { kind: "keyword-grant", keyword: grant.ability },
            characteristicDefining: false,
        });
    }

    // CR 611.2a — a duration-scoped keyword REMOVAL (Shelkin Brownie stripping
    // banding until end of turn). The removal twin of the block above: same
    // expiry, opposite payload, which is the whole of what "provenance" means
    // once the registry has absorbed it.
    const temporaryRemovals = instance.temporaryRemovedKeywords ?? [];
    for (let index = 0; index < temporaryRemovals.length; index++) {
        const removal = temporaryRemovals[index];
        entries.push({
            id: `ce6-tempremove-${target.id}-${index}`,
            layer: 6,
            timestamp: removal.seq ?? 0,
            expiry: {
                kind: "duration",
                duration: removal.duration,
                controllerId: target.controllerId,
            },
            affected: { kind: "instances", instanceIds: [target.id] },
            payload: { kind: "keyword-remove", keyword: removal.keyword },
            characteristicDefining: false,
        });
    }

    // CR 613.1f — "loses all abilities" generated by a RESOLVING ability
    // (`SpellContext.loseAllAbilities`, Oko's +1 — indefinite, sentinel-keyed;
    // `loseAllAbilitiesWhileSourceRemains`, Tishana's Tidebinder — CR 611.2b,
    // keyed to the resolving permanent's own instance id). The CONTINUOUS arm
    // (Titania's Song's `ability-loss` static effect) is derived from the board
    // walk above and is deliberately absent from this ledger, so no strip is
    // counted twice.
    // A `trustLedger` derivation has NO BOARD (see
    // `recomposeLayer6ForInstance`), so the source-provenance effects it cannot
    // walk to are read off the DERIVED OUTPUT of the last real sync instead:
    // the `auraId`-keyed grant rows and `abilitiesSuppressedBy`. That is not
    // reading input from output — it is last-known information (CR 608.2h's
    // shape), the only record of a fact the synthetic view cannot see, and it
    // is exactly what the `replayLayer6Abilities` this module replaced read.
    // The next `syncLayer6` re-derives all of it from the real board.
    if (trustLedger) {
        for (let index = 0; index < granted.length; index++) {
            const grant = granted[index];
            if (!grant.auraId) continue;
            entries.push({
                id: `ce6-lki-grant-${target.id}-${index}`,
                layer: 6,
                timestamp: grant.seq ?? 0,
                expiry: { kind: "source", sourceId: grant.auraId },
                affected: { kind: "instances", instanceIds: [target.id] },
                payload: { kind: "keyword-grant", keyword: grant.ability },
                characteristicDefining: false,
            });
        }
        // A removal recorded by a BLANKET stripper is already represented by
        // that stripper's own ability-loss entry below; replaying it as a
        // targeted removal too would take the occurrence twice.
        const blanket = new Set(
            (instance.abilitiesSuppressedBy ?? []).map((s) => s.sourceId)
        );
        const removals = instance.removedKeywords ?? [];
        for (let index = 0; index < removals.length; index++) {
            const removal = removals[index];
            if (blanket.has(removal.sourceId)) continue;
            entries.push({
                id: `ce6-lki-remove-${target.id}-${index}`,
                layer: 6,
                timestamp: removal.seq ?? 0,
                expiry: { kind: "source", sourceId: removal.sourceId },
                affected: { kind: "instances", instanceIds: [target.id] },
                payload: { kind: "keyword-remove", keyword: removal.keyword },
                characteristicDefining: false,
            });
        }
    }

    // The resolving arm's LEDGER. Under `trustLedger` the derived record of
    // BOTH arms is unioned in, because a boardless derivation cannot re-walk to
    // the continuous one; on a synced board that record already contains every
    // ledger hold, so the union is idempotent (same argument as
    // `abilityLossTimestamp`'s two reads). Deduped on `sourceId`+`seq`, which
    // is the identity of a hold — two holds from one source at one timestamp
    // are one effect (CR 611.2c).
    const ledger = instance.abilityLossHolds ?? [];
    let holds = ledger;
    if (trustLedger) {
        const seen = new Set(ledger.map((h) => `${h.sourceId}|${h.seq}`));
        holds = [
            ...ledger,
            ...(instance.abilitiesSuppressedBy ?? []).filter(
                (h) => !seen.has(`${h.sourceId}|${h.seq}`)
            ),
        ];
    }
    for (let index = 0; index < holds.length; index++) {
        const hold = holds[index];
        if (
            !trustLedger &&
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
    return { entries, templates };
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

/** CR 613.7 timestamp floor for command-zone emblems, which the engine mints no
 *  `staticSeq` for (CR 114.3 — an emblem is not a permanent). Far below every
 *  minted stamp, so an emblem's grant never outranks a real one and can never
 *  interleave with the board's own ordering; among themselves, emblems order by
 *  creation (array) order. Twin of `DERIVED_TIMESTAMP_BASE` in `gre/layers.ts`,
 *  and it goes the same way in PRD #2064 S6, when producers write entries with
 *  their own stamps. */
const EMBLEM_TIMESTAMP_BASE = -1_000_000_000;

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
        case "instance-duration":
            // NOT checked here, and NOT yet ticked either: the phase-boundary
            // cleanup (`gre/phases.ts`) ticks the instance-borne records, and
            // nothing splices `state.continuousEffects`. A STORED entry with a
            // duration expiry would therefore apply forever, which is why
            // `addContinuousEffect` rejects one (`gre/state.ts`) — PRD #2064 S6
            // moves the countdown in here and lifts the restriction.
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
    // gate, so it runs it here; a DERIVED one has, and re-running it is a pure
    // repeat rather than a second, provenance-dependent rule.
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
        /** Take the instance's own CR 611.2b ability-loss ledger at face value
         *  instead of checking each hold's source against the board. Set ONLY
         *  by `recomposeLayer6ForInstance`, whose board is a synthetic one-card
         *  view in which no hold's source can be found — without it, an
         *  identity swap would silently end a Tishana's Tidebinder strip. The
         *  next full `syncLayer6` re-checks every hold against the real
         *  board. */
        trustInstanceLedger?: boolean;
    }
): Layer6Derivation {
    const { entries, templates } = layer6EffectsFor(
        state,
        target,
        opts?.trustInstanceLedger === true
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
export function recomposeLayer6ForInstance(card: CardInstanceState): void {
    const view = {
        players: [{ id: card.controllerId, battlefield: [card] }],
    } as unknown as LayerStateView;
    const result = deriveLayer6(view, card as unknown as PermanentView, {
        trustInstanceLedger: true,
    });
    card.staticAbilities = result.staticAbilities;
    card.removedKeywords =
        result.removedKeywords.length > 0 ? result.removedKeywords : undefined;
    // `abilitiesSuppressedBy` and the `auraId`-keyed grant rows are NOT
    // rewritten here: the synthetic board cannot re-derive either, and they are
    // the only surviving record of what the real board is contributing — the
    // walk above just read them as such. Clearing them would silently end a
    // Titania's Song strip and drop every anthem keyword until the next sync,
    // which is a window two production paths could read in (the search's
    // `turn-face-up` leaf, and a mana ability's `payRemoveCounterCost`).
}

/** One-shot migration for a state persisted BEFORE PRD #2064 S3, where
 *  `abilitiesSuppressedBy` was the LEDGER of every "loses all abilities" hold
 *  rather than derived output.
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
function migrateLegacyAbilityLossHolds(
    state: GameState,
    card: CardInstanceState
): void {
    const holds = card.abilitiesSuppressedBy;
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
 *  Replaces `refreshCounterGatedStatics`, whose narrow "re-run only the
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
     *  `unapplySourceStaticEffects` runs BEFORE the permanent is spliced out
     *  (destroy, exile, detach, phase out, re-attach to a different host), and
     *  the effect must be gone from that instant, not from whenever the array
     *  catches up. */
    opts?: { stoppedSourceIds?: ReadonlySet<string> }
): void {
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
    const derived: { card: CardInstanceState; result: Layer6Derivation }[] = [];
    for (const player of state.players) {
        for (const card of player.battlefield) {
            // A card the engine has never derived for is either brand new or
            // came out of a state PERSISTED BEFORE this slice. Both are
            // handled here, and only here, because both need the BOARD to be
            // read correctly (see `migrateLegacyAbilityLossHolds`).
            const legacy = card.baseStaticAbilities === undefined;
            ensureLayer6Base(card);
            if (legacy) migrateLegacyAbilityLossHolds(state, card);
            derived.push({
                card,
                result: deriveLayer6(view, card as unknown as PermanentView),
            });
        }
    }
    for (const { card, result } of derived) {
        card.staticAbilities = result.staticAbilities;
        card.abilitiesSuppressedBy =
            result.abilitiesSuppressedBy.length > 0
                ? result.abilitiesSuppressedBy
                : undefined;
        card.removedKeywords =
            result.removedKeywords.length > 0
                ? result.removedKeywords
                : undefined;
        // Source-provenance grants are derived; duration- and residue-borne
        // ones stay on the instance until PRD #2064 S6, so they are preserved
        // and the derived rows replace only the `auraId`-keyed half.
        const keptStatic = (card.grantedStaticAbilities ?? []).filter(
            (g) => !g.auraId
        );
        const staticRows = [...keptStatic, ...result.grantedStatic];
        card.grantedStaticAbilities =
            staticRows.length > 0 ? staticRows : undefined;
        const keptActivated = (card.grantedActivatedAbilities ?? []).filter(
            (g) => !g.auraId
        );
        const activated = [...keptActivated, ...result.grantedActivated];
        card.grantedActivatedAbilities =
            activated.length > 0 ? activated : undefined;
        const keptTriggered = (card.grantedTriggeredAbilities ?? []).filter(
            (g) => !g.auraId
        );
        const triggered = [...keptTriggered, ...result.grantedTriggered];
        card.grantedTriggeredAbilities =
            triggered.length > 0 ? triggered : undefined;
    }
}
