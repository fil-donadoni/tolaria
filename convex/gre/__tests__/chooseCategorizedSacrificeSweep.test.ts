// `chooseCategorized` battlefield SACRIFICE sweep + the CR 101.4 simultaneous
// split (issue #3712).
//
// CR 701.21a — "To sacrifice a permanent, its controller moves it from the
// battlefield directly to its owner's graveyard." `sweep.action: "sacrifice"`
// takes every non-picked permanent the chooser controls that `sweep.filter`
// admits.
//
// CR 101.4 — "the active player … makes any choices required, then the next
// player in turn order … Then the actions happen simultaneously." A lone
// `chooseCategorized` with a sweep is admitted as a `forEach { set: "players",
// simultaneous: true }` body; the interpreter splits it into every player's
// pick, then every player's sweep.
//
// Global Ruin is the shipped card; the Ajani, Nacatl Avenger −4 shape (artifact
// / creature / enchantment / planeswalker, lands excluded) is a temporary
// sorcery variant, since the card itself is not in the catalogue.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { resolveTopOfStack, type GameState } from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { validateEffectScript } from "../effects/validate";
import { registerTokenDefinition } from "../../cards";
import { getDefinition, withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";

const globalRuin = getDefinition("336474b4-2cf5-44c0-b72c-f75f1a7ed928");
const plains = getDefinition("b1623d57-4729-4796-b3f7-f1837a05c6ed");
const tundra = getDefinition("a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb");
const mountain = getDefinition("eace2c85-976c-425e-9800-5a6ccbd91b56");

const def = (
    id: string,
    types: CardDefinition["types"],
    subtypes: string[] = []
): CardDefinition => {
    const d: CardDefinition = {
        id,
        name: id,
        rarity: "common",
        manaCost: {},
        types,
        subtypes,
        ...(types.includes("Creature") ? { power: 1, toughness: 1 } : {}),
        ...(types.includes("Planeswalker") ? { loyalty: 3 } : {}),
    };
    registerTokenDefinition(d);
    return d;
};

// A land with no basic land type — Global Ruin can never keep it.
const WASTELAND = def("test-3712-typeless-land", ["Land"]);
const ARTIFACT_CREATURE = def(
    "test-3712-artifact-creature",
    ["Artifact", "Creature"],
    ["Construct"]
);
const CREATURE = def("test-3712-creature", ["Creature"], ["Bear"]);
const ENCHANTMENT = def("test-3712-enchantment", ["Enchantment"]);
const PLANESWALKER = def("test-3712-planeswalker", ["Planeswalker"]);

const perm = (cardId: string, owner: string, id: string) =>
    makeInstance(cardId, { id, controllerId: owner, ownerId: owner });

function submit(state: GameState, picks: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: picks,
    });
}

const ids = (cards: readonly { id: string }[]) => cards.map((c) => c.id).sort();

// Ajani, Nacatl Avenger −4 as a sorcery: "Each opponent chooses an artifact,
// a creature, an enchantment, and a planeswalker from among the nonland
// permanents they control, then sacrifices the rest."
const AJANI_MINUS_FOUR: CardDefinition = {
    id: "test-3712-ajani-minus-four",
    name: "test-3712-ajani-minus-four",
    rarity: "common",
    manaCost: {},
    types: ["Sorcery"],
    effects: [
        {
            op: "chooseCategorized",
            player: "opponent",
            zone: "battlefield",
            categories: [
                { label: "Artifact", filter: { type: "Artifact" } },
                { label: "Creature", filter: { type: "Creature" } },
                { label: "Enchantment", filter: { type: "Enchantment" } },
                { label: "Planeswalker", filter: { type: "Planeswalker" } },
            ],
            onPicked: "keep",
            sweep: { filter: { excludeType: "Land" }, action: "sacrifice" },
        },
    ],
};

describe("chooseCategorized sacrifice sweep (CR 701.21a, issue #3712)", () => {
    it("Global Ruin validates as a simultaneous players body", () => {
        expect(validateEffectScript(globalRuin)).toEqual([]);
    });

    it("keeps a dual land for BOTH its types and sacrifices the rest, including a land with no basic type (CR 701.21a)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        perm(tundra.id, "p1", "p1-tundra"),
                        perm(plains.id, "p1", "p1-plains"),
                        perm(WASTELAND.id, "p1", "p1-waste"),
                        perm(CREATURE.id, "p1", "p1-bear"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, globalRuin.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
        expect(head.kind).toBe("choose-categorized");
        // The Tundra alone answers Plains AND Island — the cover floor is 1.
        expect(head.count).toEqual({ min: 1, max: 2 });
        submit(state, ["p1-tundra"]);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        // Lands only: the bear is untouched; the typeless land and the
        // un-nominated Plains go to the graveyard.
        expect(ids(state.players[0].battlefield)).toEqual(
            ["p1-bear", "p1-tundra"].sort()
        );
        // The graveyard also holds the resolved sorcery itself (CR 608.2k).
        expect(
            ids(
                state.players[0].graveyard.filter(
                    (c) => c.card.id !== globalRuin.id
                )
            )
        ).toEqual(["p1-plains", "p1-waste"]);
    });

    it("a later chooser decides against the board BEFORE any sacrifice (CR 101.4 / 101.4b)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        perm(plains.id, "p1", "p1-plains-a"),
                        perm(plains.id, "p1", "p1-plains-b"),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        perm(mountain.id, "p2", "p2-mountain-a"),
                        perm(mountain.id, "p2", "p2-mountain-b"),
                    ],
                }),
            ],
        });
        pushSpell(state, globalRuin.id, "p2");
        expect(resolveTopOfStack(state)).toBeNull();
        // APNAP: the active player (p1) chooses first, whoever cast it.
        let head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
        submit(state, ["p1-plains-a"]);

        // p1's answer is RECORDED, not applied: p2 is prompted while p1's
        // un-nominated Plains is still on the battlefield.
        head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        expect(ids(state.players[0].battlefield)).toEqual(
            ["p1-plains-a", "p1-plains-b"].sort()
        );
        expect(state.players[0].graveyard).toHaveLength(0);
        submit(state, ["p2-mountain-b"]);

        // "Then the actions happen simultaneously."
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(ids(state.players[0].battlefield)).toEqual(["p1-plains-a"]);
        expect(ids(state.players[0].graveyard)).toEqual(["p1-plains-b"]);
        expect(ids(state.players[1].battlefield)).toEqual(["p2-mountain-b"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "p2-mountain-a"
        );
        expect(state.stack).toHaveLength(0);
    });

    it("a forced pick auto-resolves in the choose pass and still sweeps after every player (CR 101.4)", () => {
        const state = makeState({
            players: [
                // One Plains + a typeless land: the pick is forced (no prompt).
                makePlayer("p1", {
                    battlefield: [
                        perm(plains.id, "p1", "p1-plains"),
                        perm(WASTELAND.id, "p1", "p1-waste"),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        perm(mountain.id, "p2", "p2-mountain-a"),
                        perm(mountain.id, "p2", "p2-mountain-b"),
                    ],
                }),
            ],
        });
        pushSpell(state, globalRuin.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        // p1's forced answer was not applied yet — the typeless land stands.
        expect(ids(state.players[0].battlefield)).toEqual(
            ["p1-plains", "p1-waste"].sort()
        );
        submit(state, ["p2-mountain-a"]);
        expect(ids(state.players[0].battlefield)).toEqual(["p1-plains"]);
        expect(ids(state.players[1].battlefield)).toEqual(["p2-mountain-a"]);
    });

    it("Ajani −4 shape: an artifact creature answers artifact AND creature; lands are never swept", () => {
        withTemporaryDefinition(AJANI_MINUS_FOUR, () => {
            expect(validateEffectScript(AJANI_MINUS_FOUR)).toEqual([]);
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", {
                        battlefield: [
                            perm(ARTIFACT_CREATURE.id, "p2", "p2-golem"),
                            perm(CREATURE.id, "p2", "p2-bear"),
                            perm(ENCHANTMENT.id, "p2", "p2-ench-a"),
                            perm(ENCHANTMENT.id, "p2", "p2-ench-b"),
                            perm(PLANESWALKER.id, "p2", "p2-walker"),
                            perm(mountain.id, "p2", "p2-mountain"),
                            perm(WASTELAND.id, "p2", "p2-waste"),
                        ],
                    }),
                ],
            });
            pushSpell(state, AJANI_MINUS_FOUR.id, "p1");
            expect(resolveTopOfStack(state)).toBeNull();
            const head = state.pendingChoices![0];
            expect(head.playerId).toBe("p2");
            // The golem covers artifact + creature: 3 permanents answer all
            // four categories; 4 is the maximum matching.
            expect(head.count).toEqual({ min: 3, max: 4 });
            submit(state, ["p2-golem", "p2-ench-b", "p2-walker"]);

            expect(ids(state.players[1].battlefield)).toEqual(
                [
                    "p2-golem",
                    "p2-ench-b",
                    "p2-walker",
                    "p2-mountain",
                    "p2-waste",
                ].sort()
            );
            expect(ids(state.players[1].graveyard)).toEqual(
                ["p2-bear", "p2-ench-a"].sort()
            );
            // The caster's side is never touched.
            expect(state.players[0].battlefield).toHaveLength(0);
        });
    });
});

describe("chooseCategorized sweep validation (issue #3712)", () => {
    const base = {
        id: "test-3712-validate",
        name: "test-3712-validate",
        rarity: "common" as const,
        manaCost: {},
        types: ["Sorcery" as const],
    };
    const op = (zone: "hand" | "battlefield", action: string) => ({
        op: "chooseCategorized",
        player: "controller",
        zone,
        categories: [{ label: "W", filter: { color: "W" } }],
        onPicked: "keep",
        sweep: { action },
    });

    it("pairs discard with the hand and sacrifice with the battlefield", () => {
        const ok = (zone: "hand" | "battlefield", action: string) =>
            validateEffectScript({
                ...base,
                effects: [op(zone, action)],
            } as unknown as CardDefinition);
        expect(ok("hand", "discard")).toEqual([]);
        expect(ok("battlefield", "sacrifice")).toEqual([]);
        expect(ok("hand", "sacrifice").join("\n")).toMatch(
            /"sacrifice" requires zone: "battlefield"/
        );
        expect(ok("battlefield", "discard").join("\n")).toMatch(
            /"discard" requires zone: "hand"/
        );
        expect(ok("battlefield", "exile")).not.toEqual([]);
    });

    it("admits a lone swept chooseCategorized as a simultaneous players body, and nothing wider", () => {
        const forEach = (effects: unknown[]) =>
            validateEffectScript({
                ...base,
                effects: [
                    {
                        op: "forEach",
                        select: { set: "players" },
                        simultaneous: true,
                        effects,
                    },
                ],
            } as unknown as CardDefinition);
        const swept = {
            ...op("battlefield", "sacrifice"),
            player: { ref: "$each" },
        };
        expect(forEach([swept])).toEqual([]);
        // No sweep — nothing the CR 101.4 split was admitted for.
        const { sweep: _omit, ...unswept } = swept;
        expect(forEach([unswept]).join("\n")).toMatch(/simultaneous/);
        // One Op wider — rejected, never a silent sequential fallback.
        expect(
            forEach([
                swept,
                { op: "draw", player: "controller", amount: 1 },
            ]).join("\n")
        ).toMatch(/simultaneous/);
    });
});
