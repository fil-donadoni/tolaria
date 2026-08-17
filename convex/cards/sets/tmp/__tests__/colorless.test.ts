// TMP (Tempest) — colorless card behavior tests (ADR 0043 colour split).
// Each card's describe block cites the CR section it exercises.

import { describe, it, expect } from "vitest";
import { ancientTomb, cursedScroll, lotusPetal, wasteland } from "../colorless";
import { plains, badlands, grizzlyBears } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    applyUnconditionalTapSelfDamage,
    tapSourceIntoPayment,
} from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyNameCardSubmit } from "../../../../gre/pendingChoiceSubmit";

/** Push an activated ability onto the stack with its cost assumed already
 *  paid, then resolve it (mirrors the per-set `resolveActivated` shim). */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

// Ancient Tomb — "{T}: Add {C}{C}. This land deals 2 damage to you." The
// self-damage rides the NEW `dealsDamageToControllerOnTap` rider (issue
// #675) — the unconditional sibling of the painland
// `dealsDamageToControllerOnColoredTap` rider, firing on EVERY tap
// regardless of the (here, always colorless) mana produced.
describe("Ancient Tomb ({T}: Add {C}{C}, self-damage, CR 605.1a / 120)", () => {
    it("tapping for mana deals 2 damage to the controller", () => {
        const tomb = makeInstance(ancientTomb.id, {
            id: "tomb",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tomb], life: 20 }),
                makePlayer("p2"),
            ],
        });
        const ability = ancientTomb.activatedAbilities![0];
        applyUnconditionalTapSelfDamage(state, ability, tomb, "p1");
        expect(state.players[0].life).toBe(18);
    });

    it("does not fire when the ability lacks the rider", () => {
        const tomb = makeInstance(ancientTomb.id, {
            id: "tomb",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tomb], life: 20 }),
                makePlayer("p2"),
            ],
        });
        applyUnconditionalTapSelfDamage(
            state,
            {
                ...ancientTomb.activatedAbilities![0],
                dealsDamageToControllerOnTap: undefined,
            },
            tomb,
            "p1"
        );
        expect(state.players[0].life).toBe(20);
    });

    // Full path through the real tap-for-mana entry point (mirrors the ICE
    // painland harness, `tapSourceIntoPayment` — the same exported game.ts
    // function the painland cycle uses directly in unit tests). This is the
    // FIRST card exercising `dealsDamageToControllerOnTap`: verifies the mana
    // and the damage land TOGETHER from one activation, not the rider in
    // isolation.
    it("activating the mana ability adds {C}{C} to the pool AND deals 2 damage to the controller (CR 605.1a / 120)", () => {
        const tomb = makeInstance(ancientTomb.id, {
            id: "tomb",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [tomb], life: 20 });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, tomb, undefined, []);
        expect(player.manaPool.C).toBe(2);
        expect(player.life).toBe(18);
        expect(tomb.isTapped).toBe(true);
    });

    it("the self-damage fires exactly once per tap (not doubled, not on untap)", () => {
        const tomb = makeInstance(ancientTomb.id, {
            id: "tomb",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [tomb], life: 20 });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, tomb, undefined, []);
        // One tap → exactly one 2-damage ping, never a double-fire from both
        // the choice and fixed branches (Ancient Tomb has no manaChoices, so
        // only the fixed branch of tapSourceIntoPayment runs).
        expect(player.life).toBe(18);
        expect(player.manaPool.C).toBe(2);
    });

    it("the mana and the life loss both survive the wire-format projection (PublicGameState)", () => {
        const tomb = makeInstance(ancientTomb.id, {
            id: "tomb",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [tomb], life: 20 });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, tomb, undefined, []);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(18);
        expect(projected.players[0].manaPool.C).toBe(2);
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "tomb"
        )!;
        expect(slim.isTapped).toBe(true);
    });
});

// Lotus Petal — "{T}, Sacrifice this artifact: Add one mana of any color."
describe("Lotus Petal ({T}, Sacrifice: any color, CR 605.1a / 701.21)", () => {
    it("activating for {U} (index 1) sacrifices the petal and adds {U} (CR 701.21)", () => {
        const petal = makeInstance(lotusPetal.id, {
            id: "petal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [petal] });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, petal, 1, []);
        expect(player.manaPool.U).toBe(1);
        // Sacrifice cost: moved off the battlefield into the graveyard, not
        // left tapped.
        expect(
            player.battlefield.find((c) => c.id === "petal")
        ).toBeUndefined();
        expect(player.graveyard.find((c) => c.id === "petal")).toBeDefined();
    });
});

describe("Wasteland (CR 701.26a tap for a 605.1a mana ability / CR 701.8 destroy nonbasic land)", () => {
    it("{T}: Add {C} (CR 106.1)", () => {
        const w = makeInstance(wasteland.id, {
            id: "w",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [w] })],
        });
        const manaAbility = wasteland.activatedAbilities!.find(
            (a) => a.id === "wasteland-mana"
        )!;
        manaAbility.effect!({
            addMana: (amount) => {
                for (const [color, count] of Object.entries(amount)) {
                    if (color === "X" || typeof count !== "number") continue;
                    state.players[0].manaPool[color] =
                        (state.players[0].manaPool[color] ?? 0) + count;
                }
            },
        });
        expect(state.players[0].manaPool.C).toBe(1);
    });

    it("getLegalTargets excludes a basic land and includes a nonbasic land (CR 205.4a)", () => {
        const basic = makeInstance(plains.id, {
            id: "basic",
            controllerId: "p1",
            ownerId: "p1",
        });
        const nonbasic = makeInstance(badlands.id, {
            id: "nonbasic",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [basic] }),
                makePlayer("p2", { battlefield: [nonbasic] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            {
                type: "Land",
                count: 1,
                excludeSupertypes: "Basic",
            },
            NO_TARGETING_SOURCE
        );
        const legalIds = legal.map((t) => ("id" in t ? t.id : undefined));
        expect(legalIds).toContain("nonbasic");
        expect(legalIds).not.toContain("basic");
    });

    it("destroy ability destroys a targeted nonbasic land (CR 701.8)", () => {
        const w = makeInstance(wasteland.id, {
            id: "w",
            controllerId: "p1",
            ownerId: "p1",
        });
        const nonbasic = makeInstance(badlands.id, {
            id: "nonbasic",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [w] }),
                makePlayer("p2", { battlefield: [nonbasic] }),
            ],
        });
        state.stack.push({
            ...makeInstance(wasteland.id, {
                id: "w-ability",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            abilityId: "wasteland-destroy",
            targets: [{ type: "permanent", id: "nonbasic" }],
        });
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "nonbasic")
        ).toBe(false);
    });

    it("wire: the destroyed nonbasic land is gone from both viewers' projected battlefield", () => {
        // Target legality (excludeSupertypes) is computed server-side only —
        // getLegalTargets always runs against the fat GameState, never a
        // projected client view (the frontend has no local re-derivation to
        // test, confirmed: no src/ file references excludeSupertypes /
        // supertypeFilter). The wire-relevant fact is the OUTCOME: the
        // destroyed land disappears from the projected board for both seats.
        const w = makeInstance(wasteland.id, {
            id: "w",
            controllerId: "p1",
            ownerId: "p1",
        });
        const nonbasic = makeInstance(badlands.id, {
            id: "nonbasic",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [w] }),
                makePlayer("p2", { battlefield: [nonbasic] }),
            ],
        });
        state.stack.push({
            ...makeInstance(wasteland.id, {
                id: "w-ability",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            abilityId: "wasteland-destroy",
            targets: [{ type: "permanent", id: "nonbasic" }],
        });
        resolveTopOfStack(state);
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            expect(
                projected.players[1].battlefield.some(
                    (c) => c.id === "nonbasic"
                )
            ).toBe(false);
        }
    });
});

// Cursed Scroll — "{3}, {T}: Choose a card name, then reveal a card at random
// from your hand. If that card has the chosen name, this artifact deals 2
// damage to any target." Protocol resolve() card (name-a-card + random reveal +
// runtime name compare). The seeded PRNG (rngSeed 0) makes the "random" pick
// deterministic in tests: with counter starting at 0, the first randomInt(n)
// draw resolves to index 0, so ordering the hand controls which card is
// revealed. CR 201.3 (name), CR 701.20a (random reveal), CR 119 (damage).
describe("Cursed Scroll ({3},{T}: name + random reveal → 2 damage, CR 201.3 / 701.20a / 119)", () => {
    // p1 controls a Cursed Scroll; the given cards start in p1's hand (order
    // matters — index 0 is the deterministically-revealed card at rngSeed 0).
    function setup(hand: CardInstanceState[]) {
        const scroll = makeInstance(cursedScroll.id, {
            id: "scroll",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scroll], hand }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        return { state, scroll };
    }

    function handCard(def: { id: string }, instId: string): CardInstanceState {
        return makeInstance(def.id, {
            id: instId,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
    }

    it("one-card hand: the reveal is forced, so naming that card deals 2 (guaranteed)", () => {
        const { state, scroll } = setup([handCard(grizzlyBears, "bears")]);
        resolveActivated(state, scroll, "cursed-scroll-ping", [
            { type: "player", id: "p2" },
        ]);
        // Suspended on the name-card choice for the controller.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("name-card");
        expect(head.playerId).toBe("p1");
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "Grizzly Bears",
        });
        // CR 119 — the revealed card matched → 2 damage to p2.
        expect(state.players[1].life).toBe(18);
        // The revealed card is only shown, not moved out of hand.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["bears"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("multi-card hand, revealed card MATCHES the named card → deals 2", () => {
        // rngSeed 0 → first draw picks index 0 (the Bears).
        const { state, scroll } = setup([
            handCard(grizzlyBears, "bears"),
            handCard(plains, "plains"),
        ]);
        resolveActivated(state, scroll, "cursed-scroll-ping", [
            { type: "player", id: "p2" },
        ]);
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "Grizzly Bears",
        });
        expect(state.players[1].life).toBe(18);
    });

    it("multi-card hand, revealed card does NOT match → no damage", () => {
        // Index 0 is Plains; naming Grizzly Bears misses the random reveal.
        const { state, scroll } = setup([
            handCard(plains, "plains"),
            handCard(grizzlyBears, "bears"),
        ]);
        resolveActivated(state, scroll, "cursed-scroll-ping", [
            { type: "player", id: "p2" },
        ]);
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "Grizzly Bears",
        });
        // CR 608.2b — the conditional failed, so no damage is dealt.
        expect(state.players[1].life).toBe(20);
    });

    it("empty hand: nothing is revealed, so no damage (CR 608.2b)", () => {
        const { state, scroll } = setup([]);
        resolveActivated(state, scroll, "cursed-scroll-ping", [
            { type: "player", id: "p2" },
        ]);
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "Grizzly Bears",
        });
        expect(state.players[1].life).toBe(20);
    });

    it("can deal its 2 damage to a creature (any target)", () => {
        const bearsOnField = makeInstance(grizzlyBears.id, {
            id: "target-bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        const scroll = makeInstance(cursedScroll.id, {
            id: "scroll",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [scroll],
                    hand: [handCard(grizzlyBears, "bears")],
                }),
                makePlayer("p2", { battlefield: [bearsOnField] }),
            ],
        });
        resolveActivated(state, scroll, "cursed-scroll-ping", [
            { type: "permanent", id: "target-bears" },
        ]);
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "Grizzly Bears",
        });
        // 2/2 Bears took 2 marked damage → destroyed by SBA (CR 704.5g).
        expect(
            state.players[1].battlefield.some((c) => c.id === "target-bears")
        ).toBe(false);
    });

    it("wire format: the 2 damage AND the revealed card survive projectPublicState", () => {
        const { state, scroll } = setup([handCard(grizzlyBears, "bears")]);
        resolveActivated(state, scroll, "cursed-scroll-ping", [
            { type: "player", id: "p2" },
        ]);
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "Grizzly Bears",
        });
        // The damage (life loss) is visible to both seats.
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            expect(projected.players[1].life).toBe(18);
        }
        // The revealed card is known-to-all, so the opponent (p2) sees the real
        // card in p1's hand instead of a nulled slot (CR 701.20a reveal).
        const p2View = projectPublicState(state, 1, "p2");
        const p1HandSlot = p2View.players[0].hand[0];
        expect(p1HandSlot?.card?.id).toBe(grizzlyBears.id);
    });
});
