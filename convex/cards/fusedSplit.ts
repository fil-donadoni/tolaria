// CR 702.102 — FUSE: the FUSED SPLIT SPELL as a third registered twin of a
// split card (ADR 0121's twin mechanism, one more suffix).
//
// "If a player casts a split card with fuse from their hand, the player may
// choose to cast both halves of that split card rather than choose one half.
// … The resulting spell is a fused split spell" (702.102a). Three of its
// subrules say what that ONE spell is, and each is a function of the two
// halves the card already declares (`splitHalves`), so — exactly like the
// CR 709.4 combination — it is derived, never hand-authored:
//
//   * 702.102b / 709.4d — "a fused split spell has the combined
//     characteristics of its two halves": the combined name, the union of the
//     type lines (`combineSplitTypes`);
//   * 702.102c — "the total cost of a fused split spell includes the mana cost
//     of each half": the CR 709.4b sum (`combineSplitManaCosts`);
//   * 702.102d — "as a fused split spell resolves, the controller of the spell
//     follows the instructions of the left half and then follows the
//     instructions of the right half": the left half's Effect Script followed
//     by the right half's.
//
// The twin is a FLAT `CardDefinition` — one target group per targeting half,
// the left half's first (CR 601.2c: targets are chosen in the order the
// text names them) — so every pre-commit surface (timing, affordability, the
// target walk, the Bot's move enumeration, the client's target prompt) reads
// it through the same `subject` member of `CAST_MODE_CENSUS` it reads a
// single half through, with no fused-specific branch.
//
// The one transform 702.102d needs is the SEGMENT merge Splice already does
// (`gre/effects/scriptSegment.ts`): each half's script names its own targets
// from slot 0, and on the fused spell the right half's targets sit after the
// left half's, so the right half's `{ target: i }` refs are rebased by the
// left half's target count and its own bindings renamed. That is sound only
// when the count is FIXED and every slot read is a rebasable ref; the shapes
// where it is not are refused by {@link fusedSplitShapeRefusal}, which the compiler also reads, so
// a card whose fused spell cannot be built is refused rather than shipped with
// a fuse option that resolves wrongly.

import {
    declaredBindingNames,
    rebaseTargetRefs,
    renameBindings,
    targetReadsAreRebasable,
} from "../gre/effects/scriptSegment";
import {
    combineSplitManaCosts,
    combineSplitNames,
    combineSplitTypes,
} from "./splitCard";
import { twinDefinitionId } from "./twinId";
import type {
    CardDefinition,
    EffectOp,
    SplitHalf,
    TargetRequirement,
} from "./types";

/** The Mechanics Registry keyword id a split card's `staticAbilities` carries
 *  when it has fuse (CR 702.102a — "fuse is a static ability found on some
 *  split cards"). */
export const FUSE_KEYWORD = "fuse";

/** A printed fuse line ("Fuse (You may cast one or both halves of this card
 *  from your hand.)"), which Scryfall records on each face. */
export const FUSE_LINE = /^Fuse\b/;

/** The twin-id suffix of the fused split spell. */
export const FUSED_SPLIT_SUFFIX = "fused";

/** The registry id of `parentId`'s fused split spell. */
export function fusedSplitDefinitionId(parentId: string): string {
    return twinDefinitionId(parentId, FUSED_SPLIT_SUFFIX);
}

/** `true` when `def` is a split card with fuse (CR 702.102a). */
export function hasFuse(def: CardDefinition | undefined): boolean {
    return (
        def?.splitHalves !== undefined &&
        (def.staticAbilities ?? []).includes(FUSE_KEYWORD)
    );
}

/** Whether a script iterates the WHOLE announced target set
 *  (`forEach { set: "targets" }`), which on the fused spell would sweep the
 *  other half's targets too. */
function readsWholeTargetSet(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(readsWholeTargetSet);
    if (value === null || typeof value !== "object") return false;
    const obj = value as Record<string, unknown>;
    if (obj.set === "targets") return true;
    return Object.values(obj).some(readsWholeTargetSet);
}

/** How many targets `half` announces, when that number is fixed — 0 for a
 *  targetless half, `undefined` for a variable count ("X", "up to N",
 *  "any number"). */
function fixedTargetCount(half: SplitHalf): number | undefined {
    const req = half.targetRequirement;
    if (!req) return 0;
    return typeof req.count === "number" ? req.count : undefined;
}

/** CR 702.102d — why `halves` cannot be fused into ONE flat spell that follows
 *  the left half's instructions and then the right half's, or `undefined` when
 *  they can.
 *
 *  Every reason is a property of the halves' DATA, never of a card:
 *
 *   * a half with no Effect Script has no instructions this module can
 *     concatenate;
 *   * the left half announces a VARIABLE number of targets while the right
 *     half targets too — the right half's slots would have no fixed position;
 *   * a half sweeps the whole announced target set while the other half
 *     targets — it would act on the other half's targets as well;
 *   * the right half reads a target slot by a reference other than the
 *     `{ target: i }` selector (the reserved `$target<N>` refs), which cannot
 *     be moved past the left half's slots.
 *
 *  A binding name both halves declare is NOT a refusal: the right half's own
 *  names are renamed ({@link FUSED_RIGHT_BINDING_PREFIX}). */
export function fusedSplitShapeRefusal(
    halves: readonly [SplitHalf, SplitHalf]
): string | undefined {
    const [left, right] = halves;
    if (!left.effects || !right.effects) {
        return "fused split spell needs both halves as Effect Scripts";
    }
    const leftTargets = fixedTargetCount(left);
    const hasLeftTargets = left.targetRequirement !== undefined;
    const hasRightTargets = right.targetRequirement !== undefined;
    if (hasRightTargets && leftTargets === undefined) {
        return "fused split spell: the left half announces a variable number of targets before the right half's";
    }
    if (
        (readsWholeTargetSet(left.effects) && hasRightTargets) ||
        (readsWholeTargetSet(right.effects) && hasLeftTargets)
    ) {
        return "fused split spell: a half iterates every announced target while the other half also targets";
    }
    if (
        (fixedTargetCount(left) ?? 0) > 0 &&
        !targetReadsAreRebasable(right.effects)
    ) {
        return "fused split spell: the right half reads a target slot by a reference that cannot be moved past the left half's";
    }
    return undefined;
}

/** The prefix the right half's own binding names are renamed under, so the
 *  persisted choice store — keyed by name, first match wins — never hands the
 *  right half the left half's answer (the reason `gre/splice.ts` renames a
 *  spliced segment's). Alphanumeric after the `$`: the binding-name grammar. */
export const FUSED_RIGHT_BINDING_PREFIX = "$fusedRight";

/** CR 702.102d — the right half's script as the SECOND segment of the fused
 *  spell: its target slots moved past the left half's `offset`, its own
 *  bindings renamed. */
function rightHalfSegment(
    effects: readonly EffectOp[],
    offset: number
): EffectOp[] {
    const rebased =
        offset > 0 ? rebaseTargetRefs([...effects], offset) : [...effects];
    const declared = new Set<string>();
    declaredBindingNames(rebased, declared);
    if (declared.size === 0) return rebased;
    const rename = new Map(
        [...declared].map((name) => [
            name,
            FUSED_RIGHT_BINDING_PREFIX + name.slice(1),
        ])
    );
    return renameBindings(rebased, rename);
}

/** CR 702.102 — the fused split spell `parent` can be cast as, or `undefined`
 *  when `parent` has no fuse or its halves cannot be fused
 *  ({@link fusedSplitShapeRefusal}).
 *
 *  Like each half's twin, it carries the parent's `rarity` and
 *  `imagePrintId` (the PRINT's, not characteristics) with the same `??
 *  parent.id` fallback `splitHalfTwinDefinition` documents. */
export function fusedSplitTwinDefinition(
    parent: CardDefinition
): CardDefinition | undefined {
    const halves = parent.splitHalves;
    if (!halves || !hasFuse(parent)) return undefined;
    if (fusedSplitShapeRefusal(halves) !== undefined) return undefined;
    const [left, right] = halves;
    const offset = fixedTargetCount(left) ?? 0;
    const groups: TargetRequirement[] = [
        ...(left.targetRequirement ? [left.targetRequirement] : []),
        ...(right.targetRequirement ? [right.targetRequirement] : []),
    ];
    const effects: EffectOp[] = [
        ...(left.effects ?? []),
        ...rightHalfSegment(right.effects ?? [], offset),
    ];
    const manaCost = combineSplitManaCosts(left.manaCost, right.manaCost);
    const subtypes = [
        ...new Set([...(left.subtypes ?? []), ...(right.subtypes ?? [])]),
    ];
    return {
        id: fusedSplitDefinitionId(parent.id),
        name: combineSplitNames(halves),
        rarity: parent.rarity,
        types: combineSplitTypes(halves),
        ...(subtypes.length > 0 ? { subtypes } : {}),
        ...(manaCost ? { manaCost } : {}),
        // The fuse line is the CARD's (CR 702.102a: it applies while the card
        // is in a hand), printed on both faces; the spell shows each half's
        // instructions once.
        oracleText: [left.oracleText, right.oracleText]
            .flatMap((text) => text.split("\n"))
            .filter((line) => !FUSE_LINE.test(line))
            .join("\n"),
        effects,
        ...(groups.length > 0 ? { targetRequirement: groups[0] } : {}),
        ...(groups.length > 1
            ? { additionalTargetRequirements: groups.slice(1) }
            : {}),
        imagePrintId: parent.imagePrintId ?? parent.id,
    };
}
