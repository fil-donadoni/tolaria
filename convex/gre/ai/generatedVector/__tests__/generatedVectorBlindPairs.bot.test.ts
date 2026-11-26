// The generated vector tells apart boards the Evaluation reads as ONE
// (issue #10853; ADR 0186's Census gate reads the whole corpus, this pins
// that the generator can do it at all).
//
// A BLIND Eval Pair (`verdicts/report.ts`) is two candidate moves whose
// settled boards give the same fitted basis, the same evaluation terms and
// the same policy value: no weight vector of any kind can order them. Each
// position below is a `must` Test Position of the blade registry that yields
// such a pair today. The pair is rebuilt through the production path — the
// registry's verdict, `evalPairsOf`, the real classifier — and the generated
// vector is read off the SAME settled probe board `candidateFeatures` reads
// (`candidateGeneratedVector`).
//
// What is pinned, and what is not. That the generated vectors of a pair
// DIFFER is this module's claim and is asserted for every blind pair listed.
// That the pair is STILL blind is a fact about the Evaluation, which moves:
// a new term may give one of these positions its sight, and that is no defect
// here. So the list holds more positions than the three the issue asks for,
// and the test demands that at least three are blind when it runs.

import { describe, expect, it } from "vitest";
import { seatPlayerId } from "../../blade/matcher";
import {
    evalPairsOf,
    resolveVerdictMoves,
    type EvalPair,
} from "../../verdicts/evalPairs";
import { buildVerdictState } from "../../verdicts/position";
import { verdictsFromRegistry } from "../../verdicts/registrySource";
import { isBlindPair } from "../../verdicts/report";
import type { Verdict } from "../../verdicts/types";
import { candidateGeneratedVector } from "../candidate";
import { namedEntries, subtractVectors } from "../vector";

/** A Test Position, and one column family the two boards of its blind pair
 *  are expected to differ in — the reason a reader can check by eye. */
const POSITIONS: readonly { label: string; differsIn: string }[] = [
    {
        // Wild Growth on its own Forest or on the opponent's land: whose
        // mana base grew.
        label: "cast variant: enchants its OWN land with Wild Growth",
        differsIn: "mana.base.",
    },
    {
        // The phasing Aura on its own creature or on the opponent's: whose
        // board holds the keyword.
        label: "phasing: an Aura granting phasing never enchants its own creature",
        differsIn: "kw.phasing.",
    },
    {
        // Surveil: the land stays on top or goes to the graveyard.
        label: "surveil: bins a dead land off the same board",
        differsIn: "type.Land.graveyard.",
    },
    {
        // Explore: the revealed card stays on top or is put in the graveyard.
        label: "explore: bins the revealed blank instead of leaving it as the next draw",
        differsIn: "cards.graveyard.",
    },
    {
        // Surveil: the planeswalker stays on top or goes to the graveyard.
        label: "surveil: keeps a castable planeswalker on top",
        differsIn: "type.Planeswalker.graveyard.",
    },
    {
        // The bounce land's trigger returns itself or another land: which
        // abilities are left on the battlefield and which went to the hand.
        label: "bounce land: Amulet of Vigor never returns the untapped bounce land without tapping it",
        differsIn: "op.moveZone.triggered.",
    },
];

/** The column names two candidates' generated vectors differ in. */
function generatedDifference(verdict: Verdict, pair: EvalPair): string[] {
    const state = buildVerdictState(verdict);
    const botId = seatPlayerId(state, verdict.seat);
    const resolved = resolveVerdictMoves(verdict, state, botId);
    if ("error" in resolved) throw new Error(resolved.error);
    const right = candidateGeneratedVector(
        state,
        botId,
        resolved.moves[pair.rightIndex]
    );
    const other = candidateGeneratedVector(
        state,
        botId,
        resolved.moves[pair.otherIndex]
    );
    return namedEntries(subtractVectors(right, other)).map(([name]) => name);
}

describe("generated vector — separates boards that share an Eval Pair feature vector (issue #10853)", () => {
    const byId = new Map(
        verdictsFromRegistry().verdicts.map((verdict) => [verdict.id, verdict])
    );

    it("at least three blind pairs get different generated vectors, through the real candidate-feature path", () => {
        const separated: string[] = [];
        for (const { label, differsIn } of POSITIONS) {
            const verdict = byId.get(`registry:${label}`);
            expect(verdict, `no registry verdict for "${label}"`).toBeDefined();
            const built = evalPairsOf(verdict as Verdict);
            expect(built.error, label).toBeUndefined();
            const blind = [...built.pairs, ...built.timing].filter(isBlindPair);
            // No longer blind: the Evaluation learned to see it. Not ours.
            if (blind.length === 0) continue;
            const differences = blind.map((pair) =>
                generatedDifference(verdict as Verdict, pair)
            );
            const telling = differences.filter((names) =>
                names.some((name) => name.startsWith(differsIn))
            );
            expect(
                telling.length,
                `"${label}": blind to the Evaluation, and the generated ` +
                    `vectors do not differ in ${differsIn}* either`
            ).toBeGreaterThan(0);
            separated.push(label);
        }
        expect(
            separated.length,
            "fewer than three of the listed positions are still blind to " +
                "the Evaluation — list new blind pairs (the registry corpus " +
                "holds dozens), do not weaken the count"
        ).toBeGreaterThanOrEqual(3);
    });
});
