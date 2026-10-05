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
    minimalPairFitOutcomes,
    minimalPairStandings,
    verdictIdOf,
    verdictsFromRegistry,
    type Discriminant,
    testPositionKeysOf,
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
        const report = collectVerdictReport(slice.verdicts, {
            testPositions: testPositionKeysOf(BLADE_SCENARIOS),
        });
        expect(report.incomplete.map((r) => r.verdictId)).toEqual([
            `registry:${stifle.label}`,
        ]);
        expect(report.pairs).toEqual([]);
        expect(formatVerdictReport(report, 0)).toContain(
            `registry:${stifle.label}`
        );
    });

    it("every conditional unpaired entry is debt, verdict or not — no `must` demoted (issue #4797)", () => {
        // A `predicate` entry lowers to no verdict, so it can never be an
        // incomplete verdict; it owes its pair all the same and is listed.
        const predicate = BLADE_SCENARIOS.find(
            (s) =>
                s.tier === "must" &&
                s.expect.predicate !== undefined &&
                s.classification?.kind === "conditional"
        )!;
        expect(predicate).toBeDefined();
        const slice = verdictsFromRegistry([predicate]);
        expect(slice.verdicts).toEqual([]);
        const text = formatVerdictReport(
            collectVerdictReport(slice.verdicts, {
                gaps: slice.gaps,
                testPositions: testPositionKeysOf(BLADE_SCENARIOS),
            }),
            0
        );
        expect(text).toContain("INCOMPLETE pairs — debt (1)");
        expect(text).toContain(`registry:${predicate.label}: Conditional`);

        // The whole registry: the debt heading counts every conditional entry
        // no declared half completes, whatever it lowers to.
        const unpaired = BLADE_SCENARIOS.filter(
            (s) =>
                s.classification?.kind === "conditional" &&
                !declared.some((d) => d.pairOf!.anchor === s.label)
        );
        expect(
            formatVerdictReport(
                collectVerdictReport(derived.verdicts, {
                    gaps: derived.gaps,
                    testPositions: testPositionKeysOf(BLADE_SCENARIOS),
                }),
                0
            )
        ).toContain(`INCOMPLETE pairs — debt (${unpaired.length})`);
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
            "share their floating mana"
        );
        const mana = position({ ...BASE, manaPool: { me: { R: 2 } } });
        expect(pairPositionDefect(anchor, mana, d("mana"))).toBeNull();
        expect(pairPositionDefect(anchor, mana, d("life"))).toContain(
            "share their life totals"
        );
        const lands = position({ ...BASE, landCount: 2 });
        expect(pairPositionDefect(anchor, lands, d("mana"))).toContain(
            "share their floating mana"
        );
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

    it("a count of N is N cards, and a reorder is not a swap (review)", () => {
        const withCount = (count: number, name = "Forest") =>
            position({
                ...BASE,
                cards: [
                    ...BASE.cards,
                    { name, owner: "me", zone: "library", count },
                ],
            });
        // twenty cards for twenty others are twenty cards, not one
        expect(
            pairPositionDefect(
                withCount(20),
                withCount(20, "Craw Wurm"),
                d("card")
            )
        ).toContain("20 card(s) leave and 20 arrive");
        // one more of the same card is one card
        expect(
            pairPositionDefect(withCount(2), withCount(3), d("card"))
        ).toBeNull();
        // the same cards, written two ways, are no difference at all
        const split = position({
            ...BASE,
            cards: [
                ...BASE.cards,
                { name: "Forest", owner: "me", zone: "library" },
                { name: "Forest", owner: "me", zone: "library" },
            ],
        });
        expect(pairPositionDefect(withCount(2), split, d("card"))).toContain(
            "same cards"
        );
        // a library reordered while a card arrives is two changes
        const lib = (...names: string[]) =>
            position({
                ...BASE,
                cards: [
                    ...BASE.cards,
                    ...names.map((name) => ({
                        name,
                        owner: "me" as const,
                        zone: "library" as const,
                    })),
                ],
            });
        expect(
            pairPositionDefect(
                lib("Forest", "Island"),
                lib("Island", "Forest", "Swamp"),
                d("card")
            )
        ).toContain("reordered");
        expect(
            pairPositionDefect(
                lib("Forest", "Island"),
                lib("Forest", "Island", "Swamp"),
                d("card")
            )
        ).toBeNull();
    });

    it("other: a resized array hides changes, so it is refused (review)", () => {
        const grown = position({
            ...BASE,
            cards: [
                { ...BASE.cards[0], tapped: true },
                BASE.cards[1],
                { name: "Shock", owner: "me", zone: "hand" },
            ],
        });
        expect(pairPositionDefect(anchor, grown, d("other"))).toContain(
            "not how many entries"
        );
    });

    it("step: the same step and turn is no step; turn-scoped tallies move only with the turn (review)", () => {
        const pooled = position({ ...BASE, manaPool: { me: { R: 1 } } });
        expect(pairPositionDefect(anchor, pooled, d("step"))).toContain(
            "share a step and a turn"
        );
        const tally = position({
            ...BASE,
            phase: "END_STEP",
            spellsCastThisTurn: { me: 2 },
        });
        expect(pairPositionDefect(anchor, tally, d("step"))).toContain(
            "beyond"
        );
        const nextTurn = position({
            ...BASE,
            phase: "END_STEP",
            turn: 4,
            spellsCastThisTurn: { me: 2 },
        });
        expect(pairPositionDefect(anchor, nextTurn, d("step"))).toBeNull();
    });

    it("life: one seat's total only; key order is not a difference (review)", () => {
        const both = position({ ...BASE, life: { me: 1, opp: 1 } });
        expect(pairPositionDefect(anchor, both, d("life"))).toContain(
            "2 life totals"
        );
        const reordered = position({
            ...BASE,
            life: { opp: 20, me: 20 },
            cards: BASE.cards.map((c) => ({
                zone: c.zone,
                owner: c.owner,
                name: c.name,
            })),
        });
        expect(pairPositionDefect(anchor, reordered, d("other"))).toContain(
            "identical"
        );
    });
});

describe("registry pairs reach the Minimal Pair report (issue #4796 review)", () => {
    it("minimalPairFitOutcomes names every registry pair — standings keyed by content hash, rows by verdict id", () => {
        // labels are unique — the declarations resolve by label
        const labels = BLADE_SCENARIOS.map((s) => s.label);
        expect(new Set(labels).size).toBe(labels.length);
        const { verdicts } = verdictsFromRegistry();
        const rows = minimalPairFitOutcomes(
            verdicts,
            [],
            testPositionKeysOf(BLADE_SCENARIOS)
        );
        const declared = BLADE_SCENARIOS.filter((s) => s.pairOf !== undefined);
        expect(rows.map((r) => r.halfId).sort()).toEqual(
            declared.map((s) => `registry:${s.label}`).sort()
        );
        for (const row of rows) {
            expect(row.anchorId.startsWith("registry:")).toBe(true);
        }
    });

    it("a half that accepts no move its anchor forbids is refused", () => {
        const half = byLabel(HALF);
        const anchor = byLabel(ANCHOR);
        const elsewhere: BladeScenario = {
            ...half,
            expect: { moves: [{ kind: "pass" }] },
        };
        const out = verdictsFromRegistry([anchor, elsewhere]);
        expect(out.gaps.find((g) => g.label === half.label)?.detail).toContain(
            "accepts no move the anchor forbids"
        );
    });
});
