// Forced-sacrifice ordering (CR 701.21a, CR 702.86a; issue #8382): the
// battlefield worth a forced sacrifice ranks its victims in, the two orders
// it keeps on every board, and the answer set the search is offered.

import { describe, expect, it } from "vitest";
import { getCardByName, tryGetDefinition } from "../../../cards";
import { withTemporaryDefinition } from "../../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../../cards/types";
import type { CardInstanceState, GameState } from "../../state";
import { battlefieldPermanentWorth } from "../candidateValue";
import { choiceCandidates } from "../choiceCandidates";
import { buildBladeState } from "../blade/build";
import { findBladeScenario } from "../blade/registry";

const LETHAL =
    "annihilator: sacrifices the mana rocks and keeps its untapped blockers";
const NO_LETHAL =
    "annihilator pair: rocks before creatures, basics before the dual, no lethal";

const nameOf = (c: CardInstanceState) =>
    tryGetDefinition((c.card as { id?: string }).id ?? "")?.name ?? "";

function onBattlefield(cardId: string, id: string): GameState {
    const card = makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        isTapped: true,
    });
    return makeState({
        players: [makePlayer("p1", { battlefield: [card] }), makePlayer("p2")],
    });
}

describe("battlefield sacrifice worth (CR 603.6a, CR 701.21a)", () => {
    it("a land's worth on the battlefield takes nothing from its spent ETB Ability", () => {
        const maze = getCardByName("Hedge Maze");
        expect(maze.triggeredAbilities?.length ?? 0).toBeGreaterThan(0);
        const withEtb = onBattlefield(maze.id, "maze");
        const withEtbWorth = battlefieldPermanentWorth(
            withEtb,
            withEtb.players[0].battlefield[0]
        );
        const stripped = {
            ...maze,
            triggeredAbilities: [],
        } as CardDefinition;
        withTemporaryDefinition(stripped, () => {
            const bare = onBattlefield(maze.id, "maze");
            expect(withEtbWorth).toBe(
                battlefieldPermanentWorth(bare, bare.players[0].battlefield[0])
            );
        });
        const island = onBattlefield(getCardByName("Island").id, "island");
        expect(withEtbWorth).toBeGreaterThanOrEqual(
            battlefieldPermanentWorth(island, island.players[0].battlefield[0])
        );
    });
});

/** Every answer the search is offered at the scenario's sacrifice choice, as
 *  card names. */
function answerSets(label: string): string[][] {
    const state = buildBladeState(findBladeScenario(label)!);
    const choice = state.pendingChoices![0];
    expect(choice.kind).toBe("sacrifice-permanents");
    const byId = new Map(
        state.players.flatMap((p) => p.battlefield).map((c) => [c.id, c])
    );
    return choiceCandidates(state, choice).map((c) => {
        const move = c.move;
        if (move.kind !== "resolution-choice") throw new Error(move.kind);
        return (move.cardInstanceIds ?? []).map((id) => nameOf(byId.get(id)!));
    });
}

const ROCKS = ["Sol Ring", "Talisman of Curiosity"];
const CREATURES = [
    "Delighted Halfling",
    "Scythecat Cub",
    "Hullbreacher",
    "Subtlety",
    "Nadu, Winged Wisdom",
];

describe("the forced-sacrifice answer set (CR 702.86a)", () => {
    for (const label of [LETHAL, NO_LETHAL]) {
        it(`every set keeps the two orders — ${label}`, () => {
            const sets = answerSets(label);
            expect(sets.length).toBeGreaterThan(1);
            for (const set of sets) {
                const takesCreatureOrDual = set.some(
                    (n) => CREATURES.includes(n) || n === "Hedge Maze"
                );
                if (takesCreatureOrDual) {
                    expect(ROCKS.every((r) => set.includes(r))).toBe(true);
                }
                if (set.includes("Hedge Maze")) {
                    expect(set.filter((n) => n === "Island")).toHaveLength(4);
                }
            }
        });
    }

    it("offers a set that keeps every untapped creature (CR 509.1a)", () => {
        const untapped = ["Delighted Halfling", "Hullbreacher", "Subtlety"];
        expect(
            answerSets(LETHAL).some((set) =>
                untapped.every((n) => !set.includes(n))
            )
        ).toBe(true);
    });
});
