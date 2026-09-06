// Continuous-effect layer system (CR 611, 613).
// Scope: layer 7 (power/toughness). Every layer-7 effect — a static ability's,
// a counter's, a resolved spell's residue — is read as a Continuous Effects
// Registry entry (`gre/continuousEffects.ts`, ADR 0082, PRD #2064 S2).
// Computed at read time — never mutate card state.
//
// Static effects are expressed via an `applies` predicate plus a small
// `StaticEffectContext` of pure helpers (getColors, isCreature, hasSubtype).
// Each card declares its own eligibility rule — engine has no enum of
// scopes/filters to maintain.

import { getInstanceManaCost, tryGetDefinition } from "../cards";
import { tryGetEmblemDefinition } from "../cards/emblems";
import { getEffectiveColors } from "../cards/effectiveColors";
import { hasSupertypeLive } from "./snow";
import { compareContinuousEffects } from "./continuousEffects";
import type {
    ContinuousEffect,
    ContinuousEffectSublayer,
} from "./continuousEffects";
import type {
    CardType,
    Color,
    EmblemInstance,
    PermanentView,
    StaticEffect,
    StaticEffectContext,
    StaticEffectStateView,
} from "../cards/types";

export type PTBuff = { power: number; toughness: number };

const ZERO: PTBuff = { power: 0, toughness: 0 };

/** The view the layer system reads. `StaticEffectStateView` (canonical in
 *  `cards/types.ts`, so static-effect predicates can reference it without a
 *  cycle) plus the Continuous Effects Registry, which layer 7 is defined
 *  against (ADR 0082, PRD #2064). The registry rides here rather than on
 *  `StaticEffectStateView` itself to keep `cards/types.ts` a dependency-free
 *  leaf; it is optional because a caller that constructs the view by hand
 *  (`gre/constants.ts`'s `manaLayerView`, `src/lib/effective-stats.ts`'s
 *  `toLayerState`) may have none to pass. PRD #2064 S5 puts the registry on the
 *  wire, so a client caller that reconstructs a whole `GameState`
 *  (`src/lib/ai/state-adapter.ts`) now has one; `toLayerState` still does not —
 *  see the note in `layer7EffectsFor`. */
export type LayerStateView = StaticEffectStateView & {
    readonly continuousEffects?: readonly ContinuousEffect[];
};

/** CR 114 — a source-less synthetic `PermanentView` standing in for a
 *  command-zone emblem, so its owner-scoped continuous static effects flow
 *  through the same `applies(target, source, ctx)` predicates as a battlefield
 *  source. `controllerId`/`ownerId` are the emblem's owner (CR 114.3), so an
 *  anthem's "creatures you control" predicate (controller match) scopes
 *  correctly. Carries no card characteristics — an emblem has none (CR 114.3).
 *  Issue #1221. */
export function emblemAsStaticSource(emblem: EmblemInstance): PermanentView {
    return {
        id: emblem.id,
        controllerId: emblem.ownerId,
        ownerId: emblem.ownerId,
        types: [],
        subtypes: [],
        isTapped: false,
        // Registry-keyed like a card's `card.id`, for any ctx helper that reads
        // the source's underlying definition.
        card: { id: emblem.emblemId },
    } as PermanentView;
}

/** Returns the emblem definition's static effects of a given kind, or [] if the
 *  emblem is unregistered / carries none. Mirrors `getStaticEffects` for the
 *  command zone (CR 114). */
function getEmblemStaticEffects(emblem: EmblemInstance): StaticEffect[] {
    return tryGetEmblemDefinition(emblem.emblemId)?.staticEffects ?? [];
}

/** Returns the card definition's static effects, or [] if unknown.
 *
 *  `modeOverride` resolves a STORED registry entry, whose `effectIndex` was
 *  computed against the mode recorded in its own payload — not against
 *  whatever mode the permanent carries now. Omit it and the live mode is used,
 *  which is what the per-read derivation wants. */
function getStaticEffects(
    card: PermanentView,
    modeOverride?: string
): StaticEffect[] {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return [];
    const def = tryGetDefinition(cardId);
    if (!def) return [];
    const cardEffects = def.staticEffects ?? [];
    // CR 700.2c — a modal permanent also contributes its chosen mode's static
    // effects (Jihad's per-colour anthem). Mirrors `getEffectiveStaticEffects`
    // in state.ts (kept local to avoid a layers ↔ state import cycle).
    const chosenModeId =
        modeOverride ?? (card as { chosenModeId?: string }).chosenModeId;
    if (!chosenModeId || !def.modes) return cardEffects;
    const mode = def.modes.find((m) => m.id === chosenModeId);
    const modeEffects = mode?.staticEffects ?? [];
    if (modeEffects.length === 0) return cardEffects;
    if (cardEffects.length === 0) return modeEffects;
    return [...cardEffects, ...modeEffects];
}

/** Context passed to every static-effect predicate. Pure, state-free. */
export const STATIC_EFFECT_CTX: StaticEffectContext = {
    // CR 613.1d layer 5 — delegated to the single colour authority
    // (`cards/effectiveColors.ts`): colorOverride SETS, grantedColors UNION.
    getColors: getEffectiveColors,
    isCreature(card: PermanentView): boolean {
        return card.types.includes("Creature");
    },
    hasSubtype(card: PermanentView, subtype: string): boolean {
        return card.subtypes.includes(subtype);
    },
    hasSupertype(card: PermanentView, supertype: string): boolean {
        // CR 205.4a — printed supertypes live on the (possibly copied /
        // tokenized) card definition, overlaid by any `supertype-set` static
        // effect or indefinite `setSupertype` mutation (Melting / Arcum's
        // Weathervane). `hasSupertypeLive` resolves the live status.
        return hasSupertypeLive(card, supertype);
    },
    getPrintedTypes(card: PermanentView): CardType[] {
        // CR 205.2 — printed type line from the card definition; ignores the
        // live `types` array (which type-add / animate effects mutate).
        const cardId = (card.card as { id?: string }).id;
        const def = cardId ? tryGetDefinition(cardId) : undefined;
        return (def?.types ?? []) as CardType[];
    },
    getName(card: PermanentView): string {
        // CR 201.2 — card name from the (possibly copied / tokenized) card
        // definition. An embedded name on the instance's card reference wins
        // (copy effects), else look the printed name up via the registry.
        const embedded = (card.card as { name?: string }).name;
        if (embedded) return embedded;
        const cardId = (card.card as { id?: string }).id;
        const def = cardId ? tryGetDefinition(cardId) : undefined;
        return def?.name ?? "";
    },
    getManaValue(card: PermanentView): number {
        // CR 202.3 — numeric X in the printed cost contributes to mana
        // value (the codebase encodes generic cost as `X: number`); only
        // the string-X placeholder for variable-X cards is treated as 0.
        // Single authority (`cards/registry.ts`): instance `manaCostOverride`
        // (CR 707.2 "except it has no mana cost" — an Eternalize token) →
        // embedded fixture cost → registry definition.
        const cost = getInstanceManaCost(card);
        if (!cost) return 0;
        let total = 0;
        for (const [k, v] of Object.entries(cost)) {
            // `xFactor` is an X-multiplier, not a mana amount — exclude it.
            if (k === "xFactor") continue;
            if (typeof v === "number") total += v;
        }
        return total;
    },
    getCounterCount(card: PermanentView, type: string): number {
        // CR 122.1 — mirrors `SpellContext.getCounterCount` (state.ts) for
        // static-effect predicates (issue #1318). `card.counters` is the
        // live per-permanent map; a missing entry means zero counters of
        // that type, not "unknown".
        return card.counters?.[type] ?? 0;
    },
};

/** Devotion (CR 700.5, issue #2070) — the number of mana symbols of `color`
 *  among the mana costs of permanents `controllerId` controls: coloured pips
 *  + `phyrexian[color]` pips (CR 105.2 — still a coloured symbol) + ONE per
 *  `hybrid` pair CONTAINING `color` (a `[U,R]` pair counts toward devotion to
 *  BOTH blue and red). Generic, `{X}`/`xFactor`, and a permanent with no mana
 *  cost (token, land) contribute 0. Scanned by CONTROLLER, mirroring
 *  `countDomain`'s CR 110.4 convention (a stolen permanent counts for its
 *  controller). Reads each permanent's live mana cost through
 *  `getInstanceManaCost` (`cards/registry.ts`) — the SAME single authority
 *  the layer-5 colour system (`getManaValue` above) and every other
 *  mana-value / cost-derived-colour reader share, so a `manaCostOverride`
 *  (CR 707.2's "except it has no mana cost", an Eternalize/Embalm token)
 *  correctly contributes 0 here too. Lives here rather than beside
 *  `countDomain` (`cards/types.ts`) because it needs the registry lookup
 *  `countDomain` doesn't — `cards/types.ts` is a deliberately dependency-free
 *  leaf (ADR-adjacent to the `colors.ts` cycle-avoidance comment above
 *  `setCardManaCostLookup`), and this module already imports
 *  `getInstanceManaCost` for exactly this class of scan. Backs the tenth
 *  `EffectValue` grammar member (`{ devotion: { of, color } }`,
 *  `SpellContext.getDevotion`, Thassa's Oracle). Single-colour only — CR
 *  700.5's two-colour devotion sentence ("devotion to [color 1] and
 *  [color 2]") is unimplemented yet (extract-on-second rule). */
export function countDevotion(
    state: StaticEffectStateView,
    controllerId: string,
    color: Color
): number {
    let total = 0;
    for (const player of state.players) {
        for (const permanent of player.battlefield) {
            if (permanent.controllerId !== controllerId) continue;
            const cost = getInstanceManaCost(permanent);
            if (!cost) continue;
            total += (cost[color] ?? 0) + (cost.phyrexian?.[color] ?? 0);
            for (const pip of cost.hybrid ?? []) {
                if (pip.includes(color)) total += 1;
            }
        }
    }
    return total;
}

/** Per-counter-type contribution to layer 7c (CR 613.4c — "effects AND
 *  COUNTERS that modify power and/or toughness"; CR 122.1a). Only the
 *  P/T-modifying built-in types are recognized here; other types (corpse,
 *  mire, charge, vitality) are inert to the layer system and are read by
 *  card-specific abilities directly. */
const COUNTER_PT_CONTRIBUTION: Record<string, PTBuff> = {
    "+1/+1": { power: 1, toughness: 1 },
    "-1/-1": { power: -1, toughness: -1 },
    "+1/+0": { power: 1, toughness: 0 },
    "-1/-0": { power: -1, toughness: 0 },
    "+0/+1": { power: 0, toughness: 1 },
    "-0/-1": { power: 0, toughness: -1 },
    // CR 122.1d — Spirit Shackle (LEG) stacks "-0/-2" counters on a tapped
    // creature. Each contributes -2 toughness, 0 power; they ride the same
    // counter→P/T pipeline as the built-in -1/-1 family.
    "-0/-2": { power: 0, toughness: -2 },
    // CR 122.1c — FEM C5 black introduces the ±2 counter family: Armor Thrull's
    // "+1/+2", Soul Exchange's "+2/+2" (on a reanimated Thrull), and Ebon
    // Praetor's "-2/-2" (upkeep) / "+1/+0" (sacrificed-Thrull bonus, already
    // above). Each rides the same counter→P/T pipeline.
    "+1/+2": { power: 1, toughness: 2 },
    "+2/+2": { power: 2, toughness: 2 },
    "-2/-2": { power: -2, toughness: -2 },
};

/** True while `sourceId` is a permanent on some battlefield that is tapped
 *  (CR 611.2b state-tied duration). A source that has left the battlefield
 *  fails (the effect ends with its source). */
export function isSourceTappedLive(
    state: LayerStateView,
    sourceId: string
): boolean {
    for (const player of state.players) {
        const src = player.battlefield.find((c) => c.id === sourceId);
        if (src) return Boolean((src as PermanentView).isTapped);
    }
    return false;
}

/** CR 613.4 — the layer-7 sublayers, applied in this order. Declared as a
 *  `Record` over the sublayer union rather than a bare literal, so `tsc` reds
 *  when the union gains a member instead of the pipeline silently skipping
 *  it. */
const LAYER_7_SUBLAYER_ORDER: Record<ContinuousEffectSublayer, number> = {
    "7a": 0,
    "7b": 1,
    "7c": 2,
    "7d": 3,
};

const LAYER_7_SUBLAYERS: readonly ContinuousEffectSublayer[] = (
    Object.keys(LAYER_7_SUBLAYER_ORDER) as ContinuousEffectSublayer[]
).sort((a, b) => LAYER_7_SUBLAYER_ORDER[a] - LAYER_7_SUBLAYER_ORDER[b]);

/** Timestamp floor for entries this module DERIVES per read rather than reads
 *  out of `state.continuousEffects` (PRD #2064 S2).
 *
 *  A derived entry has no real CR 613.7 timestamp to carry: the engine mints
 *  one only when a grant happens (`allocStaticTimestamp`), and gives a
 *  permanent no object timestamp at all (CR 613.7d), so board walk order is the
 *  only ordering proxy available — exactly the proxy the pre-migration
 *  `getCDAContribution` and `temporaryPTSet` readers already used ("array order
 *  is the timestamp"). Starting the derived sequence far below every minted
 *  stamp keeps that proxy from silently interleaving with real ones: a stored
 *  entry, which is residue of a spell that resolved at a known moment, sorts
 *  after every derived entry instead of landing at an arbitrary point inside
 *  the board walk. `allocStaticTimestamp` counts grants, so it cannot approach
 *  this floor within a game.
 *
 *  It disappears with the proxy: once S6's producers write these entries, they
 *  carry the minted timestamp and this constant goes with the derivation. */
const DERIVED_TIMESTAMP_BASE = -1_000_000_000;

/** The live source and `StaticEffect` a DERIVED template entry was built from,
 *  kept beside the entry so the resolver never has to look either up again —
 *  and so an emblem's effect, which no card-registry lookup can reach, resolves
 *  by the same path as a permanent's. */
type DerivedTemplate = { source: PermanentView; effect: StaticEffect };

/** The layer-7 registry entries applying to `target`, in CR 613.7 order, paired
 *  with the live source each source-provenance entry was derived from.
 *
 *  This is the ONE place layer 7 reads a `staticEffects[]` declaration or a
 *  P/T field off a card instance; every consumer below reads `ContinuousEffect`
 *  entries and nothing else. Two provenances are DERIVED per read rather than
 *  stored, and both are derivable precisely because they have something live to
 *  read (ADR 0082's own argument for why the other provenances need a registry
 *  at all):
 *
 *  - a permanent's or emblem's `pt-buff` / `pt-cda` static ability — expiry
 *    `source`, re-evaluated against the live board at every read, so phasing,
 *    a control change and a leave-the-battlefield need no purge site and
 *    cannot drift (CR 613.1: characteristics are recomputed every time they
 *    are checked);
 *  - counters — expiry `counter`, one entry per counter TYPE because CR 613.7c
 *    gives every counter of a kind the same timestamp.
 *
 *  The three instance-borne families (`temporaryPTSet`, `temporaryPTMods`,
 *  `sourceTappedPTMods`) are resolution residue with no source to walk. They
 *  are derived here too while their countdown still lives on the instance
 *  (expiry `instance-duration` / `while-source-tapped`); PRD #2064 S6 flips
 *  them to stored entries, which is a producer change this read path already
 *  accepts — stored layer-7 entries are unioned in below and resolve through
 *  the same payload resolver.
 */
function layer7EffectsFor(
    state: LayerStateView,
    target: PermanentView
): {
    entries: ContinuousEffect[];
    templates: ReadonlyMap<string, DerivedTemplate>;
} {
    const entries: ContinuousEffect[] = [];
    const templates = new Map<string, DerivedTemplate>();
    let ordinal = DERIVED_TIMESTAMP_BASE;

    // One walk covers both `pt-cda` (7a) and `pt-buff` (7c) for battlefield
    // sources AND emblems. The pre-registry code reached emblems from the
    // pt-buff walk only, so an emblem-declared `pt-cda` contributed nothing;
    // it now contributes to 7a. That is a deliberate widening, not an
    // accident — CR 604.3 makes a characteristic-defining ability apply in
    // every zone and CR 114.3 gives an emblem abilities like any other object,
    // so no rule ever kept emblems out of 7a. No emblem in `cards/emblems.ts`
    // declares one today, so no board changes.
    const pushSourceEffects = (
        source: PermanentView,
        effects: readonly StaticEffect[]
    ): void => {
        for (let index = 0; index < effects.length; index++) {
            const effect = effects[index];
            const cda = effect.kind === "pt-cda";
            if (!cda && effect.kind !== "pt-buff") continue;
            if (!effect.applies(target, source, STATIC_EFFECT_CTX)) continue;
            // CR 611.2c source-level gate ("as long as ..."): evaluated once
            // per source against the whole board (Jihad). Only `pt-buff`
            // carries one — a characteristic-defining ability has no such gate
            // (CR 604.3: it applies in every zone, at all times).
            if (
                !cda &&
                effect.condition &&
                !effect.condition(source, state, STATIC_EFFECT_CTX)
            ) {
                continue;
            }
            const id = `ce-src-${source.id}-${index}`;
            templates.set(id, { source, effect });
            entries.push({
                id,
                layer: 7,
                // CR 613.4a vs 613.4c — a CDA defines P/T, a buff modifies it.
                sublayer: cda ? "7a" : "7c",
                timestamp: ordinal++,
                expiry: { kind: "source", sourceId: source.id },
                affected: { kind: "predicate" },
                payload: {
                    kind: "template",
                    sourceCardId: (source.card as { id?: string }).id ?? "",
                    effectIndex: index,
                    modeId: (source as { chosenModeId?: string }).chosenModeId,
                },
                characteristicDefining: cda,
            });
        }
    };

    for (const player of state.players) {
        for (const source of player.battlefield) {
            pushSourceEffects(source, getStaticEffects(source));
        }
    }
    // CR 114 (issue #1221) — command-zone emblems contribute source-less,
    // owner-scoped statics (Sorin, Lord of Innistrad's "+1/+0" emblem). Same
    // predicate walk, with a synthetic source whose controller is the owner.
    for (const emblem of state.emblems ?? []) {
        pushSourceEffects(
            emblemAsStaticSource(emblem),
            getEmblemStaticEffects(emblem)
        );
    }

    // CR 613.4b layer 7b — set P/T. Array order is the timestamp; both halves
    // are independently optional ("base power 0" leaves toughness alone).
    const sets = target.temporaryPTSet ?? [];
    for (let index = 0; index < sets.length; index++) {
        entries.push({
            id: `ce-set-${target.id}-${index}`,
            layer: 7,
            sublayer: "7b",
            timestamp: ordinal++,
            expiry: { kind: "instance-duration" },
            affected: { kind: "instances", instanceIds: [target.id] },
            // Built field by field: the instance entry also carries a
            // `duration`, which belongs to the expiry, not to the payload.
            payload: {
                kind: "pt-set",
                power: sets[index].power,
                toughness: sets[index].toughness,
            },
            characteristicDefining: false,
        });
    }

    // CR 613.4c layer 7c — counters. One entry per TYPE: CR 613.7c gives every
    // counter of a kind the same timestamp, so they cannot interleave.
    for (const [counterType, count] of Object.entries(target.counters ?? {})) {
        const contribution = COUNTER_PT_CONTRIBUTION[counterType];
        if (!contribution || count === 0) continue;
        entries.push({
            id: `ce-counter-${target.id}-${counterType}`,
            layer: 7,
            sublayer: "7c",
            timestamp: ordinal++,
            expiry: {
                kind: "counter",
                permanentId: target.id,
                counterType,
            },
            affected: { kind: "instances", instanceIds: [target.id] },
            payload: {
                kind: "pt-modify",
                power: contribution.power * count,
                toughness: contribution.toughness * count,
            },
            characteristicDefining: false,
        });
    }

    // CR 613.4c layer 7c — one-shot pumps scoped to a phase boundary.
    const mods = target.temporaryPTMods ?? [];
    for (let index = 0; index < mods.length; index++) {
        entries.push({
            id: `ce-mod-${target.id}-${index}`,
            layer: 7,
            sublayer: "7c",
            timestamp: ordinal++,
            expiry: { kind: "instance-duration" },
            affected: { kind: "instances", instanceIds: [target.id] },
            payload: {
                kind: "pt-modify",
                power: mods[index].power,
                toughness: mods[index].toughness,
            },
            characteristicDefining: false,
        });
    }

    // CR 611.2b layer 7c — "for as long as [the source] remains tapped". The
    // condition IS the expiry, so a stale entry simply does not exist here:
    // the buff disappears the instant the source untaps, before the
    // `checkSourceTappedEffects` SBA splices the instance entry out.
    for (const mod of target.sourceTappedPTMods ?? []) {
        if (!isSourceTappedLive(state, mod.sourceId)) continue;
        entries.push({
            id: `ce-tapped-${target.id}-${mod.sourceId}-${ordinal}`,
            layer: 7,
            sublayer: "7c",
            timestamp: ordinal++,
            expiry: { kind: "while-source-tapped", sourceId: mod.sourceId },
            affected: { kind: "instances", instanceIds: [target.id] },
            payload: {
                kind: "pt-modify",
                power: mod.power,
                toughness: mod.toughness,
            },
            characteristicDefining: false,
        });
    }

    // Stored entries (`state.continuousEffects`). Nothing writes a layer-7 one
    // yet — S6 does — but the read path unions them now so a producer added
    // later needs no second consumer, and so the registry, not this walk, is
    // what layer 7 is defined against.
    //
    // Three hazards the flip must clear, none guarded here because the stored
    // set is empty and a guard on an empty set proves nothing:
    //
    // 1. DOUBLE COUNT. A provenance that starts being stored must stop being
    //    derived in the SAME change — store a `counter`-expiry entry while
    //    `target.counters` still holds the counter and the permanent gets the
    //    bonus twice.
    // 2. ORDER. A stored entry always outranks a derived one (see
    //    `DERIVED_TIMESTAMP_BASE`), which is invisible in the summing sublayer
    //    7c but decides the winner in the last-wins sublayers 7a and 7b.
    // 3. THE CLIENT'S OWN LAYER-7 READ. PRD #2064 S5 put the registry on the
    //    wire and carried it into the Brain's `GameState`
    //    (`src/lib/ai/state-adapter.ts`), so a client-side ENGINE run derives
    //    layer 7 from the same entries the server does. The board's P/T
    //    reducer does NOT: `src/lib/effective-stats.ts` builds its
    //    `LayerStateView` in `toLayerState`, which passes `emblems` and no
    //    registry, so `state.continuousEffects` reads `undefined` and this
    //    loop sees nothing. Harmless while the stored set is empty — no
    //    producer writes a layer-7 entry until S6 — and it is S6's first
    //    producer that must thread the field through `toLayerState` and its
    //    `effectivePower` / `effectiveToughness` callers, or a stored +1/+1
    //    residue will be invisible on the board while the server counts it.
    for (const stored of state.continuousEffects ?? []) {
        if (stored.layer !== 7) continue;
        if (!layer7EntryApplies(stored, target)) continue;
        entries.push(stored);
    }

    entries.sort(compareContinuousEffects);
    return { entries, templates };
}

/** Whether a STORED entry applies to `target`. A `predicate`-affected entry is
 *  pinned by its type to `source` expiry and a template payload, so its
 *  predicate is the template's `applies` — resolved in `resolveLayer7Payload`,
 *  which returns `undefined` when it does not match. */
function layer7EntryApplies(
    entry: ContinuousEffect,
    target: PermanentView
): boolean {
    if (entry.affected.kind === "predicate") return true;
    return entry.affected.instanceIds.includes(target.id);
}

/** The P/T contribution of one layer-7 entry, or `undefined` when the entry
 *  contributes nothing to this target (a template whose predicate does not
 *  match, or a payload from another layer).
 *
 *  A template payload keeps its `applies` / `compute` closures on the card
 *  definition (they cannot round-trip through the DB), so it is resolved
 *  against the live source: the one derived here during the board walk, or —
 *  for a stored entry — the permanent named by its `source` expiry. */
function resolveLayer7Payload(
    state: LayerStateView,
    target: PermanentView,
    entry: ContinuousEffect,
    templates: ReadonlyMap<string, DerivedTemplate>
): { power?: number; toughness?: number } | undefined {
    const payload = entry.payload;
    if (payload.kind === "pt-modify" || payload.kind === "pt-set") {
        return payload;
    }
    if (payload.kind !== "template") return undefined;
    const derived = templates.get(entry.id);
    // A STORED template entry names its source by id only, so its closures are
    // re-fetched from the live definition. An emblem is deliberately not
    // resolvable this way — `getStaticEffects` reads the CARD registry and an
    // emblem id is not a card id — which is why emblem statics stay derived
    // (they are, and PRD #2064 S6 keeps them so unless it stores an emblem's
    // effect list too).
    const source =
        derived?.source ??
        (entry.expiry.kind === "source"
            ? findPermanent(state, entry.expiry.sourceId)
            : undefined);
    if (!source) return undefined;
    let effect = derived?.effect;
    if (!effect) {
        // A stored entry names its source by INSTANCE id, which an id reused
        // across games would resolve to the wrong object; `sourceCardId` is
        // the entry's own record of what it was written against, so a
        // mismatch means the entry no longer describes this permanent.
        if ((source.card as { id?: string }).id !== payload.sourceCardId) {
            return undefined;
        }
        // `payload.modeId`, not the live mode: `effectIndex` was computed
        // against the mode the entry recorded (CR 700.2).
        effect = getStaticEffects(source, payload.modeId)[payload.effectIndex];
    }
    // A stored `effectIndex` can point at any `StaticEffect` kind — including
    // a CR 611.3 rules-modifying one this registry deliberately excludes — so
    // the kind is checked before the effect is treated as layer 7 at all.
    if (effect?.kind === "pt-buff") {
        if (!effect.applies(target, source, STATIC_EFFECT_CTX))
            return undefined;
        // CR 611.2c — the source-level gate. The derivation above already
        // applied it, so this only fires for a STORED entry; running it in
        // both places keeps the gate from being provenance-dependent.
        if (
            effect.condition &&
            !effect.condition(source, state, STATIC_EFFECT_CTX)
        ) {
            return undefined;
        }
        return { power: effect.power, toughness: effect.toughness };
    }
    if (effect?.kind === "pt-cda") {
        if (!effect.applies(target, source, STATIC_EFFECT_CTX))
            return undefined;
        return effect.compute(source, state, STATIC_EFFECT_CTX, target);
    }
    return undefined;
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

/**
 * Sum of the layer-7c contributions `target` receives from STATIC ABILITIES of
 * battlefield sources and command-zone emblems (CR 613.4c, 611.2) — the
 * +N/+N deltas of Crusade, Bad Moon and Castle. Counters, pumps and set-P/T
 * effects are other provenances or other sublayers and are excluded, as they
 * always were.
 */
// Production reads go through `computeEffectivePT`; this survives as the seam
// `layers.test.ts` uses to assert the static-buff provenance in isolation.
export function getStaticPTBuff(
    state: LayerStateView,
    target: PermanentView
): PTBuff {
    // Fast path: P/T effects are only meaningful on creatures (CR 208.2).
    if (!STATIC_EFFECT_CTX.isCreature(target)) return ZERO;
    const { entries, templates } = layer7EffectsFor(state, target);
    let power = 0;
    let toughness = 0;
    for (const entry of entries) {
        if (entry.sublayer !== "7c") continue;
        if (entry.expiry.kind !== "source") continue;
        const value = resolveLayer7Payload(state, target, entry, templates);
        if (!value) continue;
        power += value.power ?? 0;
        toughness += value.toughness ?? 0;
    }
    if (power === 0 && toughness === 0) return ZERO;
    return { power, toughness };
}

/**
 * Applies the CR 613.4 sublayers to `target`, in order, reading ONLY registry
 * entries (ADR 0082, PRD #2064 S2):
 *
 *   7a CDA      → starting value = printed base + the latest matching
 *                 characteristic-defining effect (CR 613.4a; overwrite, never
 *                 summed across sources — ADR 0017, and the official
 *                 Opalescence ruling that duplicates do not compound)
 *   7b set      → an effect setting this characteristic replaces the value
 *                 (CR 613.4b); latest timestamp wins, halves independent
 *   7c modify   → += every modifying effect AND counter (CR 613.4c puts both
 *                 in one sublayer; the pre-registry pipeline split them across
 *                 two steps, which was order-equivalent since both are sums)
 *   7d switch   → power and toughness swap (CR 613.4d). No card in scope emits
 *                 a `pt-switch` entry yet, so the loop is empty in practice.
 *
 * Computed at read time, never mutating card state.
 */
function computeEffectivePT(
    state: LayerStateView,
    target: PermanentView,
    opts: { includeTemporary?: boolean } = {}
): PTBuff {
    // When false, the until-boundary P/T entries are dropped — the ones whose
    // countdown is held on the instance (`temporaryPTSet` 7b, `temporaryPTMods`
    // 7c), which is exactly the `instance-duration` expiry. The persistent
    // provenances (CDA, static buffs, counters, and the source-tapped effects
    // of Ashnod's Battle Gear, which are state-tied rather than boundary-tied)
    // are unaffected. Used only by the bot evaluation, so a combat trick's
    // temporary buff is not scored as permanent material (ADR 0020 §2).
    const includeTemporary = opts.includeTemporary ?? true;
    const basePower = target.power ?? 0;
    const baseToughness = target.toughness ?? 0;
    // Fast path: only creatures carry P/T-layer effects (CR 208.2).
    if (!STATIC_EFFECT_CTX.isCreature(target)) {
        return { power: basePower, toughness: baseToughness };
    }
    const { entries, templates } = layer7EffectsFor(state, target);

    let power = basePower;
    let toughness = baseToughness;
    for (const sublayer of LAYER_7_SUBLAYERS) {
        // CR 613.4a — the latest CDA overwrites every earlier one outright, so
        // 7a resolves to a single delta applied to the printed base.
        let cdaPower: number | undefined;
        let cdaToughness: number | undefined;
        for (const entry of entries) {
            if (entry.sublayer !== sublayer) continue;
            if (
                !includeTemporary &&
                entry.expiry.kind === "instance-duration"
            ) {
                continue;
            }
            if (sublayer === "7d") {
                // CR 613.4d — the switch takes no value from its payload, so
                // it is gated on the payload KIND: `ContinuousEffectSlot` does
                // not pin payload to sublayer, and an entry carrying a value
                // must not both swap and silently lose that value.
                if (entry.payload.kind !== "pt-switch") continue;
                const swapped = power;
                power = toughness;
                toughness = swapped;
                continue;
            }
            const value = resolveLayer7Payload(state, target, entry, templates);
            if (!value) continue;
            if (sublayer === "7a") {
                if (value.power !== undefined) cdaPower = value.power;
                if (value.toughness !== undefined)
                    cdaToughness = value.toughness;
            } else if (sublayer === "7b") {
                if (value.power !== undefined) power = value.power;
                if (value.toughness !== undefined) toughness = value.toughness;
            } else {
                power += value.power ?? 0;
                toughness += value.toughness ?? 0;
            }
        }
        if (sublayer === "7a") {
            power = basePower + (cdaPower ?? 0);
            toughness = baseToughness + (cdaToughness ?? 0);
        }
    }
    return { power, toughness };
}

/** Effective power after the CR 613.4 layer pipeline. Not floored (combat
 *  damage floors separately). */
export function getEffectivePower(
    state: LayerStateView,
    target: PermanentView
): number {
    return computeEffectivePT(state, target).power;
}

/** Effective toughness after the CR 613.4 layer pipeline. */
export function getEffectiveToughness(
    state: LayerStateView,
    target: PermanentView
): number {
    return computeEffectivePT(state, target).toughness;
}

/** Effective power EXCLUDING until-boundary modifications (`temporaryPTSet`,
 *  `temporaryPTMods`). The bot evaluation uses this so a combat trick's
 *  "until end of turn" buff is not counted as permanent material (ADR 0020 §2).
 *  Persistent layers (CDA, counters, static buffs, +1/+1 counters) still count. */
export function getPermanentEffectivePower(
    state: LayerStateView,
    target: PermanentView
): number {
    return computeEffectivePT(state, target, { includeTemporary: false }).power;
}

/** Effective toughness EXCLUDING until-boundary modifications — toughness twin
 *  of `getPermanentEffectivePower` (ADR 0020 §2). */
export function getPermanentEffectiveToughness(
    state: LayerStateView,
    target: PermanentView
): number {
    return computeEffectivePT(state, target, { includeTemporary: false })
        .toughness;
}
