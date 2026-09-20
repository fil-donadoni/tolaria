// Catalogue guard — `TargetRequirement.announcedOnlyIfKicked` (CR 702.33g /
// CR 601.2c, issue #4220) is honoured at exactly ONE place: the group list
// `announceCast` builds for a SPELL cast, filtered by
// `castAnnouncedTargetGroups` (`convex/gre/kicker.ts`) and mirrored by the
// Bot's `enumerateCastMoves`.
//
// Two invariants follow, and breaking either is silent:
//
//  1. It may not sit on a PRIMARY `targetRequirement`. That field is the group
//     every cast announces — the announcement reads it before it knows
//     whether the gate opens, and `hasEnoughLegalTargets` (`gre/rules.ts`)
//     gates the Cast UI on it unconditionally. A card whose only target is
//     inside the gate (Probe) declares NO primary requirement and puts its one
//     group on `additionalTargetRequirements`, which is what the compiler's
//     `declareTargets` emits.
//  2. It may not sit on an ABILITY's or a MODE's requirement. An activated or
//     triggered ability announces its targets through a path that never
//     consults a kicker payment (CR 602.2b / 603.3d), and a multi-instance
//     modal announcement (ADR 0094) builds its groups from the mode list
//     without filtering — so the gate would be ignored and the target demanded
//     on every use.
//
// The compiler refuses both at its own three sites (`lowerActivated.ts`,
// `lowerTriggered.ts`, `lowerSpellModes`); this is the same invariant over the
// HAND-WRITTEN catalogue, which those refusals never see.

import { describe, it, expect } from "vitest";
import type { TargetRequirement } from "../types";
import { getAllCards } from "../index";

const gated = (req: TargetRequirement | undefined) =>
    req?.announcedOnlyIfKicked === true;

describe("TargetRequirement.announcedOnlyIfKicked catalogue guard (issue #4220)", () => {
    it("is set only on a card-level additional target group", () => {
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            const where = (site: string) => `${card.name} :: ${site}`;
            if (gated(card.targetRequirement)) {
                offenders.push(where("card.targetRequirement"));
            }
            if (gated(card.kickedTargetRequirement)) {
                offenders.push(where("card.kickedTargetRequirement"));
            }
            for (const mode of card.modes ?? []) {
                if (
                    gated(mode.targetRequirement) ||
                    (mode.additionalTargetRequirements ?? []).some(gated)
                ) {
                    offenders.push(where(`mode ${mode.id}`));
                }
            }
            for (const trigger of card.triggeredAbilities ?? []) {
                if (gated(trigger.targetRequirement)) {
                    offenders.push(where(`trigger ${trigger.id}`));
                }
            }
            for (const ability of card.activatedAbilities ?? []) {
                if (
                    gated(ability.targetRequirement) ||
                    (ability.additionalTargetRequirements ?? []).some(gated)
                ) {
                    offenders.push(where(`ability ${ability.id}`));
                }
                for (const mode of ability.modes ?? []) {
                    if (gated(mode.targetRequirement)) {
                        offenders.push(
                            where(`ability ${ability.id} mode ${mode.id}`)
                        );
                    }
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("a gated group is the LAST group, and there is at most one", () => {
        // CR 601.2c — an Effect Script reads the announced picks POSITIONALLY,
        // and a dropped group closes the list up. A gated group followed by an
        // ungated one therefore means a DIFFERENT `{ target: n }` on a kicked
        // and an unkicked cast: the trailing group would sit one slot earlier
        // whenever the kicker went unpaid. The compiler refuses to allocate
        // anything after a gated group (`TargetSlots.allocate` — the
        // announcement is open-ended from there on); this is the same
        // invariant over the hand-written catalogue, which that refusal never
        // sees. Two gates have the same problem twice over.
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            const groups = card.additionalTargetRequirements ?? [];
            const flags = groups.filter(gated).length;
            if (flags === 0) continue;
            if (flags > 1) {
                offenders.push(`${card.name} :: ${flags} gated groups`);
                continue;
            }
            if (!gated(groups[groups.length - 1])) {
                offenders.push(`${card.name} :: gated group is not last`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("a card declaring a gated group also declares a Kicker (CR 702.33a)", () => {
        // A gate nothing can open is a group the caster is never asked for —
        // the clause would be dead text rather than a conditional one.
        const offenders = getAllCards()
            .filter(
                (c) =>
                    (c.additionalTargetRequirements ?? []).some(gated) &&
                    (c.kickers ?? []).length === 0
            )
            .map((c) => c.name);
        expect(offenders).toEqual([]);
    });
});
