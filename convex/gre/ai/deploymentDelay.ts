// Deployment delay for the Brain's hand term.
//
// A card in hand is worth less the more turns its owner needs to cast it. The
// latent discounts (`latentCreatureDiscount` and its flash twin) price "one
// turn from the board", whatever the mana base can actually deploy: a hand of
// four three-drops on three lands reads the same as four one-drops on the same
// lands, although the first needs four turns to reach the battlefield and the
// second two. This schedules a player's known hand against the mana their base
// produces each turn and prices each card's wait.
//
// The schedule, per player:
//   - the WINDOWS are that player's turns, from the one under way (when they
//     are the active player with a main phase still ahead, its capacity is the
//     mana they can spend right now) or else their next one (their whole mana
//     base, CR 502.3: every source untaps);
//   - a window's capacity is the base (at least one mana per land: a fetch
//     land not yet cracked is a land to come) plus the lands they can put down by
//     then: one land drop per turn (CR 305.2), from the lands in hand and the
//     expected lands among the cards drawn by then (CR 504.1: one draw per
//     turn, at the library's land share — order is never read, so the
//     determinized shuffle cannot move it);
//   - a card costs its EFFECTIVE total (CR 601.2f, the castability reader's
//     `castCostTotal`), so a tax delays it and a reduction speeds it up;
//   - cards are placed in value order, most valuable first, each in the
//     earliest window with mana left for it. Mana does not carry over between
//     turns (CR 500.5: the pool empties at each step's end).
//
// Only SORCERY-SPEED cards are scheduled. A card with instant speed (an
// instant, CR 304.1; flash, CR 702.8a) is held by choice until a window it
// wants, the reading `latentFlashCreatureDiscount` already makes; it neither
// waits nor takes mana from the schedule. Read the other way (a held answer
// holding mana up so the hand behind it waits), every one-ply Eval Pair that
// holds an answer reads the hold as a loss.
//
// A card's WAIT is the QUEUE it stands in: the index of its window less the
// index of the first window that could cast it alone, both capped at
// `DEPLOYMENT_WAIT_HORIZON`. Its worth in hand is multiplied by
// `deploymentDelayDecay ^ wait`. The turns a card needs on its own — a
// six-drop on two lands — are what the fitted latent discounts already price,
// across every cost the corpus holds; what they cannot see is the hand
// competing for one base, the turns a card waits while the cards ahead of it
// spend the mana. So a hand the base deploys in parallel is unchanged, and a
// hand a tax or a thin base serialises reads as the delay it is.
//
// Known limits, listed so nobody reads a full value as a verdict:
//   - only the TOTAL is read, not colours: a hand its base cannot colour reads
//     as castable as soon as the total fits;
//   - a source that will not untap (an untap lock) still counts in the base,
//     and a land that makes no mana (a utility land) counts as one;
//   - a card the base cannot cast on its own within the horizon (a tax
//     pushing a lone spell past every window) waits nothing here;
//   - lands are never scheduled (CR 305.1 — they are played, not cast) and
//     keep their worth.

/** The last window the schedule reads: past four turns the game the hand was
 *  dealt into has usually moved on. */
export const DEPLOYMENT_WAIT_HORIZON = 4;

/** The mana base a player deploys their hand from. */
export type DeploymentBase = {
    /** Mana the first window can spend: what the player can pay right now
     *  in a turn of theirs still under way, else their whole base. */
    firstWindowMana: number;
    /** Mana every later window starts with: the whole base. */
    perTurnMana: number;
    /** Lands in hand, each one land drop away. */
    landsInHand: number;
    /** The library's land share — the expected lands per draw. */
    libraryLandShare: number;
    /** Land drops open in the first window (0 or 1 in the ordinary case). */
    firstWindowLandDrops: number;
    /** Draws taken before the first window (1 when the first window is the
     *  player's next turn, 0 when it is the turn under way). */
    firstWindowDraws: number;
};

/** Mana window `w` can spend under `base`. */
export function windowMana(base: DeploymentBase, w: number): number {
    const mana = w === 0 ? base.firstWindowMana : base.perTurnMana;
    const drops = base.firstWindowLandDrops + w;
    const lands =
        base.landsInHand + base.libraryLandShare * (base.firstWindowDraws + w);
    return mana + Math.min(drops, lands);
}

/** The first window whose whole mana covers `cost`, or the horizon. */
function firstWindowCovering(cost: number, base: DeploymentBase): number {
    for (let w = 0; w < DEPLOYMENT_WAIT_HORIZON; w++) {
        if (windowMana(base, w) + 1e-9 >= cost) return w;
    }
    return DEPLOYMENT_WAIT_HORIZON;
}

/** The queue wait of each card, given its effective cost and its worth,
 *  under `base`. Cards are placed most valuable first (ties: the earlier
 *  index), each in the earliest window whose remaining mana covers its cost;
 *  a card's wait is that window less the first one that covers it alone. */
export function deploymentWaits(
    costs: readonly number[],
    worths: readonly number[],
    base: DeploymentBase
): number[] {
    const n = costs.length;
    const waits = new Array<number>(n).fill(0);
    if (n === 0) return waits;
    const order = Array.from({ length: n }, (_, i) => i).sort(
        (a, b) => worths[b] - worths[a] || a - b
    );
    const left: number[] = [];
    for (let w = 0; w < DEPLOYMENT_WAIT_HORIZON; w++) {
        left.push(windowMana(base, w));
    }
    for (let k = 0; k < n; k++) {
        const i = order[k];
        const cost = costs[i];
        let wait = DEPLOYMENT_WAIT_HORIZON;
        for (let w = 0; w < DEPLOYMENT_WAIT_HORIZON; w++) {
            // A tolerance for the fractional mana the expected land draws add.
            if (left[w] + 1e-9 >= cost) {
                left[w] -= cost;
                wait = w;
                break;
            }
        }
        waits[i] = wait - firstWindowCovering(cost, base);
    }
    return waits;
}

/** The share of its worth a card waiting `wait` windows keeps. */
export function deploymentShare(wait: number, decay: number): number {
    return wait === 0 ? 1 : decay ** wait;
}
