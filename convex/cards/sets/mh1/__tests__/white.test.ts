// MH1 — white card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
    submitChoice,
} from "../../../__tests__/setup.helper";
import { isProtectedFromSource } from "../../../../gre/protection";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";
import { castProhibitionReason } from "../../../castRestrictions";
import { withTemporaryDefinition } from "../../../registry";
import { rangerCaptainOfEos } from "../white.cards";

const giverOfRunes = getDefinition("4e117771-5a8b-4812-b487-32ba34b7f724");
const balduvianBears = getDefinition("ef5297cb-e763-4871-9cd3-0e2dbcc52095");
const juggernaut = getDefinition("dcd6a291-5282-4f49-8203-d9b416083c48");
const lightningBolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");

/** Push an activated ability onto the stack with its cost assumed already
 *  paid, then resolve it (mirrors post-activateAbility state). */
// Giver of Runes — {W} Creature — Kor Cleric (CR 702.16 protection;
// CR 613.1f temporary keyword grant; CR 700.2 modal choice; CR 109.2
// "another" excludes the source itself).
describe("Giver of Runes (CR 702.16 protection incl. colorless; CR 109.2 'another')", () => {
    function setup() {
        const giver = makeInstance(giverOfRunes.id, {
            id: "giver",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "t",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [giver, target] }),
                makePlayer("p2"),
            ],
        });
        return { state, giver, target };
    }

    it("excludes itself from the dynamic target requirement ('another target creature you control')", () => {
        const { state, giver } = setup();
        const ability = giverOfRunes.activatedAbilities![0];
        const dynamicReq = ability.getTargetRequirement!(
            giver as never,
            state as never
        );
        expect(dynamicReq.excludeInstanceIds).toEqual([giver.id]);
        expect(dynamicReq.controller).toBe("you");
    });

    it("CR 702.16 — grants protection from colorless that actually blocks colorless sources (issue #928)", () => {
        const { state, giver } = setup();
        resolveActivated(state, giver, "giver-of-runes-protect", [
            { type: "permanent", id: "t" },
        ]);
        expect(state.pendingChoices).toHaveLength(1);
        submitChoice(state, ["protection-colorless"]);
        const target = state.players[0].battlefield.find((c) => c.id === "t")!;
        expect(target.staticAbilities).toContain("protection from colorless");

        // CR 105.2c — a source with no colors at all (Juggernaut, {X:4} only)
        // is colorless: enforcement, not just the string, must be present.
        const colorlessSource = makeInstance(juggernaut.id, {
            id: "jug",
            controllerId: "p2",
            ownerId: "p2",
        });
        expect(isProtectedFromSource(target, colorlessSource, false)).toBe(
            true
        );

        // A colored source (green) is untouched by protection FROM colorless.
        const coloredSource = makeInstance(balduvianBears.id, {
            id: "bb2",
            controllerId: "p2",
            ownerId: "p2",
        });
        expect(isProtectedFromSource(target, coloredSource, false)).toBe(false);

        // CR 702.16b — a colorless spell/source (sourceColors: []) can no
        // longer choose the protected creature as a target.
        const legalAgainstColorless = getLegalTargets(
            state,
            lightningBolt.targetRequirement!,
            NO_TARGETING_SOURCE
        );
        expect(legalAgainstColorless.map((x) => x.id)).not.toContain("t");
        // ...but a colored (green) source is unaffected.
        const legalAgainstGreen = getLegalTargets(
            state,
            lightningBolt.targetRequirement!,
            {
                ...NO_TARGETING_SOURCE,
                colors: ["G"],
            }
        );
        expect(legalAgainstGreen.map((x) => x.id)).toContain("t");

        // Wire format (ADR — projection must not strip the enforcement path):
        // the granted ability and its enforcement both survive projection.
        const projected = projectPublicState(state, 1, "p1");
        const slimTarget = projected.players[0].battlefield.find(
            (c) => c.id === "t"
        )!;
        expect(slimTarget.staticAbilities).toContain(
            "protection from colorless"
        );
        expect(isProtectedFromSource(slimTarget, colorlessSource, false)).toBe(
            true
        );
    });

    it("grants a chosen color's protection to another target creature", () => {
        const { state, giver } = setup();
        resolveActivated(state, giver, "giver-of-runes-protect", [
            { type: "permanent", id: "t" },
        ]);
        submitChoice(state, ["protection-blue"]);
        const target = state.players[0].battlefield.find((c) => c.id === "t")!;
        expect(target.staticAbilities).toContain("protection from blue");
    });
});

// Ranger-Captain of Eos — "Sacrifice this creature: Your opponents can't cast
// noncreature spells this turn." (CR 601.3a cast prohibition; CR 514.2 cleared
// at cleanup; CR 205.2a "noncreature" = no Creature type, so an artifact
// creature stays castable.)
describe("Ranger-Captain of Eos (CR 601.3a noncreature cast lock)", () => {
    const captain = rangerCaptainOfEos();

    // The derived catalogue row lands after merge, so the card is served to
    // the registry directly for the duration of each test.
    function lockedState() {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        withTemporaryDefinition(captain, () => {
            const source = makeInstance(captain.id, {
                id: "captain",
                controllerId: "p1",
                ownerId: "p1",
            });
            resolveActivated(state, source, "ranger-captain-of-eos-lock");
        });
        return state;
    }

    it("locks the opponent out of noncreature spells only", () => {
        const state = lockedState();
        const bolt = makeInstance(lightningBolt.id, { id: "bolt" });
        const bears = makeInstance(balduvianBears.id, { id: "bears" });
        const jugg = makeInstance(juggernaut.id, { id: "jugg" });
        expect(castProhibitionReason("p2", bolt, state)).toBeDefined();
        expect(castProhibitionReason("p2", bears, state)).toBeUndefined();
        expect(castProhibitionReason("p2", jugg, state)).toBeUndefined();
        expect(castProhibitionReason("p1", bolt, state)).toBeUndefined();
    });

    it("survives the wire projection so the client gate agrees", () => {
        const state = lockedState();
        const projected = projectPublicState(state, 1, "p1");
        const bolt = makeInstance(lightningBolt.id, { id: "bolt" });
        expect(castProhibitionReason("p2", bolt, projected)).toBeDefined();
    });

    it("stacks with an instant/sorcery lock instead of being swallowed", () => {
        const state = lockedState();
        const ctxLock = { playerId: "p2", cardTypes: ["Instant" as const] };
        state.cannotCastSpellsThisTurn!.unshift(ctxLock);
        const jugg = makeInstance(juggernaut.id, { id: "jugg" });
        const bolt = makeInstance(lightningBolt.id, { id: "bolt" });
        expect(castProhibitionReason("p2", bolt, state)).toBeDefined();
        expect(castProhibitionReason("p2", jugg, state)).toBeUndefined();
    });
});
