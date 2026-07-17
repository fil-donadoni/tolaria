// Storm (CR 702.40, ADR 0052) — mechanism tests. Per ADR 0052 / PRD #1041 §
// Testing Decisions, these mechanism tests (S1–S5) are storm's proof
// obligation; the four launch cards (Brain Freeze, Grapeshot, Tendrils of
// Agony, Empty the Warrens) reuse already-exercised Ops (mill, dealDamage,
// loseLife/gainLife, createToken) and are covered by the catalogue-wide DSL
// static sweep + auto-generated smoke test (S6) — no hand-written per-card
// test is required beyond exercising each card at least once here.
import { describe, it, expect, beforeAll } from "vitest";
import {
    makeState,
    makePlayer,
    makeInstance,
    pushSpell,
} from "../../cards/__tests__/setup";
import { emitSpellCastEvent, resolveTopOfStack } from "../state";
import { advancePhase } from "../phases";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { lightningBolt, grizzlyBears } from "../../cards/sets/lea";
import { brainFreeze, tendrilsOfAgony } from "../../cards/sets/scg";
import { grapeshot, emptyTheWarrens } from "../../cards/sets/tsp";
import type { GameState, StackItem } from "../state";

// A player-scoped shroud fixture (CR 702.18 / 115.4) — mirrors the pattern
// `targeting.test.ts` established for `StaticPlayerGuard` ("no shipped card
// grants this yet"): used ONLY to construct a genuine ZERO legal-alternative
// scenario for the copy-retarget auto-resolve test (a "target player"
// requirement otherwise always has both players as legal candidates in this
// engine's 2-player invariant, CR 102.2).
const SHROUD_SOURCE_ID = "test-storm-shroud-source";
const shroudFixture: CardDefinition = {
    id: SHROUD_SOURCE_ID,
    name: "Test Storm Shroud Source",
    rarity: "common",
    types: ["Enchantment"],
    staticEffects: [
        { kind: "player-guard", id: "test-storm-shroud", cantBeTargeted: true },
    ],
};

beforeAll(() => {
    registerTokenDefinition(shroudFixture);
});

function fillLibrary(count: number, controllerId: string) {
    return Array.from({ length: count }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `lib-${controllerId}-${i}`,
            controllerId,
            ownerId: controllerId,
            zone: "library",
        })
    );
}

/** Mirrors `finalizeTargetSelection`'s "copy-retarget" branch in
 *  `convex/game.ts`: writes the chosen targets onto the spell copy and
 *  clears the prompt. Kept as a pure helper so the test needs no Convex
 *  context — the exact convention the Fork test suite already established
 *  (`sets/lea/__tests__/red.test.ts`). */
function applyCopyRetarget(
    state: GameState,
    newTargets: NonNullable<StackItem["targets"]>
): void {
    const pt = state.pendingTarget!;
    const copy = state.stack.find((s) => s.id === pt.cardInstanceId);
    if (copy) copy.targets = newTargets;
    state.pendingTarget = undefined;
}

/** Drains the WHOLE stack — `resolveTopOfStack` resolves one item at a time
 *  (CR 608.3), so a storm trigger's copies (once created) each need their
 *  OWN separate call to actually resolve, on top of the trigger's own call
 *  that creates them. Any retarget offer encountered along the way is
 *  DECLINED (mirrors "copy resolves with the original targets if no
 *  re-selection", the Fork suite's convention) — used by tests that assert
 *  on the aggregate outcome rather than on the retarget flow itself (that
 *  gets its own dedicated, manually-driven tests below). */
function drainStack(state: GameState, maxIterations = 20): void {
    let i = 0;
    while (state.stack.length > 0 && i < maxIterations) {
        resolveTopOfStack(state);
        if (state.pendingTarget) state.pendingTarget = undefined;
        i++;
    }
}

describe("Storm — spells-cast-this-turn counter (CR 702.40a, S2)", () => {
    it("increments per cast and carries priorSpellCount on SPELL_CAST", () => {
        const state = makeState();
        const bolt1 = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bolt1);
        expect(state.spellsCastThisTurn).toBe(1);
        // A targeting spell now also emits a trailing BECAME_TARGET event
        // (CR 603.2b, Leovold's foundation), so locate the SPELL_CAST
        // explicitly rather than assuming it is the terminal pending event.
        const events1 = state.pendingEvents ?? [];
        const casts1 = events1.filter((e) => e.type === "SPELL_CAST");
        const evt1 = casts1[casts1.length - 1];
        expect(evt1).toMatchObject({ type: "SPELL_CAST", priorSpellCount: 0 });

        const bolt2 = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        emitSpellCastEvent(state, bolt2);
        expect(state.spellsCastThisTurn).toBe(2);
        const events2 = state.pendingEvents ?? [];
        const casts2 = events2.filter((e) => e.type === "SPELL_CAST");
        const evt2 = casts2[casts2.length - 1];
        expect(evt2).toMatchObject({ type: "SPELL_CAST", priorSpellCount: 1 });
    });

    it("a spell COPY does not increment the count (CR 707.10)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: fillLibrary(10, "p1") }),
                makePlayer("p2", { library: fillLibrary(10, "p2") }),
            ],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bolt);
        expect(state.spellsCastThisTurn).toBe(1);

        const bf = pushSpell(state, brainFreeze.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bf); // priorSpellCount = 1 -> 1 copy
        expect(state.spellsCastThisTurn).toBe(2); // only the cast increments

        resolveTopOfStack(state); // storm trigger creates the copy
        // Still 2 — the copy created by the trigger never went through
        // emitSpellCastEvent.
        expect(state.spellsCastThisTurn).toBe(2);
    });

    it("resets at the start of each turn (CR 702.40a 'this turn')", () => {
        const state = makeState({ phase: "END_STEP", turn: 1 });
        state.spellsCastThisTurn = 3;
        advancePhase(state); // END_STEP -> CLEANUP (auto) -> UNTAP (auto, new turn) -> UPKEEP
        expect(state.turn).toBe(2);
        expect(state.spellsCastThisTurn).toBeUndefined();
    });
});

describe("Storm — cast-trigger + copy resolution (CR 702.40, S1)", () => {
    it("zero prior spells this turn -> zero copies, only the original resolves", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { battlefield: [] })],
        });
        const gs = pushSpell(state, grapeshot.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, gs); // priorSpellCount = 0
        expect(state.stack).toHaveLength(2); // grapeshot + storm trigger
        expect(state.stack[1].triggeredAbilityId).toBe("storm");
        expect(state.stack[1].stormCopiesRemaining).toBe(0);

        resolveTopOfStack(state); // storm trigger resolves: 0 copies, pops
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe(gs.id);

        resolveTopOfStack(state); // grapeshot itself resolves
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].life).toBe(19); // only 1 damage total
    });

    it("N prior spells -> N copies; original + copies all resolve (Empty the Warrens, no-retarget branch)", () => {
        const state = makeState();
        // Two prior spells this turn (Lightning Bolt, resolved before the
        // storm spell is cast).
        for (let i = 0; i < 2; i++) {
            const bolt = pushSpell(state, lightningBolt.id, "p1", [
                { type: "player", id: "p2" },
            ]);
            emitSpellCastEvent(state, bolt);
            resolveTopOfStack(state);
        }
        expect(state.players[1].life).toBe(14); // 2 * 3 damage
        expect(state.spellsCastThisTurn).toBe(2);

        const etw = pushSpell(state, emptyTheWarrens.id, "p1", []);
        emitSpellCastEvent(state, etw); // priorSpellCount = 2
        const trigger = state.stack[state.stack.length - 1];
        expect(trigger.triggeredAbilityId).toBe("storm");
        expect(trigger.stormCopiesRemaining).toBe(2);

        // Non-targeted storm never raises a retarget prompt — the whole
        // 2-copy CREATION loop drains in a single resolveTopOfStack call
        // (`resolveTopOfStack` resolves one stack item at a time, CR 608.3;
        // here that one item is the trigger itself, which creates both
        // copies before popping — the copies still need their OWN separate
        // calls to actually resolve).
        resolveTopOfStack(state);
        expect(state.pendingTarget).toBeUndefined();
        // The trigger popped; the original + both (unresolved) copies remain.
        expect(state.stack).toHaveLength(3);
        expect(state.players[0].battlefield).toHaveLength(0);

        resolveTopOfStack(state); // copy #2 resolves (LIFO — created last)
        expect(state.players[0].battlefield).toHaveLength(2);
        resolveTopOfStack(state); // copy #1 resolves
        expect(state.players[0].battlefield).toHaveLength(4);

        resolveTopOfStack(state); // the original Empty the Warrens resolves
        expect(state.stack).toHaveLength(0);
        // + 2 more from the original -> 6 total (2 copies + the original).
        expect(state.players[0].battlefield).toHaveLength(6);
        expect(
            state.players[0].battlefield.every((c) =>
                c.subtypes.includes("Goblin")
            )
        ).toBe(true);
    });

    it("an opponent's spell cast earlier this turn counts (CR 702.40a — any player)", () => {
        const state = makeState();
        const oppBolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        emitSpellCastEvent(state, oppBolt);
        resolveTopOfStack(state);
        expect(state.spellsCastThisTurn).toBe(1);

        const etw = pushSpell(state, emptyTheWarrens.id, "p1", []);
        emitSpellCastEvent(state, etw); // priorSpellCount includes p2's bolt
        expect(state.stack[state.stack.length - 1].stormCopiesRemaining).toBe(
            1
        );
    });

    it("a spell cast AFTER the storm spell (before the trigger resolves) does not count", () => {
        const state = makeState();
        const etw = pushSpell(state, emptyTheWarrens.id, "p1", []);
        emitSpellCastEvent(state, etw); // priorSpellCount = 0, fixed now
        const trigger = state.stack[state.stack.length - 1];
        expect(trigger.stormCopiesRemaining).toBe(0);

        // A second spell cast in response, before the storm trigger resolves.
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        emitSpellCastEvent(state, bolt);
        expect(state.spellsCastThisTurn).toBe(2);

        // The already-built trigger's copy count is UNCHANGED — it was
        // fixed at cast time (event.priorSpellCount), not re-read live.
        expect(trigger.stormCopiesRemaining).toBe(0);
    });

    it("copies are still created even if the original storm spell is countered in response", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bolt);
        resolveTopOfStack(state);

        const etw = pushSpell(state, emptyTheWarrens.id, "p1", []);
        emitSpellCastEvent(state, etw); // priorSpellCount = 1
        expect(state.stack.map((s) => s.id)).toEqual([
            etw.id,
            state.stack[1].id,
        ]);

        // Simulate the original being countered: removed from the stack
        // before the storm trigger (which sits above it) resolves.
        state.stack = state.stack.filter((s) => s.id !== etw.id);
        expect(state.stack).toHaveLength(1); // only the storm trigger remains

        resolveTopOfStack(state); // trigger resolves from its detached snapshot: creates the 1 copy, pops
        expect(state.stack).toHaveLength(1); // the copy remains, unresolved
        expect(state.players[0].battlefield).toHaveLength(0);

        resolveTopOfStack(state); // the copy itself resolves
        expect(state.stack).toHaveLength(0); // the copy ceased to exist too
        // The copy still resolved even though the original never did.
        expect(state.players[0].battlefield).toHaveLength(2);
    });

    it("Brain Freeze — the storm tracer card mills 3 per copy + the original (target-player retarget path)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: fillLibrary(20, "p1") }),
                makePlayer("p2", { library: fillLibrary(20, "p2") }),
            ],
        });
        for (let i = 0; i < 2; i++) {
            const bolt = pushSpell(state, lightningBolt.id, "p1", [
                { type: "player", id: "p2" },
            ]);
            emitSpellCastEvent(state, bolt);
            resolveTopOfStack(state);
        }
        const bf = pushSpell(state, brainFreeze.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bf); // priorSpellCount = 2

        // Resolve the storm trigger, declining every retarget offer (kept
        // targets = p2 for every copy, mirroring "copy resolves with the
        // original targets if no re-selection" from the Fork suite).
        drainStack(state);
        // 2 copies + the original, 3 mills each -> 9.
        expect(state.players[1].graveyard).toHaveLength(9);
    });

    it("Tendrils of Agony — multi-Op (loseLife + gainLife) per copy + the original, the classic storm kill", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bolt);
        resolveTopOfStack(state); // p2: 20 -> 17 (Lightning Bolt, unrelated to storm)

        const t = pushSpell(state, tendrilsOfAgony.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, t); // priorSpellCount = 1 -> 1 copy

        drainStack(state);
        // 1 copy + original -> 2 * (2 life loss / 2 life gain), on top of the
        // Lightning Bolt's 3 already dealt: 17 - 4 = 13.
        expect(state.players[1].life).toBe(13);
        expect(state.players[0].life).toBe(24);
    });
});

describe("Storm — per-copy retarget (CR 707.10b / 707.12c, S5)", () => {
    it("offers a retarget and auto-resolves when there is NO legal alternative (Arena-style zero-branch)", () => {
        const shroudSource = makeInstance(SHROUD_SOURCE_ID, {
            id: "shroud-src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [shroudSource],
                    library: fillLibrary(20, "p1"),
                }),
                makePlayer("p2", { library: fillLibrary(20, "p2") }),
            ],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bolt);
        resolveTopOfStack(state); // unrelated prior spell (count -> 1)

        const bf = pushSpell(state, brainFreeze.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bf); // priorSpellCount = 1 -> 1 copy

        resolveTopOfStack(state); // storm trigger: creates the 1 copy, pops
        // p1 is shrouded (cantBeTargeted) — p2 (the current target) is the
        // ONLY legal target, so there is no real alternative: no prompt.
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack).toHaveLength(2); // the copy + the original, both unresolved

        resolveTopOfStack(state); // the copy resolves (kept its inherited target, p2)
        resolveTopOfStack(state); // the original resolves too
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(6); // 2 instances * 3 mills
    });

    it("N copies drain N sequential retargets through the real mutation path without stalling", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: fillLibrary(20, "p1") }),
                makePlayer("p2", { library: fillLibrary(20, "p2") }),
            ],
        });
        for (let i = 0; i < 2; i++) {
            const bolt = pushSpell(state, lightningBolt.id, "p1", [
                { type: "player", id: "p2" },
            ]);
            emitSpellCastEvent(state, bolt);
            resolveTopOfStack(state);
        }
        const bf = pushSpell(state, brainFreeze.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bf); // priorSpellCount = 2 -> 2 copies

        // Copy #1: created + retarget offered (2 legal players, a real
        // choice) -> suspends.
        resolveTopOfStack(state);
        expect(state.pendingTarget?.kind).toBe("copy-retarget");
        const copy1Id = state.pendingTarget!.cardInstanceId;
        applyCopyRetarget(state, [{ type: "player", id: "p1" }]); // redirect at p1

        // Copy #2: created + retarget offered again -> suspends.
        resolveTopOfStack(state);
        expect(state.pendingTarget?.kind).toBe("copy-retarget");
        const copy2Id = state.pendingTarget!.cardInstanceId;
        expect(copy2Id).not.toBe(copy1Id);
        applyCopyRetarget(state, [{ type: "player", id: "p2" }]); // keep at p2

        // Trigger fully resolves now (0 copies remaining) -> pops; then each
        // copy and the original resolve in turn (CR 608.3, one at a time) —
        // no further retarget prompts (only COPIES offer one, never the
        // original, and both copies are already answered).
        drainStack(state);
        expect(state.stack).toHaveLength(0);

        // p1's graveyard: the 2 priming Lightning Bolts (CR 608.2m — a
        // resolved instant/sorcery goes to its OWNER's graveyard; p1 cast
        // both) + copy1 (redirected to p1) milling 3 + Brain Freeze's own
        // card landing in its owner's (p1's) graveyard after it resolves =
        // 2 + 3 + 1 = 6.
        expect(state.players[0].graveyard).toHaveLength(6);
        // p2's graveyard: copy2 (kept at p2) milling 3 + the original's own
        // effect (still targeting p2) milling 3 = 6. p2 cast nothing, so no
        // spell cards land in its own graveyard.
        expect(state.players[1].graveyard).toHaveLength(6);
    });
});

describe("Storm — wire format (projectPublicState, S4)", () => {
    it("priorSpellCount and the storm trigger stack item survive the projection", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bolt);
        resolveTopOfStack(state);

        const gs = pushSpell(state, grapeshot.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, gs); // priorSpellCount = 1

        const projected = projectPublicState(state, 1, "p1");
        const slimTrigger = projected.stack.find(
            (s) => s.triggeredAbilityId === "storm"
        );
        expect(slimTrigger).toBeDefined();
        expect(slimTrigger!.stormCopiesRemaining).toBe(1);
        expect(
            (slimTrigger!.triggerEvent as { priorSpellCount?: number })
                ?.priorSpellCount
        ).toBe(1);
        // The internal detached snapshot is an engine artifact, not sent to
        // the client (see slimCard, gameProjections.ts).
        expect(
            (slimTrigger as unknown as { stormSnapshot?: unknown })
                .stormSnapshot
        ).toBeUndefined();
    });
});

describe("Storm — serialize round-trip (S3)", () => {
    it("spellsCastThisTurn round-trips through the DB compact/expand form", () => {
        const state = makeState();
        state.spellsCastThisTurn = 4;
        const round = expandState(compactState(state));
        expect(round.spellsCastThisTurn).toBe(4);
    });

    it("a mid-resolution storm trigger (stormSnapshot + stormCopiesRemaining) survives a save/load", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bolt);
        resolveTopOfStack(state);

        const gs = pushSpell(state, grapeshot.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, gs); // priorSpellCount = 1, trigger on stack, not yet resolved

        const round = expandState(compactState(state));
        const trigger = round.stack.find(
            (s) => s.triggeredAbilityId === "storm"
        );
        expect(trigger).toBeDefined();
        expect(trigger!.stormCopiesRemaining).toBe(1);
        expect(trigger!.stormSnapshot).toBeDefined();
        expect((trigger!.stormSnapshot!.card as { id: string }).id).toBe(
            grapeshot.id
        );

        // Resolution continues correctly after the round-trip (declining the
        // copy's retarget offer, keeping its inherited target).
        drainStack(round);
        expect(round.stack).toHaveLength(0);
        // Lightning Bolt (3) + the storm copy (1) + the original Grapeshot
        // (1), all at p2: 20 - 3 - 1 - 1 = 15.
        expect(round.players[1].life).toBe(15);
    });
});
