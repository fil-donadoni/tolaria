// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — sweep positions and the plays that win there.
// One fixture per outcome on the generated position; the sweep itself runs over the whole
// `ready` set in `oracle:compile`, these files are the evidence its verdicts
// mean what the lockfile says (split by cost, issue #6148).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition } from "../../../cards/types";
import { applyMoveInSearch, policyValue } from "../../search";
import { cloneGameState } from "../../clone";
import type { GameState } from "../../state";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import type { Move } from "../../moves";
import { enumerateMoves } from "../../moves";
import {
    REACH_WINDOWS,
    botReachSpec,
    buildBotReachState,
    playBotReach,
    playBotReachSeats,
} from "../botReach";
import {
    ahead,
    forEachDestroy,
    forEachPump,
    castleCount,
    forEachDamage,
    creatureWithSweep,
    eachPlayerSacrifices,
    ownersOf,
} from "./botReachPlay.fixture";

describe("Bot-play sweep (ADR 0105 § 7.2) — sweep positions and the plays that win there", () => {
    // Issue #4773 — the verdict above held for Armageddon only by rollout
    // noise: at 1 ply `pass` beat the cast by ~50 points, because the sweep
    // sat in hand at one representative victim's worth while the land surplus
    // it takes is worth less. The greedy policy is the claim that does not
    // depend on the budget: with the opponent ahead in the swept type, the
    // cast reads as a gain for every destroyed kind.
    it("a destroying sweep with the opponent ahead beats pass at 1 ply", () => {
        const valueOf = (
            state: GameState,
            holderId: string,
            move: Move
        ): number => {
            const probe = cloneGameState(state);
            applyMoveInSearch(probe, holderId, move);
            return policyValue(
                probe,
                holderId,
                move,
                DEFAULT_EVAL_WEIGHTS,
                holderId
            );
        };
        // Issue #4781 — one card per family the hand term now reads off the
        // board: a colour-filtered bounce, a damage sweep, a subtype-filtered
        // destroy.
        for (const name of [
            "Day of Judgment",
            "Tranquility",
            "Armageddon",
            "Hibernation",
            "Pyroclasm",
            "Flashfires",
        ] as const) {
            for (const seat of [0, 1] as const) {
                for (const window of REACH_WINDOWS) {
                    const { state, holderId, instanceId } = buildBotReachState(
                        getCardByName(name),
                        seat,
                        window
                    );
                    const moves = enumerateMoves(state, holderId);
                    const pass = moves.find((m) => m.kind === "pass")!;
                    const cast = moves.find(
                        (m) =>
                            m.kind === "cast-spell" &&
                            m.cardInstanceId === instanceId
                    )!;
                    expect(
                        valueOf(state, holderId, cast),
                        `${name} seat ${seat} ${window}`
                    ).toBeGreaterThan(valueOf(state, holderId, pass));
                }
            }
        }
    });

    it("a toughness shrink's position puts the opponent ahead in bodies that die to it, with no Castle to prop them up", () => {
        for (const def of [
            getCardByName("Infest"),
            getCardByName("Languish"),
            forEachPump("shrink-neg", {}, 0, {
                negate: { domain: { of: "controller" } },
            }),
        ])
            withTemporaryDefinition(def, () => {
                for (const seat of [0, 1] as const) {
                    expect(
                        ahead(def, seat, "Creature"),
                        def.name
                    ).toBeGreaterThan(0);
                    expect(castleCount(def, seat), def.name).toBe(0);
                }
            });
    });

    it("a pump of the holder's own creatures puts the holder ahead in bodies", () => {
        const charge = getCardByName("Desperate Charge");
        for (const seat of [0, 1] as const) {
            expect(ahead(charge, seat, "Creature")).toBeLessThan(0);
            // Not a shrink: the Castle stays where it was.
            expect(castleCount(charge, seat)).toBe(2);
        }
    });

    it("played — a mass shrink and a mass pump are cast where they win", () => {
        for (const name of [
            "Infest",
            "Nausea",
            "Shrivel",
            "Planar Despair",
            "Rollick of Abandon",
            "Final Revels",
            "Desperate Charge",
        ] as const)
            expect(playBotReach(getCardByName(name)), name).toEqual({
                outcome: "played",
            });
    }, 300_000);

    it("a damage sweep's position puts the opponent ahead in bodies that die to it, with no Castle to prop them up", () => {
        for (const def of [
            forEachDamage("damage-all", { filter: { type: "Creature" } }),
            forEachDamage("damage-nonflying", {
                filter: { type: "Creature", excludeAbility: "flying" },
            }),
        ])
            withTemporaryDefinition(def, () => {
                for (const seat of [0, 1] as const) {
                    expect(
                        ahead(def, seat, "Creature"),
                        def.name
                    ).toBeGreaterThan(0);
                    expect(castleCount(def, seat), def.name).toBe(0);
                }
            });
    });

    it("no claim is made where the damage does not reach both sides' creatures", () => {
        for (const def of [
            forEachDamage("damage-own", {
                controller: "controller",
                filter: { type: "Creature" },
            }),
            forEachDamage("damage-land", { filter: { type: "Land" } }),
            forEachDamage("damage-fliers", {
                filter: { type: "Creature", hasAbility: "flying" },
            }),
        ])
            withTemporaryDefinition(def, () => {
                for (const seat of [0, 1] as const) {
                    expect(ahead(def, seat, "Creature"), def.name).toBe(0);
                    expect(castleCount(def, seat), def.name).toBe(2);
                }
            });
    });

    it("played — a damage sweep is cast where it wins", () => {
        // The pose holds discard fodder for the X (issue #5015): without it
        // the sweep's X was at most 1 and the cast a near no-op.
        expect(playBotReach(getCardByName("Sickening Dreams"))).toEqual({
            outcome: "played",
        });
        for (const name of [
            "Pyroclasm",
            "Tremor",
            "Rain of Embers",
            "Dry Spell",
            "Fire Tempest",
        ] as const)
            expect(playBotReach(getCardByName(name)), name).toEqual({
                outcome: "played",
            });
    }, 300_000);

    it("a creature that sweeps behind its own sacrifice is posed against the opponent's surplus, with none of the holder's bodies to lose", () => {
        const def = creatureWithSweep("spent-sweep", { sacrifice: true });
        const kept = creatureWithSweep("spent-vs-kept", { tap: true });
        const ownCreatures = (d: CardDefinition, seat: 0 | 1): number => {
            const { state, holderId } = buildBotReachState(d, seat);
            return state.players
                .find((p) => p.id === holderId)!
                .battlefield.filter((c) => c.types.includes("Creature")).length;
        };
        withTemporaryDefinition(def, () =>
            withTemporaryDefinition(kept, () => {
                for (const seat of [0, 1] as const) {
                    expect(ownCreatures(def, seat), def.name).toBeLessThan(
                        ownCreatures(kept, seat)
                    );
                    expect(
                        ahead(def, seat, "Creature"),
                        def.name
                    ).toBeGreaterThan(0);
                    expect(castleCount(def, seat), def.name).toBe(0);
                }
            })
        );
    });

    it("no claim is made for an ability that keeps the body", () => {
        const def = creatureWithSweep("kept-sweep", { tap: true });
        withTemporaryDefinition(def, () => {
            for (const seat of [0, 1] as const) {
                expect(ahead(def, seat, "Creature"), def.name).toBe(0);
                expect(castleCount(def, seat), def.name).toBe(2);
            }
        });
    });

    it("played — a creature that spends itself on a damage sweep is cast where it wins", () => {
        for (const name of ["Bloodfire Dwarf", "Bloodfire Colossus"] as const)
            expect(playBotReach(getCardByName(name)), name).toEqual({
                outcome: "played",
            });
    }, 300_000);

    // Issue #4469: the gap was a stale verdict from before the damage-sweep pose
    // (issue #4467). Devastate destroys a target land AND damages every
    // creature and player (CR 120.3e), so its pose is the land-target position
    // plus the opponent's surplus of small bodies; the Bot now casts it at both
    // seats.
    // Issue #4890 — CR 603.6a: the sweep is hosted by the card's own "when this
    // enters" trigger, so the pose reads it like a spell script's: the
    // opponent's lands exceed the holder's, which the kicked leg destroys too.
    it("an enters-trigger land sweep is posed against the opponent's surplus of lands", () => {
        const def = getCardByName("Desolation Angel");
        const lands = (owner: "me" | "opp"): number =>
            botReachSpec(def)
                .cards.filter(
                    (c) =>
                        c.owner === owner &&
                        c.zone === "battlefield" &&
                        [
                            "Plains",
                            "Island",
                            "Swamp",
                            "Mountain",
                            "Forest",
                        ].includes(c.name)
                )
                .reduce((n, c) => n + (c.count ?? 1), 0);
        expect(lands("opp")).toBeGreaterThan(lands("me"));
    });

    it("played — a creature whose enters-trigger destroys every land", () => {
        for (const name of ["Desolation Angel", "Desolation Giant"] as const)
            expect(playBotReach(getCardByName(name)), name).toEqual({
                outcome: "played",
            });
    }, 300_000);

    it("played — a land destroyer that also damages every creature", () => {
        expect(playBotReachSeats(getCardByName("Devastate"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    it("a symmetric edict's position leaves the holder nothing of the edicted type and the opponent bodies to lose", () => {
        for (const [name, kind] of [
            ["Barter in Blood", "Creature"],
            ["Simplify", "Enchantment"],
        ] as const)
            for (const seat of [0, 1] as const) {
                const { holder, opponent } = ownersOf(
                    getCardByName(name),
                    seat,
                    kind
                );
                expect(holder, name).toBe(0);
                expect(opponent, name).toBeGreaterThan(0);
            }
    });

    it("no claim is made where the edict is not a plain type filter", () => {
        // A subtype-filtered edict is not read: the level pose stays.
        const def = eachPlayerSacrifices("edict-subtype", {
            type: "Creature",
            subtype: "Goblin",
        });
        expect(ownersOf(def, 0, "Creature").holder).toBe(2);
    });

    it("played — a symmetric edict is cast where the opponent loses more", () => {
        for (const name of [
            "Barter in Blood",
            "Crack the Earth",
            "Simplify",
        ] as const)
            expect(playBotReach(getCardByName(name)), name).toEqual({
                outcome: "played",
            });
    }, 300_000);

    it("a destroying sweep's position puts the opponent ahead in the swept type, the holder ahead in bodies", () => {
        for (const seat of [0, 1] as const) {
            const wrath = getCardByName("Day of Judgment");
            expect(ahead(wrath, seat, "Creature")).toBeGreaterThan(0);
            expect(ahead(wrath, seat, "Enchantment")).toBe(0);
            const tranquility = getCardByName("Tranquility");
            expect(ahead(tranquility, seat, "Enchantment")).toBeGreaterThan(0);
            // What the sweep leaves standing is the holder's.
            expect(ahead(tranquility, seat, "Creature")).toBeLessThan(0);
            const armageddon = getCardByName("Armageddon");
            expect(ahead(armageddon, seat, "Land")).toBeGreaterThan(0);
            expect(ahead(armageddon, seat, "Creature")).toBeLessThan(0);
        }
    });

    it("no claim is made where the sweep does not destroy what the pose would hand over", () => {
        // Each of these selects every player's battlefield or looks like a
        // sweep, and each must keep the SYMMETRIC pose: a buff or a shrink is
        // not a loss for the opponent, a filter no filler matches (Goblins)
        // poses nothing, and `controller` scopes the sweep to one side.
        const symmetric: CardDefinition[] = [
            getCardByName("Grizzly Bears"),
            forEachPump("buff-all", {}, 2, 0), // +2/+0 to every creature
            forEachPump("shrink-power", {}, -2, 0), // -2/-0 kills nothing
            forEachPump("shrink-own", { controller: "controller" }, 0, -2),
            forEachPump(
                "shrink-subtype",
                { filter: { subtype: "Goblin" } },
                0,
                -2
            ),
            forEachDestroy("subtype-only", {
                filter: { subtype: "Goblin" },
            }),
            forEachDestroy("own-only", {
                controller: "controller",
                filter: { type: "Creature" },
            }),
        ];
        for (const def of symmetric)
            withTemporaryDefinition(def, () => {
                for (const seat of [0, 1] as const) {
                    for (const kind of [
                        "Creature",
                        "Artifact",
                        "Enchantment",
                    ] as const)
                        expect(ahead(def, seat, kind), def.name).toBe(0);
                    // The holder's lands are the card's cost, so it always has
                    // more of them; the pose only ever ADDS to the opponent's.
                    expect(ahead(def, seat, "Land"), def.name).toBeLessThan(0);
                }
            });
    });

    // Issue #4781 — a removing sweep whose filter names no card type was
    // posed level, so nothing it took was the opponent's surplus and its
    // 1-ply cast read as a loss. The pose now matches the filter against the
    // fillers and basics through the latent lens' own mapping.
    it("a sweep filtered on anything but type is posed against what the filter matches", () => {
        const nonland = forEachDestroy("excludes-land", {
            filter: { excludeType: "Land" },
        });
        const plains = forEachDestroy("plains-only", {
            filter: { subtype: "Plains" },
        });
        withTemporaryDefinition(nonland, () => {
            for (const seat of [0, 1] as const) {
                for (const kind of [
                    "Creature",
                    "Artifact",
                    "Enchantment",
                ] as const)
                    expect(ahead(nonland, seat, kind), kind).toBeGreaterThan(0);
                expect(ahead(nonland, seat, "Land")).toBeLessThan(0);
            }
        });
        withTemporaryDefinition(plains, () => {
            for (const seat of [0, 1] as const) {
                expect(ahead(plains, seat, "Land")).toBeGreaterThan(0);
                expect(ahead(plains, seat, "Creature")).toBe(0);
            }
        });
    });

    it("a sweep with no filter destroys every type, so every type is posed", () => {
        const all = forEachDestroy("unfiltered", {});
        withTemporaryDefinition(all, () => {
            for (const seat of [0, 1] as const) {
                expect(ahead(all, seat, "Creature")).toBeGreaterThan(0);
                expect(ahead(all, seat, "Enchantment")).toBeGreaterThan(0);
                expect(ahead(all, seat, "Land")).toBeGreaterThan(0);
            }
        });
    });
});
