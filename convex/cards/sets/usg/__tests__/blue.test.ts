// USG — blue card behavior tests (ADR 0043 per-colour split).
//
// Annul reuses the already-exercised `counter` Op and the existing
// `spellTypeFilter` target filter, so the per-Op regime (§ DSL-first
// authoring) covers it catalogue-wide (validateEffectScript + the
// auto-generated smoke test). The issue nonetheless mandates a hand-written
// assertion that the artifact-OR-enchantment spell-type restriction is
// exhaustive over the spell-type union: legal against artifact / enchantment
// spells, illegal against creature / instant spells and abilities.

import { describe, it, expect } from "vitest";
import { annul, showAndTell, timeSpiral } from "..";
import {
    blackLotus,
    crusade,
    forest,
    grizzlyBears,
    lightningBolt,
    mountain,
} from "../../lea";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    makeInstance,
    makeState,
    makePlayer,
    pushSpell,
} from "../../../__tests__/setup";

describe("Annul ({U}: counter target artifact or enchantment spell, CR 701.6a / 114.1)", () => {
    it("legal targets are exactly the artifact and enchantment spells on the stack", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const artifactSpell = pushSpell(state, blackLotus.id, "p2"); // Artifact
        const enchantmentSpell = pushSpell(state, crusade.id, "p2"); // Enchantment
        pushSpell(state, grizzlyBears.id, "p2"); // Creature — not legal
        pushSpell(state, lightningBolt.id, "p2"); // Instant — not legal

        const legal = getLegalTargets(
            state,
            annul.targetRequirement!,
            NO_TARGETING_SOURCE
        );
        expect(legal.map((t) => t.id).sort()).toEqual(
            [artifactSpell.id, enchantmentSpell.id].sort()
        );
    });

    it("a creature spell is not a legal target", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, grizzlyBears.id, "p2");
        expect(
            getLegalTargets(
                state,
                annul.targetRequirement!,
                NO_TARGETING_SOURCE
            )
        ).toHaveLength(0);
    });

    it("an instant spell is not a legal target", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, lightningBolt.id, "p2");
        expect(
            getLegalTargets(
                state,
                annul.targetRequirement!,
                NO_TARGETING_SOURCE
            )
        ).toHaveLength(0);
    });

    it("resolving Annul counters the targeted artifact spell (CR 701.6a)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const artifactSpell = pushSpell(state, blackLotus.id, "p2"); // Artifact
        // Annul cast by p1 targeting the artifact spell, on top of the stack.
        pushSpell(state, annul.id, "p1", [
            { type: "spell", id: artifactSpell.id },
        ]);

        resolveTopOfStack(state);

        // The countered artifact spell left the stack for its owner's graveyard
        // (CR 701.6a) and never resolved onto the battlefield.
        expect(
            state.stack.find((i) => i.id === artifactSpell.id)
        ).toBeUndefined();
        const p2 = state.players.find((p) => p.id === "p2")!;
        expect(p2.graveyard.some((c) => c.card.id === blackLotus.id)).toBe(
            true
        );
        expect(p2.battlefield.some((c) => c.card.id === blackLotus.id)).toBe(
            false
        );
    });
});

// Show and Tell — flagged by the DSL smoke sweep as an explicit skip
// ("construct 'forEach' iterates a runtime-selected set — covered by the
// card's own tests"): per-Op regime, an explicit skip is the signal to add a
// hand-written test for the card's OWN wiring (each player gets an
// independent may-put decision, in APNAP order).
describe("Show and Tell ({2}{U}: each player may put an artifact/creature/enchantment/land card from hand onto the battlefield, CR 101.4 / 400.7)", () => {
    it("p1 puts a creature, p2 declines — independent per-player choices in APNAP order", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "p1-bears",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const land = makeInstance(mountain.id, {
            id: "p2-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { hand: [bears] }),
                makePlayer("p2", { hand: [land] }),
            ],
        });
        pushSpell(state, showAndTell.id, "p1");
        resolveTopOfStack(state);

        // p1 (active player, APNAP first) is asked first — put the bears.
        let head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        expect(head.playerId).toBe("p1");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p1-bears"],
        });
        expect(
            state.players[0].battlefield.some((c) => c.id === "p1-bears")
        ).toBe(true);
        expect(state.players[0].hand).toHaveLength(0);

        // p2 declines (0 picks — a legal "may" decline, CR 608.2b).
        head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        expect(head.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["p2-mountain"]);
        expect(
            state.players[1].battlefield.some((c) => c.id === "p2-mountain")
        ).toBe(false);

        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});

// Time Spiral — NOT DSL-migratable (ADR 0045): the Timetwister-shape shuffle
// clause is the SAME already-tracked bulk whole-zone-move gap Timetwister
// itself is blocked on (lea/__tests__/blue.test.ts covers Timetwister;
// tracked-by: #1727). `resolveSteps` (not a bare `resolve`) because the
// seven-card draws are irreversible and must run exactly once before the
// untap choice can suspend (Sylvan Library precedent, leg/green.ts).
describe("Time Spiral ({4}{U}{U}: exile self, Timetwister-shape shuffle+draw for each player, untap up to 6 lands, CR 608.2m / 400.7 / 701.26)", () => {
    it("exiles itself, shuffles hand+graveyard into library and draws 7 for each player, then untaps up to 6 chosen lands across both battlefields", () => {
        const makeLib = (owner: string, n: number, prefix: string) =>
            Array.from({ length: n }, (_, i) =>
                makeInstance(forest.id, {
                    id: `${prefix}-lib-${i}`,
                    controllerId: owner,
                    ownerId: owner,
                    zone: "library",
                })
            );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(grizzlyBears.id, {
                            id: "p1-hand-1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    graveyard: [
                        makeInstance(lightningBolt.id, {
                            id: "p1-gy-1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                    library: makeLib("p1", 10, "p1"),
                    battlefield: [
                        makeInstance(mountain.id, {
                            id: "p1-land-1",
                            controllerId: "p1",
                            ownerId: "p1",
                            isTapped: true,
                        }),
                        makeInstance(mountain.id, {
                            id: "p1-land-2",
                            controllerId: "p1",
                            ownerId: "p1",
                            isTapped: true,
                        }),
                    ],
                }),
                makePlayer("p2", {
                    hand: [
                        makeInstance(grizzlyBears.id, {
                            id: "p2-hand-1",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                    graveyard: [],
                    library: makeLib("p2", 10, "p2"),
                    battlefield: [
                        makeInstance(mountain.id, {
                            id: "p2-land-1",
                            controllerId: "p2",
                            ownerId: "p2",
                            isTapped: true,
                        }),
                    ],
                }),
            ],
        });

        const spellItem = pushSpell(state, timeSpiral.id, "p1");
        resolveTopOfStack(state);

        // Step 0 (irreversible) already ran: "Exile Time Spiral" (CR 608.2m
        // self-redirect) was flagged on the stack item — the actual zone
        // move only lands once the WHOLE resolution finishes (below), but the
        // flag proves step 0 fired and the item is now suspended in step 1,
        // still on the stack awaiting the untap choice (`resolutionStep: 1`).
        const p1 = state.players[0];
        const p2 = state.players[1];
        const suspended = state.stack.find((i) => i.id === spellItem.id);
        expect(suspended).toBeDefined();
        expect(suspended?.exileOnResolve).toBe(true);

        // Each player shuffled hand+graveyard into library, then drew 7
        // (library was large enough for both).
        expect(p1.hand).toHaveLength(7);
        expect(p2.hand).toHaveLength(7);
        // p1 started with 10 lib + 1 hand + 1 graveyard = 12 cards in the
        // shuffled pool; 7 drawn leaves 5. p2: 10 lib + 1 hand = 11 pool; 7
        // drawn leaves 4.
        expect(p1.library).toHaveLength(5);
        expect(p2.library).toHaveLength(4);
        expect(p1.graveyard).toHaveLength(0);

        // Step 1 — "You untap up to six lands." No controller restriction:
        // the pool spans BOTH battlefields (allControllers: true).
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-permanents");
        expect(head.candidateIds?.slice().sort()).toEqual(
            ["p1-land-1", "p1-land-2", "p2-land-1"].sort()
        );
        expect(head.count).toEqual({ min: 0, max: 6 });

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p1-land-1", "p2-land-1"],
        });

        const untapped = (id: string) =>
            [...p1.battlefield, ...p2.battlefield].find((c) => c.id === id)
                ?.isTapped;
        expect(untapped("p1-land-1")).toBe(false);
        expect(untapped("p2-land-1")).toBe(false);
        expect(untapped("p1-land-2")).toBe(true); // not picked — stays tapped

        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);

        // Resolution fully finished — NOW the self-redirect actually lands
        // Time Spiral in its owner's exile instead of the graveyard.
        expect(p1.exile.some((c) => c.card.id === timeSpiral.id)).toBe(true);
        expect(p1.graveyard.some((c) => c.card.id === timeSpiral.id)).toBe(
            false
        );
    });

    it("resolving with an empty library leaves nothing to shuffle/draw and skips straight to the untap step (CR 608.2b)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(mountain.id, {
                            id: "p1-land-1",
                            controllerId: "p1",
                            ownerId: "p1",
                            isTapped: true,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, timeSpiral.id, "p1");
        resolveTopOfStack(state);

        expect(state.players[0].hand).toHaveLength(0);
        const head = state.pendingChoices?.[0];
        // With only one land in play, the untap choice still raises (a real
        // decision: untap it or not) and the earlier steps ran without error.
        expect(head?.kind).toBe("choose-permanents");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head!.stackItemId,
            step: head!.step,
            choiceId: head!.choiceId,
            cardInstanceIds: ["p1-land-1"],
        });
        expect(state.players[0].battlefield[0].isTapped).toBe(false);
        expect(state.stack).toHaveLength(0);
    });
});
