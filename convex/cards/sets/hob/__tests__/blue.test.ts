// HOB blue — Bilbo, Thief in the Night (issue #7227).
//
// Runs the REAL definition: the attack trigger is collected from a real
// ATTACKERS_DECLARED event, each answer goes through `applyPendingChoiceSubmit`,
// and the spell's destination is read off the zones it reaches. CR 608.2g (the
// cast happens during the resolution), CR 614.1a (the exile rider replaces only
// a move to the graveyard), CR 601.2f (the static line discounts the cast).
import { describe, expect, it } from "vitest";
import { getDefinition, registerTokenDefinition } from "../../../index";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import {
    buildSpellContext,
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { collectTriggers } from "../../../../gre/triggers";
import { projectPublicState } from "../../../../gameProjections";
import { validateEffectScript } from "../../../../gre/effects/validate";
import type { CardDefinition, GameEvent } from "../../../types";

const BILBO = getDefinition("484c7f83-8339-4ae1-8350-68ce1f7d05a3").id;
const ISLAND = getDefinition("90a57c0e-fa61-45ef-955d-d296403967d5").id;

function register(
    id: string,
    types: CardDefinition["types"],
    extra: Partial<CardDefinition> = {}
): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        // {1}{U}: payable by one Island only under Bilbo's {1} discount.
        manaCost: { X: 1, U: 1 },
        types,
        ...extra,
    });
    return id;
}

const SORCERY = register("hob-test-sorcery", ["Sorcery"], {
    effects: [{ op: "draw", player: "controller", count: 1 }],
});
const INSTANT = register("hob-test-instant", ["Instant"], {
    effects: [{ op: "draw", player: "controller", count: 1 }],
});
const TARGETED = register("hob-test-targeted", ["Instant"], {
    targetRequirement: { type: "Creature", count: 1 },
    effects: [{ op: "destroy", target: { target: 0 } }],
});
const ARTIFACT = register("hob-test-artifact", ["Artifact"]);
const ARTIFACT_LAND = register("hob-test-artifact-land", ["Artifact", "Land"], {
    manaCost: {},
});
const CREATURE = register("hob-test-creature", ["Creature"], {
    power: 1,
    toughness: 1,
});
const COUNTERER = register("hob-test-counterer", ["Instant"]);

function graveyardCard(cardId: string, id = "spell"): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "graveyard",
    });
}

function board(
    graveyard: CardInstanceState[],
    opts: { bilbo?: boolean; islands?: number } = {}
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    ...(opts.bilbo === false
                        ? []
                        : [
                              makeInstance(BILBO, {
                                  id: "bilbo",
                                  controllerId: "p1",
                                  ownerId: "p1",
                              }),
                          ]),
                    ...Array.from({ length: opts.islands ?? 1 }, (_, i) =>
                        makeInstance(ISLAND, {
                            id: `island${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                ],
                graveyard,
                library: Array.from({ length: 3 }, (_, i) =>
                    makeInstance(CREATURE, {
                        id: `lib${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    })
                ),
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(CREATURE, {
                        id: "victim",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

/** Collects Bilbo's attack trigger from the real event and resolves it. */
function attack(state: GameState): void {
    const event = {
        type: "ATTACKERS_DECLARED",
        attackerIds: ["bilbo"],
        attackingPlayerId: "p1",
    } as unknown as GameEvent;
    const built = collectTriggers(state, [event]);
    expect(built).toHaveLength(1);
    state.stack.push(built[0] as StackItem);
    resolveTopOfStack(state);
}

function answer(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

/** Attack, pick `spell`, accept the Cast offer. */
function castFromGraveyard(state: GameState): StackItem {
    attack(state);
    answer(state, ["spell"]);
    expect(state.pendingChoices![0].options?.map((o) => o.id)).toContain(
        "cast"
    );
    answer(state, ["cast"]);
    return state.stack.find((s) => s.id === "spell")!;
}

/** A second spell, whose context performs the counter or the move. */
function p2Context(state: GameState) {
    const item = {
        ...makeInstance(COUNTERER, {
            id: "counterer",
            zone: "stack",
            controllerId: "p2",
            ownerId: "p2",
        }),
        castById: "p2",
    } as StackItem;
    state.stack.push(item);
    return buildSpellContext(state, item);
}

const p1 = (state: GameState) => getPlayer(state, "p1");
const holds = (zone: CardInstanceState[]) => zone.some((c) => c.id === "spell");

describe("Bilbo, Thief in the Night — the attack trigger (CR 608.2g)", () => {
    it("offers only castable artifact, instant and sorcery cards", () => {
        const state = board([
            graveyardCard(SORCERY, "a"),
            graveyardCard(INSTANT, "b"),
            graveyardCard(ARTIFACT, "c"),
            graveyardCard(CREATURE, "d"),
            graveyardCard(ARTIFACT_LAND, "e"),
        ]);
        attack(state);
        const pick = state.pendingChoices![0];
        expect(pick.kind).toBe("choose-graveyard-card");
        expect(pick.count).toEqual({ min: 0, max: 1 });
        expect([...(pick.candidateIds ?? [])].sort()).toEqual(["a", "b", "c"]);
    });

    it("reaches the caster's client through projectPublicState", () => {
        const state = board([graveyardCard(SORCERY)]);
        attack(state);
        const pick = projectPublicState(state, 1, "p1").pendingChoices?.[0];
        expect(pick?.kind).toBe("choose-graveyard-card");
        expect(pick?.candidateIds).toEqual(["spell"]);
        answer(state, ["spell"]);
        const offer = projectPublicState(state, 1, "p1").pendingChoices?.[0];
        expect(offer?.options?.map((o) => o.id)).toEqual(["cast", "decline"]);
    });

    it("the spell goes on the stack with no priority, from the graveyard", () => {
        const state = board([graveyardCard(SORCERY)]);
        const spell = castFromGraveyard(state);
        expect(spell.castById).toBe("p1");
        expect(spell.castFromZone).toBe("graveyard");
        expect(holds(p1(state).graveyard)).toBe(false);
    });

    it("picking nothing casts nothing and leaves the card", () => {
        const state = board([graveyardCard(SORCERY)]);
        attack(state);
        answer(state, []);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(holds(p1(state).graveyard)).toBe(true);
        expect(state.stack).toHaveLength(0);
    });

    it("declining grants no later window: the permission dies with the resolution", () => {
        const state = board([graveyardCard(SORCERY)]);
        attack(state);
        answer(state, ["spell"]);
        answer(state, ["decline"]);
        const card = p1(state).graveyard.find((c) => c.id === "spell")!;
        expect(card).toBeDefined();
        expect(card.castableFromGraveyardBy).toBeUndefined();
    });

    it("a targeted spell collects its target across the suspend, rider intact", () => {
        const state = board([graveyardCard(TARGETED)]);
        attack(state);
        answer(state, ["spell"]);
        answer(state, ["cast"]);
        expect(state.pendingChoices![0].kind).toBe("choose-damage-target");
        answer(state, ["victim"]);
        const spell = state.stack.find((s) => s.id === "spell")!;
        expect(spell.targets).toEqual([
            expect.objectContaining({ id: "victim" }),
        ]);
        expect(spell.exileOnResolve).toBe(true);
        // Exactly one cast: the `if` walked again after each suspend.
        expect(state.stack.filter((s) => s.id === "spell")).toHaveLength(1);
    });

    it("no qualifying card: nothing is asked", () => {
        const state = board([graveyardCard(CREATURE)]);
        attack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});

describe("Bilbo — the exile rider replaces the move to the graveyard (CR 614.1a)", () => {
    it("an instant cast this way is exiled as it resolves", () => {
        const state = board([graveyardCard(INSTANT)]);
        castFromGraveyard(state);
        resolveTopOfStack(state);
        expect(holds(p1(state).exile)).toBe(true);
        expect(holds(p1(state).graveyard)).toBe(false);
    });

    it("a countered sorcery is exiled, not put into the graveyard (CR 701.6a)", () => {
        const state = board([graveyardCard(SORCERY)]);
        castFromGraveyard(state);
        p2Context(state).counter({ type: "spell", id: "spell" }, "graveyard");
        expect(holds(p1(state).exile)).toBe(true);
        expect(holds(p1(state).graveyard)).toBe(false);
    });

    it("a fizzled instant is exiled (CR 608.2b)", () => {
        const state = board([graveyardCard(TARGETED)]);
        attack(state);
        answer(state, ["spell"]);
        answer(state, ["cast"]);
        answer(state, ["victim"]);
        const spell = state.stack.find((s) => s.id === "spell")!;
        spell.targets = [{ type: "permanent", id: "gone" }];
        state.stack = state.stack.filter((s) => s.id === "spell");
        resolveTopOfStack(state);
        expect(holds(p1(state).exile)).toBe(true);
        expect(holds(p1(state).graveyard)).toBe(false);
    });

    it("an instant returned to hand is not exiled: only the graveyard is replaced", () => {
        const state = board([graveyardCard(INSTANT)]);
        castFromGraveyard(state);
        p2Context(state).moveSpellFromStack(
            { type: "spell", id: "spell" },
            "hand"
        );
        expect(holds(p1(state).hand)).toBe(true);
        expect(holds(p1(state).exile)).toBe(false);
    });

    it("a countered ARTIFACT spell goes to the graveyard: the rider names instants and sorceries", () => {
        const state = board([graveyardCard(ARTIFACT)]);
        const spell = castFromGraveyard(state);
        expect(spell.exileOnResolve).toBeUndefined();
        p2Context(state).counter({ type: "spell", id: "spell" }, "graveyard");
        expect(holds(p1(state).graveyard)).toBe(true);
        expect(holds(p1(state).exile)).toBe(false);
    });

    it("an artifact spell resolves onto the battlefield", () => {
        const state = board([graveyardCard(ARTIFACT)]);
        castFromGraveyard(state);
        resolveTopOfStack(state);
        expect(holds(p1(state).battlefield)).toBe(true);
    });
});

describe("Bilbo — spells cast from anywhere other than your hand cost {1} less (CR 601.2f)", () => {
    it("pays {U} for a {1}{U} spell cast by the trigger: one Island taps", () => {
        const state = board([graveyardCard(SORCERY)], { islands: 1 });
        castFromGraveyard(state);
        expect(state.stack.some((s) => s.id === "spell")).toBe(true);
        expect(
            p1(state).battlefield.find((c) => c.id === "island0")!.isTapped
        ).toBe(true);
    });

    it("without the discount the same cast cannot be paid and stays in the graveyard", () => {
        const state = board([graveyardCard(SORCERY)], { islands: 1 });
        const bilbo = p1(state).battlefield.find((c) => c.id === "bilbo")!;
        attack(state);
        answer(state, ["spell"]);
        // Bilbo gone: the discount stops applying before the cast is paid.
        p1(state).battlefield = p1(state).battlefield.filter(
            (c) => c !== bilbo
        );
        const head = state.pendingChoices?.[0];
        if (head) answer(state, ["cast"]);
        expect(state.stack.some((s) => s.id === "spell")).toBe(false);
        expect(holds(p1(state).graveyard)).toBe(true);
    });
});

describe("castDuringResolution — validator", () => {
    it("refuses the rider with anyNumber, which never reaches it", () => {
        const errors = validateEffectScript({
            id: "t",
            name: "t",
            effects: [
                {
                    op: "choice",
                    kind: "choose-graveyard-card",
                    player: "controller",
                    zone: "graveyard",
                    count: { min: 0, max: 1 },
                    prompt: "Pick.",
                    bind: "$p",
                },
                {
                    op: "castDuringResolution",
                    card: { ref: "$p" },
                    player: "controller",
                    source: "graveyard",
                    anyNumber: true,
                    exilesOnResolve: true,
                },
            ],
        } as never);
        expect(errors.join()).toContain('"exilesOnResolve" is not valid');
    });
});
