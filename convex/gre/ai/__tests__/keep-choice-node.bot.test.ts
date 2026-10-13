/**
 * `keep-permanents` / `keep-hand` are in-tree choice nodes (CR 608.2d, issue
 * #5559) — Balance's and Pox's "choose N to keep, the rest go".
 *
 * Before this neither kind had a candidate generator, so `decidingPlayer`
 * answered null at the suspended keep and the search could not get past it: a
 * cast of Balance scored the card gone from hand and nothing it does, and
 * every search held it whatever the board.
 */

import { describe, expect, it } from "vitest";
import { choiceCandidates } from "../choiceCandidates";
import { decidingPlayer } from "../../search";
import { applyMoveForSearch } from "../../applyMove";
import { enumerateMoves } from "../../moves";
import { buildBladeState } from "../blade/runner";
import { findBladeScenario } from "../blade/registry";
import { getCardByName } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import type { PendingChoice } from "../../state";

describe("keep choices as search nodes (issue #5559)", () => {
    it("a cast of Balance reaches the opponent's keep as a decision node", () => {
        const scenario = findBladeScenario(
            "keep-N edict: casts Balance at two lands and no creatures against five lands and two creatures"
        );
        if (!scenario) throw new Error("blade entry missing");
        const state = buildBladeState(scenario);
        const cast = enumerateMoves(state, "p1").find(
            (m) => m.kind === "cast-spell"
        );
        if (!cast) throw new Error("no cast enumerated");
        const probe = applyMoveForSearch(state, "p1", cast);
        const head = probe.pendingChoices?.[0];
        expect(head?.kind).toBe("keep-permanents");
        expect(choiceCandidates(probe, head!).length).toBeGreaterThan(0);
        expect(decidingPlayer(probe)).toBe("p2");
    });

    const creature = (name: string, id: string) =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });

    const keepChoice = (
        kind: "keep-permanents" | "keep-hand",
        count: number
    ): PendingChoice =>
        ({
            stackItemId: "s",
            step: 0,
            choiceId: "p1",
            playerId: "p1",
            kind,
            zone: kind === "keep-hand" ? "hand" : "battlefield",
            count,
            prompt: "Keep",
            ...(kind === "keep-permanents"
                ? { filter: { types: "Creature" } }
                : {}),
        }) as PendingChoice;

    const kept = (choice: PendingChoice, state: ReturnType<typeof makeState>) =>
        choiceCandidates(state, choice).map((c) =>
            c.move.kind === "resolution-choice"
                ? [...(c.move.cardInstanceIds ?? [])].sort()
                : []
        );

    it("keep-permanents keeps the best and gives up the cheapest", () => {
        // Two Bears and a Shivan Dragon, keep one: the first answer keeps the
        // Dragon. Every answer keeps exactly one creature.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        creature("Grizzly Bears", "bear-a"),
                        creature("Shivan Dragon", "dragon"),
                        creature("Grizzly Bears", "bear-b"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const answers = kept(keepChoice("keep-permanents", 1), state);
        expect(answers[0]).toEqual(["dragon"]);
        for (const a of answers) expect(a).toHaveLength(1);
    });

    it("keep-hand keeps the best cards of the hand", () => {
        const card = (name: string, id: string) =>
            makeInstance(getCardByName(name).id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        card("Grizzly Bears", "bear"),
                        card("Shivan Dragon", "dragon"),
                        card("Craw Wurm", "wurm"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const answers = kept(keepChoice("keep-hand", 2), state);
        expect(answers[0]).toEqual(["dragon", "wurm"]);
        for (const a of answers) expect(a).toHaveLength(2);
    });
});
