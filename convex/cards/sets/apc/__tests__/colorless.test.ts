// Per-card behaviour tests for APC colourless cards
// (`convex/cards/sets/apc/colorless.ts`).
//
// Dragon Arch is a hand-tail card (issue #3806) built entirely out of
// already-exercised Ops, so the per-Op regime owes it nothing. What it DOES
// owe is the one card-level claim no Op test makes: the activated ability's
// candidate list is the MULTICOLOURED creatures in hand and nothing else
// (CR 105.2b). Both wrong readings fail silently at the table — an OR over
// the five colours puts a mono-coloured creature into play, and a dropped
// `type` puts a gold non-creature there.
//
// Resolved through the REGISTRY SEAM by id, never by name.
import { describe, expect, it } from "vitest";
import { getDefinition, registerTokenDefinition } from "../../../index";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "../../../__tests__/setup";
import {
    discardToGraveyard,
    payDiscardAtRandomCost,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { advancePhase, finalizeCleanupDiscard } from "../../../../gre/phases";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";

const DRAGON_ARCH = getDefinition("eec581b8-e509-420c-b142-afaa6dd06cc8");
/** Angus Mackenzie — {G}{W}{U}, three of the five colours (CR 105.2b). */
const GOLD_CREATURE = getDefinition("57264bd9-94f6-4d4d-baff-2b2900585635");
/** Grizzly Bears — {1}{G}, monocoloured (CR 105.2a). */
const MONO_CREATURE = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
/** Ornithopter — no coloured pip at all (CR 105.2c). */
const COLORLESS_CREATURE = getDefinition(
    "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0"
);
/** Vindicate — {1}{W}{B}: multicoloured, and NOT a creature. */
const GOLD_NONCREATURE = getDefinition("2a1bfefd-dae8-49e9-9d56-cc852e3dc93b");

/** p1 controls Dragon Arch and holds `hand` (by definition id). */
function board(handIds: string[]): {
    state: GameState;
    arch: CardInstanceState;
} {
    const arch = makeInstance(DRAGON_ARCH.id, {
        id: "arch",
        controllerId: "p1",
        ownerId: "p1",
    });
    const hand = handIds.map((defId, i) =>
        makeInstance(defId, {
            id: `h${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [arch], hand }),
            makePlayer("p2"),
        ],
    });
    return { state, arch };
}

/** Pushes Dragon Arch's activated ability onto the stack and resolves it —
 *  the REAL ability (cost, `useStack`), not a hand-built script. */
function activate(state: GameState, source: CardInstanceState): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId: "dragon-arch-put",
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Dragon Arch — {2}, {T}: put a multicolored creature from hand onto the battlefield (CR 105.2b / 400.7, issue #3806)", () => {
    it("offers ONLY the multicoloured creature, and putting it in play is a zone change, not a cast", () => {
        const { state, arch } = board([
            GOLD_CREATURE.id,
            MONO_CREATURE.id,
            COLORLESS_CREATURE.id,
            GOLD_NONCREATURE.id,
        ]);
        activate(state, arch);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        // h0 alone: the mono-coloured creature is the OR-over-five misparse,
        // the colourless one is CR 105.2c, the gold sorcery is a dropped
        // `type`.
        expect(head.candidateIds).toEqual(["h0"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h0"],
        });
        expect(state.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "arch",
            "h0",
        ]);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "h1",
            "h2",
            "h3",
        ]);
        // Nothing was CAST — casting puts a spell on the stack (CR 601.2) and
        // this creature never went there: the stack is empty after the
        // ability resolved, with no creature spell on it.
        expect(state.stack).toHaveLength(0);
    });

    it('is a "you may" — declining puts nothing onto the battlefield', () => {
        const { state, arch } = board([GOLD_CREATURE.id]);
        activate(state, arch);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["arch"]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["h0"]);
    });

    it("does nothing with no multicoloured creature in hand (CR 608.2b)", () => {
        const { state, arch } = board([MONO_CREATURE.id]);
        expect(() => activate(state, arch)).not.toThrow();
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["arch"]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["h0"]);
    });
});

// ---------------------------------------------------------------------------
// Brass Herald (issue #3809) — the type chosen as it entered parameterises
// its ETB reveal filter AND its anthem (CR 607.2d linked abilities).
// ---------------------------------------------------------------------------

const BRASS_HERALD = getDefinition("89bd60a7-2ba4-4fce-bf74-2ea9b8fd4dbe");
const HERALD_GOBLIN = "brass-herald-test-goblin";
const HERALD_ELF = "brass-herald-test-elf";
/** A Kindred (Tribal) Goblin that is NOT a creature card (CR 308): "creature
 *  cards of the chosen type" must leave it in the bottom pile. */
const HERALD_KINDRED_GOBLIN = "brass-herald-test-kindred-goblin";
registerTokenDefinition({
    id: HERALD_GOBLIN,
    name: HERALD_GOBLIN,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
});
registerTokenDefinition({
    id: HERALD_ELF,
    name: HERALD_ELF,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elf"],
    power: 1,
    toughness: 1,
});
registerTokenDefinition({
    id: HERALD_KINDRED_GOBLIN,
    name: HERALD_KINDRED_GOBLIN,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Kindred", "Sorcery"],
    subtypes: ["Goblin"],
});

function heraldBoard(): GameState {
    const lib = (defId: string, id: string) =>
        makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(HERALD_GOBLIN, {
                        id: "my-goblin",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                library: [
                    lib(HERALD_GOBLIN, "l-goblin"),
                    lib(HERALD_ELF, "l-elf"),
                    lib(HERALD_KINDRED_GOBLIN, "l-kindred"),
                    lib(HERALD_GOBLIN, "l-goblin2"),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(HERALD_GOBLIN, {
                        id: "their-goblin",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                    makeInstance(HERALD_ELF, {
                        id: "their-elf",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
}

/** Casts Brass Herald for real: the spell resolves, the CR 614.12a as-enters
 *  pick is answered with `chosen`, and the ETB trigger that results is left
 *  on the stack. Returns the Herald that entered. */
function castHerald(state: GameState, chosen: string): CardInstanceState {
    pushSpell(state, BRASS_HERALD.id, "p1");
    resolveTopOfStack(state);
    expect(state.pendingChoices![0].asEntersKind).toBe("subtypes");
    submitChoice(state, [chosen]);
    const herald = state.players[0].battlefield.find(
        (c) => c.card.id === BRASS_HERALD.id
    )!;
    expect(herald.chosenSubtypes).toEqual([chosen]);
    expect(state.stack[state.stack.length - 1]?.triggeredAbilityId).toBe(
        "brass-herald-reveal"
    );
    return herald;
}

/** Resolves the ETB, then answers whatever the reveal left pending (the
 *  CR 401.4 bottom-order pick) with its offered ids, so assertions read the
 *  final zones. */
function resolveEtb(state: GameState): void {
    resolveTopOfStack(state);
    for (let guard = 0; guard < 5 && state.pendingChoices?.length; guard++) {
        const head = state.pendingChoices[0];
        // The keep is forced (`optional: false`, take = look): exactly the
        // SERVER-computed eligible set is the one legal answer.
        submitChoice(state, head.eligibleIds ?? []);
    }
}

describe("Brass Herald — the chosen creature type parameterises the ETB reveal and the anthem (CR 205.3m / 607.2d, issue #3809)", () => {
    it("puts exactly the revealed CREATURE cards of the chosen type into hand; the rest go to the bottom", () => {
        const state = heraldBoard();
        castHerald(state, "Goblin");
        resolveEtb(state);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "l-goblin",
            "l-goblin2",
        ]);
        // The Elf is the wrong type; the Kindred Goblin is the right type but
        // not a creature card — both stay in the library.
        expect(state.players[0].library.map((c) => c.id).sort()).toEqual([
            "l-elf",
            "l-kindred",
        ]);
    });

    it("fails CLOSED with no stored choice: nothing is put into hand", () => {
        const state = heraldBoard();
        const herald = castHerald(state, "Goblin");
        delete herald.chosenSubtypes;
        resolveEtb(state);
        expect(state.players[0].hand).toEqual([]);
        expect(state.players[0].library).toHaveLength(4);
    });

    it("CR 608.2h — a Herald bounced before its ETB resolved still reveals by its last-known chosen type", () => {
        const state = heraldBoard();
        const herald = castHerald(state, "Goblin");
        removePermanentTo(state, herald.id, "hand");
        resolveEtb(state);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual(
            [herald.id, "l-goblin", "l-goblin2"].sort()
        );
    });

    it("the anthem buffs every creature of the chosen type, both sides, on the wire", () => {
        const state = heraldBoard();
        const herald = castHerald(state, "Goblin");
        // Wire format — the anthem and the chosen type it reads survive the
        // projection the client derives P/T from.
        const projected = projectPublicState(state, 1, "p1");
        const pt = (id: string) => {
            const c = projected.players
                .flatMap((p) => p.battlefield)
                .find((x) => x.id === id)!;
            return [
                getEffectivePower(projected, c),
                getEffectiveToughness(projected, c),
            ];
        };
        expect(pt("my-goblin")).toEqual([2, 2]);
        expect(pt("their-goblin")).toEqual([2, 2]);
        expect(pt("their-elf")).toEqual([1, 1]);
        // Herald is a Golem, not a Goblin — no self-buff.
        expect(pt(herald.id)).toEqual([2, 2]);
    });
});

// Dodecapod (issue #3814) — a discard replacement scoped by the discard's
// ORIGIN (CR 614.1a / 701.9): only an effect of a spell or ability an OPPONENT
// controls puts it onto the battlefield. The four other origins — your own
// effect, a cost, the CR 514.1 cleanup discard — reach the graveyard.
const DODECAPOD = getDefinition("ded8b992-a1c2-4e43-ad0a-ea3995a3c8b8");
/** Mind Twist — {X}{B}: target player discards X cards at random. */
const MIND_TWIST = getDefinition("eee9e106-a248-49d2-b8c8-6bbcd56ce739");
/** Library of Leng — "If an effect causes you to discard a card … you may put
 *  it on top of your library instead" (LEA). */
const LIBRARY_OF_LENG_ID = "2340edcb-8cd5-4ccd-99e2-b9a29f72c495";
/** Mind Rot — {2}{B}: target player discards two cards (THEIR choice). */
const MIND_ROT = getDefinition("b91d355d-8409-4f0b-87ce-7590a8b9ebc0");

/** p1 holds Dodecapod (`pod`) plus `extra` Grizzly Bears. */
function podBoard(extra = 0, overrides: Partial<GameState> = {}): GameState {
    const hand = [
        makeInstance(DODECAPOD.id, {
            id: "pod",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        }),
        ...Array.from({ length: extra }, (_, i) =>
            makeInstance(MONO_CREATURE.id, {
                id: `bear${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        ),
    ];
    return makeState({
        players: [makePlayer("p1", { hand }), makePlayer("p2")],
        ...overrides,
    });
}

function mindTwistP1(state: GameState, caster: "p1" | "p2", x: number): void {
    pushSpell(state, MIND_TWIST.id, caster, [{ type: "player", id: "p1" }]);
    state.stack[state.stack.length - 1].chosenX = x;
    resolveTopOfStack(state);
}

const zoneOfPod = (state: GameState) => {
    const p1 = state.players[0];
    if (p1.battlefield.some((c) => c.id === "pod")) return "battlefield";
    if (p1.graveyard.some((c) => c.id === "pod")) return "graveyard";
    if (p1.hand.some((c) => c.id === "pod")) return "hand";
    return "elsewhere";
};

describe("Dodecapod — CR 614.1a discard replacement scoped by what caused the discard", () => {
    it("an OPPONENT's spell makes you discard it → onto the battlefield with two +1/+1 counters, and it was still discarded (CR 701.9c)", () => {
        const state = podBoard();
        mindTwistP1(state, "p2", 1);
        expect(zoneOfPod(state)).toBe("battlefield");
        const pod = state.players[0].battlefield.find((c) => c.id === "pod")!;
        expect(pod.controllerId).toBe("p1");
        expect(pod.counters?.["+1/+1"]).toBe(2);
        // Wire format — the counters and the 5/5 body reach the client.
        const view = projectPublicState(state, 1, "p2");
        const seen = view.players[0].battlefield.find((c) => c.id === "pod")!;
        expect(seen.counters?.["+1/+1"]).toBe(2);
        expect(getEffectivePower(view, seen)).toBe(5);
        expect(getEffectiveToughness(view, seen)).toBe(5);
    });

    it("the replaced discard is still a discard: the chokepoint reports it and CARD_DISCARDED fires (ruling: 'you've still discarded it')", () => {
        const state = podBoard();
        expect(
            discardToGraveyard(state, "p1", "pod", {
                kind: "effect",
                controllerId: "p2",
            })
        ).toBe(true);
        expect(zoneOfPod(state)).toBe("battlefield");
        expect(
            (state.pendingEvents ?? []).filter(
                (e) =>
                    e.type === "CARD_DISCARDED" &&
                    "cardInstanceId" in e &&
                    e.cardInstanceId === "pod"
            )
        ).toHaveLength(1);
    });

    it("an opponent's spell that lets YOU choose the discard applies too (ruling: 'causes you to choose a card to discard')", () => {
        const state = podBoard(2);
        pushSpell(state, MIND_ROT.id, "p2", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["pod", "bear0"],
        });
        expect(zoneOfPod(state)).toBe("battlefield");
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["bear0"]);
    });

    it("with Library of Leng also applying, the card's own replacement wins (CR 616.1 — the affected player's pick)", () => {
        const state = podBoard();
        state.players[0].battlefield.push(
            makeInstance(LIBRARY_OF_LENG_ID, {
                id: "leng",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        mindTwistP1(state, "p2", 1);
        expect(zoneOfPod(state)).toBe("battlefield");
    });

    it("YOUR OWN spell makes you discard it → graveyard", () => {
        const state = podBoard();
        mindTwistP1(state, "p1", 1);
        expect(zoneOfPod(state)).toBe("graveyard");
    });

    it("discarded to pay a COST (CR 118) → graveyard", () => {
        const state = podBoard();
        payDiscardAtRandomCost(state, "p1", 1);
        expect(zoneOfPod(state)).toBe("graveyard");
    });

    it("the CLEANUP hand-size discard (CR 514.1, no spell or ability) → graveyard", () => {
        const state = podBoard(7, {
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
        });
        advancePhase(state);
        expect(state.pendingChoices![0].count).toBe(1);
        finalizeCleanupDiscard(state, ["pod"]);
        expect(zoneOfPod(state)).toBe("graveyard");
    });
});
