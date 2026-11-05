// An as-enters copy of a card in a graveyard, its name exception and its linked
// "When you do, exile that card" (CR 614.12 / 707.2, CR 707.9b, CR 603.11 /
// 707.9g — issue #8041, the clause Superior Spider-Man prints).
import { describe, expect, it } from "vitest";
import {
    processPendingActionTriggers,
    putReanimatedSetOnBattlefield,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { eligibleZonePickCards } from "../zonePickEligibility";
import { compactState, expandState } from "../serialize";
import { checkStateBasedActions } from "../sba";
import { matchesBandQuality } from "../banding";
import { revertCopy } from "../copy";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../layers";
import { validateEffectScript } from "../effects/validate";
import { copyExceptName, objectHasChosenName } from "../../cards/cardNames";
import { tryGetDefinition } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { clone } from "../../cards/sets/lea/blue.cards";
import {
    forest,
    grizzlyBears,
    serraAngel,
} from "../../cards/sets/lea/index.cards";
import {
    graveyardCopyProbe,
    legend,
    LEGEND_ID,
    PROBE_ID,
    PROBE_NAME,
} from "./fixtures/graveyardCopyProbe.fixture";

function inZone(
    defId: string,
    id: string,
    ownerId: string,
    zone: "graveyard" | "battlefield"
): CardInstanceState {
    return makeInstance(defId, { id, controllerId: ownerId, ownerId, zone });
}

/** p1 casts the probe; `p1Yard` / `p2Yard` are the graveyards it may copy from. */
function cast(
    p1Yard: CardInstanceState[],
    p2Yard: CardInstanceState[],
    p1Board: CardInstanceState[] = []
): { state: GameState; probeId: string } {
    const state = makeState({
        players: [
            makePlayer("p1", { graveyard: p1Yard, battlefield: p1Board }),
            makePlayer("p2", { graveyard: p2Yard }),
        ],
    });
    const spell = pushSpell(state, PROBE_ID, "p1");
    resolveTopOfStack(state);
    return { state, probeId: spell.id };
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

function onBattlefield(state: GameState, id: string): CardInstanceState {
    const card = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === id);
    if (!card) throw new Error(`${id} is not on the battlefield`);
    return card;
}

const probed = <T>(fn: () => T): T =>
    withTemporaryDefinition(graveyardCopyProbe, fn);

const yards = () => ({
    mine: [inZone(forest().id, "forest", "p1", "graveyard")],
    theirs: [
        inZone(serraAngel().id, "angel", "p2", "graveyard"),
        inZone(grizzlyBears().id, "bears", "p2", "graveyard"),
    ],
});

describe("as-enters copy of a graveyard card (CR 614.12 / 707.2, issue #8041)", () => {
    it("offers matching cards in EVERY graveyard, optionally, off the battlefield", () => {
        probed(() => {
            const myCreature = inZone(
                grizzlyBears().id,
                "myBears",
                "p1",
                "graveyard"
            );
            const { mine, theirs } = yards();
            const { state, probeId } = cast([...mine, myCreature], theirs);

            const head = state.pendingChoices![0];
            expect(head.kind).toBe("choose-graveyard-card");
            expect(head.zone).toBe("graveyard");
            expect(head.asEntersKind).toBe("copy");
            expect(head.count).toEqual({ min: 0, max: 1 });
            // The land fails the filter; both graveyards answer.
            expect(head.candidateIds).toEqual(["myBears", "angel", "bears"]);
            // The Bot's and the legal-action enumerator's authority agrees.
            expect(
                eligibleZonePickCards(state, head)
                    .map((c) => c.id)
                    .sort()
            ).toEqual(["angel", "bears", "myBears"]);
            // CR 614.12a — chosen before it enters.
            expect(
                state.players[0].battlefield.some((c) => c.id === probeId)
            ).toBe(false);
        });
    });

    it("declines by itself when no card matches, entering as its printed self", () => {
        probed(() => {
            const { state, probeId } = cast(
                [inZone(forest().id, "forest", "p1", "graveyard")],
                []
            );
            expect(state.pendingChoices ?? []).toHaveLength(0);
            const entered = onBattlefield(state, probeId);
            expect(entered.copiedFrom).toBeUndefined();
            processPendingActionTriggers(state);
            expect(state.stack).toHaveLength(0);
        });
    });

    it("declining applies no copy and triggers nothing, the card staying put", () => {
        probed(() => {
            const { mine, theirs } = yards();
            const { state, probeId } = cast(mine, theirs);
            answer(state, []);
            processPendingActionTriggers(state);
            expect(onBattlefield(state, probeId).copiedFrom).toBeUndefined();
            expect(state.stack).toHaveLength(0);
            expect(state.players[1].graveyard).toHaveLength(2);
        });
    });

    it("enters as the copy with the whole clause, the trigger going on the stack", () => {
        probed(() => {
            const { mine, theirs } = yards();
            const { state, probeId } = cast(mine, theirs);
            answer(state, ["angel"]);
            processPendingActionTriggers(state);

            const entered = onBattlefield(state, probeId);
            expect(entered.copiedFrom).toBe(PROBE_ID);
            expect((entered.card as { id: string }).id).toBe(serraAngel().id);
            expect(copyExceptName(entered)).toBe(PROBE_NAME);
            expect(entered.staticAbilities).toContain("flying");
            expect(entered.subtypes).toEqual(
                expect.arrayContaining(["Angel", "Spider", "Human", "Hero"])
            );
            expect(getEffectivePower(state, entered)).toBe(4);
            expect(getEffectiveToughness(state, entered)).toBe(4);

            // CR 603.3 — on the stack, not done: the card waits in the graveyard.
            expect(state.players[1].graveyard.map((c) => c.id)).toContain(
                "angel"
            );
            const [trigger] = state.stack;
            expect(trigger.reflexiveTrigger).toBe(true);
            expect(trigger.controllerId).toBe("p1");
            expect(trigger.triggerSourceId).toBe(probeId);
            expect((trigger.card as { id: string }).id).toBe(PROBE_ID);

            resolveTopOfStack(state);
            // Into its OWNER's exile, whoever copied it.
            expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
                "bears",
            ]);
            expect(state.players[1].exile.map((c) => c.id)).toEqual(["angel"]);
            expect(state.players[0].exile).toHaveLength(0);
        });
    });

    it("a non-cast entry takes the same clause (the CR 614 chokepoint)", () => {
        probed(() => {
            const { theirs } = yards();
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", { graveyard: theirs }),
                ],
            });
            const lifted = inZone(PROBE_ID, "probe", "p1", "graveyard");
            putReanimatedSetOnBattlefield(state, [
                { card: lifted, controllerId: "p1" },
            ]);
            answer(state, ["bears"]);
            processPendingActionTriggers(state);
            expect(copyExceptName(onBattlefield(state, "probe"))).toBe(
                PROBE_NAME
            );
            expect(state.stack).toHaveLength(1);
        });
    });

    it("the trigger does nothing to a card that left the graveyard (CR 400.7 / 608.2b)", () => {
        probed(() => {
            for (const elsewhere of ["hand", "battlefield"] as const) {
                const { mine, theirs } = yards();
                const { state } = cast(mine, theirs);
                answer(state, ["angel"]);
                processPendingActionTriggers(state);
                const owner = state.players[1];
                const card = owner.graveyard.find((c) => c.id === "angel")!;
                owner.graveyard = owner.graveyard.filter((c) => c !== card);
                owner[elsewhere].push({ ...card, zone: elsewhere });

                resolveTopOfStack(state);
                expect(owner[elsewhere].some((c) => c?.id === "angel")).toBe(
                    true
                );
                expect(owner.exile).toHaveLength(0);
            }
        });
    });

    describe("CR 707.9g — a later copy effect takes the linked trigger with it", () => {
        const copiedClone = () =>
            cast(
                [],
                [inZone(clone().id, "clone", "p2", "graveyard")],
                [inZone(grizzlyBears().id, "bears", "p1", "battlefield")]
            );

        it("the copied Clone's own clause, answered, replaces name and trigger", () => {
            probed(() => {
                const { state, probeId } = copiedClone();
                answer(state, ["clone"]);
                // CR 707.6 — the owed list grew.
                expect(state.pendingChoices![0].kind).toBe("choose-permanents");
                answer(state, ["bears"]);
                processPendingActionTriggers(state);

                const entered = onBattlefield(state, probeId);
                expect((entered.card as { id: string }).id).toBe(
                    grizzlyBears().id
                );
                expect(copyExceptName(entered)).toBeUndefined();
                expect(state.stack).toHaveLength(0);
                expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
                    "clone",
                ]);
            });
        });

        it("the copied Clone's own clause, declined, leaves both standing", () => {
            probed(() => {
                const { state, probeId } = copiedClone();
                answer(state, ["clone"]);
                answer(state, []);
                processPendingActionTriggers(state);

                expect(copyExceptName(onBattlefield(state, probeId))).toBe(
                    PROBE_NAME
                );
                expect(state.stack).toHaveLength(1);
                resolveTopOfStack(state);
                expect(state.players[1].exile.map((c) => c.id)).toEqual([
                    "clone",
                ]);
            });
        });

        it("the trigger survives the save point between the two prompts", () => {
            probed(() => {
                const { state } = copiedClone();
                answer(state, ["clone"]);
                const reloaded = expandState(
                    JSON.parse(JSON.stringify(compactState(state)))
                );
                answer(reloaded, []);
                processPendingActionTriggers(reloaded);
                expect(reloaded.stack).toHaveLength(1);
            });
        });
    });

    it("the validator reads the linked trigger's body, `$copied` included", () => {
        expect(validateEffectScript(graveyardCopyProbe)).toEqual([]);
        const broken: typeof graveyardCopyProbe = {
            ...graveyardCopyProbe,
            entersWith: {
                asEnters: [
                    {
                        kind: "copy",
                        whenCopied: {
                            oracleText: "When you do, exile it.",
                            effects: [
                                {
                                    op: "moveZone",
                                    target: { ref: "$other" },
                                    from: "graveyard",
                                    to: "exile",
                                },
                            ],
                        },
                    },
                ],
            },
        };
        expect(validateEffectScript(broken).join("\n")).toMatch(/\$other/);
    });
});

describe("a copy effect's name exception (CR 707.9b, issue #8041)", () => {
    const copied = () => {
        const { mine, theirs } = yards();
        const { state, probeId } = cast(mine, theirs);
        answer(state, ["angel"]);
        return { state, entered: onBattlefield(state, probeId) };
    };

    it("is what the object is called, not what it copied", () => {
        probed(() => {
            const { entered } = copied();
            expect(STATIC_EFFECT_CTX.getName(entered)).toBe(PROBE_NAME);
            expect(
                objectHasChosenName(entered, PROBE_NAME, tryGetDefinition)
            ).toBe(true);
            expect(
                objectHasChosenName(
                    entered,
                    serraAngel().name,
                    tryGetDefinition
                )
            ).toBe(false);
            expect(
                matchesBandQuality(entered, {
                    kind: "name",
                    name: PROBE_NAME,
                })
            ).toBe(true);
        });
    });

    it("is inherited by a copy of the copy (CR 707.3)", () => {
        probed(() => {
            const { state, entered } = copied();
            const lifted = inZone(clone().id, "clone", "p1", "graveyard");
            putReanimatedSetOnBattlefield(state, [
                { card: lifted, controllerId: "p1" },
            ]);
            answer(state, [entered.id]);
            const second = onBattlefield(state, "clone");
            expect(copyExceptName(second)).toBe(PROBE_NAME);
            expect((second.card as { id: string }).id).toBe(serraAngel().id);
        });
    });

    it("hides on a face-down object, which has no name (CR 708.2)", () => {
        expect(
            copyExceptName({ faceDown: true, copyExcept: { name: PROBE_NAME } })
        ).toBeUndefined();
    });

    it("ends with the copy effect (CR 707.2)", () => {
        probed(() => {
            const { state, entered } = copied();
            revertCopy(state, entered);
            expect(copyExceptName(entered)).toBeUndefined();
        });
    });

    describe("CR 704.5j — the legend rule keys off the excepted name", () => {
        const legends = () =>
            cast(
                [],
                [inZone(LEGEND_ID, "gyLegend", "p2", "graveyard")],
                [inZone(LEGEND_ID, "bfLegend", "p1", "battlefield")]
            );
        const withLegend = <T>(fn: () => T): T =>
            probed(() => withTemporaryDefinition(legend, fn));

        it("does not group a copy with the card it copied", () => {
            withLegend(() => {
                const { state } = legends();
                answer(state, ["gyLegend"]);
                checkStateBasedActions(state);
                expect(state.pendingChoices ?? []).toHaveLength(0);
            });
        });

        it("groups two legendary copies sharing the excepted name", () => {
            withLegend(() => {
                const { state, probeId } = legends();
                answer(state, ["gyLegend"]);
                const twin = {
                    ...onBattlefield(state, probeId),
                    id: "twin",
                };
                state.players[0].battlefield.push(twin);
                checkStateBasedActions(state);
                expect(state.pendingChoices?.[0]?.kind).toBe("legend-keep");
            });
        });
    });
});
