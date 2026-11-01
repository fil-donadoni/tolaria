// The Weight Fit (issue #3401, PRD #3397, ADR 0124 §3) — its contract, and
// the reproducibility guard that ties the committed weights to the verdicts.
//
// Two halves, and the second is the one with teeth (the first lives in
// `weightFitContract.bot.test.ts`):
//
//  1. The CONTRACT of `fitWeights`, on hand-built pairs where the right answer
//     is known by construction: determinism to the bit, the numeraire pinned,
//     a pair moving only the weights it loads, a contradictory couple reported
//     rather than resolved, the sign constraint and the declared bands held.
//  2. The REPRODUCIBILITY GUARD (PRD #3397 story 7): re-run the whole pipeline
//     — the blade registry lowered to verdicts, followed by the verdicts the
//     committed Verdict Lock names (ADR 0128 §2, issue #3583), the Eval Pairs
//     built at the hand-picked prior, the fit — and demand
//     `DEFAULT_EVAL_WEIGHTS` exactly. This is the card-index lockfile
//     discipline: a hand-edited weight, a new blade entry nobody refitted
//     for, or a widened lock whose weights did not move with it, reds here
//     and nowhere else.
//
// It lives in the BOT suite rather than the blade suite because it is a gate:
// the blade suite's must tier is the search's metric, this is the weights'.
// The whole pipeline rebuilds the positions and evaluates them — ~4 s on the
// MacBook (2026-10-24) — and `check:lane` runs it alone as the
// `eval-weights-fit` cheap guard. The locked
// verdicts come from the machine pack cache, fetched once per lock on a miss
// (ADR 0128 §10, `scripts/lib/verdict-pack-cache.ts`).
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
    ATTESTATION_OBJECT_PREFIX,
    VERDICT_OBJECT_PREFIX,
    putAttestation,
    putVerdict,
    readVerdict,
} from "../../../verdictStore";
import { createMemoryVerdictStore } from "../../../verdictStoreMemory";
import { packVerdicts } from "../../../../scripts/lib/verdict-pack-cache";
import { REFIT_ARTIFACT_PATHS } from "../../../../scripts/lib/bot-refit";
import { runVerdictPromotionStep } from "../blade/verdictPromotion";
import {
    committedVerdictCorpus,
    CORPUS_EXCLUDED,
} from "./committedVerdictCorpus.fixture";
import { BLADE_SCENARIOS } from "../blade/registry";
import { DEFAULT_EVAL_WEIGHTS, FIT_BASE_EVAL_WEIGHTS } from "../evalWeights";
import {
    EVAL_WEIGHTS_PATH,
    VERDICT_LOCK_PATH,
    collectVerdictReport,
    fitInputPairs,
    fitWeights,
    rewriteDefaultEvalWeights,
    serializeVerdictLock,
    testPositionKeysOf,
    verdictPackObjectName,
    verdictSideOf,
    verdictsFromLock,
    verdictsFromRegistry,
    type RegistryVerdicts,
    type Verdict,
} from "../verdicts";

const REPO = resolve(__dirname, "../../../..");

/** The guard's pipeline over a corpus: pairs at the prior, the fit side of
 *  the held-out split (issue #3981), fit from it. */
function guardFit(corpus: RegistryVerdicts) {
    const report = collectVerdictReport(corpus.verdicts, {
        testPositions: testPositionKeysOf(BLADE_SCENARIOS),
        gaps: corpus.gaps,
        weights: FIT_BASE_EVAL_WEIGHTS,
    });
    return {
        errors: report.errors,
        result: fitWeights(
            fitInputPairs(
                report.pairs,
                corpus.verdicts,
                testPositionKeysOf(BLADE_SCENARIOS)
            ),
            FIT_BASE_EVAL_WEIGHTS
        ),
    };
}

/** Reads the LOCKED corpus through this machine's store key: skipped on
 *  the hosted advisory lane only (issue #5675, `CORPUS_EXCLUDED`). */
const describeLockedCorpus = describe.skipIf(CORPUS_EXCLUDED);

describeLockedCorpus(
    "the committed weights ARE the fit of the committed verdicts (issue #3401)",
    () => {
        it("re-running the fit over the registry and the lock reproduces DEFAULT_EVAL_WEIGHTS", async () => {
            const { errors, result } = guardFit(await committedVerdictCorpus());
            // A verdict the engine can no longer rebuild yields no pairs and would
            // shrink the corpus SILENTLY — the fit would still reproduce whatever
            // the smaller corpus says. The lockfile has to pin the input too.
            expect(
                errors,
                "a committed verdict no longer rebuilds — the corpus shrank"
            ).toEqual([]);
            expect(
                result.weights,
                "DEFAULT_EVAL_WEIGHTS is not the fit of the committed verdicts — " +
                    "run `bun run bot:refit` (it writes the weights and re-records every " +
                    "pin that derives from them; `fit:weights` only prints the block). " +
                    "A new blade `moves` entry is a new verdict and obliges a refit; " +
                    "a widened Verdict Lock moves the weights in the same change " +
                    "(`bun run verdicts:promote` writes both)."
            ).toEqual(DEFAULT_EVAL_WEIGHTS);
            // What a promotion writes for this fit IS the committed file, byte for
            // byte — so the literal it rewrites is the literal this guard reads.
            const source = readFileSync(join(REPO, EVAL_WEIGHTS_PATH), "utf8");
            expect(rewriteDefaultEvalWeights(source, result)).toBe(source);
        });
    }
);

describe("the guard's corpus is the registry, then the lock (issue #3583, ADR 0128 §2)", () => {
    it("carries every verdict a committed lock names, after the registry's", async () => {
        const store = createMemoryVerdictStore();
        const registry = verdictsFromRegistry(BLADE_SCENARIOS);
        const { verdictId } = await putVerdict(store, registry.verdicts[0]);
        const { packHash, bytes } = packVerdicts([
            { verdictId, payload: await readVerdict(store, verdictId) },
        ]);
        await store.put(
            verdictPackObjectName(packHash),
            bytes,
            "application/gzip"
        );
        const root = mkdtempSync(join(tmpdir(), "weight-fit-guard-"));
        try {
            mkdirSync(join(root, "data"));
            writeFileSync(
                join(root, VERDICT_LOCK_PATH),
                serializeVerdictLock({ verdictIds: [verdictId], packHash })
            );
            const corpus = await committedVerdictCorpus(BLADE_SCENARIOS, {
                root,
                cacheDir: join(root, "cache"),
                store: () => store,
            });
            expect(corpus.verdicts.map((v) => v.id)).toEqual([
                ...registry.verdicts.map((v) => v.id),
                verdictId,
            ]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

/** A NEW explicit judgement — a position no blade entry judges (a registry
 *  one some turns later), carrying the answer its original gets, on the
 *  requested side of the held-out split (issue #3981). A re-stated registry
 *  judgement would be refused as already in the corpus, and would move the
 *  weights only by double counting. */
function leverOn(original: Verdict, side: "fit" | "held-out"): Verdict {
    const testPositions = testPositionKeysOf(BLADE_SCENARIOS);
    for (let later = 1; later < 100; later++) {
        const lever: Verdict = {
            ...original,
            id: `lever:${later}`,
            source: "authored",
            spec: {
                ...original.spec,
                turn: (original.spec.turn ?? 1) + later,
            },
        };
        if (verdictSideOf(lever, testPositions) === side) return lever;
    }
    throw new Error(`no later turn puts ${original.id} ${side}`);
}

/** Promote ONE attested lever over an empty lock, through the real step. */
async function promoteOne(lever: Verdict) {
    const store = createMemoryVerdictStore();
    const { verdictId } = await putVerdict(store, lever);
    await putAttestation(store, {
        verdictId,
        author: "jovial-guineapig-250:tester1",
        sourceAxis: "explicit",
    });
    const snapshot = async (prefix: string) =>
        Promise.all(
            (await store.list(prefix)).map(async (name) => ({
                name,
                base64: Buffer.from((await store.get(name))!).toString(
                    "base64"
                ),
            }))
        );
    const source = readFileSync(join(REPO, EVAL_WEIGHTS_PATH), "utf8");
    const promoted = runVerdictPromotionStep({
        mode: "promote",
        lock: null,
        evalWeightsSource: source,
        verdictObjects: await snapshot(VERDICT_OBJECT_PREFIX),
        attestationObjects: await snapshot(ATTESTATION_OBJECT_PREFIX),
        // A bar no single promotion clears: the proposer searches nothing.
        admission: {
            minPersons: 1,
            ownerPersons: [],
            minConsecutivePromotions: 1000,
            seeds: [1],
            iterations: 1,
        },
    });
    if (promoted.mode !== "promote" || promoted.noop) {
        throw new Error("expected a promotion that writes");
    }
    expect(promoted.lock.verdictIds).toEqual([verdictId]);
    const locked = verdictsFromLock(promoted.lock, [
        { verdictId, payload: await readVerdict(store, verdictId) },
    ]);
    return { promoted, source, locked };
}

describe("widening the lock and moving the weights are ONE change (issue #3583, ADR 0128 §7)", () => {
    const registry = verdictsFromRegistry(BLADE_SCENARIOS);
    const committed = guardFit(registry).result;
    const original = registry.verdicts.find((v) =>
        committed.violated.some((o) => o.pair.verdictId === v.id)
    );

    it("a promoted lock without its weights reds the guard; the weights it writes are the refit", async () => {
        expect(
            original,
            "the committed fit satisfies every registry pair — this demonstration needs another position"
        ).toBeDefined();
        const { promoted, source, locked } = await promoteOne(
            leverOn(original!, "fit")
        );

        // The checkout holding the promotion's lock but NOT its weights: the
        // guard's own corpus shape, pipeline and comparison — red.
        const widened: RegistryVerdicts = {
            verdicts: [...registry.verdicts, ...locked],
            gaps: registry.gaps,
        };
        const { errors, result } = guardFit(widened);
        expect(errors).toEqual([]);
        expect(result.weights).not.toEqual(DEFAULT_EVAL_WEIGHTS);
        expect(result.weights).not.toEqual(committed.weights);

        // The weights the promotion wrote are exactly that refit, so the same
        // checkout WITH them holds the literal the guard then demands.
        expect(promoted.evalWeightsSource).not.toBe(source);
        expect(promoted.evalWeightsSource).toBe(
            rewriteDefaultEvalWeights(source, result)
        );
    });

    it("a promoted HELD-OUT verdict never reaches the fit: the weights are the registry's alone (issue #3981)", async () => {
        const { promoted, source, locked } = await promoteOne(
            leverOn(original!, "held-out")
        );
        // It is in the lock and in the corpus — it rebuilds, and it yields
        // pairs the fit would have to answer…
        const corpus = [...registry.verdicts, ...locked];
        const widened = collectVerdictReport(corpus, {
            testPositions: testPositionKeysOf(BLADE_SCENARIOS),
            gaps: registry.gaps,
            weights: FIT_BASE_EVAL_WEIGHTS,
        });
        expect(widened.errors).toEqual([]);
        expect(widened.pairs.some((p) => p.verdictId === locked[0].id)).toBe(
            true
        );
        // …which WOULD move the weights if they reached the fit — so the
        // equality below is the narrowing's doing, not this lever's silence.
        expect(
            fitWeights(widened.pairs, FIT_BASE_EVAL_WEIGHTS).weights
        ).not.toEqual(committed.weights);
        // …and the fit's input carries none of them, so the promotion writes
        // the registry-only fit, to the byte.
        expect(
            fitInputPairs(
                widened.pairs,
                corpus,
                testPositionKeysOf(BLADE_SCENARIOS)
            ).some((p) => p.verdictId === locked[0].id)
        ).toBe(false);
        expect(promoted.evalWeightsSource).toBe(
            rewriteDefaultEvalWeights(source, committed)
        );
    });
});

// Issue #7653 — the fitted weights are derived state the base writes: the
// refit's artefact list names this fit's file first, so `derive:sync` and the
// hand-edit refusal cover the file the fit actually rewrites.
describe("the refit artefacts name the fit's file (issue #7653)", () => {
    it("REFIT_ARTIFACT_PATHS[0] is the file a fit rewrites", () => {
        // The file carries the one literal the promotion rewrites: any other
        // path (a pin fixture, the hand-written `evalWeights.ts`) throws.
        const source = readFileSync(
            join(REPO, REFIT_ARTIFACT_PATHS[0]),
            "utf8"
        );
        const fit = fitWeights([], FIT_BASE_EVAL_WEIGHTS);
        expect(rewriteDefaultEvalWeights(source, fit)).toContain(
            "export const FITTED_EVAL_WEIGHTS"
        );
        expect(REFIT_ARTIFACT_PATHS[0]).toBe(EVAL_WEIGHTS_PATH);
    });
});
