// CR 702.26 — the phasing keyword: the toggle of the untap step (CR 502.1) and
// the rules that reach a phased-out permanent. The `phaseOut` Op has its own
// tests in `effects/__tests__/interpreter.test.ts`.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { finalizeCleanup, untapStep } from "../phases";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { checkStateBasedActions } from "../sba";
import type { CardInstanceState, GameState } from "../state";
import { phaseOutPermanent } from "../state";

const creature = (id: string, staticAbilities: string[] = []): CardDefinition =>
    ({
        id,
        name: id,
        manaCost: { X: 1 },
        types: ["Creature"],
        subtypes: ["Bear"],
        power: 2,
        toughness: 2,
        staticAbilities,
    }) as unknown as CardDefinition;

const PHASER = creature("test-phasing-phaser", ["phasing"]);
const DOUBLE_PHASER = creature("test-phasing-double", ["phasing", "phasing"]);
const BEAR = creature("test-phasing-bear");
const OPTIONAL_UNTAPPER = creature("test-phasing-optional", [
    "may-choose-not-to-untap",
]);
const ANTHEM = {
    ...creature("test-phasing-anthem"),
    staticEffects: [
        {
            kind: "pt-buff",
            power: 1,
            toughness: 1,
            applies: () => true,
            appliesTo: "all-creatures",
        },
    ],
} as unknown as CardDefinition;
const CURSE = {
    id: "test-phasing-curse",
    name: "test-phasing-curse",
    manaCost: { X: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: ["Creature"], count: 1 },
    compiledStaticEffects: [
        { kind: "keyword-grant", appliesTo: "host", keyword: "phasing" },
    ],
} as unknown as CardDefinition;
const PLAIN_AURA = {
    ...CURSE,
    id: "test-phasing-aura",
    name: "test-phasing-aura",
    compiledStaticEffects: [],
} as unknown as CardDefinition;
const PHASING_AURA = {
    ...PLAIN_AURA,
    id: "test-phasing-phasing-aura",
    name: "test-phasing-phasing-aura",
    staticAbilities: ["phasing"],
} as unknown as CardDefinition;
const EQUIPMENT = {
    id: "test-phasing-equipment",
    name: "test-phasing-equipment",
    manaCost: { X: 1 },
    types: ["Artifact"],
    subtypes: ["Equipment"],
    staticAbilities: ["phasing"],
} as unknown as CardDefinition;

function withDefinitions<T>(run: () => T): T {
    const defs = [
        PHASER,
        DOUBLE_PHASER,
        BEAR,
        OPTIONAL_UNTAPPER,
        ANTHEM,
        CURSE,
        PLAIN_AURA,
        PHASING_AURA,
        EQUIPMENT,
    ];
    const nest = (i: number): T =>
        i === defs.length
            ? run()
            : withTemporaryDefinition(defs[i], () => nest(i + 1));
    return nest(0);
}

function instance(
    def: CardDefinition,
    id: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(def.id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        staticAbilities: [...(def.staticAbilities ?? [])],
        ...overrides,
    });
}

function board(p1: CardInstanceState[], p2: CardInstanceState[] = []) {
    return makeState({
        phase: "UNTAP",
        players: [
            makePlayer("p1", { battlefield: p1 }),
            makePlayer("p2", { battlefield: p2 }),
        ],
    });
}

/** The next turn's untap step, for `activePlayerId`. */
function nextUntap(state: GameState, activePlayerId: string): void {
    state.turn += 1;
    state.activePlayerId = activePlayerId;
    state.priorityPlayerId = activePlayerId;
    state.phase = "UNTAP";
    untapStep(state);
}

const battlefieldIds = (state: GameState, seat: number) =>
    state.players[seat].battlefield.map((c) => c.id);
const phasedOutIds = (state: GameState) =>
    (state.phasedOut ?? []).flatMap((b) => b.cards.map((c) => c.id));

describe("phasing keyword — the untap-step toggle (CR 702.26a, CR 502.1)", () => {
    it("phases out at its controller's untap step and back in at the next one", () => {
        withDefinitions(() => {
            const state = board([instance(PHASER, "ph")]);
            nextUntap(state, "p1");
            expect(battlefieldIds(state, 0)).toEqual([]);
            expect(phasedOutIds(state)).toEqual(["ph"]);
            nextUntap(state, "p1");
            expect(battlefieldIds(state, 0)).toEqual(["ph"]);
            expect(phasedOutIds(state)).toEqual([]);
            nextUntap(state, "p1");
            expect(phasedOutIds(state)).toEqual(["ph"]);
        });
    });

    it("toggles only for the active player (CR 702.26a)", () => {
        withDefinitions(() => {
            const state = board([instance(PHASER, "ph")]);
            nextUntap(state, "p2");
            expect(battlefieldIds(state, 0)).toEqual(["ph"]);
            nextUntap(state, "p1");
            expect(phasedOutIds(state)).toEqual(["ph"]);
            nextUntap(state, "p2");
            expect(phasedOutIds(state)).toEqual(["ph"]);
        });
    });

    it("a permanent that phases in does not phase straight back out", () => {
        withDefinitions(() => {
            const state = board([instance(PHASER, "ph")]);
            nextUntap(state, "p1");
            state.turn += 1;
            state.activePlayerId = "p1";
            untapStep(state);
            expect(battlefieldIds(state, 0)).toEqual(["ph"]);
        });
    });

    it("phases in tapped, then untaps in the same step (CR 502.1, 502.3)", () => {
        withDefinitions(() => {
            const state = board([instance(PHASER, "ph", { isTapped: true })]);
            nextUntap(state, "p1");
            expect(phasedOutIds(state)).toEqual(["ph"]);
            nextUntap(state, "p1");
            const back = state.players[0].battlefield[0];
            expect(back.isTapped).toBe(false);
        });
    });

    it("a resumed untap step does not toggle a second time (CR 502.1)", () => {
        withDefinitions(() => {
            // The optional-untap prompt, with no restriction before it, resumes
            // with `restrictionCursor` still 0.
            const state = board([
                instance(PHASER, "ph"),
                instance(OPTIONAL_UNTAPPER, "opt", { isTapped: true }),
            ]);
            nextUntap(state, "p1");
            expect(state.pendingChoices?.[0]?.kind).toBe("untap-pick");
            expect(phasedOutIds(state)).toEqual(["ph"]);
            // Phase `ph` back in on the next turn, and answer that prompt.
            state.pendingChoices = undefined;
            state.pendingUntapStep = undefined;
            nextUntap(state, "p1");
            expect(battlefieldIds(state, 0)).toContain("ph");
            const head = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: [],
            });
            expect(battlefieldIds(state, 0)).toContain("ph");
            expect(phasedOutIds(state)).toEqual([]);
        });
    });

    it("a skipped untap step has no phasing event (CR 702.26m)", () => {
        withDefinitions(() => {
            const stasis = {
                ...BEAR,
                id: "test-phasing-skip",
                name: "test-phasing-skip",
                staticEffects: [
                    {
                        kind: "untap-restriction",
                        filter: {},
                        maxUntap: 0,
                        skipsStep: true,
                        oracleText: "Players skip their untap steps.",
                    },
                ],
            } as unknown as CardDefinition;
            withTemporaryDefinition(stasis, () => {
                const state = board([
                    instance(PHASER, "ph"),
                    instance(stasis, "stasis"),
                ]);
                nextUntap(state, "p1");
                expect(battlefieldIds(state, 0)).toContain("ph");
                expect(phasedOutIds(state)).toEqual([]);
            });
        });
    });

    it("multiple instances are redundant (CR 702.26p)", () => {
        withDefinitions(() => {
            const state = board([instance(DOUBLE_PHASER, "ph")]);
            nextUntap(state, "p1");
            expect(state.phasedOut).toHaveLength(1);
            expect(phasedOutIds(state)).toEqual(["ph"]);
        });
    });

    it("phasing granted by an Aura toggles the host and takes the Aura along (CR 702.26g)", () => {
        withDefinitions(() => {
            const state = board([
                instance(BEAR, "bear"),
                instance(CURSE, "curse", { attachedTo: "bear", staticSeq: 1 }),
            ]);
            checkStateBasedActions(state);
            nextUntap(state, "p1");
            expect(state.phasedOut).toHaveLength(1);
            expect(state.phasedOut![0].cards.map((c) => c.id)).toEqual([
                "bear",
                "curse",
            ]);
            nextUntap(state, "p1");
            const back = battlefieldIds(state, 0);
            expect(back).toContain("bear");
            expect(back).toContain("curse");
            expect(
                state.players[0].battlefield.find((c) => c.id === "curse")!
                    .attachedTo
            ).toBe("bear");
        });
    });

    it("crosses the wire as a public phased-out bundle (CR 702.26b)", () => {
        withDefinitions(() => {
            const state = board([instance(PHASER, "ph")]);
            nextUntap(state, "p1");
            const projected = projectPublicState(state, 1, "p2");
            expect(projected.players[0].battlefield).toHaveLength(0);
            expect(projected.phasedOut![0].cards[0].id).toBe("ph");
        });
    });
});

describe("attachments that phase (CR 702.26g, 702.26h, 702.26i, 702.26j)", () => {
    it("takes an attachment's own attachment along (CR 702.26g)", () => {
        withDefinitions(() => {
            const state = board([
                instance(PHASER, "ph"),
                instance(EQUIPMENT, "eq", { attachedTo: "ph" }),
                instance(PLAIN_AURA, "aura", { attachedTo: "eq" }),
            ]);
            nextUntap(state, "p1");
            expect(state.players[0].battlefield).toEqual([]);
            expect(phasedOutIds(state).sort()).toEqual(["aura", "eq", "ph"]);
            expect(state.players[0].graveyard).toEqual([]);
        });
    });

    it("an attachment that would phase both ways just goes with its host (CR 702.26h)", () => {
        withDefinitions(() => {
            const state = board([
                instance(EQUIPMENT, "eq", { attachedTo: "ph" }),
                instance(PHASER, "ph"),
            ]);
            nextUntap(state, "p1");
            expect(state.phasedOut).toHaveLength(1);
            expect(state.phasedOut![0].cards[0].id).toBe("ph");
            expect(phasedOutIds(state).sort()).toEqual(["eq", "ph"]);
            nextUntap(state, "p1");
            expect(
                state.players[0].battlefield.find((c) => c.id === "eq")!
                    .attachedTo
            ).toBe("ph");
        });
    });

    it("an attachment that phased out directly returns to its host if it is still there (CR 702.26i)", () => {
        withDefinitions(() => {
            const state = board([
                instance(BEAR, "bear"),
                instance(PHASING_AURA, "aura", { attachedTo: "bear" }),
            ]);
            nextUntap(state, "p1");
            expect(battlefieldIds(state, 0)).toEqual(["bear"]);
            nextUntap(state, "p1");
            checkStateBasedActions(state);
            expect(battlefieldIds(state, 0)).toContain("aura");
            expect(
                state.players[0].battlefield.find((c) => c.id === "aura")!
                    .attachedTo
            ).toBe("bear");
        });
    });

    it("an Aura whose host left phases in unattached and the SBA takes it (CR 702.26i, 704.5m)", () => {
        withDefinitions(() => {
            const state = board([
                instance(BEAR, "bear"),
                instance(PHASING_AURA, "aura", { attachedTo: "bear" }),
            ]);
            nextUntap(state, "p1");
            state.players[0].battlefield = [];
            nextUntap(state, "p1");
            checkStateBasedActions(state);
            expect(state.players[0].battlefield).toEqual([]);
            expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
                "aura",
            ]);
        });
    });

    it("an Equipment whose host left phases in unattached and stays (CR 702.26i, 704.5n)", () => {
        withDefinitions(() => {
            const state = board([
                instance(BEAR, "bear"),
                instance(EQUIPMENT, "eq", { attachedTo: "bear" }),
            ]);
            nextUntap(state, "p1");
            expect(phasedOutIds(state)).toEqual(["eq"]);
            state.players[0].battlefield = [];
            nextUntap(state, "p1");
            checkStateBasedActions(state);
            const eq = state.players[0].battlefield.find((c) => c.id === "eq")!;
            expect(eq.attachedTo).toBeUndefined();
        });
    });
});

describe("what reaches a phased-out permanent (CR 702.26b, 702.26f, 514.2)", () => {
    it("removes marked damage from a phased-out permanent at cleanup (CR 514.2)", () => {
        withDefinitions(() => {
            const state = board([instance(BEAR, "bear", { damageMarked: 1 })]);
            state.phase = "CLEANUP";
            phaseOutPermanent(state, "bear", {
                returnOn: { kind: "untap-cycle" },
            });
            finalizeCleanup(state);
            expect(state.phasedOut![0].cards[0].damageMarked).toBeUndefined();
        });
    });

    it("a duration expires while phased out (CR 702.26f)", () => {
        withDefinitions(() => {
            const bear = instance(BEAR, "bear", {
                grantedAttackRequirements: [
                    { seq: 1, duration: { phase: "end-of-turn" } },
                ],
            });
            const state = board([bear]);
            state.phase = "CLEANUP";
            phaseOutPermanent(state, "bear", {
                returnOn: { kind: "untap-cycle" },
            });
            finalizeCleanup(state);
            expect(
                state.phasedOut![0].cards[0].grantedAttackRequirements
            ).toBeUndefined();
        });
    });

    it("a timed control change expires while out; it phases in under the old player, then reverts (CR 702.26a, 702.26d, 702.26f)", () => {
        withDefinitions(() => {
            const stolen = instance(BEAR, "stolen", {
                controllerId: "p1",
                ownerId: "p2",
                baseControllerId: "p2",
                controlChanges: [
                    {
                        auraId: "thief",
                        previousControllerId: "p2",
                        controllerId: "p1",
                        seq: 1,
                        duration: { phase: "end-of-turn" },
                    },
                ],
            } as Partial<CardInstanceState>);
            const state = board([stolen]);
            state.phase = "CLEANUP";
            phaseOutPermanent(state, "stolen", {
                returnOn: { kind: "untap-cycle" },
            });
            finalizeCleanup(state);
            expect(state.phasedOut![0].cards[0].controlChanges).toBeUndefined();
            // Not the untap step of the player control reverted to…
            nextUntap(state, "p2");
            expect(phasedOutIds(state)).toEqual(["stolen"]);
            // …the untap step of the player it phased out under.
            nextUntap(state, "p1");
            expect(phasedOutIds(state)).toEqual([]);
            expect(battlefieldIds(state, 1)).toEqual(["stolen"]);
        });
    });

    it("a host stolen by an Aura stays under the thief while it phases out and back in (CR 702.26a, 702.26d, 702.26g)", () => {
        withDefinitions(() => {
            const thief = {
                ...PLAIN_AURA,
                id: "test-phasing-thief",
                name: "test-phasing-thief",
                compiledStaticEffects: undefined,
                staticEffects: [
                    {
                        kind: "control-change",
                        applies: (
                            target: { id: string },
                            source: { attachedTo?: string }
                        ) => source.attachedTo === target.id,
                    },
                ],
            } as unknown as CardDefinition;
            withTemporaryDefinition(thief, () => {
                const state = board(
                    [instance(PHASER, "ph", { baseControllerId: "p1" })],
                    [
                        instance(thief, "thief", {
                            controllerId: "p2",
                            ownerId: "p2",
                            attachedTo: "ph",
                            staticSeq: 1,
                        }),
                    ]
                );
                checkStateBasedActions(state);
                expect(battlefieldIds(state, 1)).toContain("ph");

                nextUntap(state, "p2");
                expect(phasedOutIds(state).sort()).toEqual(["ph", "thief"]);
                expect(state.phasedOut![0].cards[0].controllerId).toBe("p2");

                // The owner's untap step is not the one it phased out under.
                nextUntap(state, "p1");
                expect(phasedOutIds(state).sort()).toEqual(["ph", "thief"]);

                nextUntap(state, "p2");
                expect(phasedOutIds(state)).toEqual([]);
                expect(battlefieldIds(state, 1).sort()).toEqual([
                    "ph",
                    "thief",
                ]);
            });
        });
    });

    it("a 'for as long as' duration tracking it ends for good (CR 702.26f)", () => {
        withDefinitions(() => {
            const state = board([
                instance(BEAR, "bear", {
                    sourceTappedPTMods: [
                        { sourceId: "gear", power: 2, toughness: -2 },
                    ],
                    untapLockedBy: ["gear"],
                    controlChanges: [
                        {
                            auraId: "lasting",
                            previousControllerId: "p1",
                            controllerId: "p1",
                        },
                        {
                            auraId: "gear",
                            previousControllerId: "p1",
                            controllerId: "p1",
                            condition: { kind: "source-tapped" },
                        },
                    ],
                } as Partial<CardInstanceState>),
            ]);
            phaseOutPermanent(state, "bear", {
                returnOn: { kind: "untap-cycle" },
            });
            const bundled = state.phasedOut![0].cards[0];
            expect(bundled.sourceTappedPTMods).toBeUndefined();
            expect(bundled.untapLockedBy).toBeUndefined();
            expect(bundled.controlChanges?.map((row) => row.auraId)).toEqual([
                "lasting",
            ]);
        });
    });

    it("a keyword granted by a source stops the moment the source phases out (CR 702.26b)", () => {
        withDefinitions(() => {
            const state = board([
                instance(BEAR, "bear"),
                instance(CURSE, "curse", { attachedTo: "bear", staticSeq: 1 }),
            ]);
            checkStateBasedActions(state);
            const bear = state.players[0].battlefield[0];
            expect(bear.staticAbilities).toContain("phasing");
            phaseOutPermanent(state, "curse", {
                returnOn: { kind: "untap-cycle" },
            });
            expect(bear.staticAbilities).not.toContain("phasing");
        });
    });

    it("a phased-out source stops applying its static effects (CR 702.26b)", () => {
        withDefinitions(() => {
            const held = instance(BEAR, "bear", {
                abilityLossHolds: [{ sourceId: "anthem", seq: 1 }],
            } as Partial<CardInstanceState>);
            const state = board([instance(ANTHEM, "anthem"), held]);
            phaseOutPermanent(state, "anthem", {
                returnOn: { kind: "untap-cycle" },
            });
            expect(
                state.players[0].battlefield[0].abilityLossHolds
            ).toBeUndefined();
        });
    });
});
