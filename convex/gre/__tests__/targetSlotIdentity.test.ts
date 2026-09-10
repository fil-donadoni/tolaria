// CR 608.2b — an announced target that has become illegal keeps its POSITION
// for the whole resolution (issue #2985).
//
// "Illegal targets, if any, won't be affected by parts of a resolving spell's
// effect for which they're illegal. Other parts of the effect for which those
// targets are not illegal may still affect them." The rule never says to
// remove an illegal target from the announced list — and the list's INDEX is
// what a `{ target: N }` reference resolves through, so closing the list up
// renumbers every later slot and the wrong Op silently acts on the wrong
// object. These tests pin the identity, not the legality verdict.
//
// The probes apply a DIFFERENT Op to each slot on purpose: every multi-target
// card in the shipped catalogue applies the SAME Op to each of its targets, so
// a shifted reference happens to act on an object that was going to be acted
// on anyway. That is exactly why the defect shipped invisible.

import { describe, it, expect } from "vitest";
import { getPlayer, resolveTopOfStack, type GameState } from "../state";
import { compactState, expandState } from "../serialize";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { getDefinition, withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";

const GRIZZLY_BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870";

/** Two announced Creature slots, two DIFFERENT Ops — slot 0 is tapped, slot 1
 *  gets a +1/+1 counter. Either outcome landing on the other slot's object is
 *  the compaction bug, visibly. */
const TWO_SLOT_PROBE_ID = "test:slot-identity-two";
const twoSlotProbe: CardDefinition = {
    id: TWO_SLOT_PROBE_ID,
    name: "Test Two-Slot Probe",
    rarity: "common",
    oracleText: "Tap target creature. Put a +1/+1 counter on target creature.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    additionalTargetRequirements: [{ type: "Creature", count: 1 }],
    effects: [
        { op: "tapUntap", action: "tap", target: { target: 0 } },
        {
            op: "counters",
            action: "add",
            counter: "+1/+1",
            target: { target: 1 },
            count: 1,
        },
    ],
};

/** Three announced Creature slots, three DIFFERENT Ops — tap, counter, 1
 *  damage. The middle-slot case is the one a two-slot probe cannot show: with
 *  compaction the THIRD reference falls off the end while the SECOND takes the
 *  third object. */
const THREE_SLOT_PROBE_ID = "test:slot-identity-three";
const threeSlotProbe: CardDefinition = {
    id: THREE_SLOT_PROBE_ID,
    name: "Test Three-Slot Probe",
    rarity: "common",
    oracleText:
        "Tap target creature. Put a +1/+1 counter on target creature. This spell deals 1 damage to target creature.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    additionalTargetRequirements: [
        { type: "Creature", count: 1 },
        { type: "Creature", count: 1 },
    ],
    effects: [
        { op: "tapUntap", action: "tap", target: { target: 0 } },
        {
            op: "counters",
            action: "add",
            counter: "+1/+1",
            target: { target: 1 },
            count: 1,
        },
        { op: "dealDamage", amount: 1, to: { target: 2 } },
    ],
};

/** The three-slot probe with a leading modal pick, so the resolution SUSPENDS
 *  after the legality gate has run and before a single positional Op has. The
 *  state persisted at that suspension is what must round-trip. */
const SUSPENDING_PROBE_ID = "test:slot-identity-suspend";
const suspendingProbe: CardDefinition = {
    ...threeSlotProbe,
    id: SUSPENDING_PROBE_ID,
    name: "Test Suspending Slot Probe",
    effects: [
        {
            op: "optionChoice",
            player: "controller",
            prompt: "Choose a mode.",
            // TWO modes: a single-mode pick has no real branch and
            // auto-resolves without ever suspending (#1945).
            modes: [
                {
                    id: "go",
                    label: "Go",
                    effects: threeSlotProbe.effects!,
                },
                {
                    id: "stop",
                    label: "Stop",
                    effects: [
                        { op: "gainLife", player: "controller", amount: 1 },
                    ],
                },
            ],
        },
    ],
};

function bears(id: string, controllerId: string) {
    return makeInstance(GRIZZLY_BEARS, {
        id,
        controllerId,
        ownerId: controllerId,
    });
}

/** p1 controls every creature named; p2 is empty. */
function stateWith(ids: string[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: ids.map((id) => bears(id, "p1")) }),
            makePlayer("p2"),
        ],
    });
}

/** CR 608.2b's first sentence — "a target that's no longer in the zone it was
 *  in when it was targeted is illegal". The bluntest way to make a slot
 *  illegal without touching the verdict logic under test. */
function removeFromBattlefield(state: GameState, id: string): void {
    const p1 = getPlayer(state, "p1");
    const idx = p1.battlefield.findIndex((c) => c.id === id);
    const [gone] = p1.battlefield.splice(idx, 1);
    gone.zone = "graveyard";
    p1.graveyard.push(gone);
}

function onBattlefield(state: GameState, id: string) {
    return getPlayer(state, "p1").battlefield.find((c) => c.id === id);
}

function counterCount(state: GameState, id: string): number {
    return onBattlefield(state, id)?.counters?.["+1/+1"] ?? 0;
}

describe("CR 608.2b — an illegal target keeps its announced slot (issue #2985)", () => {
    it("baseline: both slots legal, each Op acts on its own announced object", () => {
        withTemporaryDefinition(twoSlotProbe, () => {
            const state = stateWith(["a", "b"]);
            pushSpell(state, TWO_SLOT_PROBE_ID, "p1", [
                { type: "permanent", id: "a" },
                { type: "permanent", id: "b" },
            ]);

            resolveTopOfStack(state);

            expect(onBattlefield(state, "a")!.isTapped).toBe(true);
            expect(counterCount(state, "a")).toBe(0);
            expect(onBattlefield(state, "b")!.isTapped).toBe(false);
            expect(counterCount(state, "b")).toBe(1);
        });
    });

    it("FIRST slot illegal: the second Op still acts on the second object, and the first Op acts on nothing", () => {
        withTemporaryDefinition(twoSlotProbe, () => {
            const state = stateWith(["a", "b"]);
            pushSpell(state, TWO_SLOT_PROBE_ID, "p1", [
                { type: "permanent", id: "a" },
                { type: "permanent", id: "b" },
            ]);
            removeFromBattlefield(state, "a");

            resolveTopOfStack(state);

            // The counter — slot 1's Op — lands on slot 1's object.
            expect(counterCount(state, "b")).toBe(1);
            // And the tap — slot 0's Op, whose target is illegal — lands on
            // NOTHING. Under compaction `b` became slot 0 and was tapped.
            expect(onBattlefield(state, "b")!.isTapped).toBe(false);
        });
    });

    it("SECOND slot illegal: the first Op still acts on the first object, and the second Op is skipped", () => {
        withTemporaryDefinition(twoSlotProbe, () => {
            const state = stateWith(["a", "b"]);
            pushSpell(state, TWO_SLOT_PROBE_ID, "p1", [
                { type: "permanent", id: "a" },
                { type: "permanent", id: "b" },
            ]);
            removeFromBattlefield(state, "b");

            resolveTopOfStack(state);

            expect(onBattlefield(state, "a")!.isTapped).toBe(true);
            expect(counterCount(state, "a")).toBe(0);
        });
    });

    it("MIDDLE slot illegal: the first and third references still name their own announced objects", () => {
        withTemporaryDefinition(threeSlotProbe, () => {
            const state = stateWith(["a", "b", "c"]);
            pushSpell(state, THREE_SLOT_PROBE_ID, "p1", [
                { type: "permanent", id: "a" },
                { type: "permanent", id: "b" },
                { type: "permanent", id: "c" },
            ]);
            removeFromBattlefield(state, "b");

            resolveTopOfStack(state);

            expect(onBattlefield(state, "a")!.isTapped).toBe(true);
            expect(counterCount(state, "a")).toBe(0);
            // `c` is slot 2: damaged, never countered, never tapped. Under
            // compaction it became slot 1 and took the +1/+1 counter while the
            // damage Op read past the end of the shortened list.
            expect(counterCount(state, "c")).toBe(0);
            expect(onBattlefield(state, "c")!.isTapped).toBe(false);
            expect(onBattlefield(state, "c")!.damageMarked).toBe(1);
        });
    });

    it("a reference naming an illegal slot skips its Op; later Ops in the same script still run", () => {
        withTemporaryDefinition(threeSlotProbe, () => {
            const state = stateWith(["a", "b", "c"]);
            pushSpell(state, THREE_SLOT_PROBE_ID, "p1", [
                { type: "permanent", id: "a" },
                { type: "permanent", id: "b" },
                { type: "permanent", id: "c" },
            ]);
            removeFromBattlefield(state, "a");

            resolveTopOfStack(state);

            // Slot 0's Op is skipped; slots 1 and 2 both still run.
            expect(counterCount(state, "b")).toBe(1);
            expect(onBattlefield(state, "b")!.isTapped).toBe(false);
            expect(onBattlefield(state, "c")!.damageMarked).toBe(1);
            expect(onBattlefield(state, "c")!.isTapped).toBe(false);
        });
    });

    it("ALL slots illegal: the spell still fizzles to its owner's graveyard, unchanged", () => {
        withTemporaryDefinition(twoSlotProbe, () => {
            const state = stateWith(["a", "b", "bystander"]);
            pushSpell(state, TWO_SLOT_PROBE_ID, "p1", [
                { type: "permanent", id: "a" },
                { type: "permanent", id: "b" },
            ]);
            removeFromBattlefield(state, "a");
            removeFromBattlefield(state, "b");

            resolveTopOfStack(state);

            expect(state.stack).toHaveLength(0);
            expect(
                getPlayer(state, "p1").graveyard.some(
                    (c) => c.card.id === TWO_SLOT_PROBE_ID
                )
            ).toBe(true);
            // Nothing ran: the untargeted bystander is untouched.
            expect(onBattlefield(state, "bystander")!.isTapped).toBe(false);
            expect(counterCount(state, "bystander")).toBe(0);
        });
    });

    it("a resolution that suspends on a choice and resumes preserves the positions across the round trip", () => {
        withTemporaryDefinition(suspendingProbe, () => {
            const state = stateWith(["a", "b", "c"]);
            const item = pushSpell(state, SUSPENDING_PROBE_ID, "p1", [
                { type: "permanent", id: "a" },
                { type: "permanent", id: "b" },
                { type: "permanent", id: "c" },
            ]);
            removeFromBattlefield(state, "b");

            // The gate runs, then the modal pick suspends the resolution.
            expect(resolveTopOfStack(state)).toBeNull();
            expect(item.illegalTargetSlots).toEqual([1]);
            expect(item.targets).toHaveLength(3);

            // The suspension is a stable save point: persist and reload.
            const reloaded = expandState(compactState(state));
            const restored = reloaded.stack[reloaded.stack.length - 1];
            expect(restored.targets?.map((t) => t.id)).toEqual(["a", "b", "c"]);
            expect(restored.illegalTargetSlots).toEqual([1]);

            const head = reloaded.pendingChoices![0];
            applyPendingChoiceSubmit(reloaded, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["go"],
            });

            expect(onBattlefield(reloaded, "a")!.isTapped).toBe(true);
            expect(counterCount(reloaded, "a")).toBe(0);
            expect(counterCount(reloaded, "c")).toBe(0);
            expect(onBattlefield(reloaded, "c")!.damageMarked).toBe(1);
        });
    });

    it("the shipped catalogue's own two-slot card is unaffected when only one slot is illegal (CR 608.2b's Plague Spores)", () => {
        // Plague Spores destroys BOTH slots, so compaction never showed a
        // wrong-object outcome here — the regression guard is that the
        // position-preserving gate does not change what it always did.
        const plagueSpores = getDefinition(
            "0d106d56-a688-49cc-8d5d-0279a5a7c0a7"
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance("ce2d603a-3231-4a8c-bf39-1617586ea870", {
                            id: "creature",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const land = makeInstance("6f1c8cb0-38eb-408b-94e8-16db83999b3b", {
            id: "land",
        });
        getPlayer(state, "p1").battlefield.push(land);
        pushSpell(state, plagueSpores.id, "p1", [
            { type: "permanent", id: "creature" },
            { type: "permanent", id: "land" },
        ]);
        // The creature slot goes illegal; the land slot stays legal.
        removeFromBattlefield(state, "creature");

        resolveTopOfStack(state);

        expect(onBattlefield(state, "land")).toBeUndefined();
    });
});
