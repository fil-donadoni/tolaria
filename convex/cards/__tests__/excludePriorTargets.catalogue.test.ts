// Catalogue guard — `TargetRequirement.excludePriorTargets` ("ANOTHER target",
// CR 115.3, issue #3236) is meaningful ONLY on an `additionalTargetRequirements`
// entry, because it is lowered into the registered `excludeInstanceIds` filter
// at exactly one place: the moment the target walk ADVANCES from one group to
// the next (`advanceTargetGroupOrFinalize`, `convex/game.ts`).
//
// Anywhere else it reads as a no-op with no error and no warning: on a PRIMARY
// requirement there is no earlier group to exclude, and a triggered ability has
// no `additionalTargetRequirements` twin at all, so its whole group walk never
// passes through the lowering. The card would ship letting one permanent fill
// both halves of an "another target" clause — the failure this directive exists
// to prevent, silently reintroduced. The fail-closed norm wants that caught at
// definition time, which is what this sweep does.

import { describe, it, expect } from "vitest";
import type { TargetRequirement } from "../types";
import { getAllCards } from "../index";

describe("TargetRequirement.excludePriorTargets catalogue guard (issue #3236)", () => {
    it("is set only on an additional target group, never on a primary or trigger requirement", () => {
        const offenders: string[] = [];
        const flagged = (req: TargetRequirement | undefined) =>
            req?.excludePriorTargets === true;

        for (const card of getAllCards()) {
            const where = (site: string) => `${card.name} :: ${site}`;
            if (flagged(card.targetRequirement)) {
                offenders.push(where("card.targetRequirement"));
            }
            if (flagged(card.kickedTargetRequirement)) {
                offenders.push(where("card.kickedTargetRequirement"));
            }
            for (const mode of card.modes ?? []) {
                if (flagged(mode.targetRequirement)) {
                    offenders.push(where(`mode ${mode.id}`));
                }
            }
            for (const trigger of card.triggeredAbilities ?? []) {
                if (flagged(trigger.targetRequirement)) {
                    offenders.push(where(`trigger ${trigger.id}`));
                }
            }
            for (const ability of card.activatedAbilities ?? []) {
                if (flagged(ability.targetRequirement)) {
                    offenders.push(where(`ability ${ability.id} (primary)`));
                }
                for (const mode of ability.modes ?? []) {
                    if (flagged(mode.targetRequirement)) {
                        offenders.push(
                            where(`ability ${ability.id} mode ${mode.id}`)
                        );
                    }
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    it("the one shipped user declares it on an additional group (guard the guard)", () => {
        // A sweep whose positive case never occurs is vacuously green: this
        // pins the shape the guard is written around.
        const saheeli = getAllCards().find(
            (c) => c.name === "Saheeli, Sublime Artificer"
        )!;
        const minus2 = saheeli.activatedAbilities!.find(
            (a) => a.id === "saheeli-sublime-artificer-minus2"
        )!;
        expect(
            minus2.additionalTargetRequirements!.some(
                (r) => r.excludePriorTargets === true
            )
        ).toBe(true);
    });
});
