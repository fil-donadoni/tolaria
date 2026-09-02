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
import {
    compareContinuousEffects,
    latestTimestamp,
    renderKeyword,
} from "./continuousEffects";
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
    /** CR 613.7 — the LATEST timestamp among the ability-loss effects applying
     *  to this permanent, or `null` when none do. What
     *  `grantOutrankedByAbilityLoss` compares a grant against. */
    abilityLossSeq: number | null;
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
    target: PermanentView
): {
    entries: ContinuousEffect[];
    templates: ReadonlyMap<string, DerivedTemplate>;
} {
    const entries: ContinuousEffect[] = [];
    const templates = new Map<string, DerivedTemplate>();

    const pushSourceEffects = (
        source: PermanentView,
        effects: readonly StaticEffect[]
    ): void => {
        // CR 613.7a — a continuous effect generated by a static ability has the
        // timestamp of the object the ability is on. `staticSeq` is that stamp,
        // minted by `allocStaticTimestamp` when the source applied.
        const seq = (source as { staticSeq?: number }).staticSeq ?? 0;
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
    for (const emblem of state.emblems ?? []) {
        const synthetic = emblemAsStaticSource(emblem);
        pushSourceEffects(synthetic, sourceStaticEffects(synthetic));
    }

    const instance = target as unknown as CardInstanceState;

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
    const granted = instance.grantedStaticAbilities ?? [];
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
    for (
        let index = 0;
        index < (instance.abilitiesSuppressedBy ?? []).length;
        index++
    ) {
        const hold = instance.abilitiesSuppressedBy![index];
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

    entries.sort(compareContinuousEffects);
    return { entries, templates };
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
        case "instance-duration":
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
        case "keyword-grant":
            // The parameter is RE-DERIVED here, at read time: `keywordFor`
            // computes the keyword from the live source and target (a
            // protection colour set that follows a board change), while a
            // fixed-output grant returns its declared `keyword` (ADR 0050's
            // fixed / computed pair, as `subtype-set` already has).
            return {
                kind: "keyword-grant",
                keyword:
                    effect.keywordFor?.(target, source, STATIC_EFFECT_CTX) ??
                    effect.keyword,
            };
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
    target: PermanentView
): Layer6Derivation {
    const { entries, templates } = layer6EffectsFor(state, target);
    const instance = target as unknown as CardInstanceState;
    const staticAbilities = [...layer6Base(instance)];
    const grantedActivated: Layer6Derivation["grantedActivated"] = [];
    const grantedTriggered: Layer6Derivation["grantedTriggered"] = [];
    const removedKeywords: Layer6Derivation["removedKeywords"] = [];
    const abilityLossStamps: number[] = [];

    for (const entry of entries) {
        const action = resolveLayer6Action(state, target, entry, templates);
        if (!action) continue;
        switch (action.kind) {
            case "keyword-grant":
                staticAbilities.push(action.keyword);
                break;
            case "keyword-remove": {
                const idx = staticAbilities.indexOf(action.keyword);
                if (idx === -1) break;
                staticAbilities.splice(idx, 1);
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
                // A later grant is applied after this point in the walk and
                // survives, so the stamp is recorded rather than acted on
                // again: `getEffectiveActivatedAbilities` needs it to make the
                // same call for NATIVE abilities, which are not in this walk.
                abilityLossStamps.push(entry.timestamp);
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
        grantedActivated,
        grantedTriggered,
        abilityLossSeq: latestTimestamp(abilityLossStamps),
        removedKeywords,
    };
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
export function syncLayer6(state: GameState): void {
    const derived: { card: CardInstanceState; result: Layer6Derivation }[] = [];
    for (const player of state.players) {
        for (const card of player.battlefield) {
            // Capture the base BEFORE the first write, while `staticAbilities`
            // still holds it alone (see `layer6Base`).
            if (card.baseStaticAbilities === undefined) {
                card.baseStaticAbilities = [...card.staticAbilities];
            }
            derived.push({
                card,
                result: deriveLayer6(
                    state as unknown as LayerStateView,
                    card as unknown as PermanentView
                ),
            });
        }
    }
    for (const { card, result } of derived) {
        card.staticAbilities = result.staticAbilities;
        card.abilityLossSeq = result.abilityLossSeq ?? undefined;
        card.removedKeywords =
            result.removedKeywords.length > 0
                ? result.removedKeywords
                : undefined;
        // Source-provenance grants are derived; duration- and residue-borne
        // ones stay on the instance until PRD #2064 S6, so they are preserved
        // and the derived rows replace only the `auraId`-keyed half.
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
