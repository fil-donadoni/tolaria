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

// A text-defined bound (`TargetCountQuantity`, issue #6526) is NOT inert any
// more (issue #7210): CR 601.2c's "the number of targets will be defined by
// the spell's text" is part of the announcement CR 603.3d incorporates, and
// `triggerTargetMinMax` reads it against the trigger item. Only the literal
// `"X"` stays banned. A modal trigger announces its chosen mode's requirement
// through the same path, so every mode is swept too.
function hasInertVariableMax(ability: TriggeredAbility): boolean {
    return [
        ability.targetRequirement,
        ...(ability.additionalTargetRequirements ?? []),
        ...(ability.modes ?? []).map((m) => m.targetRequirement),
    ].some((req) => {
        const count = req?.count;
        return (
            typeof count === "object" &&
            count !== null &&
            !Array.isArray(count) &&
            count.max === "X"
        );
    });
}

/** Every JSON path under `node` at which a target count's `max` is the
 *  `{ kickerCount: true }` quantity, skipping `triggeredAbilities` subtrees. */
function kickerCountMaxOutsideTriggers(node: unknown, path: string): string[] {
    if (typeof node !== "object" || node === null) return [];
    if (Array.isArray(node)) {
        return node.flatMap((n, i) =>
            kickerCountMaxOutsideTriggers(n, `${path}[${i}]`)
        );
    }
    const record = node as Record<string, unknown>;
    const out: string[] = [];
    const max = (record.count as { max?: unknown } | undefined)?.max;
    if (typeof max === "object" && max !== null && "kickerCount" in max) {
        out.push(`${path}.count.max`);
    }
    for (const [key, child] of Object.entries(record)) {
        if (key === "triggeredAbilities") continue;
        out.push(...kickerCountMaxOutsideTriggers(child, `${path}.${key}`));
    }
    return out;
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

    // Issue #7210 — `{ kickerCount: true }` as a target bound was proven on
    // the TRIGGER walk only: a triggered ability's source already carries the
    // Kicker record its spell paid (CR 702.33e). A spell's or activated
    // ability's own walk is a different announcement; keep the shape off it
    // until one is proven there.
    it("no target count outside triggeredAbilities[] is bounded by { kickerCount: true }", () => {
        const offenders = getAllCards().flatMap((card) =>
            kickerCountMaxOutsideTriggers(card, card.name)
        );
        expect(offenders).toEqual([]);
    });
});
