// Scars of Mirrodin (SOM) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { applyPlayLand } from "../../../../gre/playLand";
import {
    createTokenPermanents,
    getPlayer,
    resolveTopOfStack,
    type GameState,
} from "../../../../gre/state";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../../gre/triggers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { getEffectivePower } from "../../../../gre/layers";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import type { GameEvent, TriggerStateView } from "../../../types";
import { getCardByName, getDefinition } from "../../../index";

const copperlineGorge = getDefinition("28f1d784-f286-418d-a712-bc07ad10d4a2");
const moxOpal = getDefinition("6be9b1d5-9ab8-4adb-ba54-2c0117e842fa");
const island = getDefinition("90a57c0e-fa61-45ef-955d-d296403967d5");

// The SOM "fast land" cycle — "This land enters tapped unless you control
// two or fewer other lands." (CR 614.1c self-conditional replacement via the
// NEW `entersTappedUnless` field, issue #675.)
describe("Copperline Gorge (fast land, CR 614.1c / 605.1a)", () => {
    it("enters UNTAPPED with two or fewer other lands", () => {
        const otherLands = [
            makeInstance(island.id, { id: "l1" }),
            makeInstance(island.id, { id: "l2" }),
        ];
        const gorge = makeInstance(copperlineGorge.id, {
            id: "gorge",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: otherLands, hand: [gorge] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        const played = applyPlayLand(state, player, "gorge")!;
        expect(played.isTapped).toBe(false);
    });

    it("enters TAPPED with three or more other lands", () => {
        const otherLands = [
            makeInstance(island.id, { id: "l1" }),
            makeInstance(island.id, { id: "l2" }),
            makeInstance(island.id, { id: "l3" }),
        ];
        const gorge = makeInstance(copperlineGorge.id, {
            id: "gorge",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: otherLands, hand: [gorge] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        const played = applyPlayLand(state, player, "gorge")!;
        expect(played.isTapped).toBe(true);
    });
});

// Mox Opal (issue #1530, parent PRD #1525). "Metalcraft — {T}: Add one mana
// of any color. Activate only if you control three or more artifacts." A
// PREVIOUSLY-STUBBED card (som/#675-era) whose stub comment claimed the
// board-state `canActivate` gate was never consulted on the tap-mana fast
// path — stale: issue #947 (Chrome Mox's un-imprinted-mox fix) already wired
// `canActivate` into every real tap-mana consumer. Same shape as Chrome Mox
// (`canActivate` availability gate + static `manaChoices`), just gated by
// the shared `hasMetalcraft` board scan instead of a per-instance imprint
// counter.
describe("Mox Opal (SOM #179, issue #1530, Metalcraft)", () => {
    function boardWithArtifacts(count: number, opponentArtifacts = 0) {
        const mox = makeInstance(moxOpal.id, {
            id: "mox",
            controllerId: "p1",
            ownerId: "p1",
        });
        const otherArtifacts = Array.from({ length: count - 1 }, (_, i) =>
            makeInstance(moxOpal.id, {
                id: `art${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const oppArtifacts = Array.from({ length: opponentArtifacts }, (_, i) =>
            makeInstance(moxOpal.id, {
                id: `opp-art${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mox, ...otherArtifacts] }),
                makePlayer("p2", { battlefield: oppArtifacts }),
            ],
        });
        return { state, mox: state.players[0].battlefield[0] };
    }

    it("canActivate is false with only Mox Opal itself on the battlefield (1 artifact)", () => {
        const { state, mox } = boardWithArtifacts(1);
        const ability = moxOpal.activatedAbilities![0];
        expect(ability.canActivate!(mox, state as TriggerStateView)).toBe(
            false
        );
    });

    it("canActivate is false with exactly 2 artifacts controlled", () => {
        const { state, mox } = boardWithArtifacts(2);
        const ability = moxOpal.activatedAbilities![0];
        expect(ability.canActivate!(mox, state as TriggerStateView)).toBe(
            false
        );
    });

    it("canActivate is true with 3 artifacts controlled (Mox Opal counts toward its own threshold)", () => {
        const { state, mox } = boardWithArtifacts(3);
        const ability = moxOpal.activatedAbilities![0];
        expect(ability.canActivate!(mox, state as TriggerStateView)).toBe(true);
    });

    it("only counts artifacts the SAME controller controls — an opponent's artifacts don't count", () => {
        const { state, mox } = boardWithArtifacts(1, 5);
        const ability = moxOpal.activatedAbilities![0];
        expect(ability.canActivate!(mox, state as TriggerStateView)).toBe(
            false
        );
    });

    it("taps for the chosen colour once Metalcraft is active", () => {
        const { state } = boardWithArtifacts(3);
        const player = getPlayer(state, "p1");
        const mox = player.battlefield.find((c) => c.id === "mox")!;
        tapSourceIntoPayment(state, player, mox, 2, []); // index 2 → B
        expect(player.manaPool.B).toBe(1);
    });

    it("the Metalcraft gate survives projection (wire format)", () => {
        const { state } = boardWithArtifacts(3);
        const projected = projectPublicState(state, 1, "p1");
        const slimMox = projected.players[0].battlefield.find(
            (c) => c.id === "mox"
        )!;
        const ability = moxOpal.activatedAbilities![0];
        expect(
            ability.canActivate!(slimMox, projected as TriggerStateView)
        ).toBe(true);
    });

    it("the Metalcraft gate correctly reads OFF below 3 artifacts through projection too", () => {
        const { state } = boardWithArtifacts(2);
        const projected = projectPublicState(state, 1, "p1");
        const slimMox = projected.players[0].battlefield.find(
            (c) => c.id === "mox"
        )!;
        const ability = moxOpal.activatedAbilities![0];
        expect(
            ability.canActivate!(slimMox, projected as TriggerStateView)
        ).toBe(false);
    });
});

// Myr Battlesphere (issue #3244) — the card end to end, through the real
// trigger collector, the choice submit and the wire projection. The grammar it
// rides (`setSize`, `attackTargetOf`, `filter.tapped`) has its own permanent
// tests in `gre/effects/__tests__/attackTargetSetSize.test.ts`.
describe("Myr Battlesphere (CR 111.1 / 508.1m / 118.12 / 506.2)", () => {
    const battlesphere = getDefinition("b0ae94ed-7314-470b-baba-f2f58bbc894a");

    function myrTokensOf(state: GameState, playerId: string) {
        return getPlayer(state, playerId).battlefield.filter(
            (c) => c.isToken && c.subtypes.includes("Myr")
        );
    }

    it("ETB creates four 1/1 colorless Myr artifact creature tokens with printed art", () => {
        const sphere = makeInstance(battlesphere.id, { id: "sphere" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sphere] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "sphere",
                controllerId: "p1",
            } as GameEvent,
        ]);
        expect(triggers).toHaveLength(1);
        placeTriggersOnStack(state, triggers);
        resolveTopOfStack(state);
        const myr = myrTokensOf(state, "p1");
        expect(myr).toHaveLength(4);
        for (const token of myr) {
            expect(token.types).toEqual(["Artifact", "Creature"]);
            expect([token.power, token.toughness]).toEqual([1, 1]);
            expect(getDefinition(token.card.id).imagePrintId).toBeDefined();
        }
    });

    it("attacking a planeswalker: tap X Myr, +X/+0 visible on the wire, X loyalty removed", () => {
        const sphere = makeInstance(battlesphere.id, {
            id: "sphere",
            isTapped: true,
            isAttacking: true,
        });
        const walker = getCardByName("Karn, Scion of Urza")!;
        const state = makeState({
            phase: "DECLARE_ATTACKERS" as GameState["phase"],
            players: [
                makePlayer("p1", { battlefield: [sphere] }),
                makePlayer("p2"),
            ],
        });
        createTokenPermanents(
            state,
            {
                name: "Myr",
                types: ["Artifact", "Creature"],
                subtypes: ["Myr"],
                power: 1,
                toughness: 1,
            },
            "p1",
            3
        );
        state.players[1].battlefield.push(
            makeInstance(walker.id, {
                id: "karn",
                controllerId: "p2",
                ownerId: "p2",
                counters: { loyalty: 5 },
            })
        );
        state.combat = {
            attackerIds: ["sphere"],
            attackTargets: { sphere: "karn" },
            confirmed: true,
            blockerAssignments: {},
        };
        const triggers = collectTriggers(state, [
            {
                type: "ATTACKERS_DECLARED",
                attackingPlayerId: "p1",
                attackerIds: ["sphere"],
            } as GameEvent,
        ]);
        expect(triggers).toHaveLength(1);
        placeTriggersOnStack(state, triggers);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        const myrIds = myrTokensOf(state, "p1").map((c) => c.id);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: myrIds.slice(0, 2),
        });
        expect(myrTokensOf(state, "p1").filter((c) => c.isTapped)).toHaveLength(
            2
        );
        const live = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "sphere"
        )!;
        expect(getEffectivePower(state, live)).toBe(6);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "sphere"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(6);
        const karn = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "karn"
        )!;
        expect(karn.counters?.loyalty).toBe(3);
        expect(getPlayer(state, "p2").life).toBe(20);
    });
});
