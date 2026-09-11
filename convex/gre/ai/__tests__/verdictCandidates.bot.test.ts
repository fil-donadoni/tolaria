// The split builder is not a fork (issue #3405).
//
// The in-play verdict quiz runs in the BROWSER, and the browser cannot import
// `buildVerdictState`: it reaches the blade runner, which reaches
// `convex/game` and the Convex function shell, which the client-bundle purity
// guard refuses (ADR 0074). So a setup-less verdict's position is built by
// `buildSetupFreeVerdictState` — the first half of `buildBladeState`, on the
// grounds that `applyBladeSetup` with no steps is the identity.
//
// That claim is load-bearing and invisible: if the two builders ever diverged —
// a normalisation added to one, a seed changed, an extra untap — the quiz would
// still render perfectly and every verdict it submitted would key its
// candidates off instance ids the fit's own rebuild never allocates. Nothing
// downstream could tell; the verdicts would simply stop resolving. This is the
// test that says they agree.

import { describe, it, expect } from "vitest";
import {
    buildSetupFreeVerdictState,
    candidateMoves,
} from "../verdicts/candidates";
import { buildVerdictState } from "../verdicts/position";
import { moveKey } from "../../search";
import type { Verdict } from "../verdicts/types";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

const SPECS: [string, ScenarioSpec][] = [
    [
        "a main-phase board",
        {
            cards: [
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
    ],
    [
        "a declare-attackers board",
        {
            cards: [
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
    ],
];

function verdictOf(spec: ScenarioSpec): Verdict {
    return {
        id: "setup-free",
        spec,
        seat: "me",
        candidates: [],
        answer: { kind: "right", rightIndexes: [] },
        author: "test",
        createdAt: new Date(0).toISOString(),
        source: "in-play",
    };
}

describe("buildSetupFreeVerdictState agrees with buildVerdictState (issue #3405)", () => {
    for (const [name, spec] of SPECS) {
        it(`builds ${name} identically, down to the instance ids`, () => {
            const viaBlade = buildVerdictState(verdictOf(spec));
            const viaPure = buildSetupFreeVerdictState(spec);
            expect(viaPure).toEqual(viaBlade);

            // And therefore the candidate KEYS agree — which is the property
            // the quiz actually depends on, since a key is a move with its
            // instance ids inside it.
            const seat = viaBlade.players[0].id;
            expect(candidateMoves(viaPure, seat).map(moveKey)).toEqual(
                candidateMoves(viaBlade, seat).map(moveKey)
            );
        });
    }
});
