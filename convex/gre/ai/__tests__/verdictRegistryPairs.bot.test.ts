// The blade registry declares its Minimal Pairs in data (issue #4796, PRD
// #4792, ADR 0148).
//
// `classification` on an anchor and `pairOf` (by label) on its right-hand half
// replace the `// PAIRED WITH:` prose. The derivation (`registrySource.ts`)
// believes a declaration only once `pairPositionDefect` (`pairDiff.ts`) says the
// two positions differ by the named Discriminant and nothing else; a refused
// half leaves the corpus as a `pair` gap, and a conditional anchor with no half
// stays a Test Position that the fit never reads and the report lists as debt.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import { BLADE_SCENARIOS } from "../blade/registry";
import type { BladeScenario } from "../blade/types";
import { positionOf, type PairPosition } from "../verdicts/pairDerivation";
import { pairPositionDefect } from "../verdicts/pairDiff";
import {
    collectVerdictReport,
    formatVerdictReport,
    minimalPairStandings,
    verdictIdOf,
    verdictsFromRegistry,
    type Discriminant,
} from "../verdicts";

const byLabel = (label: string): BladeScenario => {
    const found = BLADE_SCENARIOS.find((s) => s.label === label);
    if (!found) throw new Error(`no registry entry "${label}"`);
    return found;
};

const HALF = "cheat into play: casts for a body that pays on the way out";
const ANCHOR =
    "cheat into play NEGATIVE CONTROL: passes for a vanilla body of the same mana value";

const standingsOf = (
    verdicts: ReturnType<typeof verdictsFromRegistry>["verdicts"]
) =>
    minimalPairStandings(
        verdicts.map((verdict) => ({
            verdictId: verdictIdOf(verdict),
            judgement: verdict,
            stored: false,
        }))
    );

describe("the registry's declared Minimal Pairs (ADR 0148)", () => {
    const declared = BLADE_SCENARIOS.filter((s) => s.pairOf !== undefined);
    const derived = verdictsFromRegistry();

    it("every declared half derives as a verdict linked to its anchor — none refused", () => {
        expect(declared.length).toBeGreaterThan(0);
        expect(derived.gaps.filter((g) => g.reason === "pair")).toEqual([]);
        for (const scenario of declared) {
            const half = derived.verdicts.find(
                (v) => v.id === `registry:${scenario.label}`
            );
            expect(half?.pairOf, scenario.label).toBeDefined();
            const anchor = derived.verdicts.find(
                (v) => v.id === `registry:${scenario.pairOf!.anchor}`
            );
            expect(half!.pairOf!.anchorId).toBe(verdictIdOf(anchor!));
            expect(half!.classification).toBeUndefined();
        }
    });

    it("a declared pair reaches the fit as a pair: both halves are paired, neither incomplete", () => {
        const standings = standingsOf(derived.verdicts);
        for (const scenario of declared) {
            const half = derived.verdicts.find(
                (v) => v.id === `registry:${scenario.label}`
            )!;
            const anchor = derived.verdicts.find(
                (v) => v.id === `registry:${scenario.pairOf!.anchor}`
            )!;
            expect(standings.get(verdictIdOf(half))?.kind).toBe("paired");
            expect(standings.get(verdictIdOf(anchor))?.kind).toBe("paired");
        }
    });

    it("a conditional entry with no half is still a verdict, yet out of the fit and listed as debt", () => {
        const incomplete = [...standingsOf(derived.verdicts).entries()].filter(
            ([, standing]) => standing.kind === "incomplete"
        );
        expect(incomplete.length).toBeGreaterThan(0);
        const unpaired = BLADE_SCENARIOS.filter(
            (s) =>
                s.classification?.kind === "conditional" &&
                !declared.some((d) => d.pairOf!.anchor === s.label) &&
                derived.verdicts.some((v) => v.id === `registry:${s.label}`)
        );
        expect(unpaired.length).toBe(incomplete.length);

        // The fit corpus is `collectVerdictReport`'s pairs: the anchor of a
        // refused pair is a verdict (the blade suite still runs the entry) but
        // contributes none, and the report names it.
        const stifle = byLabel(
            "discriminating pair: does NOT cast Phyrexian Dreadnought with no out"
        );
        const slice = verdictsFromRegistry([stifle]);
        expect(slice.verdicts).toHaveLength(1);
        const report = collectVerdictReport(slice.verdicts);
        expect(report.incomplete.map((r) => r.verdictId)).toEqual([
            `registry:${stifle.label}`,
        ]);
        expect(report.pairs).toEqual([]);
        expect(formatVerdictReport(report, 0)).toContain(
            `registry:${stifle.label}`
        );
    });

    it("no PAIRED WITH prose is left for a converted pair", () => {
        const source = readFileSync(
            new URL("../blade/registry.ts", import.meta.url),
            "utf8"
        );
        const converted = new Set(
            declared.flatMap((s) => [s.label, s.pairOf!.anchor])
        );
        const prose = source
            .split("\n")
            .filter((l) => l.includes("PAIRED WITH"));
        expect(prose.length).toBeGreaterThan(0); // the non-converted ones stay named
        for (const line of prose) {
            for (const label of converted) {
                expect(
                    line.includes(label.slice(0, 40)),
                    line.slice(0, 80)
                ).toBe(false);
            }
        }
    });
});

describe("a declared pair differing by more than its Discriminant is refused", () => {
    const half = byLabel(HALF);
    const anchor = byLabel(ANCHOR);

    it("the honest cheat-into-play pair is accepted", () => {
        const out = verdictsFromRegistry([anchor, half]);
        expect(out.gaps.filter((g) => g.reason === "pair")).toEqual([]);
        expect(
            out.verdicts.find((v) => v.id === `registry:${half.label}`)?.pairOf
        ).toBeDefined();
    });

    it("a half that also changes the life totals is dropped with a `pair` gap, its anchor left incomplete", () => {
        const greedy: BladeScenario = {
            ...half,
            spec: { ...half.spec, life: { me: 20, opp: 3 } },
        };
        const out = verdictsFromRegistry([anchor, greedy]);
        const gap = out.gaps.find((g) => g.label === half.label);
        expect(gap?.reason).toBe("pair");
        expect(gap?.detail).toContain("beyond the Discriminant");
        expect(out.verdicts.map((v) => v.id)).toEqual([
            `registry:${anchor.label}`,
        ]);
        expect(
            standingsOf(out.verdicts).get(verdictIdOf(out.verdicts[0]))?.kind
        ).toBe("incomplete");
    });

    it("a half naming another Discriminant than its anchor, or a missing anchor, is refused", () => {
        const wrongWhy: BladeScenario = {
            ...half,
            pairOf: {
                anchor: anchor.label,
                discriminant: { kind: "life", detail: "the opponent's life" },
            },
        };
        expect(
            verdictsFromRegistry([anchor, wrongWhy]).gaps.map((g) => g.reason)
        ).toEqual(["pair"]);
        const orphan: BladeScenario = {
            ...half,
            pairOf: {
                anchor: "no such entry",
                discriminant: half.pairOf!.discriminant,
            },
        };
        const gap = verdictsFromRegistry([anchor, orphan]).gaps[0];
        expect(gap.reason).toBe("pair");
        expect(gap.detail).toContain("no registry entry");
    });
});

describe("pairPositionDefect — one Discriminant, nothing else", () => {
    const BASE: ScenarioSpec = {
        cards: [
            { name: "Lightning Bolt", owner: "me", zone: "hand" },
            { name: "Mountain", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        life: { me: 20, opp: 20 },
    };
    const position = (spec: ScenarioSpec, extra: Partial<PairPosition> = {}) =>
        positionOf({ spec, seat: "me", ...extra });
    const d = (kind: Discriminant["kind"]): Discriminant => ({
        kind,
        detail: "x",
    });
    const anchor = position(BASE);

    it("card: one added, removed or swapped; two, a property tweak, or none are not", () => {
        const plus = (...cards: ScenarioSpec["cards"]) =>
            position({ ...BASE, cards: [...BASE.cards, ...cards] });
        expect(
            pairPositionDefect(
                anchor,
                plus({ name: "Shock", owner: "me", zone: "hand" }),
                d("card")
            )
        ).toBeNull();
        expect(
            pairPositionDefect(
                plus({ name: "Shock", owner: "me", zone: "hand" }),
                anchor,
                d("card")
            )
        ).toBeNull();
        const swapped = position({
            ...BASE,
            cards: [
                BASE.cards[0],
                { name: "Forest", owner: "me", zone: "battlefield" },
            ],
        });
        expect(pairPositionDefect(anchor, swapped, d("card"))).toBeNull();
        expect(
            pairPositionDefect(
                anchor,
                plus(
                    { name: "Shock", owner: "me", zone: "hand" },
                    { name: "Giant Growth", owner: "me", zone: "hand" }
                ),
                d("card")
            )
        ).toContain("2 arrive");
        const tapped = position({
            ...BASE,
            cards: [BASE.cards[0], { ...BASE.cards[1], tapped: true }],
        });
        expect(pairPositionDefect(anchor, tapped, d("card"))).toContain(
            "property of Mountain"
        );
        expect(pairPositionDefect(anchor, anchor, d("card"))).toContain(
            "same cards"
        );
        // …and a card change that drags a second difference along is refused.
        const dragged = position({
            ...BASE,
            cards: [
                ...BASE.cards,
                { name: "Shock", owner: "me", zone: "hand" },
            ],
            life: { me: 20, opp: 1 },
        });
        expect(pairPositionDefect(anchor, dragged, d("card"))).toContain(
            "beyond the Discriminant"
        );
    });

    it("step: moves the phase and its implications, nothing else", () => {
        const later = position({
            ...BASE,
            phase: "END_STEP",
            activePlayer: "opp",
            priority: "me",
        });
        expect(pairPositionDefect(anchor, later, d("step"))).toBeNull();
        expect(pairPositionDefect(anchor, anchor, d("step"))).toContain(
            "share a step"
        );
        const withLife = position({
            ...BASE,
            phase: "END_STEP",
            life: { me: 1, opp: 20 },
        });
        expect(pairPositionDefect(anchor, withLife, d("step"))).toContain(
            "beyond"
        );
    });

    it("life, mana, stack: only their own footprint may move", () => {
        const life = position({ ...BASE, life: { me: 20, opp: 4 } });
        expect(pairPositionDefect(anchor, life, d("life"))).toBeNull();
        expect(pairPositionDefect(anchor, life, d("mana"))).toContain(
            "share their mana"
        );
        const mana = position({ ...BASE, manaPool: { me: { R: 2 } } });
        expect(pairPositionDefect(anchor, mana, d("mana"))).toBeNull();
        expect(pairPositionDefect(anchor, mana, d("life"))).toContain(
            "share their life"
        );
        const lands = position({ ...BASE, landCount: 2 });
        expect(pairPositionDefect(anchor, lands, d("mana"))).toBeNull();
    });

    it("sequence: the half's setup is the anchor's plus an earlier move", () => {
        const earlier = position(BASE, {
            setup: [{ kind: "pass", seat: "me" }],
        });
        expect(pairPositionDefect(anchor, earlier, d("sequence"))).toBeNull();
        expect(pairPositionDefect(earlier, anchor, d("sequence"))).toContain(
            "not the anchor's setup"
        );
        expect(pairPositionDefect(anchor, anchor, d("sequence"))).toContain(
            "not the anchor's setup"
        );
    });

    it("other: exactly one differing value", () => {
        const one = position({ ...BASE, turn: 4 });
        expect(pairPositionDefect(anchor, one, d("other"))).toBeNull();
        const two = position({ ...BASE, turn: 4, life: { me: 1, opp: 20 } });
        expect(pairPositionDefect(anchor, two, d("other"))).toContain(
            "exactly one"
        );
        expect(pairPositionDefect(anchor, anchor, d("other"))).toContain(
            "identical"
        );
    });

    it("a different decision seat or different deck knowledge is never a Discriminant", () => {
        const otherSeat = positionOf({ spec: BASE, seat: "opp" });
        expect(pairPositionDefect(anchor, otherSeat, d("other"))).toContain(
            "different seats"
        );
        const knowing = position(BASE, {
            deckKnowledge: [{ seat: "opp", cards: ["Shock"] }],
        });
        expect(pairPositionDefect(anchor, knowing, d("other"))).toContain(
            "deck knowledge"
        );
    });
});
