/**
 * Identity swaps — copy / face-down / transform (issue #1705).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * There is NO "new object" among these sites, so every one of them re-applies.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Six engine sites replace a permanent's stored characteristics wholesale from
 * a `CardDefinition` (or from the face-down vanilla values): `applyCopy` /
 * `revertCopy` (`gre/copy.ts`), `turnFaceDown` / `turnFaceUp`
 * (`gre/faceDown.ts`) and both legs of `transformPermanent`
 * (`gre/transform.ts`). What they replace are the object's **copiable values**
 * — layer 1 (CR 613.1a). Nothing about a copy effect, a face-down flip or a
 * transform ends a continuous effect already applying to the permanent:
 *
 *   - **CR 400.7** — an object becomes a NEW object only on a ZONE CHANGE.
 *     Turning face down / face up, transforming, and being affected by a copy
 *     effect are none of those. (The only "turned face down → new object"
 *     rules in the CR, 311.6 and 312.6, are about plane and phenomenon cards.)
 *   - **CR 708.2** — a face-down permanent's listed characteristics are the
 *     *copiable values* of that object's characteristics. A grant is layer 6
 *     (CR 613.1f) and applies OVER whatever layer 1 produces.
 *   - **CR 701.27b / 712** — transforming is the same permanent.
 *   - **CR 707.2** — a copy acquires copiable values; "other effects … are not
 *     copied". Note the direction: the *copy* does not inherit the *source's*
 *     grants (already true — the sites read the copied `def`, never the
 *     source's live `staticAbilities`). It says nothing about the RECIPIENT's
 *     own layer-2–7 effects, which are not copiable values and therefore
 *     persist.
 *
 * Hence one helper, called from all six sites: rebuild layer 1, then replay
 * the permanent's OWN live overlays on top in CR 613.7 timestamp order.
 *
 * **The restore ANCHORS are re-captured; the EFFECTS are not.** `animation`,
 * `temporarySubtypeChange` and `indefiniteSubtypeSet` each store a value to
 * restore when the effect ends — captured from the identity that was live when
 * the effect started. On an identity swap that anchor is stale: the effect
 * (layer 4 / layer 7) is unchanged and survives, but layer 1 underneath it
 * changed (CR 613.1a), so the undo anchor must be re-derived from the NEW base
 * or the expiry writes a P/T and subtype line that never belonged to this face.
 *
 * **What is deliberately NOT here.** `temporaryPTSet`, `temporaryPTMods`,
 * `sourceTappedPTMods`, `colorOverride`, `grantedColors`,
 * `grantedSupertypes`, `grantedActivatedAbilities` and
 * `grantedTriggeredAbilities` are READ-TIME records (`gre/layers.ts`,
 * `cards/effectiveColors.ts`, `effectiveTriggeredAbilities`) — they are not
 * materialised into the five rebuilt fields, so they survive a rebuild by
 * construction and replaying them would double-apply.
 */

import {
    applyLandTypeReplacement,
    composeMaterializedSubtypes,
} from "./constants";
import type { CardType } from "../cards/types";
import type { CardInstanceState } from "./state";

type KeywordHold = NonNullable<CardInstanceState["removedKeywords"]>[number];

/** The copiable values (CR 613.1a layer 1) an identity swap installs: the
 *  printed characteristics of the presented face, plus whatever the swap
 *  itself adds (a copy effect's `additionalTypes`/`additionalSubtypes`). */
export interface CopiableValues {
    types: CardType[];
    subtypes: string[];
    power: number | undefined;
    toughness: number | undefined;
    staticAbilities: string[];
}

/** Splices ONE occurrence of `keyword` out of `abilities` in place, returning
 *  whether there was one to take. The multiset occupancy model (#1706): a
 *  stripper TAKES exactly one occurrence and holds it — if there is none to
 *  take, the hold has nothing to restore later and must be dropped. */
function takeOneOccurrence(abilities: string[], keyword: string): boolean {
    const idx = abilities.indexOf(keyword);
    if (idx === -1) return false;
    abilities.splice(idx, 1);
    return true;
}

/** One layer-6 operation live on the permanent, as the replay orders it.
 *
 *  `rank` breaks a timestamp TIE in exactly the direction the two readers do,
 *  so the replay can never disagree with them:
 *   - a blanket stripper sorts BEFORE a grant carrying the same `seq`, so that
 *     grant survives it — `grantOutrankedByAbilityLoss` is strictly-less
 *     (`(grantSeq ?? 0) < strippedAt`), so an equal timestamp survives too;
 *   - a targeted removal likewise sorts before an equally-stamped grant, which
 *     is what the apply path's own `(r.seq ?? 0) > seq` guard says when it
 *     decides whether a fresh `keyword-grant` is `suppressed`. */
type Layer6Step =
    | { seq: number; rank: 0; stripper: { sourceId: string; seq: number } }
    | { seq: number; rank: 1; hold: KeywordHold }
    | { seq: number; rank: 2; ability: string };

/** Layer 6 (CR 613.1f) — rebuild `staticAbilities` from the new base plus the
 *  permanent's own live grants and removals, in CR 613.7 timestamp order.
 *
 *  ONE ordered pass, not a blanket-first shortcut. A blanket "loses all
 *  abilities" takes exactly the occurrences live at ITS OWN timestamp — a
 *  targeted `keyword-remove` that landed EARLIER already holds one, and that
 *  hold belongs to the Sphere, not to the stripper. Deciding the two kinds
 *  separately re-attributed the earlier hold to the blanket source, so
 *  unapplying the blanket source resurrected a keyword the targeted removal
 *  was still holding down.
 *
 *  The pass reproduces the apply path (`applySourceStaticEffects`, which walks
 *  sources in `staticSeq` order) step for step, and stays consistent with the
 *  READERS by construction: a grant survives iff its `seq` is >= every live
 *  stripper's, which is precisely `!grantOutrankedByAbilityLoss(seq,
 *  abilityLossTimestamp(card))`. */
function replayLayer6Abilities(
    card: CardInstanceState,
    base: CopiableValues
): void {
    const steps: Layer6Step[] = [];

    // Blanket strippers. `removedKeywords` mixes two producers: a
    // `keyword-remove` static (source-keyed, one named keyword) and the
    // per-keyword ledger an `ability-loss` static writes as it empties
    // `staticAbilities`. Only the first kind is identity-independent; the
    // second described the OLD face and is rebuilt by the pass below.
    const blanketSourceIds = new Set<string>();
    for (const stripper of card.abilitiesSuppressedBy ?? []) {
        blanketSourceIds.add(stripper.sourceId);
        steps.push({ seq: stripper.seq ?? 0, rank: 0, stripper });
    }
    for (const hold of card.removedKeywords ?? []) {
        if (blanketSourceIds.has(hold.sourceId)) continue;
        steps.push({ seq: hold.seq ?? 0, rank: 1, hold });
    }
    // A `suppressed` grant (#1706) owns zero occurrences by construction and
    // releases none, so it neither pushes nor feeds a stripper.
    for (const grant of card.grantedStaticAbilities ?? []) {
        if (grant.suppressed) continue;
        steps.push({ seq: grant.seq ?? 0, rank: 2, ability: grant.ability });
    }
    steps.sort((a, b) => a.seq - b.seq || a.rank - b.rank);

    // Layer 1 underneath the whole pass: printed characteristics apply in
    // layer 1 and carry no timestamp, so they are present from the start and
    // CR 613.7 never lets them outrank ANY layer-6 removal.
    const abilities = [...base.staticAbilities];
    const removed: KeywordHold[] = [];
    for (const step of steps) {
        if (step.rank === 2) {
            abilities.push(step.ability);
        } else if (step.rank === 1) {
            // A hold with no occupancy to take at its own point in the order
            // is stale on the new face — the stripper never took an occurrence
            // of it, so it must not restore one.
            if (takeOneOccurrence(abilities, step.hold.keyword)) {
                removed.push(step.hold);
            }
        } else {
            for (const keyword of abilities) {
                removed.push({
                    keyword,
                    sourceId: step.stripper.sourceId,
                    seq: step.stripper.seq,
                });
            }
            abilities.length = 0;
        }
    }

    // `temporaryRemovedKeywords` carries no timestamp of its own: it is
    // written by a one-shot effect resolving NOW (CR 611.2a), so it applies
    // after every timestamped record above.
    const temporaryHolds: NonNullable<
        CardInstanceState["temporaryRemovedKeywords"]
    > = [];
    for (const hold of card.temporaryRemovedKeywords ?? []) {
        if (takeOneOccurrence(abilities, hold.keyword))
            temporaryHolds.push(hold);
    }

    card.removedKeywords = removed.length > 0 ? removed : undefined;
    card.temporaryRemovedKeywords =
        temporaryHolds.length > 0 ? temporaryHolds : undefined;
    card.staticAbilities = abilities;
}

/** Layer 4 card types (CR 613.1d) — re-apply the `type-add` / `type-remove`
 *  surrogates over the new base. Both records name the type itself, so they
 *  are identity-independent; their restore side reads the LIVE definition
 *  (already swapped by the caller), which is the new face by construction. */
function replayLayer4Types(
    card: CardInstanceState,
    base: CopiableValues
): void {
    const types: CardType[] = [...base.types];
    for (const granted of card.grantedTypes ?? []) {
        const type = granted.type as CardType;
        if (!types.includes(type)) types.push(type);
    }
    for (const suppressed of card.suppressedTypes ?? []) {
        const idx = types.indexOf(suppressed.type as CardType);
        if (idx !== -1) types.splice(idx, 1);
    }
    card.types = types;
}

/** Layer 4 subtypes (CR 305.7 / 613.1d) — recompose the `subtype-set` /
 *  `subtype-add` record over the new base through the ONE composer, then
 *  replay the two one-shot subtype REPLACEMENTS on top, re-capturing each
 *  one's restore anchor from the new base. */
function replayLayer4Subtypes(
    card: CardInstanceState,
    base: CopiableValues,
    priorSubtypes: string[]
): void {
    // `printedSubtypes` is the composer's own layer-1 anchor — re-capture it.
    if (card.printedSubtypes) card.printedSubtypes = [...base.subtypes];
    let subtypes = composeMaterializedSubtypes(card);

    const indefinite = card.indefiniteSubtypeSet;
    if (indefinite) {
        const set = indefinite.subtypes;
        card.indefiniteSubtypeSet = {
            ...indefinite,
            restoreSubtypes: [...subtypes],
        };
        subtypes = set
            ? card.types.includes("Land")
                ? applyLandTypeReplacement(subtypes, set)
                : [...set]
            : // Row persisted before #1705 recorded the set value: the live
              // pre-swap line IS what the effect set (`setSubtypes` replaces
              // wholesale and clears the layer-4 record).
              [...priorSubtypes];
    }

    const timed = card.temporarySubtypeChange;
    if (timed) {
        card.temporarySubtypeChange = {
            ...timed,
            restoreSubtypes: [...subtypes],
        };
        subtypes = card.types.includes("Land")
            ? applyLandTypeReplacement(subtypes, timed.subtypes)
            : [...timed.subtypes];
    }

    card.subtypes = subtypes;
}

/** Layer 4 + 7b animation (CR 208.2 / 611.1 / 613.4b) — re-apply the
 *  "becomes a creature" mutation over the new base and re-derive BOTH of its
 *  anchors: `savedPower`/`savedToughness` (the new face's pre-animation P/T)
 *  and `addedCreatureType`/`addedTypes`/`addedSubtype` (exactly what the
 *  animation adds to THIS type line — the new face may already be a creature,
 *  in which case the animation adds nothing and must remove nothing later). */
function replayAnimation(
    card: CardInstanceState,
    base: CopiableValues,
    priorPower: number | undefined,
    priorToughness: number | undefined
): void {
    const anim = card.animation;
    if (!anim) return;

    const addedCreatureType = !card.types.includes("Creature");
    const addedTypes = (anim.addedTypes ?? []).filter(
        (t) => !card.types.includes(t)
    );
    const addedSubtype =
        anim.addedSubtype !== undefined &&
        !card.subtypes.includes(anim.addedSubtype)
            ? anim.addedSubtype
            : undefined;

    const types: CardType[] = [...card.types];
    if (addedCreatureType) types.push("Creature");
    types.push(...addedTypes);
    card.types = types;
    if (addedSubtype !== undefined) {
        card.subtypes = [...card.subtypes, addedSubtype];
    }
    card.power = anim.setPower ?? priorPower;
    card.toughness = anim.setToughness ?? priorToughness;
    card.animation = {
        ...anim,
        savedPower: base.power,
        savedToughness: base.toughness,
        addedCreatureType,
        addedTypes: addedTypes.length > 0 ? addedTypes : undefined,
        addedSubtype,
    };
}

/** Rebuilds a permanent's materialised characteristics after its copiable
 *  values change (copy / face-down / transform), then replays every continuous
 *  effect currently live ON IT. Same object throughout — CR 400.7 makes a new
 *  object only on a zone change — so layers 2–7 survive the swap; see the
 *  module header for the full CR chain (613.1a vs 613.1f, 708.2, 707.2,
 *  701.27b).
 *
 *  `card.card` must ALREADY present the new identity when this is called: the
 *  layer-4 restore paths (`revertTypeProvenance`, `unapplySourceStaticEffects`)
 *  read the live definition to decide what was printed.
 *
 *  Never mutates a nested record in place — one call site runs this on a
 *  throwaway SHALLOW copy of a real card (the face-down cast legality probe,
 *  `state.ts`), which must not see the original's arrays change under it. */
export function rebuildCopiableValuesAndReplayOverlays(
    card: CardInstanceState,
    base: CopiableValues
): void {
    // The two overlay records that store no effect value of their own on rows
    // persisted before #1705 — read them off the live materialised fields
    // before layer 1 is overwritten.
    const priorPower = card.power;
    const priorToughness = card.toughness;
    const priorSubtypes = [...card.subtypes];

    card.types = [...base.types];
    card.subtypes = [...base.subtypes];
    card.power = base.power;
    card.toughness = base.toughness;
    card.staticAbilities = [...base.staticAbilities];

    replayLayer6Abilities(card, base);
    // Types before subtypes: the CR 305.7 land-type narrowing in the subtype
    // replay reads the composed type line. Animation last: it stacks on top of
    // the layer-4 result, exactly as `animateAsCreature` did on the old face.
    replayLayer4Types(card, base);
    replayLayer4Subtypes(card, base, priorSubtypes);
    replayAnimation(card, base, priorPower, priorToughness);
}
