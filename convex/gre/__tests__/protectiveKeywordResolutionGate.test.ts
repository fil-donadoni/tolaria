// CR 608.2b — a protective keyword GAINED in response counters the spell or
// ability that is already targeting the permanent (issue #2942).
//
// Until this landed the whole protective family was ANNOUNCEMENT-ONLY:
// `getLegalTargets` (offered set) and `selectTarget` (accepted set) consulted
// protection / shroud / hexproof / `permanent-guard`, and nothing downstream
// did. A Sylvan Safekeeper sacrifice in response to Terror left the creature
// dead.
//
// The one cell that LOOKED right was protection vs. burn, and it was right for
// the wrong reason: CR 702.16e prevents the DAMAGE at application, so the
// spell still resolved. Every assertion below that involves a damage spell
// therefore names something OTHER than the damage — a rider, a second target,
// a life total — because "the creature lived" cannot tell the two apart.
//
// Every check reads the SAME authorities the announcement path reads
// (`isProtectedFromSource`, `isGuardedAgainst`, `playerHasShroud`), never a
// second copy: the tests below drive real cards through the real
// `resolveTopOfStack`.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { getPlayer, resolveTopOfStack, type GameState } from "../state";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { royalAssassin, terror } from "../../cards/sets/lea/black";
import { lightningBolt } from "../../cards/sets/lea/red";
import { unsummon } from "../../cards/sets/lea/blue";
import { swordsToPlowshares } from "../../cards/sets/lea/white";
import { ashesToAshes } from "../../cards/sets/drk/black";
import { antiMagicAura } from "../../cards/sets/leg/blue";
import { solitaryConfinement } from "../../cards/sets/jud/white";

/** p2 controls one Grizzly Bears (`bear`); p1 controls nothing. */
function boardWithBear(
    extra: Partial<Parameters<typeof makeInstance>[1]> = {}
): GameState {
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear",
        controllerId: "p2",
        ownerId: "p2",
        ...extra,
    });
    return makeState({
        players: [makePlayer("p1"), makePlayer("p2", { battlefield: [bear] })],
    });
}

function bearOf(state: GameState, playerIndex = 1) {
    return state.players[playerIndex].battlefield.find((c) => c.id === "bear");
}

/** Grants a keyword to a permanent already on the battlefield, the way a
 *  `grantStaticAbility` effect does — the "in response" half of every scenario
 *  below (the spell is already on the stack when this runs). */
function grantKeyword(state: GameState, instanceId: string, keyword: string) {
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.id !== instanceId) continue;
            card.staticAbilities = [...(card.staticAbilities ?? []), keyword];
            return;
        }
    }
    throw new Error(`no permanent ${instanceId}`);
}

describe("CR 608.2b — shroud gained in response (CR 702.18a)", () => {
    it("counters a targeted DESTROY spell; the creature survives", () => {
        const state = boardWithBear();
        const spell = pushSpell(state, terror.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        grantKeyword(state, "bear", "shroud");
        resolveTopOfStack(state);

        expect(bearOf(state)).toBeDefined();
        expect(state.stack).toHaveLength(0);
        // CR 608.2b — a countered spell goes to its owner's graveyard.
        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toContain(
            spell.id
        );
    });

    it("counters a targeted DAMAGE spell; nothing is marked (CR 702.18a has no damage leg)", () => {
        const state = boardWithBear();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        grantKeyword(state, "bear", "shroud");
        resolveTopOfStack(state);

        // Shroud, unlike protection, prevents NO damage (CR 702.18a is a
        // targeting restriction only) — so a live 2/2 after a Bolt can only
        // mean the Bolt never resolved.
        expect(bearOf(state)).toBeDefined();
        expect(bearOf(state)!.damageMarked).toBeUndefined();
        expect(state.stack).toHaveLength(0);
    });

    it("counters a BOUNCE spell (Unsummon) on the same path as destroy", () => {
        const state = boardWithBear();
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        grantKeyword(state, "bear", "shroud");
        resolveTopOfStack(state);

        expect(bearOf(state)).toBeDefined();
        expect(getPlayer(state, "p2").hand).toHaveLength(0);
    });

    it("counters an EXILE spell (Swords to Plowshares) on the same path as destroy", () => {
        const state = boardWithBear();
        pushSpell(state, swordsToPlowshares.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        grantKeyword(state, "bear", "shroud");
        resolveTopOfStack(state);

        expect(bearOf(state)).toBeDefined();
        expect(getPlayer(state, "p2").exile).toHaveLength(0);
        // Swords' rider (its controller gains life equal to its power) never
        // happened either — the whole spell was countered, not just its
        // exile clause.
        expect(getPlayer(state, "p2").life).toBe(20);
    });

    it("bars the permanent's OWN controller too (CR 702.18a is unfiltered)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        grantKeyword(state, "bear", "shroud");
        resolveTopOfStack(state);

        expect(state.players[0].battlefield.some((c) => c.id === "bear")).toBe(
            true
        );
    });
});

describe("CR 608.2b — hexproof gained in response (CR 702.11b)", () => {
    it("counters an OPPONENT-controlled targeted spell", () => {
        const state = boardWithBear();
        pushSpell(state, terror.id, "p1", [{ type: "permanent", id: "bear" }]);
        grantKeyword(state, "bear", "hexproof");
        resolveTopOfStack(state);

        expect(bearOf(state)).toBeDefined();
    });

    it("does NOT counter the permanent's own controller's spell (CR 702.11b)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        grantKeyword(state, "bear", "hexproof");
        resolveTopOfStack(state);

        // Hexproof bars only opponents' sources — p1's own Unsummon resolves.
        expect(state.players[0].battlefield.some((c) => c.id === "bear")).toBe(
            false
        );
        expect(state.players[0].hand.some((c) => c.id === "bear")).toBe(true);
    });
});

describe("CR 608.2b — protection gained in response (CR 702.16b)", () => {
    // The case with NO damage-prevention fallback: destruction is not in
    // protection's DEBT (CR 702.16b–e cover damage / enchant / block / target,
    // never destroy), so a surviving creature here can only mean the CR 608.2b
    // gate ran.
    it("counters a targeted DESTROY spell (Terror + protection from black)", () => {
        const state = boardWithBear();
        const spell = pushSpell(state, terror.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        grantKeyword(state, "bear", "protection from black");
        resolveTopOfStack(state);

        expect(bearOf(state)).toBeDefined();
        expect(getPlayer(state, "p2").graveyard).toHaveLength(0);
        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toContain(
            spell.id
        );
    });

    // CR 702.16e's damage leg would leave a live creature either way, so the
    // assertion is on the SPELL: Ashes to Ashes deals 5 damage to its own
    // controller on resolution. Both targets are protected from black, so the
    // spell is countered and the rider never happens — before the CR 608.2b
    // protective leg landed it resolved and p1 took 5.
    it("counters the SPELL, not merely its damage (Ashes to Ashes rider never happens)", () => {
        const first = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const second = makeInstance(grizzlyBears.id, {
            id: "bear2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [first, second] }),
            ],
        });
        pushSpell(state, ashesToAshes.id, "p1", [
            { type: "permanent", id: "bear" },
            { type: "permanent", id: "bear2" },
        ]);
        grantKeyword(state, "bear", "protection from black");
        grantKeyword(state, "bear2", "protection from black");
        resolveTopOfStack(state);

        expect(state.players[1].battlefield).toHaveLength(2);
        expect(getPlayer(state, "p1").life).toBe(20);
    });

    // CR 608.2c — several targets, only the now-illegal one is dropped and the
    // spell does as much as it can. The rider still happens, which is what
    // separates "pruned" from "countered".
    it("prunes only the illegal target and still does as much as possible (CR 608.2c)", () => {
        const first = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const second = makeInstance(grizzlyBears.id, {
            id: "bear2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [first, second] }),
            ],
        });
        pushSpell(state, ashesToAshes.id, "p1", [
            { type: "permanent", id: "bear" },
            { type: "permanent", id: "bear2" },
        ]);
        grantKeyword(state, "bear", "shroud");
        resolveTopOfStack(state);

        expect(state.players[1].battlefield.map((c) => c.id)).toEqual(["bear"]);
        expect(getPlayer(state, "p2").exile.map((c) => c.id)).toEqual([
            "bear2",
        ]);
        expect(getPlayer(state, "p1").life).toBe(15);
    });
});

describe("CR 608.2b — abilities are covered on the same terms as spells", () => {
    it("shroud counters an activated ability targeting the permanent", () => {
        const state = boardWithBear({ isTapped: true });
        const item = pushSpell(state, royalAssassin.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.abilityId = "royal-assassin-destroy";
        grantKeyword(state, "bear", "shroud");
        resolveTopOfStack(state);
        expect(bearOf(state)).toBeDefined();

        // Control: with no shroud the very same activation destroys it, so the
        // assertion above is about the keyword and not about the fixture.
        const control = boardWithBear({ isTapped: true });
        const controlItem = pushSpell(control, royalAssassin.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        controlItem.abilityId = "royal-assassin-destroy";
        resolveTopOfStack(control);
        expect(bearOf(control)).toBeUndefined();
    });

    it("protection from the ABILITY SOURCE's colour counters it (CR 109.5)", () => {
        const state = boardWithBear({ isTapped: true });
        pushSpell(state, royalAssassin.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        state.stack[0].abilityId = "royal-assassin-destroy";
        // Royal Assassin is black; CR 109.5 — the ability's source is the
        // permanent, so its characteristics are what protection keys on.
        grantKeyword(state, "bear", "protection from black");
        resolveTopOfStack(state);

        expect(bearOf(state)).toBeDefined();
    });

    // The discriminating pair for the CR 113.3 source narrowing: Anti-Magic
    // Aura's `permanent-guard` bars SPELLS only. Both halves read the same
    // `isGuardedAgainst` the announcement path calls, with the same
    // `isSpell` bit — an ability must still get through.
    describe("Anti-Magic Aura's spell-only guard (CR 113.3)", () => {
        function enchantedBoard(): GameState {
            const bear = makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p2",
                ownerId: "p2",
                isTapped: true,
            });
            const aura = makeInstance(antiMagicAura.id, {
                id: "aura",
                controllerId: "p2",
                ownerId: "p2",
                attachedTo: "bear",
            });
            return makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", { battlefield: [bear, aura] }),
                ],
            });
        }

        it("counters a targeted SPELL at resolution", () => {
            const state = enchantedBoard();
            pushSpell(state, terror.id, "p1", [
                { type: "permanent", id: "bear" },
            ]);
            resolveTopOfStack(state);
            expect(bearOf(state)).toBeDefined();
        });

        it("lets an ABILITY through", () => {
            const state = enchantedBoard();
            const item = pushSpell(state, royalAssassin.id, "p1", [
                { type: "permanent", id: "bear" },
            ]);
            item.abilityId = "royal-assassin-destroy";
            resolveTopOfStack(state);
            expect(bearOf(state)).toBeUndefined();
        });
    });
});

describe("CR 608.2b — a PLAYER who gained shroud (CR 702.18 via CR 115.4)", () => {
    it("counters a spell already targeting them", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        // Solitary Confinement's `player-guard` gives its controller shroud.
        state.players[1].battlefield.push(
            makeInstance(solitaryConfinement.id, {
                id: "confinement",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        resolveTopOfStack(state);

        expect(state.players[1].life).toBe(20);
        expect(state.stack).toHaveLength(0);
    });

    it("still resolves against a player with no guard (control)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);

        expect(state.players[1].life).toBe(17);
    });
});
