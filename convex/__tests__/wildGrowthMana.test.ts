// Integration tests: Wild-Growth-style triggered mana abilities (CR 605.4) and
// the two bugs they exposed.
//
// Wild Growth ("Whenever enchanted land is tapped for mana, its controller adds
// an additional {G}") produces its bonus inside a triggered MANA ability that
// resolves off-stack. Two payment/undo paths handled it wrong:
//
//   BUG 1 — infinite mana on tap/untap. Tapping the enchanted land floats base
//   {G} + Wild Growth's {G} (pool 2), but the untap-toggle refunded only the
//   land's OWN base {G} (pool 1). Net +1 per tap/untap cycle = infinite mana.
//   The fix records the bonus on the source (`tapBonusMana`) and refunds it too.
//
//   BUG 2 — auto-tap under-produced. The auto-tap solver counts Wild Growth's
//   bonus when planning (so it taps fewer lands), but the payment tap path
//   deferred the mana-ability trigger to cast commit — AFTER the affordability
//   check — so the bonus was missing from the pool and the spell couldn't be
//   paid: the enchanted land yielded only its base {G}. The fix realizes the
//   bonus into the pool at tap time (`realizeManaAbilityTapBonus`), keeping the
//   tap's NON-mana triggers deferred, and flags the event so the commit-time
//   flush doesn't add the bonus a second time.
//
// There is no convex-test harness here: the payment/commit paths call the REAL
// exported GRE primitives (tapSourceIntoPayment, tryAutoCommitPendingCast,
// realizeManaAbilityTapBonus, refundTapBonusMana), and the priority tap path
// replicates the `tapUntap` tap/untap branches over those same functions.

import { describe, it, expect } from "vitest";
import {
    tapSourceIntoPayment,
    tryAutoCommitPendingCast,
    refundTapBonusMana,
} from "../game";
import { buildAutoTapSources, solveSmartAutoTap } from "../gre/autoTap";
import {
    emitPermanentTapped,
    processPendingActionTriggers,
    getManaSubstitutions,
    normalizeManaCost,
    type GameState,
    type PlayerState,
    type CardInstanceState,
    type PendingCast,
} from "../gre/state";
import { getBasicLandMana, getFixedManaAmount } from "../gre/constants";
import { compactState, expandState } from "../gre/serialize";
import { projectPublicState } from "../gameProjections";
import { forest, wildGrowth, grizzlyBears } from "../cards/sets/lea";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";

/** A Forest enchanted with Wild Growth, plus a fresh state. */
function wildGrowthForest(overrides: Partial<PlayerState> = {}) {
    const host = makeInstance(forest.id, {
        id: "host-forest",
        controllerId: "p1",
        ownerId: "p1",
    });
    const aura = makeInstance(wildGrowth.id, {
        id: "wg",
        controllerId: "p1",
        ownerId: "p1",
        attachedTo: "host-forest",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [host, aura], ...overrides }),
            makePlayer("p2"),
        ],
    });
    return { state, player: state.players[0] };
}

/** Replicates the `tapUntap` priority tap-for-mana branch: float base {G}, run
 *  the trigger flush (Wild Growth resolves off-stack), then record the bonus
 *  the flush added onto the source — exactly what the mutation does. */
function priorityTapForMana(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): void {
    player.manaPool.G = (player.manaPool.G ?? 0) + 1;
    card.isTapped = true;
    card.chosenMana = { G: 1 };
    emitPermanentTapped(state, card, true, { G: 1 });
    const before = { ...player.manaPool };
    processPendingActionTriggers(state);
    const bonus: Record<string, number> = {};
    for (const [color, after] of Object.entries(player.manaPool)) {
        if (color === "X" || typeof after !== "number") continue;
        const delta = after - (before[color as keyof typeof before] ?? 0);
        if (delta > 0) bonus[color] = delta;
    }
    card.tapBonusMana = Object.keys(bonus).length > 0 ? bonus : undefined;
}

/** Replicates the `tapUntap` untap-toggle branch: refund base + bonus, clear. */
function untapToggle(player: PlayerState, card: CardInstanceState): void {
    for (const [color, amount] of Object.entries(card.chosenMana ?? {})) {
        if (typeof amount === "number" && amount > 0) {
            const key = color as keyof PlayerState["manaPool"];
            player.manaPool[key] = Math.max(
                0,
                (player.manaPool[key] ?? 0) - amount
            );
        }
    }
    card.chosenMana = undefined;
    refundTapBonusMana(player, card);
    card.isTapped = false;
}

describe("Wild Growth — infinite-mana leak on tap/untap (BUG 1, CR 605.4)", () => {
    it("tapping floats base + bonus {G}; untapping refunds BOTH (net zero)", () => {
        const { state, player } = wildGrowthForest();
        const host = player.battlefield[0];

        priorityTapForMana(state, player, host);
        // CR 605.4 — base {G} + Wild Growth's {G}, nothing on the stack.
        expect(state.stack).toHaveLength(0);
        expect(player.manaPool.G).toBe(2);
        expect(host.tapBonusMana).toEqual({ G: 1 });

        untapToggle(player, host);
        // The whole tap reverses: the bonus does NOT stay floating.
        expect(player.manaPool.G).toBe(0);
        expect(host.tapBonusMana).toBeUndefined();
        expect(host.isTapped).toBe(false);
    });

    it("repeated tap/untap cycles never accumulate mana (the combo is dead)", () => {
        const { state, player } = wildGrowthForest();
        const host = player.battlefield[0];
        for (let i = 0; i < 5; i++) {
            priorityTapForMana(state, player, host);
            untapToggle(player, host);
        }
        expect(player.manaPool.G).toBe(0);
    });
});

describe("Wild Growth — payment tap realizes the bonus (BUG 2, CR 605.4)", () => {
    it("tapSourceIntoPayment floats base + bonus {G} and records the bonus", () => {
        const { state, player } = wildGrowthForest();
        const host = player.battlefield[0];
        const tappedLandIds: string[] = [];

        tapSourceIntoPayment(state, player, host, undefined, tappedLandIds);

        // The enchanted land yields TWO {G} during payment, not one.
        expect(player.manaPool.G).toBe(2);
        expect(host.tapBonusMana).toEqual({ G: 1 });
        expect(tappedLandIds).toContain("host-forest");

        // Wire format (mandatory for visible effects): the bonus mana the client
        // renders survives the projection to the viewer's own state.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].manaPool.G).toBe(2);
    });

    it("the commit-time trigger flush does NOT add the bonus a second time", () => {
        const { state, player } = wildGrowthForest();
        const host = player.battlefield[0];
        tapSourceIntoPayment(state, player, host, undefined, []);
        expect(player.manaPool.G).toBe(2);

        // Simulate the cast-commit flush: the flagged event must not re-resolve
        // Wild Growth's mana ability (would be 3 {G} — double mana).
        processPendingActionTriggers(state);
        expect(player.manaPool.G).toBe(2);
    });

    it("undoing the payment tap refunds base + bonus (net zero)", () => {
        const { state, player } = wildGrowthForest();
        const host = player.battlefield[0];
        tapSourceIntoPayment(state, player, host, undefined, []);
        expect(player.manaPool.G).toBe(2);

        // Reverse the source the way untapForPayment / untapSourceFromPayment
        // do: refund the base mana (chosenMana snapshot, else the land's fixed
        // output) AND the Wild-Growth bonus.
        if (host.chosenMana) {
            for (const [color, amount] of Object.entries(host.chosenMana)) {
                if (typeof amount === "number" && amount > 0) {
                    const key = color as keyof PlayerState["manaPool"];
                    player.manaPool[key] = Math.max(
                        0,
                        (player.manaPool[key] ?? 0) - amount
                    );
                }
            }
            host.chosenMana = undefined;
        } else {
            const manaColor = getBasicLandMana(host)!;
            const amount = getFixedManaAmount(host, manaColor);
            player.manaPool[manaColor] = Math.max(
                0,
                (player.manaPool[manaColor] ?? 0) - amount
            );
        }
        refundTapBonusMana(player, host);
        expect(player.manaPool.G).toBe(0);
        expect(host.tapBonusMana).toBeUndefined();
    });
});

describe("Wild Growth — auto-tap covers a spell using the bonus (BUG 2)", () => {
    it("Grizzly Bears ({1}{G}) is castable off a single Wild-Growth Forest", () => {
        const cast = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const { state, player } = wildGrowthForest({ hand: [cast] });
        const pendingCast: PendingCast = {
            playerId: "p1",
            cardInstanceId: "bears",
            manaCost: normalizeManaCost(grizzlyBears.manaCost ?? {}),
            tappedLandIds: [],
        };
        state.pendingCast = pendingCast;

        // Auto-tap plans over the Wild-Growth-aware sources, taps the single
        // Forest, and commits — the enchanted land pays the full {1}{G}.
        const subs = getManaSubstitutions(state, player.id);
        const sources = buildAutoTapSources(player.battlefield);
        const plan = solveSmartAutoTap(
            player.manaPool,
            pendingCast.manaCost,
            subs,
            sources,
            [],
            undefined,
            () => 0
        );
        expect(plan).not.toBeNull();
        for (const step of plan!) {
            const card = player.battlefield.find((c) => c.id === step.cardId)!;
            tapSourceIntoPayment(
                state,
                player,
                card,
                step.manaChoiceIndex,
                pendingCast.tappedLandIds
            );
        }
        // Only the Forest is tapped (the plan trusted the bonus).
        expect(
            player.battlefield.find((c) => c.id === "host-forest")!.isTapped
        ).toBe(true);

        const committed = tryAutoCommitPendingCast(state, player.id);
        expect(committed).not.toBeNull();
        expect(state.pendingCast).toBeUndefined();
    });
});

describe("Wild Growth — tapBonusMana survives the DB round-trip", () => {
    it("preserves tapBonusMana across compactState/expandState", () => {
        const { state, player } = wildGrowthForest();
        player.battlefield[0].isTapped = true;
        player.battlefield[0].tapBonusMana = { G: 1 };

        const restored = expandState(compactState(state));
        const host = restored.players[0].battlefield.find(
            (c) => c.id === "host-forest"
        )!;
        expect(host.tapBonusMana).toEqual({ G: 1 });
    });
});
