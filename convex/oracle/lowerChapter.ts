/**
 * Lowering: chapter-line IR → `ChapterAbilityDefinition` (CR 714.2).
 *
 * The output is the same data a hand-written Saga declares, so the card reaches
 * the engine through the one seam every Saga does (`expandChapterAbilities`),
 * which derives the trigger, the entry lore counter and the final chapter
 * (CR 714.2d). None of them is the compiler's to write.
 */

import type {
    ChapterAbilityDefinition,
    EffectOp,
    TargetRequirement,
} from "../cards/types";
import type { EffectSentenceIR } from "./grammar/shared/effectClause";
import { declareTargets, lowerSentence, SentenceWalk } from "./lowerEffects";

export type LowerChapterResult =
    | { readonly ok: true; readonly ability: ChapterAbilityDefinition }
    | { readonly ok: false; readonly reason: string };

export function lowerChapterAbility(input: {
    readonly chapters: readonly number[];
    readonly oracleText: string;
    /** CR 201.5 — the card's printed name, for the prompts a body emits. */
    readonly cardName: string;
    readonly effects: readonly EffectSentenceIR[];
}): LowerChapterResult {
    const walk = new SentenceWalk();
    const effects: EffectOp[] = [];
    for (const sentence of input.effects) {
        // CR 107.3 — a triggered ability has no cost and announces nothing, so
        // an X in its body has no value to read.
        const result = lowerSentence(sentence, walk, {
            allowX: false,
            selfName: input.cardName,
        });
        if (!result.ok) return { ok: false, reason: result.reason };
        effects.push(...result.value);
    }
    // CR 702.33g — only a spell's announcement filters a gated group.
    if (walk.targets.hasKickerGatedGroup())
        return {
            ok: false,
            reason: "an ability cannot announce a target only if kicked (CR 702.33g)",
        };
    // CR 603.3d — a chapter ability is a triggered ability (CR 714.2b): its
    // target is announced as it goes on the stack. `declareTargets` writes at
    // most one group and refuses more, as at the triggered-ability site.
    const declared: { targetRequirement?: TargetRequirement } = {};
    const targetError = declareTargets(declared, walk.targets.requirements());
    if (targetError !== null) return { ok: false, reason: targetError };
    return {
        ok: true,
        ability: {
            chapters: [...input.chapters],
            oracleText: input.oracleText,
            effects,
            ...(declared.targetRequirement !== undefined
                ? { targetRequirement: declared.targetRequirement }
                : {}),
        },
    };
}
