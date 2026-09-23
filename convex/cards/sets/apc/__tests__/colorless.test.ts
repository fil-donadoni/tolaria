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
} from "../../../__tests__/setup";
import {
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
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

function submitHead(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

/** Casts Brass Herald for real: the spell resolves, the CR 614.12a as-enters
 *  pick is answered with `chosen`, and the ETB trigger that results is left
 *  on the stack. Returns the Herald that entered. */
function castHerald(state: GameState, chosen: string): CardInstanceState {
    pushSpell(state, BRASS_HERALD.id, "p1");
    resolveTopOfStack(state);
    expect(state.pendingChoices![0].asEntersKind).toBe("subtypes");
    submitHead(state, [chosen]);
    const herald = state.players[0].battlefield.find(
        (c) => c.card.id === BRASS_HERALD.id
    )!;
    expect(herald.chosenSubtypes).toEqual([chosen]);
    expect(state.stack.at(-1)?.triggeredAbilityId).toBe("brass-herald-reveal");
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
        submitHead(state, head.eligibleIds ?? []);
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
