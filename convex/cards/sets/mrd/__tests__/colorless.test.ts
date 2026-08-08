// mrd (Mirrodin) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    talismanOfProgress,
    talismanOfDominance,
    chromeMox,
    lightningGreaves,
    frogmite,
} from "../colorless";
import { balduvianBears } from "../../ice/green";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { isGuardedAgainst } from "../../../../gre/permanentGuard";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
} from "../../../../gre/state";
import { getLegalActions } from "../../../../gre/rules";
import { solRing } from "../../lea";

// Talisman cycle (issue #675) — same painland shape as ICE's Adarkar Wastes
// cycle (`convex/cards/sets/ice/__tests__/colorless.test.ts`): one choice
// mana ability, index 0 is the painless {C}, indices 1-2 are the two
// colours carrying `dealsDamageToControllerOnColoredTap: 1` (CR 605.1a / 120).
describe.each([
    { def: talismanOfProgress, colors: ["W", "U"] as const },
    { def: talismanOfDominance, colors: ["U", "B"] as const },
])(
    "$def.name (Talisman painland cycle, CR 605.1a / 120)",
    ({ def, colors }) => {
        it("tapping for {C} (the painless choice) costs no life and adds {C}", () => {
            const rock = makeInstance(def.id, {
                id: "rock",
                controllerId: "p1",
                ownerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [rock] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            state.activePlayerId = "p1";
            tapSourceIntoPayment(state, player, rock, 0, []);
            expect(player.manaPool.C).toBe(1);
            expect(player.life).toBe(20);
        });

        it(`tapping for ${colors[1]} (a coloured choice) costs 1 life and adds {${colors[1]}}`, () => {
            const rock = makeInstance(def.id, {
                id: "rock",
                controllerId: "p1",
                ownerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [rock] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            state.activePlayerId = "p1";
            tapSourceIntoPayment(state, player, rock, 2, []);
            expect(player.manaPool[colors[1]]).toBe(1);
            expect(player.life).toBe(19);
        });

        it("the coloured-tap life loss survives the wire-format projection (PublicGameState)", () => {
            const rock = makeInstance(def.id, {
                id: "rock",
                controllerId: "p1",
                ownerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [rock] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            state.activePlayerId = "p1";
            tapSourceIntoPayment(state, player, rock, 1, []);
            const projected = projectPublicState(state, 1, "p1");
            expect(projected.players[0].life).toBe(19);
        });
    }
);

function etbEvent(instanceId: string): StackItem["triggerEvent"] {
    return {
        type: "PERMANENT_ENTERED",
        instanceId,
        controllerId: "p1",
        types: ["Artifact"],
    } as StackItem["triggerEvent"];
}

function pushEtbTrigger(
    state: GameState,
    mox: ReturnType<typeof makeInstance>
) {
    state.stack.push({
        ...mox,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "chrome-mox-imprint",
        triggerSourceId: mox.id,
        triggerEvent: etbEvent(mox.id),
        targets: [],
    });
    resolveTopOfStack(state);
}

function submitChoice(state: GameState, cardInstanceIds: string[]) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

describe("Chrome Mox ({0} Artifact — imprint exile + colour-gated mana, CR 603.6a / 605.1a)", () => {
    it("ETB exiles the chosen nonartifact, nonland hand card and stamps its colours as imprint counters", () => {
        const mox = makeInstance(chromeMox.id, {
            id: "mox",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenCard = makeInstance(balduvianBears.id, {
            id: "greenCard",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mox], hand: [greenCard] }),
                makePlayer("p2"),
            ],
        });
        pushEtbTrigger(state, mox);
        submitChoice(state, ["greenCard"]);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].exile.map((c) => c.id)).toContain("greenCard");
        const moxOnBattlefield = state.players[0].battlefield.find(
            (c) => c.id === "mox"
        )!;
        expect(moxOnBattlefield.counters?.["imprint-G"]).toBe(1);
        // CR 406.2 — the imprinted card is exiled FACE UP (Chrome Mox names no
        // face-down exile), so it carries no `knownTo` gate.
        const exiled = state.players[0].exile.find(
            (c) => c.id === "greenCard"
        )!;
        expect(exiled.knownTo ?? []).toEqual([]);
        // CR 111 (issue #791) — pinned to the Mox, so the board renders it
        // attached to the permanent instead of loose in the exile pile. The
        // wire projection is what the board actually reads, so assert there.
        expect(exiled.exiledBySourceId).toBe("mox");
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].exile.find(
            (c) => c.id === "greenCard"
        )!;
        expect(slim.exiledByPermanentId).toBe("mox");
    });

    it("declining the exile (or an all-land/artifact hand) leaves Chrome Mox with no mana ability available", () => {
        const mox = makeInstance(chromeMox.id, {
            id: "mox",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mox], hand: [] }),
                makePlayer("p2"),
            ],
        });
        pushEtbTrigger(state, mox);
        expect(state.pendingChoices ?? []).toEqual([]);
        const ability = chromeMox.activatedAbilities![0];
        expect(ability.canActivate!(mox, {} as never)).toBe(false);
    });

    it("taps for the exiled card's colour (CR 605.1a) once imprinted", () => {
        const mox = makeInstance(chromeMox.id, {
            id: "mox",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenCard = makeInstance(balduvianBears.id, {
            id: "greenCard",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            battlefield: [mox],
            hand: [greenCard],
        });
        const state = makeState({ players: [player, makePlayer("p2")] });
        state.activePlayerId = "p1";
        pushEtbTrigger(state, mox);
        submitChoice(state, ["greenCard"]);
        const moxOnBattlefield = player.battlefield.find(
            (c) => c.id === "mox"
        )!;
        const ability = chromeMox.activatedAbilities![0];
        expect(ability.canActivate!(moxOnBattlefield, {} as never)).toBe(true);
        expect(ability.getManaChoices!(moxOnBattlefield, "p1", [])).toEqual([
            { G: 1 },
        ]);
        tapSourceIntoPayment(state, player, moxOnBattlefield, 0, []);
        expect(player.manaPool.G).toBe(1);
    });

    it("wire format: the imprint counter is visible to both viewers", () => {
        const mox = makeInstance(chromeMox.id, {
            id: "mox",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenCard = makeInstance(balduvianBears.id, {
            id: "greenCard",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mox], hand: [greenCard] }),
                makePlayer("p2"),
            ],
        });
        pushEtbTrigger(state, mox);
        submitChoice(state, ["greenCard"]);
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "mox"
            )!;
            expect(slim.counters?.["imprint-G"]).toBe(1);
        }
    });
});

// Lightning Greaves (issue #1530, parent PRD #1525). "Equipped creature has
// haste and shroud. Equip {0}." The Equip spine (`attach` Op) is Skullclamp's
// (`dst/colorless.ts`); haste is the same `keyword-grant` combo Cori-Steel
// Cutter (`tdm/red.ts`) proves. Shroud's real enforcement is the
// `permanent-guard` staticEffect `isGuardedAgainst` reads LIVE off
// `attachedTo` (no materialization step needed, unlike `keyword-grant`) — the
// same shape Sterling Grove (`inv/multicolor.ts`) proves for a GRANTED (not
// self-printed) shroud.
function equipGreavesTo(
    state: GameState,
    greavesId: string,
    targetId: string
): void {
    const greaves = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === greavesId)!;
    state.stack.push({
        ...greaves,
        zone: "stack",
        castById: greaves.controllerId,
        abilityId: "lightning-greaves-equip",
        targets: [{ type: "permanent", id: targetId }],
    } as StackItem);
    resolveTopOfStack(state);
}

describe("Lightning Greaves (MRD #199, issue #1530)", () => {
    function setup(): {
        state: GameState;
        greaves: CardInstanceState;
        bear: CardInstanceState;
    } {
        const greaves = makeInstance(lightningGreaves.id, {
            id: "greaves1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [greaves, bear] }),
                makePlayer("p2"),
            ],
        });
        return {
            state,
            greaves: state.players[0].battlefield[0],
            bear: state.players[0].battlefield[1],
        };
    }

    it("grants haste to the equipped creature (staticAbilities materialized on attach)", () => {
        const { state } = setup();
        equipGreavesTo(state, "greaves1", "bear1");
        const bear = state.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(
            state.players[0].battlefield.find((c) => c.id === "greaves1")!
                .attachedTo
        ).toBe("bear1");
        expect(bear.staticAbilities).toContain("haste");
        expect(bear.staticAbilities).toContain("shroud");
    });

    it("shroud is REAL enforcement — the equipped creature can't be targeted (CR 702.18), even by its own controller", () => {
        const { state } = setup();
        equipGreavesTo(state, "greaves1", "bear1");
        const bear = state.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        const oppSrc = { isSpell: true, controllerId: "p2" } as const;
        const ownSrc = { isSpell: true, controllerId: "p1" } as const;
        expect(isGuardedAgainst(state, bear, "cantBeTargeted", oppSrc)).toBe(
            true
        );
        // CR 702.18 shroud is unfiltered — unlike hexproof it blocks the
        // permanent's OWN controller too.
        expect(isGuardedAgainst(state, bear, "cantBeTargeted", ownSrc)).toBe(
            true
        );
    });

    it("unattached creatures are NOT guarded (shroud is attach-scoped, AURA_AFFECTS_HOST)", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(bear.staticAbilities ?? []).not.toContain("shroud");
        const oppSrc = { isSpell: true, controllerId: "p2" } as const;
        expect(isGuardedAgainst(state, bear, "cantBeTargeted", oppSrc)).toBe(
            false
        );
    });

    it("the haste grant and shroud guard survive projection (wire format)", () => {
        const { state } = setup();
        equipGreavesTo(state, "greaves1", "bear1");
        const projected = projectPublicState(state, 1, "p2");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(slimBear.staticAbilities).toContain("haste");
        const oppSrc = { isSpell: true, controllerId: "p2" } as const;
        expect(
            isGuardedAgainst(projected, slimBear, "cantBeTargeted", oppSrc)
        ).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Frogmite — Affinity for artifacts (CR 702.41a, PRD #702 / ADR 0063). The
// keyword's shared behaviour is covered once in `mrd/__tests__/blue.test.ts`
// (Thoughtcast, the coloured witness). Frogmite is the witness for the two
// properties only a COLOURLESS ARTIFACT spell can prove: that a spell with
// affinity never counts ITSELF, and that the reduction can reach {0} because
// affinity declares no `minTotalMana` floor.
// ─────────────────────────────────────────────────────────────────────────────
describe("Frogmite — Affinity for artifacts (CR 702.41a)", () => {
    function costWith(
        battlefield: CardInstanceState[]
    ): Record<string, number> {
        const state = makeState({
            players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
        });
        const spellView = makeInstance(frogmite.id, {
            id: "frogmite-spell-view",
            controllerId: "p1",
            zone: "hand",
        });
        const cost = normalizeManaCost(frogmite.manaCost ?? {});
        applyCostModifiers(cost, getCostModifiers(state, spellView, "spell"));
        return cost;
    }

    const artifacts = (n: number) =>
        Array.from({ length: n }, (_, i) =>
            makeInstance(solRing.id, { id: `art-${i}`, controllerId: "p1" })
        );

    it("reduces to {0} at four artifacts — affinity has NO minTotalMana floor", () => {
        expect(costWith(artifacts(4))).toEqual({});
        expect(frogmite.selfCostReduction?.minTotalMana).toBeUndefined();
    });

    it("clamps at {0} rather than going negative (10 artifacts, only {4} to reduce)", () => {
        expect(costWith(artifacts(10))).toEqual({});
    });

    it("does NOT count itself: affinity functions on the STACK, the count reads the battlefield (CR 702.41a)", () => {
        // The Frogmite being cast is in hand/on the stack, never on the
        // battlefield, so it cannot discount itself: an empty board leaves the
        // full {4}.
        expect(costWith([])).toEqual({ X: 4 });
        // A DIFFERENT Frogmite already on the battlefield IS an artifact and
        // does count — proving the exclusion is positional (zone), not a
        // name/self special case.
        const otherFrogmite = makeInstance(frogmite.id, {
            id: "other-frogmite",
            controllerId: "p1",
        });
        expect(costWith([otherFrogmite])).toEqual({ X: 3 });
    });

    it("castability: the server offers 'cast' on an EMPTY mana pool once four artifacts zero the cost", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(frogmite.id, {
                            id: "frogmite-hand",
                            controllerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: artifacts(4),
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        expect(
            getLegalActions(state, state.players[0], state.players[0].hand[0])
        ).toContain("cast");
    });
});
