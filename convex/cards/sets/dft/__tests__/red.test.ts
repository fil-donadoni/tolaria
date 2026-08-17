// DFT (Aetherdrift) — red: Marauding Mako (issue #689). {R} 1/1 Shark Pirate:
// "Whenever you discard one or more cards, put that many +1/+1 counters on this
// creature." plus Cycling {1} (CR 702.29). Cycling itself is exercised in
// convex/gre/__tests__/cycling.test.ts; this covers the CR 701.9 discard
// trigger and its interaction with cycling another card.

import { describe, it, expect } from "vitest";
import { maraudingMako } from "../red";
import { raugrinTriome } from "../../iko/colorless";
import { grizzlyBears } from "../../lea";
import {
    discardCardsAtRandom,
    normalizeManaCost,
    resolveTopOfStack,
} from "../../../../gre/state";
import { getEffectivePower } from "../../../../gre/layers";
import { collectTriggers } from "../../../../gre/triggers";
import {
    buildPendingActivation,
    tryAutoCommitPendingActivation,
} from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

const DISCARD_TRIGGER = "marauding-mako-discard";

describe("Marauding Mako (CR 701.9 discard trigger, CR 702.29 Cycling)", () => {
    it("puts a +1/+1 counter on itself when you discard a card", () => {
        const mako = makeInstance(maraudingMako.id, {
            id: "mako",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const filler = makeInstance(grizzlyBears.id, {
            id: "filler",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mako], hand: [filler] }),
                makePlayer("p2"),
            ],
        });

        // CR 701.9 — discard a card (routes through the shared choke point).
        discardCardsAtRandom(state, "p1", 1);
        const triggers = collectTriggers(state, state.pendingEvents ?? []);
        const trig = triggers.find(
            (t) => t.triggeredAbilityId === DISCARD_TRIGGER
        );
        expect(trig).toBeDefined();

        state.stack.push(trig!);
        resolveTopOfStack(state);

        const grown = state.players[0].battlefield.find(
            (c) => c.id === "mako"
        )!;
        expect(grown.counters?.["+1/+1"]).toBe(1);
        // CR 613 — the +1/+1 counter makes it a 2/2.
        expect(getEffectivePower(state, grown)).toBe(2);

        // Wire format: the counter survives projectPublicState.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "mako"
        )!;
        expect(slim.counters?.["+1/+1"]).toBe(1);
    });

    it("grows when you cycle ANOTHER card while it is on the battlefield", () => {
        const mako = makeInstance(maraudingMako.id, {
            id: "mako",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const triome = makeInstance(raugrinTriome.id, {
            id: "triome",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [mako],
                    hand: [triome],
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "draw",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 },
                }),
                makePlayer("p2"),
            ],
        });

        // Cycle the Triome ({3}, discard it → draw). The discard triggers Mako.
        const cycling = raugrinTriome.activatedAbilities!.find(
            (a) => a.id === "cycling"
        )!;
        state.pendingActivation = buildPendingActivation({
            playerId: "p1",
            cardInstanceId: "triome",
            abilityId: "cycling",
            ability: cycling,
            manaCost: normalizeManaCost(cycling.cost.mana!),
            fromHand: true,
        });
        tryAutoCommitPendingActivation(state, "p1");

        // CR 603.3 — the cycling discard queued a CARD_DISCARDED event which the
        // commit's trigger flush (processPendingActionTriggers) put on the stack
        // above the cycling draw ability. Resolve the whole stack.
        expect(
            state.stack.some((s) => s.triggeredAbilityId === DISCARD_TRIGGER)
        ).toBe(true);
        while (state.stack.length > 0) resolveTopOfStack(state);

        const grown = state.players[0].battlefield.find(
            (c) => c.id === "mako"
        )!;
        expect(grown.counters?.["+1/+1"]).toBe(1);
        // The cycling draw also resolved: the library card is in hand, the
        // Triome is in the graveyard.
        expect(state.players[0].hand.some((c) => c.id === "draw")).toBe(true);
        expect(state.players[0].graveyard.some((c) => c.id === "triome")).toBe(
            true
        );
    });
});
