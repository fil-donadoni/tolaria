// CR 611.3b + a stated duration — the continuous effect of a static ability
// that OUTLIVES the object generating it (issue #3726).
//
// CR 611.3b is the default and needs no code: "The effect applies at all times
// that the permanent generating it is on the battlefield", so when the source
// leaves, the board walk in `gre/layers.ts` / `layers2to5.ts` / `layer6.ts`
// simply stops producing its entries and the effect is over. A handful of
// cards override that in their own text — Titania's Song's "If this enchantment
// leaves the battlefield, this effect continues until end of turn" — and this
// module is the whole of that override.
//
// THE CONVERSION. While the source is on the battlefield its effect is a
// DERIVED entry: `affected: predicate`, `expiry: source`, a `template` payload
// whose `applies` closure is re-evaluated at every read (CR 611.3a). At
// departure that shape stops being resolvable at all — every layer's template
// resolver looks the source up with `findPermanent` and contributes nothing
// when it is gone. So the effect is SNAPSHOTTED into the other arm of
// `ContinuousEffectScope`: `affected: instances`, `expiry: duration`, and an
// INLINE payload that carries the answer rather than a closure to recompute it
// against a source that no longer exists.
//
// WHY THAT IS THE RULE AND NOT A CONVENIENCE. CR 611.3d is the CR's own
// precedent for a static ability's effect lasting past its generator: it lasts
// "as long as stated by the effect granting that permission or ability", and
// the rule calls itself "an exception to rules 611.3a-b" — BOTH, not just the
// battlefield-presence half. With 611.3a lapsed there is no generator left to
// re-evaluate, and what remains is an effect with a stated duration, which is
// CR 611.2c's shape: "the set of objects it affects is determined when that
// continuous effect begins. After that point, the set won't change." The
// snapshot's frozen `instanceIds` IS that sentence. An artifact that enters
// after Titania's Song dies is not animated; one that stops matching
// `IS_NONCREATURE_ARTIFACT` is not released.
//
// NO NEW EXPIRY KIND, AND NO RELAXED PIN. ADR 0082 pins the `predicate` arm to
// `source` expiry by type and calls that "made unrepresentable". Nothing here
// touches it: a snapshot is not a predicate entry with a longer life, it is an
// `instances` entry, the arm whose own doc in `gre/continuousEffects.ts` already
// says "a static ability's effect can also be snapshotted this way when a slice
// needs to". This is the slice that needed to.

import type {
    CardSupertype,
    CardType,
    Color,
    DurationSpec,
    PermanentView,
    StaticEffect,
} from "../cards/types";
import type {
    ContinuousEffect,
    ContinuousEffectInlinePayload,
    ContinuousEffectSlot,
} from "./continuousEffects";
import type { Duration } from "./state";
import type { LayerStateView } from "./layers";
import { STATIC_EFFECT_CTX, LAYER_7_STATIC_EFFECT_KINDS } from "./layers";
import { LAYER_2_5_STATIC_EFFECT_KINDS } from "./layers2to5";
import { LAYER_6_STATIC_EFFECT_KINDS } from "./layer6";
import { CDA_STATIC_EFFECT_KINDS } from "./dependency";

/** One snapshotted entry, ready for `pushContinuousEffect` to mint an id for.
 *  `timestamp` is NOT left to the mint: CR 613.7a gave the effect the source's
 *  stamp while it was applying, and the lingering effect is the SAME continuous
 *  effect, so it keeps that position in its layer. Minting a fresh stamp would
 *  let a Song that died promote itself past every effect it used to lose to. */
export type LingeringSnapshot = {
    entry: Omit<ContinuousEffect, "id" | "timestamp">;
    timestamp: number;
};

/** CR 611.3b/611.3d — every entry a departing `source` leaves behind, frozen as
 *  of this moment.
 *
 *  Call it while the source is STILL on the battlefield: the predicates it
 *  evaluates take the live source (`applies(target, source, ctx)`), and a
 *  `control-change` reads the source's live controller. `removePermanentTo`
 *  (`gre/state.ts`) does exactly that — it runs before the permanent is spliced
 *  out, in the same window `stopApplyingStaticEffects` runs in.
 *
 *  Returns `[]` — the overwhelmingly common answer — for a source no effect of
 *  which declares a linger, so the departure path pays one array scan.
 *
 *  @param effects the source's EFFECTIVE static effects
 *         (`getEffectiveStaticEffects`, CR 700.2 — the definition's own plus
 *         the chosen mode's), passed in rather than looked up so this module
 *         needs no value import from `gre/state.ts`.
 *  @param resolveSpec turns a card-facing `DurationSpec` into the stored
 *         `Duration`, against the effect's controller (`resolveDuration`).
 */
export function collectLingeringSnapshots(
    state: LayerStateView,
    source: PermanentView,
    effects: readonly StaticEffect[],
    resolveSpec: (spec: DurationSpec) => Duration
): LingeringSnapshot[] {
    const snapshots: LingeringSnapshot[] = [];
    for (let index = 0; index < effects.length; index++) {
        const effect = effects[index];
        const spec = (effect as { lingersAfterSourceLeaves?: DurationSpec })
            .lingersAfterSourceLeaves;
        if (!spec) continue;
        const slot = slotFor(effect);
        if (!slot) continue;
        // CR 611.2c — the source-level "as long as ..." gate, read once against
        // the board as it is NOW. A gate that is closed at the moment of
        // departure means the effect was not applying, and an effect that was
        // not applying has nothing to continue (CR 611.2b: "It doesn't start
        // and immediately stop again").
        if (!sourceConditionHolds(effect, source, state)) continue;
        // CR 613.7a — the stamp the effect has been ordering by all along. An
        // UNSTAMPED source is skipped outright rather than read as 0, because
        // `deriveLayer6` (`gre/layer6.ts`) skips one too: an effect with no
        // timestamp has no position in layer 6 and contributes nothing there.
        // Freezing it at 0 would make a layer-6 effect that was NOT applying
        // START applying the moment its source left — the exact inversion the
        // CR 611.2b guard above exists to prevent. Layers 2-5 and 7 do read an
        // unstamped source as 0, so this is stricter than two of the three
        // derivations; stricter is the safe direction, and a source that has
        // begun applying through `beginApplyingStaticEffects` always has one.
        const stamp = (source as { staticSeq?: number }).staticSeq;
        if (stamp === undefined) continue;
        const timestamp = stamp;
        const duration = resolveSpec(spec);
        for (const player of state.players) {
            for (const target of player.battlefield) {
                // The source itself is leaving; an effect that applied to it
                // has no object left to apply to.
                if (target.id === source.id) continue;
                const payload = inlinePayloadFor(effect, target, source, state);
                if (!payload) continue;
                snapshots.push({
                    timestamp,
                    entry: {
                        ...slot,
                        expiry: {
                            kind: "duration",
                            duration,
                            controllerId: source.controllerId,
                        },
                        affected: {
                            kind: "instances",
                            instanceIds: [target.id],
                        },
                        payload,
                        // CR 604.3 — a characteristic-defining ability stays one
                        // after the snapshot: CR 613.8a clause (c) reads this to
                        // decide whether a dependency can exist at all, and the
                        // answer is a fact about the ability, not about its
                        // source's whereabouts. Read from the ONE naming
                        // authority both sibling collectors read
                        // (`CDA_STATIC_EFFECT_KINDS`, `gre/dependency.ts`),
                        // never from the sublayer: the two agree only while
                        // `pt-cda` is the set's sole member, and CR 702.73
                        // Changeling is a layer-4 CDA sitting `planned` in the
                        // Mechanics Registry. Deriving it from `"7a"` would make
                        // clause (c) fail open the day that lands.
                        characteristicDefining: CDA_STATIC_EFFECT_KINDS.has(
                            effect.kind
                        ),
                    },
                });
            }
        }
    }
    return snapshots;
}

/** CR 613 — which layer (and, for layer 7, which sublayer) the effect's kind
 *  lives in, read from the SAME three tables the derivations decide membership
 *  with, so a snapshot can never land in a layer the live effect did not.
 *  `undefined` for a kind outside the registry — unreachable from a card, since
 *  `StaticEffect` admits `lingersAfterSourceLeaves` only on registry kinds, and
 *  kept as the fail-closed answer rather than a throw on a hand-built fixture. */
function slotFor(effect: StaticEffect): ContinuousEffectSlot | undefined {
    const sublayer = (
        LAYER_7_STATIC_EFFECT_KINDS as Record<
            string,
            ContinuousEffectSlot extends { sublayer?: infer S } ? S : never
        >
    )[effect.kind];
    if (sublayer) return { layer: 7, sublayer };
    if (LAYER_6_STATIC_EFFECT_KINDS[effect.kind]) return { layer: 6 };
    const layer = LAYER_2_5_STATIC_EFFECT_KINDS[effect.kind];
    return layer === undefined ? undefined : { layer };
}

/** CR 611.2c — the effect's own source-level gate, where its kind has one.
 *  `pt-buff` takes `(source, state, ctx)` and `keyword-grant` takes
 *  `(source, state, ctx)` too; every other kind declares none, which reads as
 *  "always holds". */
function sourceConditionHolds(
    effect: StaticEffect,
    source: PermanentView,
    state: LayerStateView
): boolean {
    const condition = (
        effect as {
            condition?: (
                s: PermanentView,
                st: LayerStateView,
                c: typeof STATIC_EFFECT_CTX
            ) => boolean;
        }
    ).condition;
    return !condition || condition(source, state, STATIC_EFFECT_CTX);
}

/** The frozen answer this effect gives for `target`, or `undefined` when it
 *  gives none (its `applies` predicate does not match, or its computed form
 *  declines the target).
 *
 *  Every arm resolves the effect the way its own layer's resolver does, and
 *  stores the RESULT rather than the closure — that is the whole difference
 *  between a `template` payload and an inline one, and it is what lets the
 *  entry keep applying with no source to resolve against. */
function inlinePayloadFor(
    effect: StaticEffect,
    target: PermanentView,
    source: PermanentView,
    state: LayerStateView
): ContinuousEffectInlinePayload | undefined {
    switch (effect.kind) {
        // ── layer 2 (CR 613.1b) ──────────────────────────────────────────────
        case "control-change":
            // The live controller, read NOW. Every other reader of this effect
            // takes `source.controllerId` fresh precisely because a snapshot
            // would go stale; here the source is about to stop existing, so
            // this moment's answer is the last one there will ever be.
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? { kind: "control-change", controllerId: source.controllerId }
                : undefined;
        // ── layer 4 (CR 613.1d) ──────────────────────────────────────────────
        case "type-add":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? { kind: "type-change", add: [...effect.types] as CardType[] }
                : undefined;
        case "type-remove":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? {
                      kind: "type-change",
                      remove: [...effect.types] as CardType[],
                  }
                : undefined;
        case "subtype-add":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? { kind: "subtype-change", add: [...effect.subtypes] }
                : undefined;
        case "subtype-set": {
            // ADR 0050's two forms, resolved exactly as `layers2to5.ts` does:
            // the computed form answers per target and may decline with null.
            const computed = effect.subtypesFor
                ? effect.subtypesFor(target, source, STATIC_EFFECT_CTX)
                : effect.applies!(target, source, STATIC_EFFECT_CTX)
                  ? (effect.subtypes ?? null)
                  : null;
            return computed === null
                ? undefined
                : { kind: "subtype-change", set: [...computed] };
        }
        case "supertype-set":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? {
                      kind: "supertype-change",
                      ...(effect.add
                          ? { add: [...effect.add] as CardSupertype[] }
                          : {}),
                      ...(effect.remove
                          ? { remove: [...effect.remove] as CardSupertype[] }
                          : {}),
                  }
                : undefined;
        // ── layer 5 (CR 613.1e) ──────────────────────────────────────────────
        case "color-grant":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? { kind: "color-change", add: [...effect.colors] as Color[] }
                : undefined;
        // ── layer 6 (CR 613.1f) ──────────────────────────────────────────────
        case "keyword-grant": {
            if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                return undefined;
            }
            // `keywordFor` is the per-target computed form (it may decline with
            // null). The rendered string is what every layer-6 consult site
            // reads, and it is already rendered here, so the entry carries no
            // `parameter` to re-render against a source that is gone.
            const keyword = effect.keywordFor
                ? effect.keywordFor(target, source, STATIC_EFFECT_CTX)
                : effect.keyword;
            return keyword === null
                ? undefined
                : { kind: "keyword-grant", keyword };
        }
        case "keyword-remove":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? { kind: "keyword-remove", keyword: effect.keyword }
                : undefined;
        case "ability-loss":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? { kind: "ability-loss" }
                : undefined;
        case "triggered-grant":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? {
                      kind: "triggered-grant",
                      sourceCardId: (source.card as { id?: string }).id ?? "",
                      abilityId: effect.abilityId,
                  }
                : undefined;
        // ── layer 7 (CR 613.4) ───────────────────────────────────────────────
        case "pt-cda":
            // CR 604.3 / 613.4a — the CDA's value, computed once here. It stays
            // a CDA (`characteristicDefining`), but its INPUT is frozen with the
            // rest of the effect: with the generator gone there is nothing left
            // to recompute it against.
            if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                return undefined;
            }
            return {
                kind: "pt-set",
                ...effect.compute(source, state, STATIC_EFFECT_CTX, target),
            };
        case "pt-set":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? {
                      kind: "pt-set",
                      power: effect.power,
                      toughness: effect.toughness,
                  }
                : undefined;
        case "pt-buff":
            return effect.applies(target, source, STATIC_EFFECT_CTX)
                ? {
                      kind: "pt-modify",
                      power: effect.power,
                      toughness: effect.toughness,
                  }
                : undefined;
        default:
            // A kind `StaticEffect` does not let declare a linger. Fail-closed:
            // no entry rather than a guessed one.
            return undefined;
    }
}
