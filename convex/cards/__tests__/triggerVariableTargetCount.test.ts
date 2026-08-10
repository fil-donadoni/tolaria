// Catalogue-wide guard: no shipped `TriggeredAbility.targetRequirement`
// authors the "up to X" object-form count (`{ min, max: "X" }`, CR 601.2c —
// issue #2365) that a triggered ability's own announcement can never fill.
//
// A trigger's announcement (CR 603.3d) incorporates CR 601.2c–d — which DOES
// include announcing how many targets a variable-target ability picks
// (601.2c) — but NOT 601.2b, the step that announces an `X` value. A
// triggered ability therefore has no way to learn what `X` even is, and
// `triggerTargetMinMax` (gre/rules.ts) collapses ANY `max: "X"` straight
// down to `min`, silently discarding the announced upper bound: authoring
// this shape on a card/emblem's `TriggeredAbility.targetRequirement` would
// tsc-check cleanly and then choose zero variable targets at runtime with no
// signal anything is wrong — exactly the partial-mechanic-ships-silently
// shape `.claude/rules/gre-development.md` blocks on (#957/#958).
//
// The ONE inline-authoring surface a schema validator can statically check —
// `reflexiveTrigger`'s own `targetRequirement` field — already rejects this
// shape at authoring time (`isInlineTargetRequirement`,
// `gre/effects/validate.ts`). A card-def or emblem `TriggeredAbility.
// targetRequirement` is a DIFFERENT surface: `validateAbilityEffectScript`
// only walks `effects[]`, never the ability's own `targetRequirement` field,
// so tsc is the only check that shape gets today. This catalogue sweep is
// the guard for that surface — it is not a validator, so no card should ever
// need an allowlist entry here; a real "up to X" triggered-ability template
// isn't expressible today (open an issue if one is needed).
//
// Activated abilities are explicitly OUT of scope: CR 602.2b incorporates
// 601.2b–i in full, so an activated ability's `max: "X"` DOES get a real X
// announcement and is legitimately variable.
import { describe, it, expect } from "vitest";
import { getAllCards } from "..";
import { getAllEmblemDefinitions } from "../emblems";
import type { TriggeredAbility } from "../types";

function hasInertVariableMax(ability: TriggeredAbility): boolean {
    const count = ability.targetRequirement?.count;
    return (
        typeof count === "object" &&
        count !== null &&
        !Array.isArray(count) &&
        count.max === "X"
    );
}

describe("Triggered ability targetRequirement — no inert 'up to X' count (CR 603.3d, issue #2365)", () => {
    it('no card\'s triggeredAbilities[] authors { min, max: "X" }', () => {
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            for (const ability of card.triggeredAbilities ?? []) {
                if (hasInertVariableMax(ability)) {
                    offenders.push(`${card.name}: ability "${ability.id}"`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('no emblem\'s triggeredAbilities[] authors { min, max: "X" }', () => {
        const offenders: string[] = [];
        for (const emblem of getAllEmblemDefinitions()) {
            for (const ability of emblem.triggeredAbilities ?? []) {
                if (hasInertVariableMax(ability)) {
                    offenders.push(`${emblem.name}: ability "${ability.id}"`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
