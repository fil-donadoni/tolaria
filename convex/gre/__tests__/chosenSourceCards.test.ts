// "A source of your choice" (CR 609.7a) on the `resolve()` cards — Dark
// Sphere, Eye for an Eye, Reverse Damage, Jade Monolith: the source is chosen
// on resolution from every permanent and spell on the stack, never targeted,
// never a player. Driven through the real activation / resolution / submit
// path; the DSL cards (Circle of Protection cycle, Pentagram of the Ages,
// Rith's Charm) are covered by `damageSourceChoice.test.ts` and PLS tests.

import { describe, expect, it } from "vitest";
import { resolveTopOfStack } from "../state";
import { activateAbilityOnState } from "../activation";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveActivated,
    submitChoice,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards";

const darkSphere = getDefinition("72cfe9b9-677d-4ecb-83ab-67fb6481371d");
const eyeForAnEye = getDefinition("2933ca2a-097b-44f4-ae56-ad524d26fd06");
const reverseDamage = getDefinition("943baea8-b173-4863-a3ab-dd217d483cd9");
const jadeMonolith = getDefinition("4a77e0f1-449d-4a7d-9fa0-ba7598f7a73a");
const pentagram = getDefinition("b8d889a5-f6c7-410d-97f9-acf08b9091c8");
const grayOgre = getDefinition("73ae5276-b607-4f23-a9d2-e8cc7b8e3693");
const lightningBolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");

const HEXPROOF_OGRE = () =>
    makeInstance(grayOgre.id, {
        id: "hex",
        controllerId: "p2",
        ownerId: "p2",
        staticAbilities: ["hexproof"],
    });

describe("Reverse Damage — source chosen on resolution (CR 609.7a)", () => {
    it("offers a hexproof creature and a spell on the stack, never a player; choosing the Bolt prevents it and gains life", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 10 }),
                makePlayer("p2", { battlefield: [HEXPROOF_OGRE()] }),
            ],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, reverseDamage.id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0]!;
        expect(head.kind).toBe("pick-source");
        expect(head.candidateIds).toContain("hex");
        expect(head.candidateIds).toContain(bolt.id);
        expect(head.candidateIds).not.toContain("p1");
        expect(head.candidateIds).not.toContain("p2");
        // The pending choice crosses the wire with its candidates.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices![0]!.candidateIds).toContain(bolt.id);

        submitChoice(state, [bolt.id]);
        resolveTopOfStack(state); // the Bolt: prevented, 3 life gained
        expect(state.players[0].life).toBe(13);
    });
});

describe("Eye for an Eye — source chosen on resolution (CR 609.7a)", () => {
    it("has no target; a hexproof creature is choosable and a player is not", () => {
        expect(eyeForAnEye.targetRequirement).toBeUndefined();
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [HEXPROOF_OGRE()] }),
            ],
        });
        pushSpell(state, eyeForAnEye.id, "p1");
        resolveTopOfStack(state);
        const ids = state.pendingChoices![0]!.candidateIds!;
        expect(ids).toContain("hex");
        expect(ids).not.toContain("p1");
        expect(ids).not.toContain("p2");
        submitChoice(state, ["hex"]);
        expect(state.damageRedirections?.[0]).toMatchObject({
            kind: "reflect-to-source-controller",
            sourceInstanceId: "hex",
        });
    });
});

describe("Dark Sphere — source chosen on resolution (CR 609.7a)", () => {
    it("offers a non-creature artifact permanent and never a player", () => {
        const sphere = makeInstance(darkSphere.id, {
            id: "sphere",
            controllerId: "p1",
            ownerId: "p1",
        });
        const artifact = makeInstance(pentagram.id, {
            id: "pent",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sphere] }),
                makePlayer("p2", { battlefield: [artifact] }),
            ],
        });
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "sphere",
            abilityId: "dark-sphere-prevent-half",
        });
        expect(state.stack[0]!.targets ?? []).toHaveLength(0);
        resolveTopOfStack(state);
        const ids = state.pendingChoices![0]!.candidateIds!;
        expect(ids).toContain("pent");
        expect(ids).not.toContain("p1");
        expect(ids).not.toContain("p2");
        submitChoice(state, ["pent"]);
        expect(state.playerDamagePrevention?.[0]?.match.sourceInstanceId).toBe(
            "pent"
        );
    });
});

describe("Jade Monolith — only the creature is a target; the source is chosen (CR 609.7a)", () => {
    it("can choose a spell on the stack as the source", () => {
        const monolith = makeInstance(jadeMonolith.id, {
            id: "monolith",
            controllerId: "p1",
            ownerId: "p1",
        });
        const mine = makeInstance(grayOgre.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [monolith, mine],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "mine" },
        ]);
        // The ability on the stack carries only the creature as its target.
        resolveActivated(state, monolith, "jm-redirect", [
            { type: "permanent", id: "mine" },
        ]);
        const ids = state.pendingChoices![0]!.candidateIds!;
        expect(ids).toContain(bolt.id);
        expect(ids).not.toContain("p1");
        submitChoice(state, [bolt.id]);
        expect(state.damageRedirections?.[0]).toMatchObject({
            sourceInstanceId: bolt.id,
            targetInstanceId: "mine",
        });
    });
});
