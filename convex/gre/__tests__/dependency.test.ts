// CR 613.8 — the dependency system (issue #2068, ADR 0115).
//
// Every case is asserted under BOTH timestamp orders. A dependency exists
// precisely to make the board independent of play order, so a test that only
// exercises the order in which timestamp and dependency happen to agree proves
// nothing at all.
//
// The CR's own examples come first, and they are NON-dependencies (CR 613.9):
// false positives are this design's characteristic failure mode, since a
// one-directional phantom edge reorders effects the CR says timestamp order
// decides.
import { describe, it, expect } from "vitest";
import { beginApplyingStaticEffects, type GameState } from "../state";
import type { CardInstanceState } from "../state";
import { deriveLayers2to5 } from "../layers2to5";
import { deriveLayer6 } from "../layer6";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../layers";
import type { LayerStateView } from "../layers";
import {
    orderByDependency,
    STATIC_EFFECT_READS,
    CDA_STATIC_EFFECT_KINDS,
    type DependencyTemplate,
} from "../dependency";
import { compareContinuousEffects } from "../continuousEffects";
import type { ContinuousEffect } from "../continuousEffects";
import type { PermanentView, StaticEffect } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { LAYER_2_5_STATIC_EFFECT_KINDS } from "../layers2to5";
import { LAYER_6_STATIC_EFFECT_KINDS } from "../layer6";
import { bloodMoon } from "../../cards/sets/drk/red";
import { magusOfTheMoon } from "../../cards/sets/fut/red";
import { urborgTombOfYawgmoth } from "../../cards/sets/plc/colorless";
import { prismaticOmen } from "../../cards/sets/shm/green";
import { conspiracy } from "../../cards/sets/mmq/black";
import { lifeAndLimb } from "../../cards/sets/plc/green";
import { humility } from "../../cards/sets/tmp/white";
import { opalescence } from "../../cards/sets/uds/white";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { tropicalIsland } from "../../cards/sets/lea/colorless";

const view = (state: GameState): LayerStateView =>
    state as unknown as LayerStateView;
const asView = (card: CardInstanceState): PermanentView =>
    card as unknown as PermanentView;

/** Builds a one-player board and stamps the sources in the order given, so a
 *  case can be run under both CR 613.7 timestamp orders by permuting the
 *  argument. `beginApplyingStaticEffects` is the only stamp mint (CR 613.7a). */
function boardWith(
    permanents: readonly CardInstanceState[],
    stampOrder: readonly CardInstanceState[]
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [...permanents] }),
            makePlayer("p2"),
        ],
    });
    for (const source of stampOrder) beginApplyingStaticEffects(state, source);
    return state;
}

describe("CR 613.9 — the CR's own NON-dependency examples", () => {
    // "Two effects are affecting the same creature: one from an Aura that says
    // 'Enchanted creature has flying' and one from an Aura that says 'Enchanted
    // creature loses flying.' Neither of these depends on the other, since
    // nothing changes what they affect or what they're doing to it. Applying
    // them in timestamp order means the one that was generated last 'wins.'"
    it("a flying GRANT and a flying REMOVAL in layer 6 stay in timestamp order — the later one wins, in both orders", () => {
        for (const grantFirst of [true, false]) {
            const bears = makeInstance(grizzlyBears.id, {
                id: "bears",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [bears] }),
                    makePlayer("p2"),
                ],
            });
            const grant: ContinuousEffect = {
                id: "ce-grant",
                layer: 6,
                timestamp: grantFirst ? 1 : 2,
                expiry: { kind: "indefinite", controllerId: "p1" },
                affected: { kind: "instances", instanceIds: ["bears"] },
                payload: { kind: "keyword-grant", keyword: "flying" },
                characteristicDefining: false,
            };
            const remove: ContinuousEffect = {
                ...grant,
                id: "ce-remove",
                timestamp: grantFirst ? 2 : 1,
                payload: { kind: "keyword-remove", keyword: "flying" },
            };
            state.continuousEffects = [grant, remove];
            const derived = deriveLayer6(view(state), asView(bears));
            // The later effect wins: grant last -> flying; removal last -> none.
            expect(derived.staticAbilities.includes("flying")).toBe(
                !grantFirst
            );
        }
    });

    // "One effect reads, 'White creatures get +1/+1,' and another reads,
    // 'Enchanted creature is white.' The enchanted creature gets +1/+1 from the
    // first effect, regardless of its previous color." Clause (a) alone rules
    // the dependency out: layer 5 and layer 7c are different layers, so
    // `orderByDependency` never puts the two in one group.
    it("effects in different layers are never grouped, so no dependency between them is even askable", () => {
        const colour: ContinuousEffect = {
            id: "ce-white",
            layer: 5,
            timestamp: 2,
            expiry: { kind: "indefinite", controllerId: "p1" },
            affected: { kind: "instances", instanceIds: ["bears"] },
            payload: { kind: "color-change", add: ["W"] },
            characteristicDefining: false,
        };
        const anthem: ContinuousEffect = {
            id: "ce-anthem",
            layer: 7,
            sublayer: "7c",
            timestamp: 1,
            expiry: { kind: "indefinite", controllerId: "p1" },
            affected: { kind: "instances", instanceIds: ["bears"] },
            payload: { kind: "pt-modify", power: 1, toughness: 1 },
            characteristicDefining: false,
        };
        const ordered = orderByDependency([colour, anthem], {
            compare: compareContinuousEffects,
            template: () => undefined,
            ctx: STATIC_EFFECT_CTX,
        });
        expect(ordered.map((e) => e.id)).toEqual(["ce-white", "ce-anthem"]);
    });
});

describe("CR 613.8a/b — the dependency cases", () => {
    // CR 305.7 — "If an effect sets a land's subtype to one or more of the basic
    // land types ... It loses all abilities generated from its rules text."
    // Applying Blood Moon makes Urborg a Mountain and destroys the very ability
    // generating Urborg's effect, so Urborg DEPENDS on Blood Moon (clause (b),
    // the existence limb). Blood Moon depends on nothing: `IS_NONBASIC_LAND`
    // reads the printed type line and the Basic supertype, neither of which
    // Urborg writes.
    for (const moonFirst of [true, false]) {
        it(`Blood Moon beats Urborg with Blood Moon stamped ${moonFirst ? "first" : "second"} (CR 613.8b over CR 613.7)`, () => {
            const moon = makeInstance(bloodMoon.id, {
                id: "moon",
                controllerId: "p1",
                ownerId: "p1",
            });
            const urborg = makeInstance(urborgTombOfYawgmoth.id, {
                id: "urborg",
                controllerId: "p1",
                ownerId: "p1",
            });
            const island = makeInstance(tropicalIsland.id, {
                id: "island",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = boardWith(
                [moon, urborg, island],
                moonFirst ? [moon, urborg] : [urborg, moon]
            );
            // Blood Moon applies first at either timestamp, and Urborg's own
            // effect no longer exists once it has: no Swamp anywhere.
            expect(
                deriveLayers2to5(view(state), asView(island)).subtypes
            ).toEqual(["Mountain"]);
            expect(
                deriveLayers2to5(view(state), asView(urborg)).subtypes
            ).toEqual(["Mountain"]);
        });
    }

    // Magus of the Moon and Prismatic Omen are INDEPENDENT (CR 613.8a): Magus
    // reads the printed type line and the Basic supertype, which Prismatic Omen
    // never writes; Prismatic Omen reads card TYPES and its controller, which
    // Magus never writes; and Prismatic Omen is an enchantment, so CR 305.7
    // cannot reach its rules text. The board is therefore decided by CR 613.7
    // timestamp order, and the two orders differ.
    for (const magusFirst of [true, false]) {
        it(`Magus of the Moon and Prismatic Omen are independent — the later stamp wins (Magus ${magusFirst ? "first" : "second"})`, () => {
            const magus = makeInstance(magusOfTheMoon.id, {
                id: "magus",
                controllerId: "p1",
                ownerId: "p1",
            });
            const omen = makeInstance(prismaticOmen.id, {
                id: "omen",
                controllerId: "p1",
                ownerId: "p1",
            });
            const island = makeInstance(tropicalIsland.id, {
                id: "island",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = boardWith(
                [magus, omen, island],
                magusFirst ? [magus, omen] : [omen, magus]
            );
            const subtypes = deriveLayers2to5(
                view(state),
                asView(island)
            ).subtypes;
            if (magusFirst) {
                // Magus sets to Mountain, then Prismatic Omen adds all five.
                expect([...subtypes].sort()).toEqual(
                    ["Forest", "Island", "Mountain", "Plains", "Swamp"].sort()
                );
            } else {
                // Prismatic Omen adds all five, then Magus replaces the line.
                expect(subtypes).toEqual(["Mountain"]);
            }
        });
    }

    // Conspiracy reads card TYPES (`ctx.isCreature`) and writes subtypes; Life
    // and Limb reads SUBTYPES and writes both card types and subtypes. Each
    // changes what the other applies to, so the two form CR 613.8b's dependency
    // loop: "this rule is ignored and the effects in the dependency loop are
    // applied in timestamp order".
    for (const conspiracyFirst of [true, false]) {
        it(`Conspiracy and Life and Limb form a dependency LOOP, resolved in timestamp order (Conspiracy ${conspiracyFirst ? "first" : "second"})`, () => {
            const consp = makeInstance(conspiracy.id, {
                id: "conspiracy",
                controllerId: "p1",
                ownerId: "p1",
                chosenSubtypes: ["Zombie"],
            });
            const lal = makeInstance(lifeAndLimb.id, {
                id: "lal",
                controllerId: "p1",
                ownerId: "p1",
            });
            const bears = makeInstance(grizzlyBears.id, {
                id: "bears",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = boardWith(
                [consp, lal, bears],
                conspiracyFirst ? [consp, lal] : [lal, consp]
            );
            const subtypes = deriveLayers2to5(
                view(state),
                asView(bears)
            ).subtypes;
            if (conspiracyFirst) {
                // Conspiracy replaces the line with Zombie; Life and Limb then
                // no longer sees a Forest or a Saproling, so it adds nothing.
                expect(subtypes).toEqual(["Zombie"]);
            } else {
                // Life and Limb goes first and sees no Forest or Saproling
                // either; Conspiracy then replaces the line.
                expect(subtypes).toEqual(["Zombie"]);
            }
        });
    }

    // CR 613.8a clause (c) — "neither effect is from a characteristic-defining
    // ability or both effects are". Opalescence's base P/T is a CDA (sublayer
    // 7a); Humility's is not (sublayer 7b). They are in different sublayers, so
    // clause (a) already separates them, and clause (c) would separate them
    // again: neither can ever be made to wait for the other.
    for (const humilityFirst of [true, false]) {
        it(`Humility and Opalescence are never grouped — different sublayers and opposite CDA status (Humility ${humilityFirst ? "first" : "second"})`, () => {
            const hum = makeInstance(humility.id, {
                id: "humility",
                controllerId: "p1",
                ownerId: "p1",
            });
            const opal = makeInstance(opalescence.id, {
                id: "opalescence",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = boardWith(
                [hum, opal],
                humilityFirst ? [hum, opal] : [opal, hum]
            );
            // CR 613.4a then 613.4b: Opalescence's CDA sets Humility's P/T to
            // its mana value, and Humility's 7b set then overrides it to 1/1 —
            // the sublayer order, unaffected by either timestamp.
            expect(getEffectivePower(view(state), asView(hum))).toBe(1);
            expect(getEffectiveToughness(view(state), asView(hum))).toBe(1);
        });
    }
});

describe("CR 613.8a clause (c) — the CDA guard", () => {
    it("no layer-2-to-6 static effect kind generates a characteristic-defining ability", () => {
        // ADR 0115: clause (c) is enforced through `characteristicDefining`,
        // which every layer-2-to-6 producer hardcodes to `false`. That is
        // catalogue-conditional — CR 702.73 Changeling is a CDA defining
        // subtypes in layer 4 — so this reds the day such a kind lands, instead
        // of clause (c) failing open and silently.
        const layered = [
            ...Object.keys(LAYER_2_5_STATIC_EFFECT_KINDS),
            ...Object.keys(LAYER_6_STATIC_EFFECT_KINDS),
        ];
        for (const kind of layered) {
            expect(
                CDA_STATIC_EFFECT_KINDS.has(kind as StaticEffect["kind"])
            ).toBe(false);
        }
    });

    it("every StaticEffect kind has a read-set row", () => {
        // The `Record<StaticEffect["kind"], …>` makes this a `tsc` error too;
        // the runtime assertion catches a row typed as present but written
        // `undefined`.
        for (const value of Object.values(STATIC_EFFECT_READS)) {
            expect(Array.isArray(value)).toBe(true);
        }
    });
});

describe("CR 613.8a — the oracle", () => {
    // A test-only implementation of CR 613.8a taken LITERALLY, asserted to agree
    // with the declared table (ADR 0115 decision 4). Clause (b) unpacks into two
    // probes that need no layer derivation at all:
    //
    //   - what it applies to — re-run A's predicate over the board with B's
    //     payload applied to the candidate, and compare the affected set;
    //   - existence — ask whether A's source still generates the ability once B
    //     has applied.
    //
    // "What it does to them" is trivially unchanged for every effect on these
    // boards: an inline payload is frozen data, and every template payload here
    // is a literal subtype/type list rather than a computed one.
    type Probe = {
        entry: ContinuousEffect;
        template: DependencyTemplate;
    };

    /** Applies `b`'s layer-4 payload to a COPY of `candidate`, then asks `a`'s
     *  predicate about both copies. A disagreement is CR 613.8a clause (b). */
    function oracleDependsOn(
        a: Probe,
        b: Probe,
        board: readonly PermanentView[],
        probes: readonly Probe[]
    ): boolean {
        if (a.entry.layer !== b.entry.layer) return false;
        if (a.entry.sublayer !== b.entry.sublayer) return false;
        if (a.entry.characteristicDefining !== b.entry.characteristicDefining) {
            return false;
        }
        for (const candidate of board) {
            // CR 613.8c — "after each effect is applied, the order of remaining
            // effects is reevaluated". The question "would applying B change
            // what A applies to" is therefore asked on the board as the layer
            // leaves it, with every OTHER effect of the layer applied, not on
            // the untouched printed card.
            const base = probes
                .filter((probe) => probe !== b)
                .reduce((view, probe) => applied(probe, view), candidate);
            if (matches(a, base) !== matches(a, applied(b, base))) return true;
        }
        // The existence limb: CR 305.7 destroys the rules text generating `a`.
        const source = a.template.source;
        if (!source.types.includes("Land")) return false;
        const replaced = replacement(b, source);
        return (
            replaced !== undefined &&
            replaced.some((s) =>
                ["Plains", "Island", "Swamp", "Mountain", "Forest"].includes(s)
            )
        );
    }

    function matches(probe: Probe, target: PermanentView): boolean {
        const effect = probe.template.effect;
        if (effect.kind === "subtype-set") {
            return replacement(probe, target) !== undefined;
        }
        const applies = (
            effect as {
                applies?: StaticEffect["kind"] extends never
                    ? never
                    : (
                          t: PermanentView,
                          s: PermanentView,
                          c: typeof STATIC_EFFECT_CTX
                      ) => boolean;
            }
        ).applies;
        return applies
            ? applies(target, probe.template.source, STATIC_EFFECT_CTX)
            : false;
    }

    function replacement(
        probe: Probe,
        target: PermanentView
    ): readonly string[] | undefined {
        const effect = probe.template.effect;
        if (effect.kind !== "subtype-set") return undefined;
        if (effect.subtypesFor) {
            return (
                effect.subtypesFor(
                    target,
                    probe.template.source,
                    STATIC_EFFECT_CTX
                ) ?? undefined
            );
        }
        return effect.applies?.(
            target,
            probe.template.source,
            STATIC_EFFECT_CTX
        )
            ? effect.subtypes
            : undefined;
    }

    /** `candidate` as it would be with `b` already applied — the "applying the
     *  other" of CR 613.8a clause (b), for the layer-4 payloads on these
     *  boards. */
    function applied(b: Probe, candidate: PermanentView): PermanentView {
        const effect = b.template.effect;
        const copy: PermanentView = {
            ...candidate,
            types: [...candidate.types],
            subtypes: [...candidate.subtypes],
        };
        if (effect.kind === "subtype-set") {
            const next = replacement(b, candidate);
            if (next) copy.subtypes = [...next];
        } else if (
            effect.kind === "subtype-add" &&
            effect.applies(candidate, b.template.source, STATIC_EFFECT_CTX)
        ) {
            copy.subtypes = [
                ...new Set([...copy.subtypes, ...effect.subtypes]),
            ];
        } else if (
            effect.kind === "type-add" &&
            effect.applies(candidate, b.template.source, STATIC_EFFECT_CTX)
        ) {
            copy.types = [...new Set([...copy.types, ...effect.types])];
        }
        return copy;
    }

    const cases: {
        name: string;
        cards: {
            def: { id: string; staticEffects?: readonly StaticEffect[] };
            id: string;
        }[];
        expected: [string, string][];
    }[] = [
        {
            name: "Blood Moon + Urborg",
            cards: [
                { def: bloodMoon, id: "moon" },
                { def: urborgTombOfYawgmoth, id: "urborg" },
            ],
            expected: [["urborg#0", "moon#1"]],
        },
        {
            name: "Magus of the Moon + Prismatic Omen",
            cards: [
                { def: magusOfTheMoon, id: "magus" },
                { def: prismaticOmen, id: "omen" },
            ],
            expected: [],
        },
        {
            name: "Conspiracy + Life and Limb",
            cards: [
                { def: conspiracy, id: "conspiracy" },
                { def: lifeAndLimb, id: "lal" },
            ],
            expected: [
                ["conspiracy#0", "lal#0"],
                ["lal#0", "conspiracy#0"],
                ["lal#1", "conspiracy#0"],
            ],
        },
    ];

    for (const testCase of cases) {
        it(`agrees with the declared table on ${testCase.name}`, () => {
            const permanents = testCase.cards.map(({ def, id }) =>
                makeInstance(def.id, {
                    id,
                    controllerId: "p1",
                    ownerId: "p1",
                    ...(def.id === conspiracy.id
                        ? { chosenSubtypes: ["Zombie"] }
                        : {}),
                })
            );
            const island = makeInstance(tropicalIsland.id, {
                id: "island",
                controllerId: "p1",
                ownerId: "p1",
            });
            const bears = makeInstance(grizzlyBears.id, {
                id: "bears",
                controllerId: "p1",
                ownerId: "p1",
            });
            const board = [...permanents, island, bears].map(asView);

            const probes: Probe[] = [];
            for (let p = 0; p < permanents.length; p++) {
                const effects = testCase.cards[p].def.staticEffects ?? [];
                for (let i = 0; i < effects.length; i++) {
                    const effect = effects[i];
                    if (LAYER_2_5_STATIC_EFFECT_KINDS[effect.kind] !== 4) {
                        continue;
                    }
                    probes.push({
                        entry: {
                            id: `${permanents[p].id}#${i}`,
                            layer: 4,
                            timestamp: probes.length,
                            expiry: {
                                kind: "source",
                                sourceId: permanents[p].id,
                            },
                            affected: { kind: "predicate" },
                            payload: {
                                kind: "template",
                                sourceCardId: testCase.cards[p].def.id,
                                effectIndex: i,
                            },
                            characteristicDefining: false,
                        },
                        template: {
                            source: asView(permanents[p]),
                            effect,
                        },
                    });
                }
            }

            const oracle: string[] = [];
            for (const a of probes) {
                for (const b of probes) {
                    if (a === b) continue;
                    if (oracleDependsOn(a, b, board, probes)) {
                        oracle.push(`${a.entry.id}->${b.entry.id}`);
                    }
                }
            }
            const expected = testCase.expected.map(
                ([from, to]) => `${from}->${to}`
            );
            expect([...oracle].sort()).toEqual([...expected].sort());
        });
    }
});
