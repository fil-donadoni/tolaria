// FIN multicolor — bot-visibility tests (`*.bot.test.ts` per the suite
// boundary guard: this file imports `convex/gre/ai/**`).
//
// Sin, Spira's Punishment (issue #2382) resolves through a `resolve()` closure
// — a conditional repeat-until-land loop no Effect Script expresses — so the
// bot's value model (`OP_VALUERS` walked via `dslAbilityScriptValue`) has
// nothing to read from the real body. Its `aiEffects` shadow script is what
// keeps the trigger from valuing as a neutral no-op, which would make a 7-mana
// bomb read as a vanilla 7/7 flier to move selection.

import { describe, it, expect } from "vitest";
import { sinSpirasPunishment } from "../multicolor";
import { dslAbilityScriptValue } from "../../../../gre/ai/cardScriptValue";
import type { CardDefinition } from "../../../types";

describe("Sin, Spira's Punishment — bot visibility (PRD #1423, issue #1519)", () => {
    it("its enters-or-attacks trigger valuates as board-state-changing, not neutral", () => {
        const value = dslAbilityScriptValue(sinSpirasPunishment);
        expect(value).toBeDefined();
        expect(value!).toBeGreaterThan(0);
    });

    it("without the aiEffects shadow script the SAME card valuates as nothing", () => {
        const blind: CardDefinition = {
            ...sinSpirasPunishment,
            triggeredAbilities: sinSpirasPunishment.triggeredAbilities!.map(
                (a) => {
                    const stripped = { ...a };
                    delete stripped.aiEffects;
                    return stripped;
                }
            ),
        };
        const blindValue = dslAbilityScriptValue(blind);
        expect(blindValue ?? 0).toBe(0);
        expect(dslAbilityScriptValue(sinSpirasPunishment)!).toBeGreaterThan(
            blindValue ?? 0
        );
    });
});
