// CLB multicolor card tests.
//
// Minsc & Boo, Timeless Heroes is the tracer for the `reflexiveTrigger` Op
// (CR 603.3c), `sacrifice`'s `bind` snapshot (CR 608.2h) and
// `TargetRequirement.requireAbilityAny` (CR 702 OR-of-keywords) — each earns
// its coverage in the engine suites (`gre/effects/__tests__/interpreter.test.ts`,
// `gre/__tests__/targeting.test.ts`). What this file adds is the CARD: the
// three clauses wired together, driven through the real stack.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../../gre/triggers";
import { projectPublicState } from "../../../../gameProjections";
import { checkStateBasedActions } from "../../../../gre/sba";
import { getLegalTargets } from "../../../../gre/rules";
import { minscAndBooTimelessHeroes } from "../multicolor";
import { grizzlyBears } from "../../lea/green";
import { tryGetDefinition } from "../../../index";

const MINSC = minscAndBooTimelessHeroes.id;

/** Minsc on p1's battlefield with its starting loyalty. */
function minscOnBoard(extra: Partial<GameState> = {}): {
    state: GameState;
    minsc: CardInstanceState;
} {
    const minsc = makeInstance(MINSC, {
        id: "minsc",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty: 3 },
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [minsc] }), makePlayer("p2")],
        ...extra,
    });
    return { state, minsc: state.players[0].battlefield[0] };
}

/** Activates one of Minsc's loyalty abilities through the real stack. */
function activate(
    state: GameState,
    minsc: CardInstanceState,
    abilityId: string,
    targets: GameState["stack"][number]["targets"] = []
): void {
    state.stack.push({
        ...minsc,
        zone: "stack",
        castById: minsc.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

describe("Minsc & Boo, Timeless Heroes — the Boo trigger (CR 603.2, one Oracle line over two events)", () => {
    it("is ONE ability listening on BOTH the ETB and the upkeep event (never two near-duplicates)", () => {
        expect(minscAndBooTimelessHeroes.triggeredAbilities).toHaveLength(1);
        expect(minscAndBooTimelessHeroes.triggeredAbilities![0].event).toEqual([
            "PERMANENT_ENTERED",
            "PHASE_BEGIN",
        ]);
    });

    it("creates Boo — a legendary 1/1 red Hamster with trample and haste — when you accept (CR 117.3a)", () => {
        const { state } = minscOnBoard();
        // Fire the ETB half through the real trigger scan.
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "minsc",
                controllerId: "p1",
                cardId: MINSC,
                types: ["Planeswalker"],
            },
        ]);
        expect(triggers).toHaveLength(1);
        placeTriggersOnStack(state, triggers);
        resolveTopOfStack(state);

        console.log(
            "DBG1",
            JSON.stringify({
                choices: state.pendingChoices,
                stack: state.stack.map((s) => ({
                    id: s.id,
                    tr: s.triggeredAbilityId,
                })),
            })
        );
        // The "you may" suspends on a may-pay decision; accept it.
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        console.log(
            "DBG",
            JSON.stringify({
                bf: state.players[0].battlefield.map((c) => ({
                    id: c.id,
                    tok: c.isToken,
                    sub: c.subtypes,
                })),
                choices: (state.pendingChoices ?? []).length,
                stack: state.stack.length,
            })
        );
        const boo = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes.includes("Hamster")
        );
        expect(boo).toBeDefined();
        expect(boo!.power).toBe(1);
        expect(boo!.toughness).toBe(1);
        // CR 704.5j — the legend rule reads the token's DEFINITION (`sba.ts`
        // `isLegendaryPermanent`), which is where a token spec's supertypes
        // land; assert through that same path rather than the raw instance.
        expect(
            tryGetDefinition((boo!.card as { id: string }).id)?.supertypes
        ).toContain("Legendary");
        expect(boo!.staticAbilities).toEqual(
            expect.arrayContaining(["trample", "haste"])
        );
    });

    it("declining the may-pay creates nothing (CR 117.3a)", () => {
        const { state } = minscOnBoard();
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "minsc",
                controllerId: "p1",
                cardId: MINSC,
                types: ["Planeswalker"],
            },
        ]);
        placeTriggersOnStack(state, triggers);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].battlefield.some((c) => c.isToken)).toBe(false);
    });

    it("also fires at the beginning of YOUR upkeep, and not on the opponent's (CR 603.2)", () => {
        const { state } = minscOnBoard();
        const yours = collectTriggers(state, [
            {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: "p1",
            },
        ]);
        expect(yours).toHaveLength(1);
        const theirs = collectTriggers(state, [
            {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: "p2",
            },
        ]);
        expect(theirs).toHaveLength(0);
    });
});

describe("Minsc & Boo, Timeless Heroes — +1 (CR 702 'trample or haste')", () => {
    it("offers only creatures with trample OR haste as legal targets", () => {
        const trampler = makeInstance(grizzlyBears.id, {
            id: "trampler",
            controllerId: "p1",
            staticAbilities: ["trample"],
        });
        const hasty = makeInstance(grizzlyBears.id, {
            id: "hasty",
            controllerId: "p2",
            staticAbilities: ["haste"],
        });
        const vanilla = makeInstance(grizzlyBears.id, {
            id: "vanilla",
            controllerId: "p2",
            staticAbilities: [],
        });
        const minsc = makeInstance(MINSC, {
            id: "minsc",
            controllerId: "p1",
            counters: { loyalty: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [minsc, trampler] }),
                makePlayer("p2", { battlefield: [hasty, vanilla] }),
            ],
        });
        const req = minscAndBooTimelessHeroes.activatedAbilities!.find(
            (a) => a.id === "minsc-and-boo-plus1"
        )!.targetRequirement!;
        const legal = getLegalTargets(state, req, [], "p1");
        expect(legal.map((t) => t.id).sort()).toEqual(["hasty", "trampler"]);
    });

    it("puts three +1/+1 counters on the announced target, and the counters survive the wire projection", () => {
        const trampler = makeInstance(grizzlyBears.id, {
            id: "trampler",
            controllerId: "p1",
            staticAbilities: ["trample"],
        });
        const { state, minsc } = minscOnBoard();
        state.players[0].battlefield.push(trampler);
        activate(state, minsc, "minsc-and-boo-plus1", [
            { type: "permanent", id: "trampler" },
        ]);
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "trampler"
        )!;
        expect(onBoard.counters?.["+1/+1"]).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "trampler"
        )!;
        expect(slim.counters?.["+1/+1"]).toBe(3);
    });

    it("resolves as a no-op when no target was announced ('up to one', CR 608.2b)", () => {
        const { state, minsc } = minscOnBoard();
        expect(() =>
            activate(state, minsc, "minsc-and-boo-plus1", [])
        ).not.toThrow();
    });
});

describe("Minsc & Boo, Timeless Heroes — −2 (reflexive trigger, CR 603.3c)", () => {
    /** Minsc plus one sacrificeable creature under p1's control. */
    function boardWithFodder(
        fodder: Partial<CardInstanceState> = {}
    ): GameState {
        const bear = makeInstance(grizzlyBears.id, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
            ...fodder,
        });
        const minsc = makeInstance(MINSC, {
            id: "minsc",
            controllerId: "p1",
            ownerId: "p1",
            counters: { loyalty: 3 },
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [minsc, bear] }),
                makePlayer("p2"),
            ],
        });
    }

    it("sacrifices the chosen creature, then burns for its power via a SEPARATE stack object whose target is chosen afterwards (CR 603.3c/603.3d + 608.2h)", () => {
        const state = boardWithFodder();
        const minsc = state.players[0].battlefield[0];
        activate(state, minsc, "minsc-and-boo-minus2");

        // CR 701.16 — the sacrifice is an effect, so the player picks.
        const pick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["fodder"],
        });
        expect(
            state.players[0].battlefield.some((c) => c.id === "fodder")
        ).toBe(false);

        // The reflexive ability is now its own object on the stack.
        const reflexive = state.stack.find((s) => s.reflexiveTrigger)!;
        expect(reflexive).toBeDefined();
        expect(reflexive.controllerId).toBe("p1");

        // CR 603.3d — its target is announced HERE, after the sacrifice.
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [{ type: "player", id: "p2" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);

        // Grizzly Bears is a 2/2 — X = 2, read from the pre-sacrifice
        // snapshot even though the creature is in the graveyard by now.
        expect(state.players[1].life).toBe(18);
    });

    it("draws X cards when the sacrificed creature was a Hamster — feeding Boo to the −2 (the card's own synergy)", () => {
        // The Hamster gate reads the sacrificed card's DEFINITION subtypes in
        // its owner's graveyard, so this has to be a REAL Boo token, not a
        // creature with an overridden instance subtype.
        const { state } = minscOnBoard();
        state.players[0].library = [
            makeInstance(grizzlyBears.id, { id: "lib1", controllerId: "p1" }),
        ];
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "minsc",
                controllerId: "p1",
                cardId: MINSC,
                types: ["Planeswalker"],
            },
        ]);
        placeTriggersOnStack(state, triggers);
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        const boo = state.players[0].battlefield.find((c) => c.isToken)!;

        const minsc = state.players[0].battlefield.find(
            (c) => c.id === "minsc"
        )!;
        activate(state, minsc, "minsc-and-boo-minus2");
        const pick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: [boo.id],
        });
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [{ type: "player", id: "p2" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        // CR 704.5d — run state-based actions before the reflexive trigger
        // resolves, exactly as the engine does between priority passes. This
        // is what makes the sacrificed Boo TOKEN cease to exist: a graveyard
        // lookup here finds nothing, so the Hamster gate must read the
        // CR 608.2h snapshot instead (regression — the draw silently never
        // fired when the gate read the graveyard).
        checkStateBasedActions(state);
        expect(state.players[0].graveyard.some((c) => c.id === boo.id)).toBe(
            false
        );

        resolveTopOfStack(state);
        // Boo is a 1/1 → 1 damage and 1 card.
        expect(state.players[1].life).toBe(19);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib1"]);
    });

    it("does NOT draw when the sacrificed creature was not a Hamster", () => {
        const state = boardWithFodder();
        state.players[0].library = [
            makeInstance(grizzlyBears.id, { id: "lib1", controllerId: "p1" }),
        ];
        const minsc = state.players[0].battlefield[0];
        activate(state, minsc, "minsc-and-boo-minus2");
        const pick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["fodder"],
        });
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [{ type: "player", id: "p2" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("nothing triggers when there is no creature to sacrifice (CR 603.3c)", () => {
        const { state, minsc } = minscOnBoard();
        activate(state, minsc, "minsc-and-boo-minus2");
        expect(state.stack.some((s) => s.reflexiveTrigger)).toBe(false);
        expect(state.players[1].life).toBe(20);
    });
});
