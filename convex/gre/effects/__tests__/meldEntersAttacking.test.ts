// CR 508.4 / 506.3a / 506.3b (issue #8478) — the `meld` Op's optional
// `entersTapped` / `entersAttacking`: a printed "It enters tapped and attacking".
// A test-only meld pair whose combined back face is a creature, registered through
// the real ADR 0120 §2 seam, its ability fired by the real attack-trigger scan and
// resolved by the real interpreter; the choice answered through the real submit
// path, the outcome read through the real projection.

import { describe, expect, it } from "vitest";
import { getCardByName, preloadDefinitions } from "../../../cards";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../../gameProjections";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { compactState, expandState } from "../../serialize";
import {
    meldPermanents,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../state";
import { validateEffectScript } from "../validate";

const PARTNER_NAME = "Test Attacking Meld Partner";
const creatureBack = {
    kind: "meld" as const,
    name: "Test Attacking Melded Creature",
    types: ["Creature" as const],
    subtypes: ["Phyrexian"],
    power: 9,
    toughness: 9,
    colors: ["B" as const, "R" as const],
    imagePrintId: "test-attacking-melded-print",
};
const walkerBack = {
    kind: "meld" as const,
    name: "Test Attacking Melded Walker",
    types: ["Planeswalker" as const],
    loyalty: 7,
    colors: ["B" as const, "R" as const],
    imagePrintId: "test-attacking-melded-walker-print",
};

const TAPPED_AND_ATTACKING = { entersTapped: true, entersAttacking: true };

function holderDefinition(
    id: string,
    backFace: typeof creatureBack | typeof walkerBack,
    partnerName: string,
    flags: Partial<Extract<EffectOp, { op: "meld" }>>
) {
    return {
        id,
        name: id,
        rarity: "mythic",
        manaCost: { X: 2, B: 1, R: 1 },
        types: ["Creature"],
        power: 3,
        toughness: 5,
        backFace,
        triggeredAbilities: [
            {
                id: `${id}-meld`,
                oracleText: "Whenever you attack, meld.",
                event: "ATTACKERS_DECLARED",
                matches: (
                    event: { type: string; attackingPlayerId?: string },
                    self: { controllerId: string }
                ) =>
                    event.type === "ATTACKERS_DECLARED" &&
                    event.attackingPlayerId === self.controllerId,
                effects: [
                    {
                        op: "meld",
                        partner: { type: "Creature", name: partnerName },
                        ...flags,
                    },
                ],
            },
        ],
    };
}

function partnerDefinition(
    id: string,
    backFace: typeof creatureBack | typeof walkerBack
) {
    return {
        id,
        name: id === "test-8478-partner" ? PARTNER_NAME : id,
        rarity: "rare",
        manaCost: { X: 3 },
        types: ["Artifact", "Creature"],
        power: 3,
        toughness: 3,
        backFace,
    };
}

preloadDefinitions([
    holderDefinition(
        "test-8478-holder",
        creatureBack,
        PARTNER_NAME,
        TAPPED_AND_ATTACKING
    ),
    holderDefinition("test-8478-plain", creatureBack, PARTNER_NAME, {}),
    partnerDefinition("test-8478-partner", creatureBack),
    holderDefinition(
        "test-8478-walker-holder",
        walkerBack,
        "test-8478-walker-partner",
        TAPPED_AND_ATTACKING
    ),
    partnerDefinition("test-8478-walker-partner", walkerBack),
] as unknown as CardDefinition[]);

function attacker(defId: string, id: string): CardInstanceState {
    const card = makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
    });
    card.isAttacking = true;
    return card;
}

function walker(id: string): CardInstanceState {
    return makeInstance(getCardByName("Wrenn and Six").id, {
        id,
        controllerId: "p2",
        ownerId: "p2",
        counters: { loyalty: 3 },
    });
}

/** p1 attacks with the pair; the "whenever you attack" ability is on the stack. */
function attackWith(
    holderDefId: string,
    partners: CardInstanceState[],
    p2Battlefield: CardInstanceState[] = []
): GameState {
    const attackers = [attacker(holderDefId, "holder"), ...partners];
    const state = makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: attackers }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
        combat: {
            attackerIds: attackers.map((c) => c.id),
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    state.pendingEvents = [
        {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: attackers.map((c) => c.id),
        } as never,
    ];
    processPendingActionTriggers(state);
    expect(state.stack).toHaveLength(1);
    return state;
}

function partner(id = "partner"): CardInstanceState {
    return attacker("test-8478-partner", id);
}

function answer(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

function melded(state: GameState): CardInstanceState {
    return state.players[0].battlefield.find((c) => c.id === "holder")!;
}

describe("meld: entersTapped / entersAttacking (CR 508.4)", () => {
    it("no planeswalker: no prompt, the melded permanent joins the current combat tapped and attacking the defending player", () => {
        const state = attackWith("test-8478-holder", [partner()]);
        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.stack).toEqual([]);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "holder",
        ]);
        expect(melded(state).meldedFrom).toHaveLength(2);
        expect(melded(state).isTapped).toBe(true);
        expect(melded(state).isAttacking).toBe(true);
        expect(state.combat!.attackerIds).toContain("holder");
        // The defending player is the ABSENT entry.
        expect(state.combat!.attackTargets?.holder).toBeUndefined();
    });

    it('CR 508.4 — it is "attacking" but never "attacked": no attack event, not recorded as declared', () => {
        const state = attackWith("test-8478-holder", [partner()]);
        resolveTopOfStack(state);

        expect(melded(state).hasAttackedThisTurn).toBeFalsy();
        expect(
            (state.pendingEvents ?? []).filter(
                (e) => e.type === "ATTACKERS_DECLARED"
            )
        ).toEqual([]);
    });

    it("omitted flags: it enters untapped and not attacking, mid-combat", () => {
        const state = attackWith("test-8478-plain", [partner()]);
        resolveTopOfStack(state);

        expect(melded(state).meldedFrom).toHaveLength(2);
        expect(melded(state).isTapped).toBeFalsy();
        expect(melded(state).isAttacking).toBeFalsy();
        expect(state.combat!.attackerIds).not.toContain("holder");
    });

    it("a planeswalker: its controller chooses as it enters, and it is off every zone until they answer", () => {
        const state = attackWith(
            "test-8478-holder",
            [partner()],
            [walker("pw-1")]
        );
        resolveTopOfStack(state);

        expect(state.players[0].battlefield).toEqual([]);
        expect(state.players[0].exile).toEqual([]);
        expect(state.stagedEntries).toHaveLength(1);
        // The resolution waits on the answer.
        expect(state.stack).toHaveLength(1);
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.pendingChoices?.[0]?.options?.map((o) => o.id)
        ).toEqual(["p2", "pw-1"]);
    });

    it("SURFACE: answering the planeswalker, the projection ships it tapped and attacking that planeswalker", () => {
        const state = attackWith(
            "test-8478-holder",
            [partner()],
            [walker("pw-1")]
        );
        resolveTopOfStack(state);
        answer(state, ["pw-1"]);

        expect(state.stack).toEqual([]);
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.stagedEntries).toBeUndefined();
        // The stamp is consumed by the entry, never left on the permanent.
        expect(melded(state).enterAttackingTarget).toBeUndefined();

        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "holder"
        )!;
        expect(slim.isTapped).toBe(true);
        expect(slim.isAttacking).toBe(true);
        expect(projected.combat!.attackerIds).toContain("holder");
        expect(projected.combat!.attackTargets?.holder).toBe("pw-1");
    });

    it("the flags ride the park across a save: the entry is still tapped and attacking when answered after a round trip", () => {
        const parked = attackWith(
            "test-8478-holder",
            [partner()],
            [walker("pw-1")]
        );
        resolveTopOfStack(parked);
        const state = expandState(compactState(parked));
        answer(state, ["p2"]);

        expect(melded(state).isTapped).toBe(true);
        expect(melded(state).isAttacking).toBe(true);
        expect(state.combat!.attackTargets?.holder).toBeUndefined();
    });

    it("ADR 0100 D5 — the resumed Op does not meld again with a second counterpart on the board", () => {
        const state = attackWith(
            "test-8478-holder",
            [partner("partner-1"), partner("partner-2")],
            [walker("pw-1")]
        );
        resolveTopOfStack(state);
        answer(state, ["partner-2"]);
        expect(state.stagedEntries).toHaveLength(1);
        answer(state, ["p2"]);

        expect(state.stack).toEqual([]);
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.players[0].exile).toEqual([]);
        expect(state.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "holder",
            "partner-1",
        ]);
        expect(melded(state).meldedFrom?.map((c) => c.instanceId)).toEqual([
            "holder",
            "partner-2",
        ]);
    });

    it("CR 400.7 — the holder attacked a planeswalker, the melded permanent is a new object: it attacks what its controller chooses", () => {
        const state = attackWith(
            "test-8478-holder",
            [partner()],
            [walker("pw-1")]
        );
        state.combat!.attackTargets = { holder: "pw-1" };
        resolveTopOfStack(state);
        answer(state, ["p2"]);

        expect(melded(state).isAttacking).toBe(true);
        expect(state.combat!.attackTargets?.holder).toBeUndefined();
    });

    it("CR 506.3a — a noncreature melded permanent enters tapped, never attacking, and owes no choice", () => {
        const state = attackWith(
            "test-8478-walker-holder",
            [attacker("test-8478-walker-partner", "partner")],
            [walker("pw-1")]
        );
        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toEqual([]);
        expect(melded(state).types).toEqual(["Planeswalker"]);
        expect(melded(state).isTapped).toBe(true);
        expect(melded(state).isAttacking).toBeFalsy();
        expect(state.combat!.attackerIds).not.toContain("holder");
    });

    it("CR 506.3b — under a player who is not attacking it enters tapped, never attacking, and owes no choice", () => {
        const state = attackWith(
            "test-8478-holder",
            [partner()],
            [walker("pw-1")]
        );
        state.activePlayerId = "p2";
        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toEqual([]);
        expect(melded(state).isTapped).toBe(true);
        expect(melded(state).isAttacking).toBeFalsy();
        expect(state.combat!.attackerIds).not.toContain("holder");
    });

    it("no combat to join: it enters tapped and not attacking", () => {
        const state = attackWith("test-8478-holder", [partner()]);
        state.combat = undefined as never;
        resolveTopOfStack(state);

        expect(melded(state).isTapped).toBe(true);
        expect(melded(state).isAttacking).toBeFalsy();
    });

    it("the primitive answers with the melded permanent once it is on the battlefield, and with nothing while it is parked", () => {
        const flags = { entersAttacking: true };
        const entered = attackWith("test-8478-holder", [partner()]);
        expect(
            meldPermanents(entered, "holder", "partner", "p1", flags)?.id
        ).toBe("holder");

        const parked = attackWith(
            "test-8478-holder",
            [partner()],
            [walker("pw-1")]
        );
        expect(
            meldPermanents(parked, "holder", "partner", "p1", flags)
        ).toBeNull();
        expect(parked.stagedEntries).toHaveLength(1);
    });

    it("the validator admits the flags as booleans and refuses anything else", () => {
        const script = (entersAttacking: unknown) =>
            validateEffectScript({
                effects: [
                    {
                        op: "meld",
                        partner: { type: "Creature", name: PARTNER_NAME },
                        entersTapped: true,
                        entersAttacking,
                    },
                ],
            } as never);
        expect(script(true)).toEqual([]);
        expect(script("yes").join()).toMatch(/entersAttacking/);
    });
});
