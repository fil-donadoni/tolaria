// MH1 (Modern Horizons) — blue behavior tests (ADR 0043 colour split).
//
// Echo of Eons is Timetwister (CR 103.4 — each player shuffles hand + graveyard
// into their library, then draws seven) with Flashback {2}{U} (CR 702.34). The
// whole-table reset uses composed SpellContext zone primitives (resolve()); the
// flashback exile itself is covered class-wide by convex/gre/__tests__/flashback.test.ts.
import { describe, it, expect } from "vitest";
import { echoOfEons, forceOfNegation, urzaLordHighArtificer } from "../blue";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    getPlayer,
    processPendingActionTriggers,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { grizzlyBears } from "../../lea";
import { lightningBolt } from "../../lea/red";
import { ornithopter } from "../../atq/colorless";
import { projectPublicState } from "../../../../gameProjections";
import { activateManaAbility } from "../../../../game";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "../../../../__tests__/gameMutationHarness";
import type { Id } from "../../../../_generated/dataModel";
import { FACE_DOWN_CARD_ID } from "../../../index";

function bears(owner: string, count: number, prefix: string, zone: string) {
    return Array.from({ length: count }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `${prefix}-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: zone as never,
        })
    );
}

describe("Echo of Eons (Timetwister with flashback, CR 103.4 / 702.34)", () => {
    it("each player shuffles hand + graveyard into their library, then draws seven", () => {
        const p1 = makePlayer("p1", {
            hand: bears("p1", 3, "p1-hand", "hand"),
            graveyard: bears("p1", 2, "p1-gy", "graveyard"),
            library: bears("p1", 10, "p1-lib", "library"),
        });
        const p2 = makePlayer("p2", {
            hand: bears("p2", 1, "p2-hand", "hand"),
            graveyard: bears("p2", 4, "p2-gy", "graveyard"),
            library: bears("p2", 10, "p2-lib", "library"),
        });
        const state = makeState({ players: [p1, p2] });

        // Echo of Eons resolving on the stack (cast from hand for this test);
        // it isn't in either graveyard, so the shuffle doesn't touch it.
        state.stack.push({
            ...makeInstance(echoOfEons.id, {
                id: "echo",
                zone: "stack",
                controllerId: "p1",
                ownerId: "p1",
            }),
            castById: "p1",
            targets: [],
        });
        resolveTopOfStack(state);

        // CR 103.4 — both players drew a fresh seven; the pre-existing hands
        // and graveyards were swept into the libraries first.
        expect(getPlayer(state, "p1").hand).toHaveLength(7);
        expect(getPlayer(state, "p2").hand).toHaveLength(7);
        // Echo of Eons was cast from hand here, so after resolving it goes to
        // p1's (previously-emptied) graveyard — the flashback exile path is
        // covered class-wide by flashback.test.ts.
        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toEqual([
            "echo",
        ]);
        expect(getPlayer(state, "p2").graveyard).toHaveLength(0);
        // p1 started with 3+2+10 = 15 cards (excl. Echo); 7 in hand → 8 in library.
        expect(getPlayer(state, "p1").library).toHaveLength(8);
        // p2 started with 1+4+10 = 15 cards; 7 in hand → 8 left in library.
        expect(getPlayer(state, "p2").library).toHaveLength(8);
    });
});

// Force of Negation — {1}{U}{U} Instant. "Counter target noncreature spell. If
// that spell is countered this way, exile it instead of putting it into its
// owner's graveyard." The `counter` Op with `destination: "exile"` isn't
// scenario-generatable (a spell-on-the-stack target), so the smoke sweep
// skips it — hand-write it here. The `spellExcludeTypeFilter` legality gate
// itself is already class-wide covered (Spell Pierce,
// convex/gre/__tests__/targeting.test.ts), so this focuses on the resolution
// outcome the sweep can't reach.
describe("Force of Negation (counter → exile instead of graveyard, CR 701.5a)", () => {
    it("countering a noncreature spell removes it from the stack and exiles it (not the graveyard)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, forceOfNegation.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toEqual([bolt.id]);
        // The bolt never resolved — no damage dealt.
        expect(state.players[0].life).toBe(20);
    });

    it("the exiled destination survives the wire-format projection (PublicGameState)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, forceOfNegation.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].exile.map((c) => c.id)).toEqual([bolt.id]);
        expect(
            projected.players[1].graveyard.find((c) => c.id === bolt.id)
        ).toBeUndefined();
    });
});

// Urza, Lord High Artificer (MH1 75, issue #2371) — see the card's own
// header comment (`../blue.ts`) for the three-clause seam breakdown.

/** Casts Urza from hand and resolves its ETB trigger — `pushSpell` (creature
 *  enters via `resolveTopOfStack`'s spell branch) then the standard
 *  ETB-trigger two-step (`processPendingActionTriggers` puts the queued
 *  trigger on the stack, a second `resolveTopOfStack` resolves it into the
 *  Construct — CR 603.6a/603.3), mirroring the codebase's own creature-ETB
 *  test convention (e.g. Portable Hole, `afr/__tests__/white.test.ts`). */
function castUrzaAndResolveEtb(state: GameState): CardInstanceState {
    pushSpell(state, urzaLordHighArtificer.id, "p1");
    resolveTopOfStack(state);
    processPendingActionTriggers(state);
    resolveTopOfStack(state);
    return state.players[0].battlefield.find((c) => c.id === "urza")!;
}

describe("Urza, Lord High Artificer — ETB Construct (CR 603.6a / 604.3 CDA)", () => {
    it("creates a 0/0 Construct that counts ITSELF — a lone Construct is 1/1 and never dies to CR 704.5f", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(urzaLordHighArtificer.id, {
                            id: "urza",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        castUrzaAndResolveEtb(state);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        expect(token).toBeDefined();
        expect(token.types).toEqual(["Artifact", "Creature"]);
        expect(token.subtypes).toContain("Construct");
        // Urza itself is a Creature, not an Artifact — it does NOT count
        // toward the CDA. The token counts only ITSELF: 1/1.
        expect(getEffectivePower(state, token)).toBe(1);
        expect(getEffectiveToughness(state, token)).toBe(1);
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).toContain(token);
    });

    it("scales with every OTHER artifact its controller controls, ignoring the opponent's", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(urzaLordHighArtificer.id, {
                            id: "urza",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        makeInstance(ornithopter.id, {
                            id: "mine",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(ornithopter.id, {
                            id: "theirs",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        castUrzaAndResolveEtb(state);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        // Ornithopter ("mine") + the token itself = 2. The opponent's is not
        // counted.
        expect(getEffectivePower(state, token)).toBe(2);
        expect(getEffectiveToughness(state, token)).toBe(2);
    });

    it("wire format — the Construct's CDA P/T survives projectPublicState", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(urzaLordHighArtificer.id, {
                            id: "urza",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        makeInstance(ornithopter.id, {
                            id: "mine",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        castUrzaAndResolveEtb(state);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === token.id
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

// Full-path integration coverage for clause 2, driven through the REAL
// registered `activateManaAbility` `_handler` (`gameMutationHarness.ts`) — the
// discipline the harness's own header demands and its sibling
// `convex/__tests__/tapUntapManaAbilityManaCost.test.ts` follows for the same
// free-ramp bug class. The round-1 version of this block called the exported
// helper directly and hand-mirrored the mutation's resolve step; deleting the
// mutation's entire `payTapOtherAbilityCost(...)` call — i.e. restoring the
// free-mana bug the change exists to prevent — left all of it green (PR #2419
// review, finding 3). Driving `_handler` is what makes "the artifact is tapped"
// and "an unpaid activation is refused" assertions about the deployed code.
describe("Urza, Lord High Artificer — tap-another-artifact mana ability (CR 605.1a / 602.1, issue #2371)", () => {
    const GAME_ID = "game-1" as Id<"games">;

    type ActivateManaArgs = {
        gameId: Id<"games">;
        playerId: string;
        cardInstanceId: string;
        abilityId: string;
        tapOtherIds?: string[];
    };

    function board(extra: CardInstanceState[] = []) {
        const urza = makeInstance(urzaLordHighArtificer.id, {
            id: "urza",
            controllerId: "p1",
            ownerId: "p1",
        });
        const artifact = makeInstance(ornithopter.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [urza, artifact, ...extra] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
    }

    function activate(state: GameState, tapOtherIds?: string[]) {
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        const run = runMutation<ActivateManaArgs, void>(
            activateManaAbility as unknown as Handler<ActivateManaArgs, void>,
            stub.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                cardInstanceId: "urza",
                abilityId: "urza-lha-mana",
                ...(tapOtherIds ? { tapOtherIds } : {}),
            }
        );
        return { stub, run };
    }

    const perm = (state: GameState, id: string) =>
        state.players[0].battlefield.find((c) => c.id === id)!;

    it("taps the chosen OTHER artifact and produces exactly {U}, never tapping Urza itself", async () => {
        const { stub, run } = activate(board(), ["art"]);
        await run;

        const after = stub.state();
        // The cost taps the OTHER permanent (CR 602.1 "another"); Urza declares
        // no `cost.tap` of its own, so it stays untapped and can still attack.
        expect(perm(after, "art").isTapped).toBe(true);
        expect(perm(after, "urza").isTapped).toBe(false);
        // Exactly one {U} — the ability declares BOTH `manaProduced` and an
        // `addMana` effect script, and only the script runs on this path.
        expect(after.players[0].manaPool.U).toBe(1);
    });

    it("REJECTS the activation when no tap-other pick is supplied — no free mana, board untouched", async () => {
        const { stub, run } = activate(board());
        await expect(run).rejects.toThrow(/Not enough untapped permanents/);

        // CR 601.2 — a rejected activation pays nothing and produces nothing.
        // This is the assertion that goes red when the mutation's
        // `payTapOtherAbilityCost` call is deleted: without it the ability is
        // free ramp, and this activation SUCCEEDS with {U} in the pool.
        const after = stub.state();
        expect(after.players[0].manaPool.U ?? 0).toBe(0);
        expect(perm(after, "art").isTapped).toBe(false);
        expect(perm(after, "urza").isTapped).toBe(false);
    });

    it("rejects tapping the ability's own source (Urza is not an 'other' permanent)", async () => {
        const { stub, run } = activate(board(), ["urza"]);
        await expect(run).rejects.toThrow(/own source/);
        expect(stub.state().players[0].manaPool.U ?? 0).toBe(0);
    });

    it("rejects paying with an already-tapped artifact", async () => {
        const state = board();
        perm(state, "art").isTapped = true;
        const { stub, run } = activate(state, ["art"]);
        await expect(run).rejects.toThrow(/already tapped/);
        expect(stub.state().players[0].manaPool.U ?? 0).toBe(0);
    });

    it("rejects naming the same artifact twice to cover a multi-pick cost", async () => {
        const { run } = activate(board(), ["art", "art"]);
        await expect(run).rejects.toThrow(/already selected/);
    });

    it("rejects a non-artifact permanent (the filter requires types: Artifact)", async () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const { stub, run } = activate(board([bear]), ["bear"]);
        await expect(run).rejects.toThrow(/does not match the tap cost filter/);
        // Validation runs over EVERY pick before tapping any of them, so a
        // rejected activation leaves the board exactly as it was.
        const after = stub.state();
        expect(perm(after, "bear").isTapped).toBe(false);
        expect(perm(after, "art").isTapped).toBe(false);
    });
});

describe("Urza, Lord High Artificer — {5} shuffle/exile/free-cast ability (CR 601.3e / 608.2g / 701.20)", () => {
    function resolveImpulse(state: GameState, urza: CardInstanceState): void {
        state.stack.push({
            ...urza,
            zone: "stack",
            castById: "p1",
            abilityId: "urza-lha-impulse",
        });
        resolveTopOfStack(state);
    }

    it("shuffles the library, exiles the new top card face down, and grants an until-end-of-turn free-cast permission", () => {
        const urza = makeInstance(urzaLordHighArtificer.id, {
            id: "urza",
            controllerId: "p1",
            ownerId: "p1",
        });
        const top = makeInstance(grizzlyBears.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const rest = Array.from({ length: 4 }, (_, i) =>
            makeInstance(lightningBolt.id, {
                id: `rest-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [urza],
                    library: [top, ...rest],
                }),
                makePlayer("p2"),
            ],
        });
        resolveImpulse(state, state.players[0].battlefield[0]);
        const p1 = state.players[0];
        // One card left the library for exile; the library holds the SAME
        // remaining set (shuffled, not lost).
        expect(p1.library).toHaveLength(4);
        expect(p1.exile).toHaveLength(1);
        const exiled = p1.exile[0];
        // CR 601.3e — cast permission, without paying the mana cost, until
        // end of turn.
        expect(exiled.castableFromExileBy).toBe("p1");
        expect(exiled.castFromExileWithoutPayingManaCost).toBe(true);
        expect(exiled.castableFromExileIncludesLand).toBe(true);
        // CR 406.3 — face down: hidden to the opponent, known to the
        // controller.
        expect(exiled.knownTo).toEqual(["p1"]);
    });

    it("wire format — the exile permission survives projectPublicState for the controller, stays hidden to the opponent", () => {
        const urza = makeInstance(urzaLordHighArtificer.id, {
            id: "urza",
            controllerId: "p1",
            ownerId: "p1",
        });
        const top = makeInstance(grizzlyBears.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [urza], library: [top] }),
                makePlayer("p2"),
            ],
        });
        resolveImpulse(state, state.players[0].battlefield[0]);
        const exiledId = state.players[0].exile[0].id;

        const controllerView = projectPublicState(state, 1, "p1");
        const ownExile = controllerView.players[0].exile.find(
            (c) => c.id === exiledId
        )!;
        // The controller sees the real card identity.
        expect(ownExile.card.id).toBe(grizzlyBears.id);

        const opponentView = projectPublicState(state, 1, "p2");
        const opponentExile = opponentView.players[0].exile.find(
            (c) => c.id === exiledId
        )!;
        // Face down to the opponent (CR 406.3) — identity hidden, presence
        // still visible.
        expect(opponentExile.card.id).toBe(FACE_DOWN_CARD_ID);
    });

    it("no-ops cleanly on an empty library (CR 608.2b)", () => {
        const urza = makeInstance(urzaLordHighArtificer.id, {
            id: "urza",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [urza], library: [] }),
                makePlayer("p2"),
            ],
        });
        expect(() =>
            resolveImpulse(state, state.players[0].battlefield[0])
        ).not.toThrow();
        expect(state.players[0].exile).toHaveLength(0);
    });
});
