// FIN — per-card behavior tests for blue cards in
// `convex/cards/sets/fin/blue.ts` (Final Fantasy, split by colour per ADR
// 0043). Astrologian's Planisphere (issue #2610, Job select CR 702.182a) is
// the second consumer of the generalized `equipmentAttachTokenTrigger`
// factory and the SECOND catalogue card combining a layer-4 `subtype-add`
// static with a granted `triggered-grant` template on the same host
// (Kaldra Compleat, `mh2/__tests__/colorless.test.ts`, is the first) — this
// suite locks the card-visible pieces the DSL smoke sweep can't assert on
// its own: the token creation + attach, the additive Wizard type surviving
// the host's printed types, and the granted ability's TWO independent fire
// conditions (noncreature spell cast / third card drawn each turn).

import { describe, it, expect } from "vitest";
import { astrologiansPlanisphere } from "../blue";
import { grizzlyBears } from "../../lea/green";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import { tokenPrintIdFor } from "../../../tokenPrintLookup";

function setupPlanisphere(): { state: GameState; card: CardInstanceState } {
    const planisphere = makeInstance(astrologiansPlanisphere.id, {
        id: "planisphere1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [planisphere] }),
            makePlayer("p2"),
        ],
    });
    return { state, card: state.players[0].battlefield[0] };
}

/** Puts Astrologian's Planisphere's Job select ETB trigger on the stack
 *  (CR 603.6a) and resolves it, returning the created Hero token. */
function fireJobSelect(
    state: GameState,
    planisphere: CardInstanceState
): CardInstanceState {
    state.stack.push({
        ...planisphere,
        zone: "stack",
        castById: planisphere.controllerId,
        triggeredAbilityId: "astrologians-planisphere-job-select",
        triggerSourceId: planisphere.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: planisphere.id,
            controllerId: planisphere.controllerId,
            types: planisphere.types,
        },
        targets: undefined,
    } as StackItem);
    resolveTopOfStack(state);
    return state.players[0].battlefield.find(
        (c) => c.isToken && c.subtypes?.includes("Hero")
    )!;
}

describe("Astrologian's Planisphere (FIN #46, Job select CR 702.182a — issue #2610)", () => {
    it("definition sanity — {1}{U}, Equip {2}, subtype-add + triggered-grant", () => {
        expect(astrologiansPlanisphere.manaCost).toEqual({ generic: 1, U: 1 });
        expect(astrologiansPlanisphere.subtypes).toEqual(["Equipment"]);
        const equip = astrologiansPlanisphere.activatedAbilities!.find(
            (a) => a.id === "astrologians-planisphere-equip"
        )!;
        expect(equip.cost).toEqual({ mana: { generic: 2 } });
        expect(
            (astrologiansPlanisphere.staticEffects ?? []).map((e) => e.kind)
        ).toEqual(["subtype-add", "triggered-grant"]);
        expect(astrologiansPlanisphere.triggeredGrantTemplates).toHaveLength(1);
        expect(tokenPrintIdFor(astrologiansPlanisphere.id, "Hero")).toBe(
            "17fa0c1f-6737-487c-9101-0bec2e586795"
        );
    });

    it("resolves its own printed Hero token art", () => {
        expect(tokenPrintIdFor(astrologiansPlanisphere.id, "Hero")).toBe(
            "17fa0c1f-6737-487c-9101-0bec2e586795"
        );
    });

    it("Job select creates a 1/1 colorless Hero and attaches to it (GRE and wire format)", () => {
        const { state, card } = setupPlanisphere();
        const hero = fireJobSelect(state, card);

        expect(hero).toBeDefined();
        expect(hero.power).toBe(1);
        expect(hero.toughness).toBe(1);

        expect(
            state.players[0].battlefield.find((c) => c.id === "planisphere1")!
                .attachedTo
        ).toBe(hero.id);

        // Attaching applies BOTH statics immediately (`attachTo` re-applies
        // static effects on the new host) — the Wizard subtype is additive,
        // so the token's OWN printed "Hero" subtype survives alongside it.
        expect(hero.subtypes).toContain("Hero");
        expect(hero.subtypes).toContain("Wizard");

        const projected = projectPublicState(state, 1, "p1");
        const slimHero = projected.players[0].battlefield.find(
            (c) => c.id === hero.id
        )!;
        expect(slimHero.subtypes).toContain("Wizard");
        expect(slimHero.subtypes).toContain("Hero");
    });

    it("keeps the host's OWN printed types — the type-add is additive, not a replacement", () => {
        const { state, card } = setupPlanisphere();
        fireJobSelect(state, card);
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(bear);
        const planisphereOnBoard = state.players[0].battlefield.find(
            (c) => c.id === "planisphere1"
        )!;
        state.stack.push({
            ...planisphereOnBoard,
            zone: "stack",
            castById: "p1",
            abilityId: "astrologians-planisphere-equip",
            targets: [{ type: "permanent", id: "bear1" }],
        } as StackItem);
        resolveTopOfStack(state);

        const bearOnBoard = state.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(bearOnBoard.subtypes).toContain("Bear");
        expect(bearOnBoard.subtypes).toContain("Wizard");
    });

    it("grants the noncreature-spell / third-draw counter trigger to the equipped creature only", () => {
        const { state, card } = setupPlanisphere();
        const hero = fireJobSelect(state, card);

        const granted = effectiveTriggeredAbilities(hero).find(
            (a) => a.id === "astrologians-planisphere-granted-counter"
        );
        expect(granted).toBeDefined();
        // The Equipment itself never carries the granted ability.
        expect(
            effectiveTriggeredAbilities(
                state.players[0].battlefield.find(
                    (c) => c.id === "planisphere1"
                )!
            ).some((a) => a.id === "astrologians-planisphere-granted-counter")
        ).toBe(false);

        const noncreatureSpell = {
            type: "SPELL_CAST" as const,
            casterId: "p1",
            spellInstanceId: "spell1",
            spellCardId: "some-card",
            spellTypes: ["Instant"] as const,
            spellSubtypes: [],
            spellColors: [],
        };
        expect(granted!.matches(noncreatureSpell, hero, state)).toBe(true);
        // A CREATURE spell does not qualify (CR 601.2i).
        expect(
            granted!.matches(
                { ...noncreatureSpell, spellTypes: ["Creature"] },
                hero,
                state
            )
        ).toBe(false);
        // An OPPONENT's noncreature spell does not qualify ("you cast").
        expect(
            granted!.matches(
                { ...noncreatureSpell, casterId: "p2" },
                hero,
                state
            )
        ).toBe(false);

        // The THIRD card drawn this turn (0-based index 2) qualifies; the
        // first and second do not.
        const drawEvent = (index: number) => ({
            type: "CARD_DRAWN" as const,
            playerId: "p1",
            count: 1,
            drawIndexThisTurn: index,
            isTurnBasedDrawStepDraw: false,
        });
        expect(granted!.matches(drawEvent(0), hero, state)).toBe(false);
        expect(granted!.matches(drawEvent(1), hero, state)).toBe(false);
        expect(granted!.matches(drawEvent(2), hero, state)).toBe(true);
        // An OPPONENT drawing their third card does not qualify ("you draw").
        expect(
            granted!.matches({ ...drawEvent(2), playerId: "p2" }, hero, state)
        ).toBe(false);

        // Resolving the granted trigger puts a +1/+1 counter on the host.
        state.stack.push({
            ...hero,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "astrologians-planisphere-granted-counter",
            triggerSourceId: hero.id,
            triggerEvent: drawEvent(2),
            targets: undefined,
        } as StackItem);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === hero.id)!
                .counters?.["+1/+1"]
        ).toBe(1);
    });
});
