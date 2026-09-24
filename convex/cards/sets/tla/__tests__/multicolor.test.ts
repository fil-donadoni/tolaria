// TLA — multicolor card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    submitChoice,
} from "../../../__tests__/setup";
import {
    buildSpellContext,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
} from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { fireDelayedTriggers } from "../../../../gre/phases";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../../gre/triggers";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { backFaceDefinitionIdOf } from "../../../../gre/transform";
import { compactState, expandState } from "../../../../gre/serialize";
import { projectPublicState } from "../../../../gameProjections";
import type { PermanentView } from "../../../types";
import {
    getDefinition,
    tryGetDefinition,
    withTemporaryDefinition,
} from "../../../index";

const aang = getDefinition("fea89ca0-8070-4f28-9851-994314f9d248");
const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");
const bears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870"); // Grizzly Bears
const crawWurm = getDefinition("bfed1a95-bd67-4e16-a781-81866028af2f"); // Craw Wurm
const bolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a"); // Lightning Bolt

const mine = (defId: string, id: string, zone?: CardInstanceState["zone"]) =>
    makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        ...(zone ? { zone } : {}),
    });

/** A resolving-ability context not sitting on the stack, for driving the
 *  real entry / transform primitives from a test. */
function scratch(state: GameState) {
    const item = {
        ...mine(bolt.id, "scratch", "stack"),
        castById: "p1",
    } as StackItem;
    return buildSpellContext(state, item);
}

function onBattlefield(state: GameState, id: string) {
    return state.players[0].battlefield.find((c) => c.id === id);
}

/** Moves `id` off the battlefield and scans the departure's triggers. */
function leave(state: GameState, id: string): void {
    removePermanentTo(state, id, "graveyard");
    processPendingActionTriggers(state);
}

/** Resolves every "transform Aang" trigger on the stack, scheduling its
 *  delayed trigger. */
function resolveTransformTriggers(state: GameState): void {
    while (
        state.stack.some(
            (s) => s.triggeredAbilityId === "aang-at-the-crossroads-transform"
        )
    ) {
        resolveTopOfStack(state);
    }
}

// Runs FIRST, before any test in this file transforms an Aang: the back-face
// id must not yet have been registered by `transformPermanent`, so the lookup
// below is a genuine registry MISS decoded by `maybeSynthesizeToken`.
describe("Aang, Destined Savior — a cold decode keeps the back face's triggers alive (CR 712.8e, issue #3249)", () => {
    it("decodes the back-face id with a FIRING earthbend trigger, not the token codec's never-firing stub", () => {
        const backId = backFaceDefinitionIdOf(aang.id)!;
        const decoded = tryGetDefinition(backId)!;
        expect(decoded.name).toBe("Aang, Destined Savior");
        const earthbend = decoded.triggeredAbilities!.find(
            (t) => t.id === "aang-destined-savior-earthbend"
        )!;
        const self = mine(aang.id, "aang-view") as unknown as PermanentView;
        expect(
            earthbend.matches(
                {
                    type: "PHASE_BEGIN",
                    phase: "BEGINNING_OF_COMBAT",
                    activePlayerId: "p1",
                },
                self
            )
        ).toBe(true);
        expect(
            decoded.staticEffects?.some((e) => e.kind === "keyword-grant")
        ).toBe(true);
    });
});

describe("Aang, at the Crossroads — ETB look five, put a creature (CR 603.6a / 400.7, issue #3249)", () => {
    function aangEnters(): GameState {
        const library = [
            mine(bolt.id, "l1", "library"),
            mine(crawWurm.id, "l2", "library"),
            mine(bears.id, "l3", "library"),
            mine(forest.id, "l4", "library"),
            mine(bears.id, "l5", "library"),
            mine(forest.id, "l6", "library"),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library,
                    graveyard: [mine(aang.id, "aang", "graveyard")],
                }),
                makePlayer("p2"),
            ],
        });
        expect(
            scratch(state).returnToBattlefield("p1", "aang", "graveyard")
        ).toBe(true);
        processPendingActionTriggers(state);
        expect(state.stack[state.stack.length - 1]?.triggeredAbilityId).toBe(
            "aang-at-the-crossroads-etb"
        );
        expect(resolveTopOfStack(state)).toBeNull();
        return state;
    }

    it("offers the top five, only creatures with mana value 4 or less are keepable, and the pick is PUT onto the battlefield", () => {
        const state = aangEnters();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        expect(head.keepTo).toBe("battlefield");
        expect(head.candidateIds).toEqual(["l1", "l2", "l3", "l4", "l5"]);
        // Lightning Bolt (noncreature), Craw Wurm (mana value 6) and Forest are
        // never keepable.
        expect(head.eligibleIds).toEqual(["l3", "l5"]);
        expect(head.count).toEqual({ min: 0, max: 1 });
        expect(() => submitChoice(state, ["l2"])).toThrow();

        submitChoice(state, ["l3"]);
        const bear = onBattlefield(state, "l3");
        expect(bear).toBeDefined();
        expect(bear!.isSummoningSick).toBe(true);
        const library = state.players[0].library.map((c) => c.id);
        expect(library[0]).toBe("l6");
        expect(new Set(library)).toEqual(
            new Set(["l1", "l2", "l4", "l5", "l6"])
        );
    });

    it("declining is legal: nothing enters and all five go to the bottom", () => {
        const state = aangEnters();
        submitChoice(state, []);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["aang"]);
        const library = state.players[0].library.map((c) => c.id);
        expect(library[0]).toBe("l6");
        expect(library).toHaveLength(6);
    });
});

describe("Aang, at the Crossroads — delayed transform (CR 603.6c / 603.7a / 701.27f / 400.7, issue #3249)", () => {
    function board(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        mine(aang.id, "aang"),
                        mine(bears.id, "b1"),
                        mine(bears.id, "b2"),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(bears.id, {
                            id: "theirs",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
    }

    it("another creature you control leaving schedules the transform, which happens at the next upkeep", () => {
        const state = board();
        leave(state, "b1");
        resolveTransformTriggers(state);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].timing).toBe("next-upkeep");
        expect(onBattlefield(state, "aang")!.transformed).toBeFalsy();

        fireDelayedTriggers(state, "next-upkeep");
        resolveTopOfStack(state);
        const flipped = onBattlefield(state, "aang")!;
        expect(flipped.transformed).toBe(true);
        expect(getDefinition(flipped.card.id as string).name).toBe(
            "Aang, Destined Savior"
        );
        expect(getEffectivePower(state, flipped)).toBe(4);
        expect(getEffectiveToughness(state, flipped)).toBe(4);
        expect(flipped.staticAbilities).toContain("flying");
    });

    it("neither Aang himself nor an opponent's creature leaving triggers it", () => {
        const state = board();
        leave(state, "theirs");
        expect(
            state.stack.some(
                (s) =>
                    s.triggeredAbilityId === "aang-at-the-crossroads-transform"
            )
        ).toBe(false);
        leave(state, "aang");
        expect(
            state.stack.some(
                (s) =>
                    s.triggeredAbilityId === "aang-at-the-crossroads-transform"
            )
        ).toBe(false);
    });

    it("CR 400.7 — an Aang that left and came back before the upkeep is a new object and does not transform", () => {
        const state = board();
        leave(state, "b1");
        resolveTransformTriggers(state);
        removePermanentTo(state, "aang", "graveyard");
        expect(
            scratch(state).returnToBattlefield("p1", "aang", "graveyard")
        ).toBe(true);
        fireDelayedTriggers(state, "next-upkeep");
        const delayed = state.stack.find(
            (s) => s.delayedTriggerId !== undefined
        )!;
        state.stack = [delayed];
        resolveTopOfStack(state);
        expect(onBattlefield(state, "aang")!.transformed).toBeFalsy();
    });

    it("CR 701.27f — two creatures leaving schedule two transforms; the second finds Aang already transformed and does nothing", () => {
        const state = board();
        leave(state, "b1");
        resolveTransformTriggers(state);
        leave(state, "b2");
        resolveTransformTriggers(state);
        expect(state.delayedTriggers).toHaveLength(2);

        fireDelayedTriggers(state, "next-upkeep");
        expect(state.stack).toHaveLength(2);
        resolveTopOfStack(state);
        expect(onBattlefield(state, "aang")!.transformed).toBe(true);
        // A save between the two resolutions (the game waits on priority):
        // the fired trigger's `delayedOrigin` and Aang's transform stamp must
        // both survive the DB round trip, or the second trigger flips him back.
        const reloaded = expandState(compactState(state));
        resolveTopOfStack(reloaded);
        // Not flipped back to the front face.
        expect(onBattlefield(reloaded, "aang")!.transformed).toBe(true);
        expect(reloaded.stack).toHaveLength(0);
    });
});

describe("Aang, Destined Savior — back face (CR 712.8e / 613.1f / 701.66a, issue #3249)", () => {
    function transformedBoard(): GameState {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        mine(aang.id, "aang"),
                        mine(forest.id, "bent"),
                        mine(bears.id, "bear"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        scratch(state).transform({ type: "permanent", id: "aang" });
        expect(onBattlefield(state, "aang")!.transformed).toBe(true);
        return state;
    }

    function beginCombat(state: GameState, activePlayerId: string): void {
        state.activePlayerId = activePlayerId;
        placeTriggersOnStack(
            state,
            collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "BEGINNING_OF_COMBAT",
                    activePlayerId,
                },
            ])
        );
    }

    it("earthbend 2 at the beginning of combat on your turn: a 2/2 land creature with haste that survives SBAs", () => {
        const state = transformedBoard();
        beginCombat(state, "p1");
        expect(state.stack[state.stack.length - 1]?.triggeredAbilityId).toBe(
            "aang-destined-savior-earthbend"
        );
        raiseTriggerTargetSelection(state);
        expect(state.stack[state.stack.length - 1]?.targets).toEqual([
            { type: "permanent", id: "bent" },
        ]);
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        const bent = onBattlefield(state, "bent")!;
        expect(bent).toBeDefined();
        expect(bent.types).toEqual(
            expect.arrayContaining(["Land", "Creature"])
        );
        expect(bent.counters?.["+1/+1"]).toBe(2);
        expect(getEffectivePower(state, bent)).toBe(2);
        expect(getEffectiveToughness(state, bent)).toBe(2);
        expect(bent.staticAbilities).toContain("haste");
    });

    // The cold-decode test above memoizes Aang's back-face definition, so every
    // later transform in this file reuses it. A variant whose back face has a
    // different content-derived id has never been decoded: transforming it
    // goes through `registerBackFaceDefinition`, the path a live server takes.
    it("a back face first registered by the transform itself carries its triggered abilities", () => {
        const variant = {
            ...aang,
            id: "test-aang-registration-variant",
            backFace: { ...aang.backFace!, name: "Aang, Registration Savior" },
        };
        withTemporaryDefinition(variant, () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            mine(variant.id, "variant"),
                            mine(forest.id, "vland"),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
            scratch(state).transform({ type: "permanent", id: "variant" });
            expect(onBattlefield(state, "variant")!.transformed).toBe(true);
            beginCombat(state, "p1");
            expect(
                state.stack.some(
                    (s) =>
                        s.triggeredAbilityId ===
                        "aang-destined-savior-earthbend"
                )
            ).toBe(true);
        });
    });

    it("does not trigger at the beginning of the opponent's combat", () => {
        const state = transformedBoard();
        beginCombat(state, "p2");
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "aang-destined-savior-earthbend"
            )
        ).toBe(false);
    });

    it("land creatures you control have vigilance — a plain land and a nonland creature get nothing, through the wire too", () => {
        const state = transformedBoard();
        const plainLand = mine(forest.id, "plain");
        state.players[0].battlefield.push(plainLand);
        beginCombat(state, "p1");
        raiseTriggerTargetSelection(state);
        const trigger = state.stack[state.stack.length - 1]!;
        trigger.targets = [{ type: "permanent", id: "bent" }];
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        expect(onBattlefield(state, "bent")!.staticAbilities).toContain(
            "vigilance"
        );
        expect(onBattlefield(state, "plain")!.staticAbilities).not.toContain(
            "vigilance"
        );
        expect(onBattlefield(state, "bear")!.staticAbilities).not.toContain(
            "vigilance"
        );

        const projected = projectPublicState(state, 1, "p2");
        const slim = (id: string) =>
            projected.players[0].battlefield.find((c) => c.id === id)!;
        expect(slim("bent").staticAbilities).toContain("vigilance");
        expect(slim("plain").staticAbilities).not.toContain("vigilance");
        expect(slim("bear").staticAbilities).not.toContain("vigilance");
    });

    it("the front face's transform trigger is gone while transformed", () => {
        const state = transformedBoard();
        leave(state, "bear");
        expect(
            state.stack.some(
                (s) =>
                    s.triggeredAbilityId === "aang-at-the-crossroads-transform"
            )
        ).toBe(false);
    });
});
