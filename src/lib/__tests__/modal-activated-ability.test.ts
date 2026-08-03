// Frontend wiring for MODAL activated abilities (CR 700.2 / 602.2b, issue
// #1341 — Umezawa's Jitte).
//
// The bug class this guards is the one `.claude/rules/gre-development.md`
// § "Frontend wiring analysis" names: a card correct in the GRE is dead in the
// UI because the affordance never appears. A modal activated ability has TWO
// client-side preconditions beyond an ordinary one:
//
//   1. `getStackAbilities` must still OFFER it — its cost gate reads the
//      viewer-visible `counters` off the projected instance, and the ability
//      carries NO ability-level `targetRequirement` (the modes do), which must
//      not make it look inert.
//   2. The definition must expose `modes` so the activation handler opens the
//      `<ModePicker>` BEFORE calling `activateAbility` — the server rejects a
//      modal activation with no `chosenModeId`, so a missing picker is a hard
//      dead end, not a degraded experience.
//
// The surface assertion runs through the real `buildTriggerStateView` reducer,
// per the project rule that a hand-built view masks a dropped field.

import { describe, it, expect } from "vitest";
import { getCardByName } from "@convex/cards";
import type { CardInstance } from "../../types/game";
import { getStackAbilities, buildTriggerStateView } from "../card-utils";

const VIEWER = "p1";
const OPP = "p2";
const MODAL_ABILITY = "umezawas-jitte-modes";

const jitteDef = getCardByName("Umezawa's Jitte");

function jitteInstance(charges: number): CardInstance {
    return {
        id: "jitte-1",
        card: { id: jitteDef.id },
        controllerId: VIEWER,
        ownerId: VIEWER,
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: jitteDef.types,
        subtypes: jitteDef.subtypes ?? [],
        attachedTo: "bear-1",
        ...(charges > 0 ? { counters: { charge: charges } } : {}),
    };
}

function offeredAbilityIds(source: CardInstance): string[] {
    const view = buildTriggerStateView(
        [
            {
                id: VIEWER,
                life: 20,
                hand: [],
                battlefield: [source],
                graveyard: [],
            },
            { id: OPP, life: 20, hand: [], battlefield: [], graveyard: [] },
        ],
        VIEWER
    );
    return getStackAbilities(source, undefined, true, view, 20, []).map(
        (a) => a.id
    );
}

describe("Umezawa's Jitte — modal activated ability is reachable in the UI", () => {
    it("offers the modal ability once a charge counter is available", () => {
        expect(offeredAbilityIds(jitteInstance(1))).toContain(MODAL_ABILITY);
    });

    // CR 122.6 — the counter removal is the whole cost, so zero counters means
    // the server would throw; the UI must hide it rather than offer a dead
    // menu entry. (The generic version of this contract is swept catalogue-wide
    // in `activation-affordability.catalogue.test.ts`; asserted here too so a
    // Jitte-specific regression is legible.)
    it("hides it with no charge counters", () => {
        expect(offeredAbilityIds(jitteInstance(0))).not.toContain(
            MODAL_ABILITY
        );
    });

    // The picker's precondition: the client reads `modes` off the definition to
    // decide it must ask BEFORE dispatching `activateAbility`.
    it("exposes modes with labels and oracle text for the picker", () => {
        const ability = jitteDef.activatedAbilities!.find(
            (a) => a.id === MODAL_ABILITY
        )!;
        expect(ability.modes).toHaveLength(3);
        for (const mode of ability.modes!) {
            expect(mode.id).toBeTruthy();
            expect(mode.label).toBeTruthy();
            expect(mode.oracleText).toBeTruthy();
        }
        // CR 700.2d — no ability-level requirement; exactly one mode targets.
        expect(ability.targetRequirement).toBeUndefined();
        expect(
            ability.modes!.filter((m) => m.targetRequirement !== undefined)
        ).toHaveLength(1);
    });
});
