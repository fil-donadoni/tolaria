// CR 115.7 / 707.10c / 603.2e — a spell already on the stack that takes a target
// it did not have makes that object "become the target" (Ward, CR 702.21a), and
// the trigger is on the stack before the priority round the commit opens: the
// `selectTarget` mutation saves right after, with no scan of its own. Driven
// through the real `resolveTopOfStack` and the raised-selection commit both the
// server and the Bot use.
import { describe, expect, it } from "vitest";
import type { EffectOp, TargetSelection } from "../../cards/types";
import { getCardByName, registerTokenDefinition } from "../../cards";
import { DACK_FAYDEN_EMBLEM_ID } from "../../cards/emblems";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { requestCopyRetargetOn, resolveTopOfStack } from "../state";
import type { GameState, StackItem } from "../state";
import {
    applyRaisedTargetFinalization,
    continueAfterRetargetOffer,
} from "../pendingTargetOrigin";

const WARDED = "test-retarget-warded";
registerTokenDefinition({
    id: WARDED,
    name: WARDED,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 5,
    staticAbilities: ["ward {2}"],
});

const damage = (slots: number): EffectOp[] =>
    Array.from({ length: slots }, (_, i) => ({
        op: "dealDamage" as const,
        amount: 1,
        to: { target: i },
    }));

function defineSpell(id: string, count: number, extra: object = {}): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Instant"],
        effects: damage(count),
        targetRequirement: { type: "Creature", count },
        ...extra,
    });
    return id;
}
const ONE = defineSpell("test-retarget-one", 1);
const TWO = defineSpell("test-retarget-two", 2);

const THIEF = "test-retarget-thief";
registerTokenDefinition({
    id: THIEF,
    name: THIEF,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "gainControlOfSpell",
            target: { target: 0 },
            controller: "controller",
        },
        { op: "retarget", target: { target: 0 }, chooseNew: true },
    ],
    targetRequirement: { type: "spell", count: 1 },
});

const permanent = (id: string): TargetSelection => ({ type: "permanent", id });
const warded = (id: string, owner = "p2") =>
    makeInstance(WARDED, { id, controllerId: owner, ownerId: owner });

function board(p2: string[], p1: string[] = []): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: p1.map((id) => warded(id, "p1")),
            }),
            makePlayer("p2", {
                battlefield: p2.map((id) => warded(id, "p2")),
            }),
        ],
    });
}

/** p2's spell, stolen by p1, who now owes the new targets. */
function stolen(state: GameState, spellId: string, targets: string[]) {
    const victim = pushSpell(state, spellId, "p2", targets.map(permanent));
    pushSpell(state, THIEF, "p1", [{ type: "spell", id: victim.id }]);
    resolveTopOfStack(state);
    expect(state.pendingTarget).toMatchObject({ kind: "retarget" });
    return victim;
}

function answer(state: GameState, picks: string[]): void {
    const pt = state.pendingTarget!;
    pt.selected = picks.map(permanent);
    applyRaisedTargetFinalization(state, pt);
}

/** The Ward triggers on the stack, with the object each is aimed at. */
function wardTriggers(state: GameState): (string | undefined)[] {
    return state.stack
        .filter((s: StackItem) => s.triggeredAbilityId?.startsWith("ward"))
        .map((s: StackItem) => s.targets?.[0]?.id);
}

describe("changing a spell's targets fires 'becomes the target' (CR 115.7, CR 702.21a)", () => {
    it("Ward fires for its new controller's retarget, aimed at the spell, before priority", () => {
        const state = board(["old", "w"]);
        const victim = stolen(state, ONE, ["old"]);
        answer(state, ["w"]);

        expect(victim.targets).toEqual([permanent("w")]);
        expect(state.stack).toHaveLength(2);
        expect(wardTriggers(state)).toEqual([victim.id]);
        expect(state.pendingEvents ?? []).toEqual([]);
        expect(state.priorityPlayerId).toBe(state.activePlayerId);
    });

    it("a target left unchanged fires nothing", () => {
        const state = board(["kept", "other"]);
        stolen(state, ONE, ["kept"]);
        answer(state, ["kept"]);

        expect(wardTriggers(state)).toEqual([]);
        expect(state.stack).toHaveLength(1);
    });

    it("of two targets, only the new one fires", () => {
        const state = board(["kept", "old", "w"]);
        const victim = stolen(state, TWO, ["kept", "old"]);
        answer(state, ["kept", "w"]);

        expect(wardTriggers(state)).toEqual([victim.id]);
        const trigger = state.stack[state.stack.length - 1];
        expect(trigger.triggerEvent).toMatchObject({
            target: permanent("w"),
            sourceControllerId: "p1",
            sourceInstanceId: victim.id,
            sourceKind: "spell-new-target",
        });
    });

    it("targets that only swapped slots fire nothing (CR 115.7e)", () => {
        const state = board(["a", "b", "other"]);
        stolen(state, TWO, ["a", "b"]);
        answer(state, ["b", "a"]);

        expect(wardTriggers(state)).toEqual([]);
    });

    it("a retarget by the warded creature's own controller fires nothing (CR 702.21a)", () => {
        const state = board([], ["old", "mine"]);
        stolen(state, ONE, ["old"]);
        answer(state, ["mine"]);

        expect(wardTriggers(state)).toEqual([]);
    });

    it("a spell-scoped trigger reads it; a CAST-scoped one doesn't (CR 601.2c)", () => {
        const state = board(["old"]);
        getPlayersBoard(state, "p2").push(
            makeInstance(getCardByName("Bonecrusher Giant")!.id, {
                id: "giant",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        state.emblems = [
            {
                id: "emblem-1",
                ownerId: "p1",
                emblemId: DACK_FAYDEN_EMBLEM_ID,
                name: "Dack Fayden emblem",
                oracleText: "",
                imagePrintId: "",
            } as unknown as NonNullable<GameState["emblems"]>[number],
        ];
        stolen(state, ONE, ["old"]);
        answer(state, ["giant"]);

        const triggers = state.stack.slice(1);
        expect(triggers.map((s) => s.triggeredAbilityId)).toEqual([
            "bonecrusher-giant-targeted-ping",
        ]);
        expect(
            state.stack.some((s) => s.emblemSourceId === DACK_FAYDEN_EMBLEM_ID)
        ).toBe(false);
    });
});

function getPlayersBoard(state: GameState, id: string) {
    return state.players.find((p) => p.id === id)!.battlefield;
}

describe("a copy's new target fires 'becomes the target' (CR 707.10c, CR 702.21a)", () => {
    function copyOffer(state: GameState, inherited: string): StackItem {
        const copy = pushSpell(state, ONE, "p1", [permanent(inherited)]);
        requestCopyRetargetOn(state, copy);
        expect(state.pendingTarget).toMatchObject({ kind: "copy-retarget" });
        return copy;
    }

    it("Ward fires on the new target, aimed at the copy", () => {
        const state = board(["old", "w"]);
        const copy = copyOffer(state, "old");
        answer(state, ["w"]);

        expect(copy.targets).toEqual([permanent("w")]);
        expect(wardTriggers(state)).toEqual([copy.id]);
    });

    it("the inherited target, kept, fires nothing", () => {
        const state = board(["old", "other"]);
        copyOffer(state, "old");
        answer(state, ["old"]);

        expect(wardTriggers(state)).toEqual([]);
    });

    it("waits for the last queued copy's answer, then both land in one batch (CR 603.3b)", () => {
        const state = board(["a", "b", "w1", "w2"]);
        const first = copyOffer(state, "a");
        const second = pushSpell(state, ONE, "p1", [permanent("b")]);
        state.queuedCopyRetargets = [second.id];

        answer(state, ["w1"]);
        expect(state.pendingTarget?.cardInstanceId).toBe(second.id);
        expect(wardTriggers(state)).toEqual([]);

        answer(state, ["w2"]);
        expect(wardTriggers(state).sort()).toEqual(
            [first.id, second.id].sort()
        );
    });

    it("declining the last queued copy still scans what the earlier answer fired", () => {
        const state = board(["a", "b", "w1"]);
        const first = copyOffer(state, "a");
        const second = pushSpell(state, ONE, "p1", [permanent("b")]);
        state.queuedCopyRetargets = [second.id];

        answer(state, ["w1"]);
        expect(state.pendingTarget?.cardInstanceId).toBe(second.id);
        // What the `cancelTargetSelection` mutation does for a retarget.
        state.pendingTarget = undefined;
        continueAfterRetargetOffer(state);

        expect(second.targets).toEqual([permanent("b")]);
        expect(wardTriggers(state)).toEqual([first.id]);
    });
});
