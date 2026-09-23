// Recipient-keyed damage shields (issue #3810) — the two shapes that bind the
// RECIPIENT of damage rather than its source.
//
//   - CR 615.1a, `preventDamage` mode "all-to-matching": prevent all damage
//     that would be dealt this turn to every object a filter matches, from any
//     source (Divine Light). The mirror of "all-from-matching", and the only
//     recipient-keyed shield that binds no id — which is what lets it cover a
//     creature that comes under the shielded player's control LATER in the
//     turn (CR 615.6).
//   - CR 614.9, the `redirectDamage` Op: the next N damage that would be dealt
//     to one chosen recipient is dealt to another instead (Captain's
//     Maneuver). A REDIRECTION, not a prevention — so `unredirectable` stops
//     it and `unpreventable` does not — and a POINTS budget, not a charge
//     count, so an event bigger than what is left SPLITS.
//
// Every assertion that claims a client-visible result traverses
// `projectPublicState`, and the serialization rows go through the real
// `compactState` / `expandState` pair.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { crawWurm } from "../../cards/sets/lea/green";
import { lightningBolt } from "../../cards/sets/lea/red";
import { divineLight } from "../../cards/sets/apc/white";
import { captainsManeuver } from "../../cards/sets/apc/multicolor";
import { lashknifeBarrier } from "../../cards/sets/pls/white";
import { projectPublicState } from "../../gameProjections";
import {
    dealDamageFromPermanentToPlayer,
    resolveFight,
    resolveTopOfStack,
    type GameState,
} from "../state";
import { applyAllCombatDamage, finalizeCleanup } from "../phases";
import { compactState, expandState } from "../serialize";

/** p1 holds `mine`, p2 holds `theirs`; both are 6/4 Craw Wurms so a lethal
 *  scan never fires mid-test and the marked damage stays readable. */
function twoBoards(): GameState {
    const mine = makeInstance(crawWurm.id, {
        id: "mine",
        controllerId: "p1",
        ownerId: "p1",
    });
    const theirs = makeInstance(crawWurm.id, {
        id: "theirs",
        controllerId: "p2",
        ownerId: "p2",
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [mine] }),
            makePlayer("p2", { battlefield: [theirs] }),
        ],
    });
}

const permanentOf = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);

/** Casts Lightning Bolt from `caster` at `target` and resolves it. */
function castBolt(
    state: GameState,
    caster: string,
    target: { type: "permanent" | "player"; id: string }
): void {
    pushSpell(state, lightningBolt.id, caster, [target]);
    resolveTopOfStack(state);
}

/** Resolves Divine Light for `caster` (CR 615.1a). */
function castDivineLight(state: GameState, caster: string): void {
    pushSpell(state, divineLight.id, caster, []);
    resolveTopOfStack(state);
}

/** Resolves Captain's Maneuver for `caster` with budget `x`, shielding `from`
 *  and pointing the redirect at `to` (CR 614.9). */
function castManeuver(
    state: GameState,
    caster: string,
    x: number,
    from: { type: "permanent" | "player"; id: string },
    to: { type: "permanent" | "player"; id: string }
): void {
    const item = pushSpell(state, captainsManeuver.id, caster, [from, to]);
    item.chosenX = x;
    resolveTopOfStack(state);
}

// ---------------------------------------------------------------------------
// CR 615.1a — the recipient-scoped prevention shield
// ---------------------------------------------------------------------------

describe("CR 615.1a — prevent all damage dealt to creatures a player controls", () => {
    it("prevents spell damage dealt to a creature the shielded player controls", () => {
        const state = twoBoards();
        castDivineLight(state, "p1");
        castBolt(state, "p2", { type: "permanent", id: "mine" });
        expect(permanentOf(state, "mine")?.damageMarked).toBeUndefined();
    });

    it("leaves the shielded player themself unprotected — a player has no card type", () => {
        const state = twoBoards();
        castDivineLight(state, "p1");
        castBolt(state, "p2", { type: "player", id: "p1" });
        expect(state.players[0].life).toBe(17);
    });

    it("does not shield the OPPONENT's creatures", () => {
        const state = twoBoards();
        castDivineLight(state, "p1");
        castBolt(state, "p1", { type: "permanent", id: "theirs" });
        expect(permanentOf(state, "theirs")?.damageMarked).toBe(3);
    });

    it("CR 615.6 — covers a creature that comes under that player's control AFTER the shield resolved", () => {
        const state = twoBoards();
        castDivineLight(state, "p1");
        // The opponent's Wurm changes controller mid-turn (CR 613 layer 2 is
        // not what this reads — the shield reads the live `controllerId`).
        permanentOf(state, "theirs")!.controllerId = "p1";
        castBolt(state, "p2", { type: "permanent", id: "theirs" });
        expect(permanentOf(state, "theirs")?.damageMarked).toBeUndefined();
    });

    it("stops covering a creature that LEAVES that player's control", () => {
        const state = twoBoards();
        castDivineLight(state, "p1");
        permanentOf(state, "mine")!.controllerId = "p2";
        castBolt(state, "p2", { type: "permanent", id: "mine" });
        expect(permanentOf(state, "mine")?.damageMarked).toBe(3);
    });

    it("prevents COMBAT damage too — the shield is source-agnostic (CR 615.1a)", () => {
        const state = twoBoards();
        castDivineLight(state, "p2");
        state.combat = {
            attackerIds: ["mine"],
            confirmed: true,
            blockersConfirmed: true,
            blockerAssignments: { theirs: ["mine"] },
            blockedAttackerIds: ["mine"],
        };
        applyAllCombatDamage(state, { mine: { theirs: 6 } });
        // Craw Wurm is 6/4, so an unshielded blocker would take lethal and be
        // gone. Surviving undamaged is the whole assertion.
        expect(permanentOf(state, "theirs")?.damageMarked).toBeUndefined();
        expect(permanentOf(state, "theirs")).toBeDefined();
    });

    it("prevents damage from a PERMANENT source too (the fight sink)", () => {
        const state = twoBoards();
        castDivineLight(state, "p1");
        resolveFight(state, "mine", "theirs");
        // Craw Wurm is 6/4 both ways: unshielded, BOTH die. p1's shield keeps
        // its own Wurm undamaged and alive while the opponent's still dies.
        expect(permanentOf(state, "mine")?.damageMarked).toBeUndefined();
        expect(permanentOf(state, "mine")).toBeDefined();
        expect(permanentOf(state, "theirs")).toBeUndefined();
    });

    it("CR 109.4 — a controller-only shield covers that player's PERMANENTS and never the player", () => {
        const state = twoBoards();
        // Hand-built rather than cast: no printed card asks for a shield with
        // no `cardType` arm, and this is exactly the shape the next one would
        // reach for ("prevent all damage that would be dealt to you"). Only
        // objects on the stack or the battlefield have a controller, so the
        // arm must fail CLOSED on a player — otherwise "creatures you control"
        // would start shielding its controller's face the day the arm is used
        // on its own.
        state.recipientPreventionShields = [{ match: { controllerId: "p2" } }];
        castBolt(state, "p1", { type: "player", id: "p2" });
        expect(state.players[1].life).toBe(17);
        // The same shield DOES cover that player's permanents.
        castBolt(state, "p1", { type: "permanent", id: "theirs" });
        expect(permanentOf(state, "theirs")?.damageMarked).toBeUndefined();
    });

    it("CR 514.2 — the shield expires at CLEANUP", () => {
        const state = twoBoards();
        castDivineLight(state, "p1");
        expect(state.recipientPreventionShields).toHaveLength(1);
        // The global-flag clear is gated on the CLEANUP step itself (CR 514.2).
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(state.recipientPreventionShields).toBeUndefined();
    });

    it("wire format — the active shield survives `projectPublicState`", () => {
        const state = twoBoards();
        castDivineLight(state, "p1");
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.recipientPreventionShields).toEqual([
            { match: { controllerId: "p1", cardType: "Creature" } },
        ]);
    });

    it("serialization — the shield survives a compact/expand round trip", () => {
        const state = twoBoards();
        castDivineLight(state, "p1");
        const restored = expandState(compactState(state));
        expect(restored.recipientPreventionShields).toEqual(
            state.recipientPreventionShields
        );
    });
});

// ---------------------------------------------------------------------------
// CR 614.9 — the recipient-keyed redirection shield
// ---------------------------------------------------------------------------

describe("CR 614.9 — the next N damage dealt to one recipient is dealt to another", () => {
    it("redirects a whole event that fits inside the budget", () => {
        const state = twoBoards();
        castManeuver(
            state,
            "p1",
            3,
            { type: "player", id: "p1" },
            { type: "permanent", id: "theirs" }
        );
        castBolt(state, "p2", { type: "player", id: "p1" });
        expect(state.players[0].life).toBe(20);
        expect(permanentOf(state, "theirs")?.damageMarked).toBe(3);
    });

    it("spends the budget down and keeps the remainder of the shield", () => {
        const state = twoBoards();
        castManeuver(
            state,
            "p1",
            5,
            { type: "player", id: "p1" },
            { type: "permanent", id: "theirs" }
        );
        castBolt(state, "p2", { type: "player", id: "p1" });
        expect(state.damageRedirections).toHaveLength(1);
        expect(state.damageRedirections?.[0]).toMatchObject({
            kind: "next-n-to-recipient-redirect",
            remaining: 2,
        });
    });

    it("SPLITS an event bigger than the budget: the budget moves, the remainder stays", () => {
        const state = twoBoards();
        castManeuver(
            state,
            "p1",
            2,
            { type: "player", id: "p1" },
            { type: "permanent", id: "theirs" }
        );
        castBolt(state, "p2", { type: "player", id: "p1" });
        // 2 of the Bolt's 3 damage land on the Wurm, 1 still on the player —
        // a points budget, never an all-or-nothing charge.
        expect(permanentOf(state, "theirs")?.damageMarked).toBe(2);
        expect(state.players[0].life).toBe(19);
        // A spent shield is gone.
        expect(state.damageRedirections).toBeUndefined();
    });

    it("splits a COMBAT hit the same way (the combat sink)", () => {
        const state = twoBoards();
        castManeuver(
            state,
            "p2",
            4,
            { type: "permanent", id: "theirs" },
            { type: "player", id: "p1" }
        );
        state.combat = {
            attackerIds: ["mine"],
            confirmed: true,
            blockersConfirmed: true,
            blockerAssignments: { theirs: ["mine"] },
            blockedAttackerIds: ["mine"],
        };
        applyAllCombatDamage(state, { mine: { theirs: 6 } });
        // Craw Wurm is 6/4: 4 of the attacker's 6 are redirected onto the
        // attacking player, and the blocker still takes the other 2 — under
        // its toughness, so it survives a hit that would otherwise be lethal.
        expect(state.players[0].life).toBe(16);
        expect(permanentOf(state, "theirs")?.damageMarked).toBe(2);
    });

    it("CR 614.9 — a destination that has left the battlefield makes the effect do NOTHING, and spends no budget", () => {
        const state = twoBoards();
        castManeuver(
            state,
            "p1",
            3,
            { type: "player", id: "p1" },
            { type: "permanent", id: "theirs" }
        );
        state.players[1].battlefield = [];
        castBolt(state, "p2", { type: "player", id: "p1" });
        expect(state.players[0].life).toBe(17);
        expect(state.damageRedirections?.[0]).toMatchObject({ remaining: 3 });
    });

    it("redirects damage dealt to a PERMANENT onto a player (both ends span both types)", () => {
        const state = twoBoards();
        castManeuver(
            state,
            "p1",
            3,
            { type: "permanent", id: "mine" },
            { type: "player", id: "p2" }
        );
        castBolt(state, "p2", { type: "permanent", id: "mine" });
        expect(permanentOf(state, "mine")?.damageMarked).toBeUndefined();
        expect(state.players[1].life).toBe(17);
    });

    it("CR 614.9 — `unredirectable` damage is not moved, and leaves the shield unspent", () => {
        const state = twoBoards();
        castManeuver(
            state,
            "p1",
            3,
            { type: "permanent", id: "mine" },
            { type: "permanent", id: "theirs" }
        );
        permanentOf(state, "mine")!.damageLockThisTurn = true;
        castBolt(state, "p2", { type: "permanent", id: "mine" });
        expect(permanentOf(state, "mine")?.damageMarked).toBe(3);
        expect(state.damageRedirections?.[0]).toMatchObject({ remaining: 3 });
    });

    it("CR 615.12 — `unpreventable` damage IS still redirected: a redirect is not a prevention", () => {
        const state = twoBoards();
        castManeuver(
            state,
            "p1",
            3,
            { type: "permanent", id: "mine" },
            { type: "permanent", id: "theirs" }
        );
        state.damageUnpreventableThisTurn = true;
        castBolt(state, "p2", { type: "permanent", id: "mine" });
        expect(permanentOf(state, "mine")?.damageMarked).toBeUndefined();
        expect(permanentOf(state, "theirs")?.damageMarked).toBe(3);
    });

    it("CR 614.9 + CR 615.1a — a redirect ONTO a prevention-shielded creature is prevented", () => {
        const state = twoBoards();
        castDivineLight(state, "p2");
        castManeuver(
            state,
            "p1",
            3,
            { type: "player", id: "p1" },
            { type: "permanent", id: "theirs" }
        );
        castBolt(state, "p2", { type: "player", id: "p1" });
        // The CR 614 redirect ran first and moved the event; the CR 615 shield
        // on its NEW recipient then ate it. Nobody takes the damage.
        expect(state.players[0].life).toBe(20);
        expect(permanentOf(state, "theirs")?.damageMarked).toBeUndefined();
    });

    it("CR 614.5 — a split remainder does NOT re-run the continuous replacement layer", () => {
        const state = twoBoards();
        // Lashknife Barrier: "If a source would deal damage to a creature you
        // control, it deals that much damage minus 1 to that creature
        // instead." A CR 614 continuous replacement, and it gets ONE
        // opportunity per event — including the modified events that replace
        // it, which is exactly what a split remainder is.
        state.players[1].battlefield.push(
            makeInstance(lashknifeBarrier.id, {
                id: "barrier",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        castManeuver(
            state,
            "p2",
            2,
            { type: "permanent", id: "theirs" },
            { type: "player", id: "p1" }
        );
        state.combat = {
            attackerIds: ["mine"],
            confirmed: true,
            blockersConfirmed: true,
            blockerAssignments: { theirs: ["mine"] },
            blockedAttackerIds: ["mine"],
        };
        applyAllCombatDamage(state, { mine: { theirs: 6 } });
        // 6 → Lashknife once → 5; the shield moves 2 to p1 and 3 stay on the
        // blocker. Reducing the remainder a SECOND time would mark 2 and lose
        // a point of damage outright.
        expect(state.players[0].life).toBe(18);
        expect(permanentOf(state, "theirs")?.damageMarked).toBe(3);
    });

    it("splits an event from a PERMANENT source to a player (the painland sink)", () => {
        const state = twoBoards();
        castManeuver(
            state,
            "p2",
            2,
            { type: "player", id: "p2" },
            { type: "permanent", id: "theirs" }
        );
        dealDamageFromPermanentToPlayer(
            state,
            permanentOf(state, "mine")!,
            "p1",
            "p2",
            3
        );
        expect(permanentOf(state, "theirs")?.damageMarked).toBe(2);
        expect(state.players[1].life).toBe(19);
    });

    it("splits a FIGHT half, and the remainder's lethality is still reported", () => {
        const state = twoBoards();
        castManeuver(
            state,
            "p1",
            2,
            { type: "permanent", id: "mine" },
            { type: "player", id: "p2" }
        );
        resolveFight(state, "theirs", "mine");
        // Craw Wurm is 6/4. Of the 6 aimed at "mine", 2 go to p2 and 4 stay —
        // still lethal, so the fight destroys it rather than leaving it for
        // the SBA pass; "theirs" takes its own 6 and dies with it.
        expect(state.players[1].life).toBe(18);
        expect(permanentOf(state, "mine")).toBeUndefined();
    });

    it("CR 514.2 — the shield expires at CLEANUP", () => {
        const state = twoBoards();
        castManeuver(
            state,
            "p1",
            3,
            { type: "player", id: "p1" },
            { type: "permanent", id: "theirs" }
        );
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(state.damageRedirections).toBeUndefined();
    });

    it("wire format — the active shield survives `projectPublicState`", () => {
        const state = twoBoards();
        castManeuver(
            state,
            "p1",
            3,
            { type: "player", id: "p1" },
            { type: "permanent", id: "theirs" }
        );
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.damageRedirections?.[0]).toMatchObject({
            kind: "next-n-to-recipient-redirect",
            from: { type: "player", id: "p1" },
            redirectTo: { type: "permanent", id: "theirs" },
            remaining: 3,
        });
    });

    it("serialization — the shield survives a compact/expand round trip", () => {
        const state = twoBoards();
        castManeuver(
            state,
            "p1",
            3,
            { type: "player", id: "p1" },
            { type: "permanent", id: "theirs" }
        );
        const restored = expandState(compactState(state));
        expect(restored.damageRedirections).toEqual(state.damageRedirections);
    });
});
