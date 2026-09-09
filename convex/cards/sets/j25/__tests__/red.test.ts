// J25 (Foundations Jumpstart) — red card behavior tests (ADR 0043 colour
// split). Ivora, Insatiable Heir's Blood line is ONE `TriggeredAbility` over
// TWO engine events (CR 603.2), so its `matches` is hand-written logic no
// static sweep can reach: the tests below drive both firings and each of the
// three ways the damage half must NOT fire.

import { describe, it, expect } from "vitest";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { projectPublicState } from "../../../../gameProjections";
import { getEffectivePower } from "../../../../gre/layers";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getDefinition } from "../../../index";

const ivora = getDefinition("2ba70366-b6ae-423a-a8d8-29d2b8afd939");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

function setup() {
    const heir = makeInstance(ivora.id, {
        id: "ivora-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [heir] }),
            makePlayer("p2", { battlefield: [bear] }),
        ],
    });
    return { state };
}

/** The PERMANENT_ENTERED event Ivora's own ETB emits (CR 603.6a). */
function entered(instanceId: string) {
    return {
        type: "PERMANENT_ENTERED" as const,
        instanceId,
        controllerId: "p1",
        cardId: ivora.id,
        types: ["Creature"] as const,
    };
}

/** A DAMAGE_DEALT event (CR 120.3), parameterised on the three axes Ivora's
 *  `matches` discriminates: who dealt it, whether it was combat damage
 *  (CR 510), and what it was dealt to. */
function damage(opts: {
    sourceInstanceId: string;
    isCombat: boolean;
    target: { type: "player"; id: string } | { type: "permanent"; id: string };
}) {
    return {
        type: "DAMAGE_DEALT" as const,
        sourceInstanceId: opts.sourceInstanceId,
        sourceControllerId: "p1",
        target: opts.target,
        amount: 1,
        isCombat: opts.isCombat,
    };
}

function discarded(playerId: string) {
    return {
        type: "CARD_DISCARDED" as const,
        playerId,
        cardInstanceId: "some-card",
    };
}

/** The Blood tokens on p1's battlefield, read off the live state. */
function bloods(state: ReturnType<typeof setup>["state"]) {
    return state.players[0].battlefield.filter(
        (c) => c.isToken && c.subtypes?.includes("Blood")
    );
}

describe("Ivora, Insatiable Heir (CR 603.2 multi-event trigger, 510 combat damage, 111.1 token — issue #3228)", () => {
    it("ETB: the Blood half fires on Ivora's own entry and creates a real Blood token", () => {
        const { state } = setup();
        const triggers = collectTriggers(state, [entered("ivora-1")]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        resolveTopOfStack(state);

        const blood = bloods(state);
        expect(blood).toHaveLength(1);
        // The shared BLOOD_TOKEN_SPEC, not an inert placeholder: its real
        // activated ability came along (CR 707.2).
        const bloodDef = getDefinition((blood[0].card as { id: string }).id);
        expect(bloodDef.activatedAbilities?.[0]?.id).toBe(
            "sacrifice-discard-draw"
        );
    });

    it("ETB: another permanent entering does NOT fire it (CR 109.2 self scope)", () => {
        const { state } = setup();
        expect(collectTriggers(state, [entered("someone-else")])).toHaveLength(
            0
        );
    });

    it("combat damage to a player: the SAME ability fires again (CR 603.2 — one line, two events)", () => {
        const { state } = setup();
        const triggers = collectTriggers(state, [
            damage({
                sourceInstanceId: "ivora-1",
                isCombat: true,
                target: { type: "player", id: "p2" },
            }),
        ]);
        expect(triggers).toHaveLength(1);
        // One ability, not two entries: the ETB and the combat-damage firing
        // are the same `id` on the stack.
        expect(triggers[0].triggeredAbilityId).toBe("ivora-blood");
        state.stack.push(...triggers);
        resolveTopOfStack(state);
        expect(bloods(state)).toHaveLength(1);
    });

    it("combat damage to a CREATURE makes no Blood (CR 120.3 — 'to a player')", () => {
        const { state } = setup();
        expect(
            collectTriggers(state, [
                damage({
                    sourceInstanceId: "ivora-1",
                    isCombat: true,
                    target: { type: "permanent", id: "bear" },
                }),
            ])
        ).toHaveLength(0);
    });

    it("NON-combat damage to a player makes no Blood (CR 510 — combat damage only)", () => {
        const { state } = setup();
        expect(
            collectTriggers(state, [
                damage({
                    sourceInstanceId: "ivora-1",
                    isCombat: false,
                    target: { type: "player", id: "p2" },
                }),
            ])
        ).toHaveLength(0);
    });

    it("another creature's combat damage makes no Blood (CR 120.3 — source scope)", () => {
        const { state } = setup();
        expect(
            collectTriggers(state, [
                damage({
                    sourceInstanceId: "bear",
                    isCombat: true,
                    target: { type: "player", id: "p2" },
                }),
            ])
        ).toHaveLength(0);
    });

    it("your discard puts a +1/+1 counter on Ivora (CR 122.1a); an opponent's does not", () => {
        const { state } = setup();
        expect(collectTriggers(state, [discarded("p2")])).toHaveLength(0);

        const triggers = collectTriggers(state, [discarded("p1")]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        resolveTopOfStack(state);

        const live = state.players[0].battlefield.find(
            (c) => c.id === "ivora-1"
        )!;
        expect(live.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, live)).toBe(2);
    });

    it("wire format: the Blood token and the +1/+1 counter survive projectPublicState", () => {
        const { state } = setup();
        state.stack.push(...collectTriggers(state, [entered("ivora-1")]));
        resolveTopOfStack(state);
        state.stack.push(...collectTriggers(state, [discarded("p1")]));
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const blood = projected.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes?.includes("Blood")
        );
        expect(blood).toBeDefined();
        const heir = projected.players[0].battlefield.find(
            (c) => c.id === "ivora-1"
        )!;
        expect(heir.counters?.["+1/+1"]).toBe(1);
    });
});
