// "A source of your choice" (CR 609.7a) and "the next time it would deal
// damage to you, prevent that damage" (CR 615.1a / 615.6) — issue #5601.
//
// The `pick-source` choice kind over the `battlefield-or-stack` pool and the
// `preventDamage` `"next-from-source"` mode, driven through the REAL
// activation entry point and the REAL submit path, on the cards that ship the
// script: the Circle of Protection cycle (`makeCircleOfProtection`) and
// Pentagram of the Ages.

import { describe, expect, it } from "vitest";
import { resolveTopOfStack } from "../state";
import { applyAllCombatDamage } from "../phases";
import type { GameState } from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { eligibleZonePickCards } from "../zonePickEligibility";
import { activateAbilityOnState } from "../activation";
import { projectPublicState } from "../../gameProjections";
import { validateEffectScript } from "../effects/validate";
import { assertExpectedInput, refreshExpectedInput } from "../expectedInput";
import { compactState, expandState } from "../serialize";
import { checkStateBasedActions } from "../sba";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards";
import type { CardDefinition, EffectOp } from "../../cards/types";

const circleOfProtectionRed = getDefinition(
    "b3dd94c5-42f6-4148-be6e-2a3a4226cc0e"
);
const circleOfProtectionWhite = getDefinition(
    "92df19c9-e127-42d9-8dd2-7fa5a7095428"
);
const circleOfProtectionBlue = getDefinition(
    "848b1a7f-e8ba-40b5-92b7-af1e963a0319"
);
const circleOfProtectionGreen = getDefinition(
    "1ae32d20-b438-4f43-b603-e8f706ecfb03"
);
const circleOfProtectionBlack = getDefinition(
    "fa47b4cd-8da4-4544-b011-ba92b7009203"
);
const circleOfProtectionArtifacts = getDefinition(
    "22ebd5a3-fef8-4097-b038-89a6cb38227d"
);
const greaterRealmOfPreservation = getDefinition(
    "5e236816-0c49-4b48-b18b-03add5a80d72"
);
const pentagramOfTheAges = getDefinition(
    "b8d889a5-f6c7-410d-97f9-acf08b9091c8"
);
const savannahLions = getDefinition("d05b92bd-797e-413f-a8b0-32e0937a1ee0");
const grayOgre = getDefinition("73ae5276-b607-4f23-a9d2-e8cc7b8e3693");
const lightningBolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");
const giantGrowth = getDefinition("367dbefe-3366-408e-9fcf-7dc00f8cc201");
const ornithopter = getDefinition("59cc9bdb-7cf2-4795-bac7-ffff605c9eb0");

const POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

/** p1 holds `protector` with `mana` floating; p2 holds `p2Battlefield`. */
function board(
    protector: CardDefinition,
    p2Battlefield: ReturnType<typeof makeInstance>[] = [],
    mana: Partial<typeof POOL> = { C: 4 }
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(protector.id, {
                        id: "protector",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                manaPool: { ...POOL, ...mana },
            }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
    });
}

function p2Permanent(cardId: string, id: string, staticAbilities?: string[]) {
    return makeInstance(cardId, {
        id,
        controllerId: "p2",
        ownerId: "p2",
        ...(staticAbilities ? { staticAbilities } : {}),
    });
}

/** Activates the protector's one ability and resolves it up to its source
 *  choice. */
function activate(state: GameState, protector: CardDefinition): void {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "protector",
        abilityId: protector.activatedAbilities![0]!.id,
    });
    resolveTopOfStack(state);
}

function submit(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0]!;
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

describe("pick-source — the CR 609.7a source pool (issue #5601)", () => {
    it("a red spell on the stack is a candidate; choosing it prevents its damage to you", () => {
        const state = board(circleOfProtectionRed, [
            p2Permanent(savannahLions.id, "white-src"),
        ]);
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        activate(state, circleOfProtectionRed);

        const head = state.pendingChoices![0]!;
        expect(head.kind).toBe("pick-source");
        expect(head.zone).toBe("battlefield-or-stack");
        expect(head.playerId).toBe("p1");
        // The spell is the only red object: the white creature and the
        // (white) Circle itself are not offered.
        expect(head.candidateIds).toEqual([bolt.id]);
        // The legal-action pool the Bot reads is the same set.
        expect(eligibleZonePickCards(state, head).map((c) => c.id)).toEqual([
            bolt.id,
        ]);

        submit(state, [bolt.id]);
        expect(state.preventionEffects).toEqual([
            {
                sourceInstanceId: bolt.id,
                playerId: "p1",
                duration: { phase: "end-of-turn" },
                match: { colors: ["R"] },
            },
        ]);
        // The Bolt resolves: CR 615.6 — prevented damage never happens, and
        // the shield is used up.
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
        expect(state.preventionEffects).toBeUndefined();
    });

    it("prevents only the NEXT damage event from the chosen permanent (combat damage too)", () => {
        const state = board(circleOfProtectionRed, [
            p2Permanent(grayOgre.id, "ogre"),
        ]);
        activate(state, circleOfProtectionRed);
        submit(state, ["ogre"]);
        attackUnblocked(state, "ogre");
        expect(state.players[0].life).toBe(20);
        expect(state.preventionEffects).toBeUndefined();
        // The shield is used up: the same source's next damage is dealt.
        attackUnblocked(state, "ogre");
        expect(state.players[0].life).toBe(18);
    });

    it("a chosen red creature turned green deals its damage; the unused shield waits for it to be red again (CR 609.7b)", () => {
        const state = board(circleOfProtectionRed, [
            p2Permanent(grayOgre.id, "ogre"),
        ]);
        activate(state, circleOfProtectionRed);
        submit(state, ["ogre"]);
        const ogre = state.players[1].battlefield.find((c) => c.id === "ogre")!;
        // A layer-5 colour SET (a lace): the Ogre is green, not red.
        ogre.colorOverride = ["G"];
        attackUnblocked(state, "ogre");
        expect(state.players[0].life).toBe(18);
        expect(state.preventionEffects).toHaveLength(1);
        // Red again: the shield, never used, prevents this damage.
        ogre.colorOverride = undefined;
        attackUnblocked(state, "ogre");
        expect(state.players[0].life).toBe(18);
        expect(state.preventionEffects).toBeUndefined();
    });

    it("a chosen red spell turned blue on the stack deals its damage (CR 609.7b)", () => {
        const state = board(circleOfProtectionRed);
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        activate(state, circleOfProtectionRed);
        submit(state, [bolt.id]);
        state.stack.find((s) => s.id === bolt.id)!.colorOverride = ["U"];
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17);
        expect(state.preventionEffects).toHaveLength(1);
    });

    it("prevents only damage to YOU — the chosen source's damage to your creature is dealt (CR 615.1a)", () => {
        const state = board(circleOfProtectionRed);
        state.players[0].battlefield.push(
            makeInstance(savannahLions.id, {
                id: "lions",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "lions" },
        ]);
        activate(state, circleOfProtectionRed);
        submit(state, [bolt.id]);
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        expect(state.players[0].battlefield.some((c) => c.id === "lions")).toBe(
            false
        );
        // Unused, so it stays until it expires (CR 609.7b).
        expect(state.preventionEffects).toHaveLength(1);
    });

    it("a red creature with shroud, or with protection from white, is still a legal choice — it is not a target (CR 115.1)", () => {
        const state = board(circleOfProtectionRed, [
            p2Permanent(grayOgre.id, "shrouded", ["shroud"]),
            p2Permanent(grayOgre.id, "pro-white", ["protection from white"]),
        ]);
        activate(state, circleOfProtectionRed);
        expect(state.pendingChoices![0]!.candidateIds).toEqual([
            "shrouded",
            "pro-white",
        ]);
        submit(state, ["shrouded"]);
        expect(state.preventionEffects?.[0]?.sourceInstanceId).toBe("shrouded");
    });

    it("spells lead the pool, topmost first; an ability on the stack is not a source", () => {
        const state = board(pentagramOfTheAges, [
            p2Permanent(grayOgre.id, "ogre"),
        ]);
        const first = pushSpell(state, giantGrowth.id, "p2");
        const second = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        activate(state, pentagramOfTheAges);
        const ids = state.pendingChoices![0]!.candidateIds!;
        expect(ids.slice(0, 3)).toEqual([second.id, first.id, "protector"]);
        expect(ids).toContain("ogre");
        // No player is ever a source.
        expect(ids).not.toContain("p1");
        expect(ids).not.toContain("p2");
    });

    it("the submit path refuses a non-candidate and an id outside the pool", () => {
        const state = board(circleOfProtectionRed, [
            p2Permanent(savannahLions.id, "white-src"),
        ]);
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        activate(state, circleOfProtectionRed);
        expect(() => submit(state, ["white-src"])).toThrow(
            "Card is not an eligible choice"
        );
        expect(() => submit(state, ["p2"])).toThrow(
            "Not a permanent or a spell on the stack"
        );
        expect(state.preventionEffects).toBeUndefined();
    });

    it("with no qualifying source the ability still resolves — no choice, no shield, nothing to fizzle", () => {
        const state = board(circleOfProtectionRed, [
            p2Permanent(savannahLions.id, "white-src"),
        ]);
        activate(state, circleOfProtectionRed);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
        expect(state.preventionEffects).toBeUndefined();
    });

    it("a chosen creature SPELL keeps its shield as the permanent it becomes (CR 609.7a)", () => {
        const state = board(circleOfProtectionRed);
        const ogreSpell = pushSpell(state, grayOgre.id, "p2");
        activate(state, circleOfProtectionRed);
        submit(state, [ogreSpell.id]);
        resolveTopOfStack(state); // the Ogre resolves onto the battlefield
        expect(
            state.players[1].battlefield.some((c) => c.id === ogreSpell.id)
        ).toBe(true);
        attackUnblocked(state, ogreSpell.id);
        expect(state.players[0].life).toBe(20);
    });

    it("the pending choice crosses the wire with its stack candidate (projectPublicState)", () => {
        const state = board(circleOfProtectionRed);
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        activate(state, circleOfProtectionRed);
        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0]!;
        expect(head.zone).toBe("battlefield-or-stack");
        expect(head.candidateIds).toEqual([bolt.id]);
        // The candidate is renderable: the client sees the spell on the stack.
        expect(projected.stack.some((s) => s.id === bolt.id)).toBe(true);
    });
});

// GRE → game.ts: the `submitResolutionChoice` handler's exact sequence, on a
// state that has crossed the persistence boundary between the raise and the
// answer (the choice is saved at a stable point and re-read by the mutation).
describe("pick-source through the submitResolutionChoice path", () => {
    it("a stack candidate survives the save, passes the expected-input gate and lands its shield", () => {
        const state = board(circleOfProtectionRed);
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        activate(state, circleOfProtectionRed);
        refreshExpectedInput(state);

        // Saved at the stable point, re-read by the mutation.
        const reread = expandState(
            JSON.parse(JSON.stringify(compactState(state)))
        );
        const head = reread.pendingChoices![0]!;
        expect(head.zone).toBe("battlefield-or-stack");
        expect(head.candidateIds).toEqual([bolt.id]);

        // Mirror `submitResolutionChoice`'s handler exactly.
        assertExpectedInput(reread, { playerId: "p1", expect: "choice" });
        applyPendingChoiceSubmit(reread, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [bolt.id],
        });
        checkStateBasedActions(reread);

        resolveTopOfStack(reread);
        expect(reread.players[0].life).toBe(20);
    });
});

describe("the Circle of Protection cycle — each Circle's qualifier on the pick", () => {
    const red = () => p2Permanent(grayOgre.id, "red");
    const white = () => p2Permanent(savannahLions.id, "white");
    const artifact = () => p2Permanent(ornithopter.id, "artifact");
    const cases: [CardDefinition, string[], { W?: number; C?: number }][] = [
        [circleOfProtectionRed, ["red"], { C: 1 }],
        [circleOfProtectionWhite, ["protector", "white"], { C: 1 }],
        [circleOfProtectionBlue, [], { C: 1 }],
        [circleOfProtectionBlack, [], { C: 1 }],
        [circleOfProtectionGreen, [], { C: 1 }],
        // "A black or red source": either colour qualifies.
        [greaterRealmOfPreservation, ["red"], { W: 1, C: 1 }],
        // An artifact source, by card type; {2} to activate.
        [circleOfProtectionArtifacts, ["artifact"], { C: 2 }],
        // No qualifier: every permanent.
        [
            pentagramOfTheAges,
            ["protector", "red", "white", "artifact"],
            { C: 4 },
        ],
    ];
    for (const [card, expected, mana] of cases) {
        it(`${card.name} offers ${expected.join(", ") || "nothing"}`, () => {
            const state = board(card, [red(), white(), artifact()], mana);
            activate(state, card);
            const offered = state.pendingChoices?.[0]?.candidateIds ?? [];
            expect(offered).toEqual(expected);
        });
    }
});

describe("the script's validator rules (issue #5601)", () => {
    const pick = (extra: Record<string, unknown> = {}): EffectOp =>
        ({
            op: "choice",
            kind: "pick-source",
            player: "controller",
            zone: "battlefield-or-stack",
            count: 1,
            prompt: "Choose a source.",
            bind: "$chosen",
            ...extra,
        }) as EffectOp;
    const shield = (extra: Record<string, unknown> = {}): EffectOp =>
        ({
            op: "preventDamage",
            mode: "next-from-source",
            source: { ref: "$chosen" },
            to: { player: "controller" },
            duration: { phase: "end-of-turn" },
            ...extra,
        }) as EffectOp;
    const errorsOf = (effects: EffectOp[]) =>
        validateEffectScript({ id: "probe", name: "Probe", effects });

    it("accepts the shipped script", () => {
        expect(errorsOf([pick({ filter: { color: "R" } }), shield()])).toEqual(
            []
        );
        expect(
            errorsOf([pick({ filter: { color: ["B", "R"] } }), shield()])
        ).toEqual([]);
        expect(
            errorsOf([pick({ filter: { type: "Artifact" } }), shield()])
        ).toEqual([]);
        // CR 609.7b — the qualifier the shield rechecks.
        expect(
            errorsOf([
                pick({ filter: { color: ["B", "R"] } }),
                shield({ match: { colors: ["B", "R"] } }),
            ])
        ).toEqual([]);
        expect(
            errorsOf([
                pick({ filter: { type: "Artifact" } }),
                shield({ match: { cardType: "Artifact" } }),
            ])
        ).toEqual([]);
    });

    it("refuses a recheck that is not a source match", () => {
        expect(
            errorsOf([pick(), shield({ match: { subtype: "Goblin" } })])
        ).not.toEqual([]);
        expect(
            errorsOf([pick(), shield({ match: { colors: [] } })])
        ).not.toEqual([]);
    });

    it("refuses the kind and the pool apart, a count past one, a battlefield-pool narrowing and an unread filter key", () => {
        expect(errorsOf([pick({ zone: "battlefield" }), shield()])).not.toEqual(
            []
        );
        expect(
            errorsOf([
                pick({
                    kind: "choose-permanents",
                    zone: "battlefield-or-stack",
                }),
                shield(),
            ])
        ).not.toEqual([]);
        expect(errorsOf([pick({ count: 2 }), shield()])).not.toEqual([]);
        expect(
            errorsOf([pick({ allControllers: true }), shield()])
        ).not.toEqual([]);
        expect(
            errorsOf([pick({ filter: { subtype: "Goblin" } }), shield()])
        ).not.toEqual([]);
    });

    it("refuses a shield whose source is not a picks binding or whose recipient is not a player", () => {
        expect(
            errorsOf([pick(), shield({ source: { target: 0 } })])
        ).not.toEqual([]);
        expect(
            errorsOf([pick(), shield({ to: { ref: "$source" } })])
        ).not.toEqual([]);
        const noDuration = { ...shield() } as Record<string, unknown>;
        delete noDuration.duration;
        expect(errorsOf([pick(), noDuration as EffectOp])).not.toEqual([]);
    });
});

/** p2's `attackerId` attacks p1 unblocked and combat damage is dealt — the
 *  real combat-damage path (CR 510.2), whose source is the permanent. */
function attackUnblocked(state: GameState, attackerId: string): void {
    const attacker = state.players[1].battlefield.find(
        (c) => c.id === attackerId
    )!;
    attacker.isAttacking = true;
    attacker.isSummoningSick = false;
    state.activePlayerId = "p2";
    state.phase = "COMBAT_DAMAGE";
    state.combat = {
        attackerIds: [attackerId],
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: true,
    };
    applyAllCombatDamage(state, {});
}
