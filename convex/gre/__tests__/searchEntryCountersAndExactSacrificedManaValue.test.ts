// Two parametrizations of existing Effect Script surfaces, no new Op:
//
//   - `EffectCardFilter.manaValueEquals` reads the cost-sacrifice snapshot
//     (`{ sacrificed: { read: "manaValue", plus } }`) — "a creature card with
//     mana value equal to 1 plus the sacrificed creature's mana value".
//     CR 608.2h: the victim left as a cost, so the value is its last known
//     mana value.
//   - The `cards`-shaped `moveZone` carries `entersWithCounters` — "put that
//     card onto the battlefield with an additional +1/+1 counter on it".
//     CR 122.6: the counter is given as the object enters, through the same
//     entry-funnel slot the `target` shape's reanimation already uses.
import { describe, it, expect } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { EffectOp } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type CardInstanceState } from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { validateEffectScript } from "../effects/validate";
import { projectPublicState } from "../../gameProjections";
import { getEffectivePower, getEffectiveToughness } from "../layers";

const MV2_ID = "test-sec-creature-mv2";
const MV3_ID = "test-sec-creature-mv3";
const MV4_ID = "test-sec-creature-mv4";

function registerCreature(id: string, generic: number): void {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { X: generic },
        types: ["Creature"],
        power: 2,
        toughness: 2,
    });
}
registerCreature(MV2_ID, 2);
registerCreature(MV3_ID, 3);
registerCreature(MV4_ID, 4);

function registerScript(id: string, effects: EffectOp[]): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Sorcery"],
        effects,
    });
    return id;
}

function card(
    cardId: string,
    id: string,
    zone: "library" | "graveyard"
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });
}

const EXACT_SEARCH: EffectOp = {
    op: "choice",
    kind: "search-library",
    player: "controller",
    zone: "library",
    filter: {
        type: "Creature",
        manaValueEquals: { sacrificed: { read: "manaValue", plus: 1 } },
    },
    count: { min: 0, max: 1 },
    prompt: "Search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value.",
    bind: "$picked",
};

describe("manaValueEquals reads the cost-sacrifice snapshot (CR 608.2h)", () => {
    const ID = registerScript("test-sec-exact-sacrificed", [EXACT_SEARCH]);

    function candidates(snapshotMv: number | undefined): string[] {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        card(MV2_ID, "lib-mv2", "library"),
                        card(MV3_ID, "lib-mv3", "library"),
                        card(MV4_ID, "lib-mv4", "library"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, ID, "p1");
        if (snapshotMv !== undefined) {
            item.additionalSacrificeSnapshot = {
                cardInstanceId: "victim",
                mv: snapshotMv,
            };
        }
        resolveTopOfStack(state);
        return state.pendingChoices?.[0]?.candidateIds ?? [];
    }

    it("admits only the card at exactly 1 plus the sacrificed mana value", () => {
        expect(candidates(2)).toEqual(["lib-mv3"]);
    });

    it("fails closed when nothing was sacrificed (no snapshot)", () => {
        expect(candidates(undefined)).toEqual([]);
    });

    it("validates as an Effect Script", () => {
        expect(
            validateEffectScript({
                id: "test-sec-exact-sacrificed",
                name: "Test",
                effects: [EXACT_SEARCH],
            } as never)
        ).toEqual([]);
    });
});

describe("moveZone `cards` shape — entersWithCounters (CR 122.6)", () => {
    function searchAndPut(from: "library" | "graveyard"): EffectOp[] {
        return [
            {
                op: "choice",
                kind:
                    from === "library"
                        ? "search-library"
                        : "choose-graveyard-card",
                player: "controller",
                zone: from,
                filter: { type: "Creature" },
                count: { min: 0, max: 1 },
                prompt: "Pick a creature card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from,
                to: "battlefield",
                entersWithCounters: { "+1/+1": 1 },
            },
        ] as EffectOp[];
    }

    function resolvePick(from: "library" | "graveyard") {
        const id = registerScript(
            `test-sec-enters-counters-${from}`,
            searchAndPut(from)
        );
        const picked = card(MV3_ID, `picked-${from}`, from);
        const state = makeState({
            players: [
                makePlayer(
                    "p1",
                    from === "library"
                        ? { library: [picked] }
                        : { graveyard: [picked] }
                ),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [picked.id],
        });
        const entered = state.players[0].battlefield.find(
            (c) => c.id === picked.id
        );
        return { state, entered };
    }

    it("a library card enters with the counter, visible after projection", () => {
        const { state, entered } = resolvePick("library");
        expect(entered?.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, entered!)).toBe(3);
        expect(getEffectiveToughness(state, entered!)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === entered!.id
        )!;
        expect(slim.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(projected, slim)).toBe(3);
    });

    it("a graveyard card enters with the counter too", () => {
        const { entered } = resolvePick("graveyard");
        expect(entered?.counters?.["+1/+1"]).toBe(1);
    });

    it("validates on library / graveyard sources, refuses a hand source", () => {
        expect(
            validateEffectScript({
                id: "t",
                name: "Test",
                effects: searchAndPut("library"),
            } as never)
        ).toEqual([]);
        const fromHand = [
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "hand",
                to: "battlefield",
                entersWithCounters: { "+1/+1": 1 },
            },
        ];
        expect(
            validateEffectScript({
                id: "t",
                name: "Test",
                effects: [
                    {
                        op: "choice",
                        kind: "choose-hand-card",
                        player: "controller",
                        zone: "hand",
                        count: { min: 0, max: 1 },
                        prompt: "Pick.",
                        bind: "$picked",
                    },
                    ...fromHand,
                ],
            } as never).join("\n")
        ).toMatch(/entersWithCounters/);
    });
});
