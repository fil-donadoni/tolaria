/**
 * The hosted advisory lane's one recorded test exclusion (issue #5675): only
 * `TOLARIA_HOSTED_NO_VERDICT_CORPUS=1` skips the committed-corpus tests, and
 * every gating lane refuses to start with the variable set at all.
 */
import { describe, expect, it } from "vitest";
import {
    CORPUS_EXCLUSION_ENV,
    corpusExcluded,
    refuseCorpusExclusion,
} from "../lib/corpus-exclusion";

const HOSTED = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted" };

describe("corpusExcluded — the hosted runner only", () => {
    it("is true for the exact value 1 on a GitHub-hosted runner", () => {
        expect(corpusExcluded({ ...HOSTED, [CORPUS_EXCLUSION_ENV]: "1" })).toBe(
            true
        );
        expect(corpusExcluded(HOSTED)).toBe(false);
        expect(
            corpusExcluded({ ...HOSTED, [CORPUS_EXCLUSION_ENV]: "true" })
        ).toBe(false);
    });

    it("does nothing off a hosted runner — a self-hosted job, a machine shell", () => {
        expect(
            corpusExcluded({
                GITHUB_ACTIONS: "true",
                RUNNER_ENVIRONMENT: "self-hosted",
                [CORPUS_EXCLUSION_ENV]: "1",
            })
        ).toBe(false);
        expect(corpusExcluded({ [CORPUS_EXCLUSION_ENV]: "1" })).toBe(false);
        // Outside Actions, a stray RUNNER_ENVIRONMENT proves nothing.
        expect(
            corpusExcluded({
                RUNNER_ENVIRONMENT: "github-hosted",
                [CORPUS_EXCLUSION_ENV]: "1",
            })
        ).toBe(false);
    });
});

describe("refuseCorpusExclusion — a gating lane never skips the corpus", () => {
    it("refuses any non-empty value, naming the lane and the variable", () => {
        for (const value of ["1", "0", "true"])
            expect(() =>
                refuseCorpusExclusion("land", { [CORPUS_EXCLUSION_ENV]: value })
            ).toThrow(
                /land is a gating lane.*TOLARIA_HOSTED_NO_VERDICT_CORPUS/
            );
    });

    it("passes when the variable is unset or empty", () => {
        expect(() => refuseCorpusExclusion("health", {})).not.toThrow();
        expect(() =>
            refuseCorpusExclusion("health", { [CORPUS_EXCLUSION_ENV]: "" })
        ).not.toThrow();
    });
});
