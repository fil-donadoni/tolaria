import { describe, it, expect, beforeAll } from "vitest";
import {
    isUntargetableByPending,
    isPlayerUntargetableByPending,
} from "../targeting";
import type { CardInstance, Player, StackItem } from "~/types/game";
import { registerTokenDefinition } from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { PROTECTION_FROM_COLORED_SPELLS } from "@convex/gre/protection";
// The SERVER's accepted set, imported so the parity rows below compare the two
// real implementations instead of a client-side restatement of the server's
// rule: `applyOneTargetSelection` is the per-target function the `selectTarget`
// mutation calls (issue #2296 review).
import { applyOneTargetSelection } from "@convex/game";
import type { PendingTarget } from "@convex/gre/state";

// Client mirror of the server `cantBeTargeted` gate (#382, CR 702.18 / 611 /
// 113.3 / 109.5). When `isUntargetableByPending` returns true the battlefield
// click gate (useBattlefieldInteraction / useBattlefieldVisualState) greys the
// card and never fires `selectTarget` — so a shrouded permanent reads as
// un-clickable. These tests pin that the client derives the same answer the
// server does, including across the spell-vs-ability and Aura-spell axes.

// Real shipped C6 card ids (registry-resolved by id, like the server).
const JASMINE_BOREAL = "db6ef678-4ce9-48d6-aa4f-2afd9a1ad724"; // vanilla creature
const SPECTRAL_CLOAK = "7524fd0d-a675-41d6-bc99-bd3ba336893b";
const ANTI_MAGIC_AURA = "ff78eef1-efaa-4a12-bf5d-fec83c14aff8";
const BARTEL_RUNEAXE = "f1a42691-98bb-4234-9b56-085e6677f3e4";
const SYLVAN_CARYATID = "d40b65c1-b24d-492d-81b9-d8474ebdc08c"; // hexproof

function inst(
    overrides: Partial<CardInstance> & { card: { id: string } }
): CardInstance {
    return {
        id: overrides.id ?? "inst",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        types: ["Creature"],
        subtypes: [],
        ...overrides,
    };
}

function player(overrides: Partial<Player> & { id: string }): Player {
    return {
        name: overrides.id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    } as Player;
}

describe("isUntargetableByPending — Spectral Cloak (CR 702.18)", () => {
    function board(bearTapped: boolean): Player[] {
        const bear = inst({
            id: "bear",
            card: { id: JASMINE_BOREAL },
            isTapped: bearTapped,
        });
        const cloak = inst({
            id: "cloak",
            card: { id: SPECTRAL_CLOAK },
            types: ["Enchantment"],
            subtypes: ["Aura"],
            attachedTo: "bear",
        });
        const spell = inst({
            id: "spell",
            card: { id: JASMINE_BOREAL },
            zone: "hand",
        });
        return [
            player({ id: "p1", battlefield: [bear, cloak], hand: [spell] }),
            player({ id: "p2" }),
        ];
    }

    it("marks the untapped cloaked creature as not clickable", () => {
        const players = board(false);
        const bear = players[0].battlefield[0];
        expect(
            isUntargetableByPending(players, bear, "spell", "cast", [])
        ).toBe(true);
    });

    it("becomes clickable again once the host taps", () => {
        const players = board(true);
        const bear = players[0].battlefield[0];
        expect(
            isUntargetableByPending(players, bear, "spell", "cast", [])
        ).toBe(false);
    });
});

describe("isUntargetableByPending — Anti-Magic Aura (CR 113.3)", () => {
    function board(): Player[] {
        const bear = inst({ id: "bear", card: { id: JASMINE_BOREAL } });
        const aura = inst({
            id: "aura",
            card: { id: ANTI_MAGIC_AURA },
            types: ["Enchantment"],
            subtypes: ["Aura"],
            attachedTo: "bear",
        });
        const spell = inst({
            id: "spell",
            card: { id: JASMINE_BOREAL },
            zone: "hand",
        });
        const tim = inst({ id: "tim", card: { id: JASMINE_BOREAL } });
        return [
            player({
                id: "p1",
                battlefield: [bear, aura, tim],
                hand: [spell],
            }),
            player({ id: "p2" }),
        ];
    }

    it("not clickable for a spell source", () => {
        const players = board();
        const bear = players[0].battlefield[0];
        expect(
            isUntargetableByPending(players, bear, "spell", "cast", [])
        ).toBe(true);
    });

    it("clickable for an ability source (CR 113.3 — spells only)", () => {
        const players = board();
        const bear = players[0].battlefield[0];
        // Ability source = a battlefield permanent ("tim").
        expect(
            isUntargetableByPending(players, bear, "tim", "ability", [])
        ).toBe(false);
    });
});

describe("isUntargetableByPending — Bartel Runeaxe (CR 109.5)", () => {
    function board(): Player[] {
        const bartel = inst({
            id: "bartel",
            card: { id: BARTEL_RUNEAXE },
        });
        const auraSpell = inst({
            id: "aura-spell",
            card: { id: ANTI_MAGIC_AURA },
            types: ["Enchantment"],
            subtypes: ["Aura"],
            zone: "hand",
        });
        const boltSpell = inst({
            id: "bolt",
            card: { id: JASMINE_BOREAL },
            zone: "hand",
        });
        return [
            player({
                id: "p1",
                battlefield: [bartel],
                hand: [auraSpell, boltSpell],
            }),
            player({ id: "p2" }),
        ];
    }

    it("not clickable for an Aura spell", () => {
        const players = board();
        const bartel = players[0].battlefield[0];
        expect(
            isUntargetableByPending(players, bartel, "aura-spell", "cast", [])
        ).toBe(true);
    });

    it("clickable for a non-Aura spell", () => {
        const players = board();
        const bartel = players[0].battlefield[0];
        expect(
            isUntargetableByPending(players, bartel, "bolt", "cast", [])
        ).toBe(false);
    });
});

// CR 702.11b — hexproof is controller-relative: an opponent's targeted spell
// greys the permanent (not clickable), but the controller's own does not.
// #958. The 5th arg to isUntargetableByPending is the source's controller (the
// chooser = pendingTarget.playerId), threaded by both battlefield click gates.
describe("isUntargetableByPending — Sylvan Caryatid hexproof (CR 702.11b)", () => {
    function board(): Player[] {
        // p1 controls the hexproof Caryatid. staticAbilities mirror the wire
        // projection (the server ships the effective keyword array on the card).
        const caryatid = inst({
            id: "caryatid",
            card: { id: SYLVAN_CARYATID },
            types: ["Creature"],
            subtypes: ["Plant"],
            staticAbilities: ["defender", "hexproof"],
        });
        // p1's own bolt (in p1's hand) and p2's bolt (in p2's hand).
        const ownBolt = inst({
            id: "own-bolt",
            card: { id: JASMINE_BOREAL },
            zone: "hand",
        });
        const oppBolt = inst({
            id: "opp-bolt",
            card: { id: JASMINE_BOREAL },
            zone: "hand",
        });
        return [
            player({ id: "p1", battlefield: [caryatid], hand: [ownBolt] }),
            player({ id: "p2", hand: [oppBolt] }),
        ];
    }

    it("not clickable for an opponent's targeted spell (source controller = p2)", () => {
        const players = board();
        const caryatid = players[0].battlefield[0];
        expect(
            isUntargetableByPending(
                players,
                caryatid,
                "opp-bolt",
                "cast",
                [],
                "p2"
            )
        ).toBe(true);
    });

    it("clickable for the controller's own targeted spell (source controller = p1)", () => {
        const players = board();
        const caryatid = players[0].battlefield[0];
        expect(
            isUntargetableByPending(
                players,
                caryatid,
                "own-bolt",
                "cast",
                [],
                "p1"
            )
        ).toBe(false);
    });
});

// Player-scoped shroud (CR 702.18 applied to a player via CR 115.4, #1128).
// Mirrors the permanent suites above but drives `isPlayerUntargetableByPending`
// — the client mirror of the server's `playerHasShroud` gate — through a
// player nameplate rather than a battlefield card. No shipped card grants
// this yet (Solitary Confinement is the real consumer, blocked-by child of
// #1058); verified here with a fixture permanent registered via
// `registerTokenDefinition`, mirroring the GRE suite's synthetic-card
// pattern ("no real card this slice", per the issue).
const PLAYER_SHROUD_SOURCE_ID = "test-player-shroud-source-client";
const playerShroudFixture: CardDefinition = {
    id: PLAYER_SHROUD_SOURCE_ID,
    name: "Test Player Shroud Source",
    rarity: "common",
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "player-guard",
            id: "test-player-shroud-client",
            cantBeTargeted: true,
        },
    ],
};

beforeAll(() => {
    registerTokenDefinition(playerShroudFixture);
});

describe("isPlayerUntargetableByPending — player-scoped shroud (CR 702.18 / 115.4, #1128)", () => {
    function board(): Player[] {
        const source = inst({
            id: "shroud-source",
            card: { id: PLAYER_SHROUD_SOURCE_ID },
            types: ["Enchantment"],
            subtypes: [],
        });
        return [
            player({ id: "p1", battlefield: [source] }),
            player({ id: "p2" }),
        ];
    }

    it("marks the shrouded player's controller as not clickable", () => {
        const players = board();
        expect(isPlayerUntargetableByPending(players, "p1")).toBe(true);
    });

    it("leaves the non-shrouded player clickable (no regression)", () => {
        const players = board();
        expect(isPlayerUntargetableByPending(players, "p2")).toBe(false);
    });
});

// The One Ring (#674) — protection from everything bars targeting on the same
// unconditional terms as shroud, so it folds into the same client gate. Unlike
// shroud it is NOT derived from a battlefield permanent: it's the wire
// designation `GameState.playerProtectionFromEverything`, threaded through
// GameContext into `usePlayerInteraction` / `useDivideTargets`.
describe("isPlayerUntargetableByPending — protection from everything (CR 702.16b/i / 115.4, #674)", () => {
    function board(): Player[] {
        return [player({ id: "p1" }), player({ id: "p2" })];
    }

    it("marks a protected player as not clickable with no permanent on board", () => {
        expect(isPlayerUntargetableByPending(board(), "p1", ["p1"])).toBe(true);
    });

    it("leaves the unprotected player clickable", () => {
        expect(isPlayerUntargetableByPending(board(), "p2", ["p1"])).toBe(
            false
        );
    });

    it("no designation on the wire leaves both players clickable (no regression)", () => {
        expect(isPlayerUntargetableByPending(board(), "p1")).toBe(false);
        expect(isPlayerUntargetableByPending(board(), "p1", [])).toBe(false);
    });
});

// CR 702.16b (issue #1120) — protection from a NON-COLOUR quality on the
// CLIENT click gate. A protection the server enforces but the client still
// offers as a clickable target is a bug: the player clicks, the mutation
// throws, and nothing on the board explains why. These run through the REAL
// `isUntargetableByPending` (which is what `useBattlefieldInteraction` and
// `useBattlefieldVisualState` both call), never a hand-built view.
const TSABO_TAVOC = "ccbe2539-7a7c-468b-a270-7ca1bdcccb1e"; // protection from legendary creatures
const BARKTOOTH_WARBEARD = "0ea52228-f8ad-4623-9e05-f162473bfc03"; // Legendary Creature
const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // plain Creature

describe("isUntargetableByPending — protection from a quality (CR 702.16b, #1120)", () => {
    function board(sourceCardId: string): Player[] {
        const tsabo = inst({
            id: "tsabo",
            card: { id: TSABO_TAVOC },
            controllerId: "p1",
            ownerId: "p1",
            staticAbilities: [
                "first strike",
                "protection from legendary creatures",
            ],
        });
        const bystander = inst({
            id: "bystander",
            card: { id: GRIZZLY_BEARS_ID },
            controllerId: "p1",
            ownerId: "p1",
        });
        const source = inst({
            id: "source",
            card: { id: sourceCardId },
            controllerId: "p2",
            ownerId: "p2",
        });
        return [
            player({ id: "p1", battlefield: [tsabo, bystander] }),
            player({ id: "p2", battlefield: [source] }),
        ];
    }

    it("greys Tsabo Tavoc out for a legendary creature's ability", () => {
        const players = board(BARKTOOTH_WARBEARD);
        const tsabo = players[0].battlefield[0];
        expect(
            isUntargetableByPending(
                players,
                tsabo,
                "source",
                "ability",
                [],
                "p2"
            )
        ).toBe(true);
    });

    it("must-NOT — leaves it clickable for a NON-legendary source", () => {
        const players = board(GRIZZLY_BEARS_ID);
        const tsabo = players[0].battlefield[0];
        expect(
            isUntargetableByPending(
                players,
                tsabo,
                "source",
                "ability",
                [],
                "p2"
            )
        ).toBe(false);
    });

    it("must-NOT — leaves an unprotected permanent clickable for the legend", () => {
        const players = board(BARKTOOTH_WARBEARD);
        const bystander = players[0].battlefield[1];
        expect(
            isUntargetableByPending(
                players,
                bystander,
                "source",
                "ability",
                [],
                "p2"
            )
        ).toBe(false);
    });

    it("greys it out for its OWN controller's legend too (no controller exception)", () => {
        const players = board(BARKTOOTH_WARBEARD);
        players[1].battlefield[0].controllerId = "p1";
        const tsabo = players[0].battlefield[0];
        expect(
            isUntargetableByPending(
                players,
                tsabo,
                "source",
                "ability",
                [],
                "p1"
            )
        ).toBe(true);
    });
});

// CR 702.16b on a TRIGGER-sourced pending target (issue #1120 review). A
// triggered ability's `PendingTarget.cardInstanceId` is a synthetic STACK-ITEM
// id — present in neither hand nor battlefield — so before the stack was
// threaded in, the client could not resolve the source at all and fell open:
// the protected permanent glowed, was clickable, and the click hard-errored
// with "Target has protection from this source". These drive the real gate.
describe("isUntargetableByPending — trigger source on the stack (CR 405 / 702.16b)", () => {
    function triggerBoard(sourceCardId: string): {
        players: Player[];
        stack: StackItem[];
    } {
        const tsabo = inst({
            id: "tsabo",
            card: { id: TSABO_TAVOC },
            controllerId: "p1",
            ownerId: "p1",
            staticAbilities: [
                "first strike",
                "protection from legendary creatures",
            ],
        });
        const bystander = inst({
            id: "bystander",
            card: { id: GRIZZLY_BEARS_ID },
            controllerId: "p1",
            ownerId: "p1",
        });
        // The on-stack trigger item — a `...self` snapshot of the source
        // permanent, exactly as `buildTriggerItem` produces it.
        const triggerItem = {
            ...inst({
                id: "trigger-1",
                card: { id: sourceCardId },
                controllerId: "p2",
                ownerId: "p2",
                zone: "stack",
            }),
            castById: "p2",
            triggeredAbilityId: "some-trigger",
        } as unknown as StackItem;
        return {
            players: [
                player({ id: "p1", battlefield: [tsabo, bystander] }),
                player({ id: "p2", battlefield: [] }),
            ],
            stack: [triggerItem],
        };
    }

    it("greys Tsabo Tavoc out for a LEGENDARY creature's trigger", () => {
        const { players, stack } = triggerBoard(BARKTOOTH_WARBEARD);
        const tsabo = players[0].battlefield[0];
        expect(
            isUntargetableByPending(
                players,
                tsabo,
                "trigger-1",
                "trigger",
                stack,
                "p2"
            )
        ).toBe(true);
    });

    it("must-NOT — leaves it clickable for a NON-legendary creature's trigger", () => {
        const { players, stack } = triggerBoard(GRIZZLY_BEARS_ID);
        const tsabo = players[0].battlefield[0];
        expect(
            isUntargetableByPending(
                players,
                tsabo,
                "trigger-1",
                "trigger",
                stack,
                "p2"
            )
        ).toBe(false);
    });

    it("must-NOT — leaves an unprotected permanent clickable for the legendary trigger", () => {
        const { players, stack } = triggerBoard(BARKTOOTH_WARBEARD);
        const bystander = players[0].battlefield[1];
        expect(
            isUntargetableByPending(
                players,
                bystander,
                "trigger-1",
                "trigger",
                stack,
                "p2"
            )
        ).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// CR 702.16a — "protection from spells that are one or more colors"
// (issue #2296): client parity for the SPELL-RESTRICTED quality
// ─────────────────────────────────────────────────────────────────────────
//
// The Phelia bug class (ADR 0068): the server's ACCEPTED set learns a quality
// family and the client's OFFERED set does not, so a permanent glows, the
// player clicks, and `selectTarget` throws. This quality is the worst possible
// shape for it — the client CAN see the source's colours off the wire, so a
// colour-only client implementation looks like it works and is wrong in
// exactly the CR 113.3 cases (an ability of a coloured permanent).
//
// Every row below asserts BOTH verdicts against the SAME `PendingTarget`:
//   * the CLIENT's, from the real helper (`isUntargetableByPending`) fed the
//     way the two hooks feed it — `pendingTarget.{cardInstanceId,kind,playerId}`
//     read off the REAL wire projection (`projectPublicState`);
//   * the SERVER's, from the real accepted-set function the `selectTarget`
//     mutation calls per target (`applyOneTargetSelection`, `convex/game.ts`).
//
// Neither side's `kind` default is written in this file. That matters: the
// first version of this block passed an explicit `"cast"` literal, a shape
// production NEVER produces (`announceCast` omits `kind` entirely), and the
// client read the absent kind as "not a spell" while the server read it as
// "cast" — so an ordinary Lightning Bolt was OFFERED against a creature with
// protection from coloured spells and rejected on click. Proof-of-failure
// test-shape 3: the assertion never reached the real input.

describe("CR 702.16a — client parity for protection from coloured spells (#2296)", () => {
    const LIGHTNING_BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // red Instant
    const ORNITHOPTER_ID = "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0"; // colourless
    const PRODIGAL_SORCERER_ID = "e4dc1103-7bf1-47f6-9006-d3ed9ccd7a6a"; // blue

    /** The `PendingTarget` an ordinary CAST produces. `kind` is deliberately
     *  ABSENT: `announceCast`'s builder (`convex/game.ts`) never writes the
     *  field, so `undefined` is what every real cast puts on the wire. Spelling
     *  `kind: "cast"` here would test a shape production has no way to make.
     *
     *  `max` is open-ended so a legal pick does NOT auto-finalize into the
     *  cast-commit path (mana payment this fixture doesn't seed) — the
     *  `protectionQualityTargeting.test.ts` convention. The CR 702.16 gate
     *  under test runs before finalization either way. */
    function castPendingTarget(sourceId: string): PendingTarget {
        return {
            playerId: "p2",
            cardInstanceId: sourceId,
            targetType: "Creature",
            count: { min: 1, max: 3 },
            selected: [],
        };
    }

    /** The same selection announced from an ACTIVATED ability instead (CR
     *  602.2b) — the one production shape that DOES set `kind`. */
    function abilityPendingTarget(sourceId: string): PendingTarget {
        return { ...castPendingTarget(sourceId), kind: "ability" };
    }

    /** p1's warded creature + a plain bystander; p2 (the chooser) holds a red
     *  Instant and a colourless artifact creature and controls a blue Prodigal
     *  Sorcerer. Returns the FAT engine state (what the server validates) and
     *  its WIRE projection (what the client's hooks read) — the pair is the
     *  point: a hand-built `Player[]` would mask a field the projection drops. */
    function board(pendingTarget: PendingTarget) {
        const wardedCard = makeInstance(GRIZZLY_BEARS_ID, {
            id: "warded",
            controllerId: "p1",
            ownerId: "p1",
        });
        wardedCard.staticAbilities = [
            ...wardedCard.staticAbilities,
            PROTECTION_FROM_COLORED_SPELLS,
        ];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        wardedCard,
                        makeInstance(GRIZZLY_BEARS_ID, {
                            id: "bystander",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    hand: [
                        makeInstance(LIGHTNING_BOLT_ID, {
                            id: "bolt",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                        makeInstance(ORNITHOPTER_ID, {
                            id: "orni",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        makeInstance(PRODIGAL_SORCERER_ID, {
                            id: "tim",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
            pendingTarget,
        });
        // Viewer = p2 (the chooser), so their own hand is visible on the wire
        // — the zone a cast source is located in.
        const projected = projectPublicState(state, 1, "p2");
        return { state, projected };
    }

    /** Runs BOTH gates over one board and reports whether each BARS the pick.
     *  The client call mirrors `useBattlefieldVisualState` field for field; the
     *  server call is the exact function `selectTarget` runs per target. */
    function verdicts(pendingTarget: PendingTarget, targetId: string) {
        const { state, projected } = board(pendingTarget);
        const pt = projected.pendingTarget!;
        const players = projected.players as unknown as Player[];
        const candidate = players[0].battlefield.find(
            (c) => c.id === targetId
        )!;
        const clientBars = isUntargetableByPending(
            players,
            candidate,
            pt.cardInstanceId,
            // NOT a literal — the kind as it survives the wire. For a cast this
            // is `undefined`, which is the whole point of this block.
            pt.kind,
            (projected.stack ?? []) as unknown as StackItem[],
            pt.playerId
        );
        let serverBars = false;
        try {
            applyOneTargetSelection(state, "p2", {
                targetType: "permanent",
                targetId,
            });
        } catch (e) {
            serverBars = /protection/i.test((e as Error).message);
        }
        return { clientBars, serverBars, kind: pt.kind };
    }

    it("MUST — bars a red Instant being CAST, on both sides, with kind ABSENT on the wire", () => {
        const v = verdicts(castPendingTarget("bolt"), "warded");
        // The production shape this whole finding was about.
        expect(v.kind).toBeUndefined();
        expect(v.serverBars).toBe(true);
        expect(v.clientBars).toBe(v.serverBars);
    });

    it("must-NOT — leaves it clickable for a COLOURLESS spell (CR 105.2)", () => {
        const v = verdicts(castPendingTarget("orni"), "warded");
        expect(v.kind).toBeUndefined();
        expect(v.serverBars).toBe(false);
        expect(v.clientBars).toBe(v.serverBars);
    });

    it("must-NOT — leaves it clickable for a COLOURED permanent's ability (CR 113.3)", () => {
        // The client sees Prodigal Sorcerer's colours perfectly well; only the
        // `kind` distinguishes this from the barred cast above. A client that
        // derived the quality from colours alone would grey this out and the
        // player could never use Tim on the creature.
        const v = verdicts(abilityPendingTarget("tim"), "warded");
        expect(v.kind).toBe("ability");
        expect(v.serverBars).toBe(false);
        expect(v.clientBars).toBe(v.serverBars);
    });

    it("must-NOT — leaves an unprotected bystander clickable for the red Instant", () => {
        const v = verdicts(castPendingTarget("bolt"), "bystander");
        expect(v.serverBars).toBe(false);
        expect(v.clientBars).toBe(v.serverBars);
    });
});
