// The shrink-only census of effect-sentence kinds (issue #6557): the source's
// kinds and the committed list agree, and the list never grows. Pure over its
// inputs, so each exit is pinned with its own input, and the extractor is
// pinned on a source excerpt shaped like the real union.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    auditSentenceKinds,
    EFFECT_CLAUSE_PATH,
    effectSentenceKinds,
    parseSentenceKinds,
    SENTENCE_KINDS_PATH,
} from "../lib/sentence-kinds";

const SOURCE = `
export type AmountIR = { readonly kind: "flat" };

export type EffectSentenceIR =
    | FrameChainIR
    | {
          /** doc */
          readonly kind: "draw";
          readonly nested: { readonly kind: "not-a-sentence-kind" };
      }
    | {
          readonly kind: "pump";
      }
    | { readonly kind: "regenerate" }
    | { readonly kind: "forced-block"; readonly count: number };

export type LibraryRouteIR = { readonly kind: "elsewhere" };
`;

describe("effectSentenceKinds reads the union off the source", () => {
    it("takes the member kinds at the union's indentation, multi-line and one-line, and nothing deeper or later", () => {
        expect(effectSentenceKinds(SOURCE)).toEqual([
            "draw",
            "pump",
            "regenerate",
            "forced-block",
        ]);
    });

    it("the committed list equals the real source today", () => {
        const source = effectSentenceKinds(
            readFileSync(EFFECT_CLAUSE_PATH, "utf8")
        );
        const committed = parseSentenceKinds(
            readFileSync(SENTENCE_KINDS_PATH, "utf8")
        );
        expect(
            auditSentenceKinds({ source, committed, baseline: null }).violations
        ).toEqual([]);
        // The retired kinds of the pilot are gone from both.
        for (const retired of [
            "search-library-to-hand",
            "search-library-to-battlefield",
            "search-library-to-top",
            "shuffle-searched-library",
        ]) {
            expect(source).not.toContain(retired);
            expect(committed.kinds).not.toContain(retired);
        }
    });
});

describe("auditSentenceKinds — every exit", () => {
    const list = (...kinds: string[]) => ({ kinds });

    it("passes when source and list agree and the list did not grow", () => {
        expect(
            auditSentenceKinds({
                source: ["draw", "pump"],
                committed: list("draw", "pump"),
                baseline: list("draw", "pump", "retired-one"),
            }).violations
        ).toEqual([]);
    });

    it("reds a kind the source declares but the list does not carry — adding a kind reds it", () => {
        expect(
            auditSentenceKinds({
                source: ["draw", "pump", "brand-new"],
                committed: list("draw", "pump"),
                baseline: null,
            }).violations
        ).toEqual([{ kind: "undeclared", name: "brand-new" }]);
    });

    it("reds a list that grew against its previous revision, even with the source in step", () => {
        expect(
            auditSentenceKinds({
                source: ["brand-new", "draw", "pump"],
                committed: list("brand-new", "draw", "pump"),
                baseline: list("draw", "pump"),
            }).violations
        ).toEqual([{ kind: "grown", name: "brand-new" }]);
    });

    it("reds a row the source no longer declares", () => {
        expect(
            auditSentenceKinds({
                source: ["draw"],
                committed: list("draw", "pump"),
                baseline: null,
            }).violations
        ).toEqual([{ kind: "retired", name: "pump" }]);
    });

    it("reds a duplicate and an unsorted list", () => {
        expect(
            auditSentenceKinds({
                source: ["draw", "pump"],
                committed: list("pump", "draw"),
                baseline: null,
            }).violations
        ).toEqual([{ kind: "unsorted" }]);
        expect(
            auditSentenceKinds({
                source: ["draw"],
                committed: list("draw", "draw"),
                baseline: null,
            }).violations
        ).toEqual([{ kind: "duplicate", name: "draw" }]);
    });

    it("leaves the shrink check unrun with no previous revision", () => {
        expect(
            auditSentenceKinds({
                source: ["draw"],
                committed: list("draw"),
                baseline: null,
            }).baselineChecked
        ).toBe(false);
    });
});
