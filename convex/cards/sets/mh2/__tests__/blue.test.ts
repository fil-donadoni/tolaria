import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "../../../__tests__/setup.helper";
import type { GameState, StackItem } from "../../../../gre/state";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
    resolveTopOfStack,
} from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import type { TargetSelection } from "../../../types";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition, getCardByName } from "../../../index";
import { preloadDefinitions } from "../../../registry";
import { resolveCardExport } from "../../../defineCard";
import { inevitableBetrayal as betrayalModuleExport } from "../blue.cards";

// The PR head carries no `definition-index.json` row for the card (ADR 0157:
// derived state is regenerated post-merge), so register the module's own
// definition rather than depend on the lazy catalogue source.
preloadDefinitions([resolveCardExport(betrayalModuleExport)!]);
const inevitableBetrayal = getDefinition(
    "71725895-38cd-4017-bbf0-0b7dc9b5db60"
);

const solRing = getDefinition("c4300d24-1cae-4dd5-be7e-38cc677cf5bd");
const subtlety = getDefinition("701256d5-1389-48b7-9581-d6037209bd06");
const thoughtMonitor = getDefinition("996c1952-8d10-4296-8960-ff8993833649");

// Subtlety — {2}{U}{U} 3/3, flash/flying, blue evoke. First TARGETED trigger
// over a SPELL on the stack (CR 603.3d / 113, #1193/#1205): "choose up to one
// target creature spell or planeswalker spell; its owner puts it on the top or
// bottom of their library."

/** Put Subtlety's ETB trigger on the stack (above any target spells). */
function subtletyEtbOnStack(state: GameState, controllerId: string): StackItem {
    const source = makeInstance(subtlety.id, {
        id: "sub-src",
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
    });
    const trig: StackItem = {
        ...source,
        id: "sub-trig",
        zone: "stack",
        castById: controllerId,
        triggeredAbilityId: "subtlety-etb",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Answer a pending option-pick (top/bottom) by injecting the choice, mirroring
 *  the submitPendingChoice → collectedChoices path, then resume resolution. */
function answerOptionPick(state: GameState, optionId: string): void {
    const head = state.pendingChoices?.[0];
    if (!head) throw new Error("no pending option-pick");
    const item = state.stack.find((s) => s.id === head.stackItemId)!;
    item.collectedChoices = {
        ...(item.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: [optionId],
    };
    state.pendingChoices = undefined;
    resolveTopOfStack(state);
}

describe("Subtlety — targeted trigger over a stack spell (CR 603.3d / 113, #1205)", () => {
    it("targets only a creature/planeswalker spell (not an instant) and puts it on top of the owner's library", () => {
        const treefolk = getDefinition("b93c5869-7777-44bb-967a-e9439b25ced4"); // creature
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // p2 casts a creature spell; p1 flashes in Subtlety.
        const creatureSpell = pushSpell(state, treefolk.id, "p2");
        const trig = subtletyEtbOnStack(state, "p1");

        // CR 603.3d — the targeted trigger raises spell-target selection as it
        // is put on the stack. Only the creature spell is a legal target.
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("trigger");
        expect(pt.cardInstanceId).toBe("sub-trig");
        expect(pt.targetType).toBe("spell");

        pt.selected = [
            { type: "spell", id: creatureSpell.id },
        ] as TargetSelection[];
        finalizeTargetSelection(state, pt, "p1");
        expect(trig.targets).toEqual([{ type: "spell", id: creatureSpell.id }]);

        // Resolve the trigger — the OWNER (p2) is prompted for top/bottom.
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("option-pick");
        expect(head?.playerId).toBe("p2");

        answerOptionPick(state, "top");
        // The creature spell left the stack onto the top of p2's library.
        expect(state.stack.some((s) => s.id === creatureSpell.id)).toBe(false);
        expect(state.players[1].library[0]?.id).toBe(creatureSpell.id);

        // The spell was public on the stack (CR 405.1) — moving it into the
        // hidden library keeps it face-up to EVERYONE (ADR 0026 `knownTo`).
        const buried = state.players[1].library[0]!;
        expect(new Set(buried.knownTo)).toEqual(new Set(["p1", "p2"]));
    });

    it("the put-back spell stays revealed to the opponent through the wire projection", () => {
        const treefolk = getDefinition("b93c5869-7777-44bb-967a-e9439b25ced4");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // p2 casts a creature spell; p1 (the OPPONENT of the library owner)
        // flashes in Subtlety and puts the spell on top of p2's library.
        const creatureSpell = pushSpell(state, treefolk.id, "p2");
        subtletyEtbOnStack(state, "p1");
        raiseTriggerTargetSelection(state);
        const pt = state.pendingTarget!;
        pt.selected = [
            { type: "spell", id: creatureSpell.id },
        ] as TargetSelection[];
        finalizeTargetSelection(state, pt, "p1");
        resolveTopOfStack(state);
        answerOptionPick(state, "top");

        // p1 is not the owner but MUST see the revealed card in p2's library.
        const projected = projectPublicState(state, 1, "p1");
        const ownerView = projected.players.find((p) => p.id === "p2")!;
        expect(ownerView.library.count).toBe(1);
        const knownTop = ownerView.library.known.find((k) => k.index === 0);
        expect(knownTop?.card.id).toBe(creatureSpell.id);
    });

    it("puts the spell on the bottom of the owner's library when chosen", () => {
        const treefolk = getDefinition("b93c5869-7777-44bb-967a-e9439b25ced4");
        const filler = makeInstance(treefolk.id, {
            id: "lib0",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: [filler] }),
            ],
        });
        const creatureSpell = pushSpell(state, treefolk.id, "p2");
        const trig = subtletyEtbOnStack(state, "p1");
        raiseTriggerTargetSelection(state);
        const pt = state.pendingTarget!;
        pt.selected = [
            { type: "spell", id: creatureSpell.id },
        ] as TargetSelection[];
        finalizeTargetSelection(state, pt, "p1");
        void trig;
        resolveTopOfStack(state);
        answerOptionPick(state, "bottom");
        const lib = state.players[1].library;
        expect(lib[lib.length - 1]?.id).toBe(creatureSpell.id);
        expect(lib[0]?.id).toBe("lib0");
    });

    it("may choose no target (up to one) — the spell resolves normally", () => {
        const treefolk = getDefinition("b93c5869-7777-44bb-967a-e9439b25ced4");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const creatureSpell = pushSpell(state, treefolk.id, "p2");
        subtletyEtbOnStack(state, "p1");
        raiseTriggerTargetSelection(state);
        const pt = state.pendingTarget!;
        // Choose none.
        pt.selected = [];
        finalizeTargetSelection(state, pt, "p1");
        resolveTopOfStack(state);
        // No option-pick raised; the creature spell is still on the stack.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack.some((s) => s.id === creatureSpell.id)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Thought Monitor — Affinity for artifacts (CR 702.41a, PRD #702 / ADR 0063).
// The keyword's shared behaviour lives in `mrd/__tests__/blue.test.ts`
// (Thoughtcast) and its self-count / no-floor properties in
// `mrd/__tests__/colorless.test.ts` (Frogmite). Thought Monitor is the witness
// for COMPOSITION: affinity riding alongside a second printed keyword and an
// ETB trigger, with no interference — affinity functions only while the spell
// is on the stack (702.41a), flying only once it is a permanent.
// ─────────────────────────────────────────────────────────────────────────────
describe("Thought Monitor — Affinity for artifacts + flying + ETB draw (CR 702.41a)", () => {
    it("definition: {6}{U} Artifact Creature — Construct 2/2", () => {
        expect(thoughtMonitor.manaCost).toEqual({ X: 6, U: 1 });
        expect(thoughtMonitor.types).toEqual(["Artifact", "Creature"]);
        expect(thoughtMonitor.subtypes).toEqual(["Construct"]);
        expect(thoughtMonitor.power).toBe(2);
        expect(thoughtMonitor.toughness).toBe(2);
        expect(getCardByName("Thought Monitor")?.id).toBe(thoughtMonitor.id);
    });

    it("costs {1} less per artifact, coloured pip untouched, floored at {U}", () => {
        const costWithArtifacts = (n: number) => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: Array.from({ length: n }, (_, i) =>
                            makeInstance(solRing.id, {
                                id: `art-${i}`,
                                controllerId: "p1",
                            })
                        ),
                    }),
                    makePlayer("p2"),
                ],
            });
            const spellView = makeInstance(thoughtMonitor.id, {
                id: "tm-spell-view",
                controllerId: "p1",
                zone: "hand",
            });
            const cost = normalizeManaCost(thoughtMonitor.manaCost ?? {});
            applyCostModifiers(
                cost,
                getCostModifiers(state, spellView, "spell")
            );
            return cost;
        };
        expect(costWithArtifacts(0)).toEqual({ X: 6, U: 1 });
        expect(costWithArtifacts(2)).toEqual({ X: 4, U: 1 });
        expect(costWithArtifacts(6)).toEqual({ U: 1 });
        expect(costWithArtifacts(9)).toEqual({ U: 1 });
    });
});

// Inevitable Betrayal — "Search target opponent's library for a creature card
// and put that card onto the battlefield under your control. Then that player
// shuffles." CR 701.23b (the find is optional), CR 110.2a (the effect names the
// controller; the card keeps its owner).
describe("Inevitable Betrayal (CR 701.23b, CR 110.2a)", () => {
    function castBetrayal(): GameState {
        const creature = makeInstance(thoughtMonitor.id, {
            id: "their-creature",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const artifact = makeInstance(solRing.id, {
            id: "their-artifact",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: [artifact, creature] }),
            ],
        });
        pushSpell(state, inevitableBetrayal.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        return state;
    }

    it("searches only the opponent's creature cards, for the caster", () => {
        const state = castBetrayal();
        const head = state.pendingChoices?.[0];
        expect(head?.playerId).toBe("p1");
        expect(head?.zoneOwnerId).toBe("p2");
        expect(head?.candidateIds).toEqual(["their-creature"]);
    });

    it("puts the found creature onto the battlefield under the caster's control, owned by the opponent", () => {
        const state = castBetrayal();
        submitChoice(state, ["their-creature"]);
        const [p1, p2] = state.players;
        const stolen = p1.battlefield.find((c) => c.id === "their-creature");
        expect(stolen?.controllerId).toBe("p1");
        expect(stolen?.ownerId).toBe("p2");
        expect(p2.battlefield).toEqual([]);
        expect(p2.library.map((c) => c.id)).toEqual(["their-artifact"]);

        // The wire carries it on the caster's side of the board.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "their-creature"
        );
        expect(slim?.controllerId).toBe("p1");
        expect(slim?.ownerId).toBe("p2");
    });

    it("may find nothing: the creature stays in the opponent's library", () => {
        const state = castBetrayal();
        submitChoice(state, []);
        expect(state.players[0].battlefield).toEqual([]);
        expect(state.players[1].library.map((c) => c.id).sort()).toEqual([
            "their-artifact",
            "their-creature",
        ]);
    });
});
