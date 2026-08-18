// CR 614.12a — the as-enters MODE leg (ADR 0100 slice 2, issue #2019).
//
//   614.12a "If a replacement effect that modifies how a permanent enters the
//   battlefield requires a choice, that choice is made before the permanent
//   enters the battlefield."
//
// "As this permanent enters, choose a color" is a CR 614.1c replacement, so the
// pick belongs to the ENTRY moment on every entry path — not to cast
// announcement. Before this slice it was piggybacked on the CR 700.2c
// announcement-time modal pick (`castSpell`'s `chosenModeId` arg), so a
// permanent that entered without being cast — reanimation, a "put onto the
// battlefield" effect, a blink out of exile — carried no `chosenModeId` at all
// and every reader of it silently read false.
//
// These tests drive the SHIPPED cards through the real entry paths, and pin
// both sides of the boundary the slice moves: the entry pick must be raised on
// a non-cast entry, and the CAST path must raise it exactly ONCE (never twice,
// never zero times). The re-choice writer (`SpellContext.setChosenMode`,
// Chromatic Armor's {X} ability) is a DIFFERENT writer of the same field and
// must keep working untouched.
import { describe, expect, it } from "vitest";
import {
    buildSpellContext,
    putReanimatedSetOnBattlefield,
    resolveTopOfStack,
    type GameState,
} from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { getEffectiveManaChoices, declaresAsEntersMode } from "../constants";
import { getEffectivePower } from "../layers";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { voiceOfAll } from "../../cards/sets/pls/white";
import { prismaticWard } from "../../cards/sets/ice/white";
import { quirionElves } from "../../cards/sets/mir/green";
import { jihad, repentantBlacksmith } from "../../cards/sets/arn/white";
import { mijaeDjinn } from "../../cards/sets/arn/red";
import { visionCharm } from "../../cards/sets/vis/blue";
import { grizzlyBears } from "../../cards/sets/lea";
import type { CardDefinition } from "../../cards/types";

// --- Helpers ---------------------------------------------------------------

function head(state: GameState) {
    return (state.pendingChoices ?? [])[0];
}

function answer(state: GameState, ids: string[]): void {
    const h = head(state);
    applyPendingChoiceSubmit(state, {
        playerId: h.playerId,
        stackItemId: h.stackItemId,
        step: h.step,
        choiceId: h.choiceId,
        cardInstanceIds: ids,
    });
}

function battlefieldIds(state: GameState): string[] {
    return state.players.flatMap((p) => p.battlefield.map((c) => c.id));
}

function findPermanent(state: GameState, id: string) {
    return state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);
}

/** p1's graveyard holds `def`, ready to be reanimated (census row B). */
function withInGraveyard(
    def: CardDefinition,
    opts?: {
        p1Battlefield?: GameState["players"][number]["battlefield"];
        p2Battlefield?: GameState["players"][number]["battlefield"];
    }
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: opts?.p1Battlefield ?? [],
                graveyard: [
                    makeInstance(def.id, {
                        id: "subject",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "graveyard",
                    }),
                ],
            }),
            makePlayer("p2", { battlefield: opts?.p2Battlefield ?? [] }),
        ],
    });
}

/** Splices p1's graveyard onto the battlefield as one CR 400.7 batch — the
 *  non-cast entry path (ADR 0100 census row B). */
function reanimate(state: GameState): void {
    const gy = state.players[0].graveyard;
    const cards = gy.splice(0, gy.length);
    putReanimatedSetOnBattlefield(
        state,
        cards.map((card) => ({ card, controllerId: "p1" }))
    );
}

// --- The declaration itself ------------------------------------------------

describe("CR 614.12a — the mode pick is declared on entersWith.asEnters", () => {
    it("every shipped card whose modes ARE its as-enters clause declares it", () => {
        for (const def of [voiceOfAll, prismaticWard, quirionElves, jihad]) {
            expect(declaresAsEntersMode(def)).toBe(true);
        }
    });

    it("an ordinary CR 700.2 modal SPELL is NOT swept in (the must-NOT row)", () => {
        // Vision Charm's modes are chosen at announcement (CR 700.2c) and drive
        // its resolution; it never enters the battlefield at all.
        expect(declaresAsEntersMode(visionCharm)).toBe(false);
        expect(declaresAsEntersMode(grizzlyBears)).toBe(false);
    });
});

// --- Census row B: a NON-CAST entry ----------------------------------------

describe("CR 614.12a — a non-cast entry raises the mode pick (census row B)", () => {
    it("Voice of All reanimated out of a graveyard is parked, asked, and enters with the answer", () => {
        const state = withInGraveyard(voiceOfAll);
        reanimate(state);

        // Parked off EVERY zone until it answers (ADR 0100 D2).
        expect(battlefieldIds(state)).not.toContain("subject");
        expect(state.stagedEntries).toHaveLength(1);
        expect(head(state).asEntersCardId).toBe("subject");
        expect(head(state).asEntersKind).toBe("mode");
        expect(head(state).kind).toBe("option-pick");
        expect(head(state).options?.map((o) => o.id)).toEqual([
            "W",
            "U",
            "B",
            "R",
            "G",
        ]);

        answer(state, ["R"]);

        const permanent = findPermanent(state, "subject");
        expect(permanent?.chosenModeId).toBe("R");
        // CR 702.16 — the granted protection is live, materialized into
        // `staticAbilities` by the layer pass the entry tail runs.
        expect(permanent?.staticAbilities).toContain("protection from red");
        expect(permanent?.staticAbilities).not.toContain(
            "protection from white"
        );
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stagedEntries).toBeUndefined();
    });

    it("Quirion Elves reanimated produces the CHOSEN colour from its second mana ability", () => {
        const state = withInGraveyard(quirionElves);
        reanimate(state);
        answer(state, ["U"]);

        const permanent = findPermanent(state, "subject")!;
        expect(permanent.chosenModeId).toBe("U");
        // Through the shared server-wide resolver, not the definition's own
        // closure: this is what the tap mutations and the auto-tap planner read.
        const battlefields = state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }));
        expect(getEffectiveManaChoices(permanent, "p1", battlefields)).toEqual([
            { U: 1 },
        ]);
    });

    it("Jihad reanimated grants its anthem off the chosen colour", () => {
        // Repentant Blacksmith is white (the anthem's beneficiary); Mijae Djinn
        // is the opponent's RED nontoken permanent (the anthem's condition).
        const white = makeInstance(repentantBlacksmith.id, {
            id: "white-creature",
            controllerId: "p1",
        });
        const red = makeInstance(mijaeDjinn.id, {
            id: "red-perm",
            controllerId: "p2",
        });
        const state = withInGraveyard(jihad, {
            p1Battlefield: [white],
            p2Battlefield: [red],
        });
        const before = getEffectivePower(state, white);
        reanimate(state);

        expect(head(state).asEntersKind).toBe("mode");
        answer(state, ["R"]);

        const permanent = findPermanent(state, "subject");
        expect(permanent?.chosenModeId).toBe("R");
        // CR 613 — the mode's own `staticEffects` are what the layer system
        // reads off `chosenModeId` (`getEffectiveStaticEffects`); with no
        // `chosenModeId` the anthem cannot exist at all, which is the bug.
        expect(getEffectivePower(state, white)).toBe(before + 2);
    });

    it("Prismatic Ward reanimated owes BOTH its host pick and its colour pick", () => {
        // CR 303.4f + CR 614.12a — an Aura entering by a non-cast path chooses
        // what it enchants AND answers its own as-enters clause. Two legal
        // hosts, so the host pick is a real prompt (ADR 0003: a single legal
        // host is auto-attached with no prompt — covered below).
        const hostA = makeInstance(grizzlyBears.id, {
            id: "host-a",
            controllerId: "p1",
        });
        const hostB = makeInstance(grizzlyBears.id, {
            id: "host-b",
            controllerId: "p1",
        });
        const state = withInGraveyard(prismaticWard, {
            p1Battlefield: [hostA, hostB],
        });
        reanimate(state);

        const kinds: string[] = [];
        // Answer whatever is owed, head-first, until the entry completes.
        for (let guard = 0; guard < 4 && head(state); guard++) {
            const h = head(state);
            kinds.push(h.asEntersKind ?? "?");
            answer(state, [h.asEntersKind === "aura-host" ? "host-b" : "R"]);
        }

        expect(kinds).toEqual(expect.arrayContaining(["aura-host", "mode"]));
        const permanent = findPermanent(state, "subject");
        expect(permanent?.attachedTo).toBe("host-b");
        expect(permanent?.chosenModeId).toBe("R");
        expect(state.stagedEntries).toBeUndefined();
    });

    it("Prismatic Ward reanimated onto a SINGLE legal host still answers its colour pick", () => {
        // ADR 0003 — one legal host is a zero-branch decision (no host prompt),
        // but the CR 614.12a colour pick is still owed and the auto-attach must
        // survive the park.
        const onlyHost = makeInstance(grizzlyBears.id, {
            id: "only-host",
            controllerId: "p1",
        });
        const state = withInGraveyard(prismaticWard, {
            p1Battlefield: [onlyHost],
        });
        reanimate(state);

        expect(head(state)?.asEntersKind).toBe("mode");
        answer(state, ["B"]);

        const permanent = findPermanent(state, "subject");
        expect(permanent?.chosenModeId).toBe("B");
        expect(permanent?.attachedTo).toBe("only-host");
    });
});

// --- Census row A: the CAST path ------------------------------------------

describe("CR 614.12a — a CAST permanent is asked exactly once, at entry", () => {
    it("Voice of All cast raises the pick as it resolves, not at announcement", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, voiceOfAll.id, "p1");
        // The stack item carries NO `chosenModeId` — `announceCast` no longer
        // accepts one for this card.
        expect(item.chosenModeId).toBeUndefined();
        expect(state.pendingChoices ?? []).toHaveLength(0);

        resolveTopOfStack(state);

        // Parked mid-entry: the stack item was already popped (census row A),
        // so the finalize itself runs the entry tail once answered.
        expect(battlefieldIds(state)).not.toContain(item.id);
        expect(state.pendingChoices).toHaveLength(1);
        expect(head(state).asEntersKind).toBe("mode");

        answer(state, ["B"]);

        const permanent = findPermanent(state, item.id);
        expect(permanent?.chosenModeId).toBe("B");
        expect(permanent?.staticAbilities).toContain("protection from black");
        // EXACTLY once: nothing is still owed after the answer.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stagedEntries).toBeUndefined();
    });

    it("the granted protection survives the wire projection (mandatory)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, voiceOfAll.id, "p1");
        resolveTopOfStack(state);
        answer(state, ["G"]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(slim?.chosenModeId).toBe("G");
        expect(slim?.staticAbilities).toContain("protection from green");
    });
});

// --- The controlled-cast / cast-during-resolution producer ----------------

describe("CR 614.12a — SpellContext.getCardModes stops offering the pick", () => {
    /** A board where p2 holds `def` in hand and p1 has a resolving spell — the
     *  Word of Command shape (`ctx.getCardModes(opponentId, cardId)`). */
    function ctxWithHandCard(def: CardDefinition) {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [
                        makeInstance(def.id, {
                            id: "held",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                }),
            ],
        });
        const item = pushSpell(state, grizzlyBears.id, "p1");
        return buildSpellContext(state, item);
    }

    it("returns NO modes for a card whose pick is an as-enters choice", () => {
        // Word of Command / `castDuringResolution` would otherwise prompt at
        // announcement and the entry chokepoint would prompt again.
        expect(ctxWithHandCard(voiceOfAll).getCardModes("p2", "held")).toEqual(
            []
        );
    });

    it("still returns the modes of an ordinary modal spell (the must-NOT row)", () => {
        expect(
            ctxWithHandCard(visionCharm)
                .getCardModes("p2", "held")
                .map((m) => m.id)
        ).toEqual(visionCharm.modes!.map((m) => m.id));
    });
});

// --- Anthem sanity: the reader side still works ---------------------------

describe("CR 611/613 — the readers of chosenModeId are untouched", () => {
    it("a hand-set chosenModeId on a battlefield permanent still drives its statics", () => {
        // The re-choice writer (`SpellContext.setChosenMode`) writes exactly
        // this shape post-ETB; nothing in this slice changes how it is read.
        const voice = makeInstance(voiceOfAll.id, {
            id: "voice",
            controllerId: "p1",
        });
        voice.chosenModeId = "R";
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [voice] })],
        });
        expect(getEffectivePower(state, voice)).toBe(2);
    });
});
