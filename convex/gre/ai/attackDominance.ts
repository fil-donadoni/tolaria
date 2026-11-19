// Dominated attack declarations — the Bot's own declare-attackers node.
//
// Attack declaration is the power set of the optional attackers
// (`enumerateAttackerMoves`), and the search decides among them. When the
// defending player has nothing that could block and nothing that could punish
// a tapped attacker, the declarations that leave a FREE attacker home differ
// from the one that sends it only by the damage it would have dealt. That
// damage is real but small next to the spread of rollouts over an imagined
// opponent hand, so the pick among "both", "one" and "none" fell to rollout
// noise: the Bot skipped free damage into an empty board on some seeds.
//
// A declaration D is DOMINATED when it leaves home a free attacker F and the
// same list holds the declaration that adds F to D — same other attackers,
// same attack targets, same exert answers, same enlists. The proof is static,
// read off the public board, and fails CLOSED (no attacker is free) on every
// shape it cannot see through:
//
//   - F would be blocked: the defending player controls an untapped creature
//     (CR 509.1a — only untapped creatures block), or a permanent with an
//     activated ability that animates it (a manland can become a blocker).
//   - F's tap costs a defender: without vigilance (CR 702.20b) an attacking
//     creature taps (CR 508.1f) and cannot block the crack-back, so F is free
//     only when the defending player controls no creature at all. A tapped
//     opposing creature untaps next turn and swings — that position stays the
//     search's (the lethal crack-back pair in the blade registry).
//   - F's tap costs an ability: a non-vigilant creature with a `{T}` ability
//     gives the ability up by attacking.
//   - F deals nothing: zero or less power (CR 510.1a) — no gain to force.
//   - The attack costs something: any attack tax on the battlefield
//     (CR 508.1c/1g — Propaganda, Flooded Woodlands), or a defending
//     permanent that triggers on attackers being declared (CR 508.1m).
//
// Hidden information is the one thing the proof gives up: a flash blocker in
// the defending hand. The same creature would block whatever the Bot sends
// later, and the free damage is certain where the ambush is not.
//
// Bot paths only, like every other pruning: a dominated declaration is LEGAL,
// and the human affordance surface (`legalActions`) keeps the whole set. Root
// only (`enumerateRootMoves`): the defect is the root pick's noise; the tree
// and the rollout keep every declaration.
import type { CardInstanceState, GameState } from "../state";
import { getOpponentId } from "../state";
import type { Move } from "../moves";
import { isCreature, liveStaticDefinition } from "../constants";
import { getEffectivePower } from "../layers";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";

type DeclareAttackersMove = Extract<Move, { kind: "declare-attackers" }>;

const ATTACK_TAX_KINDS: ReadonlySet<string> = new Set([
    "attack-mana-tax",
    "attack-sacrifice-tax",
]);

/** Whether any permanent on the battlefield taxes attacks (CR 508.1c/1g). */
function attackTaxInPlay(state: GameState): boolean {
    return state.players.some((p) =>
        p.battlefield.some((perm) =>
            (liveStaticDefinition(perm)?.staticEffects ?? []).some((e) =>
                ATTACK_TAX_KINDS.has(e.kind)
            )
        )
    );
}

/** Whether `perm` triggers on attackers being declared (CR 508.1m). */
function watchesAttacks(perm: CardInstanceState): boolean {
    return (liveStaticDefinition(perm)?.triggeredAbilities ?? []).some((t) => {
        const events = Array.isArray(t.event) ? t.event : [t.event];
        return events.includes("ATTACKERS_DECLARED");
    });
}

/** Whether `perm` has an activated ability that can turn it into a creature —
 *  a manland, an animated artifact: a blocker the board does not show yet. */
function canAnimate(perm: CardInstanceState): boolean {
    return getEffectiveActivatedAbilities(perm).some(({ ability }) =>
        JSON.stringify(ability).includes('"op":"animate"')
    );
}

/** The attackers of `state`'s active player whose attack is provably free (see
 *  the header). Empty whenever the board admits a block, a crack-back or a cost
 *  it cannot read. */
export function freeAttackerIds(state: GameState): Set<string> {
    const free = new Set<string>();
    if (!state.combat) return free;
    const attacker = state.players.find((p) => p.id === state.activePlayerId);
    const defender = state.players.find(
        (p) => p.id === getOpponentId(state, state.activePlayerId)
    );
    if (!attacker || !defender) return free;
    const defBf = defender.battlefield;
    if (
        defBf.some(
            (c) =>
                (isCreature(c) && !c.isTapped) ||
                (!isCreature(c) && canAnimate(c)) ||
                watchesAttacks(c)
        )
    ) {
        return free;
    }
    if (attackTaxInPlay(state)) return free;
    const noCrackBack = !defBf.some(isCreature);
    for (const card of attacker.battlefield) {
        if (!isCreature(card)) continue;
        if (getEffectivePower(state, card) <= 0) continue;
        const vigilant = card.staticAbilities.includes("vigilance");
        if (!vigilant) {
            if (!noCrackBack) continue;
            const tapAbility = getEffectiveActivatedAbilities(card).some(
                ({ ability }) => ability.cost?.tap === true
            );
            if (tapAbility) continue;
        }
        free.add(card.id);
    }
    return free;
}

/** A declaration's shape with the free attackers taken out: two declarations
 *  with the same core differ only by which free attackers they send. */
function coreKey(
    move: DeclareAttackersMove,
    free: ReadonlySet<string>
): string {
    const keep = (id: string) => !free.has(id);
    const targets = Object.entries(move.attackTargets ?? {})
        .filter(([id]) => keep(id))
        .sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify({
        attackers: move.attackerIds.filter(keep).sort(),
        targets,
        exert: (move.exertIds ?? []).filter(keep).sort(),
        enlists: move.enlists ?? null,
    });
}

/** The free attackers `move` leaves home, partners it enlists excluded (an
 *  enlisted creature is spent on the cost, not left idle). */
function omittedFree(
    move: DeclareAttackersMove,
    free: ReadonlySet<string>
): string[] {
    const sent = new Set(move.attackerIds);
    const spent = new Set((move.enlists ?? []).map((e) => e.enlistedId));
    return [...free].filter((id) => !sent.has(id) && !spent.has(id));
}

/**
 * `moves` without the declare-attackers moves that leave a free attacker home
 * while the list offers the same declaration with it sent (see the header).
 * Every other move passes through untouched, in order; never emptying, since a
 * dropped declaration always has a kept one sending more.
 */
export function pruneDominatedAttacks(
    state: GameState,
    moves: readonly Move[],
    onPruned?: (move: Move) => void
): Move[] {
    if (!moves.some((m) => m.kind === "declare-attackers")) return [...moves];
    const declarations = moves.filter(
        (m): m is DeclareAttackersMove => m.kind === "declare-attackers"
    );
    // Free AND able to attack: a summoning-sick creature (CR 302.6) is in no
    // declaration, so it is never "left home".
    const declarable = new Set(declarations.flatMap((m) => m.attackerIds));
    const free = new Set(
        [...freeAttackerIds(state)].filter((id) => declarable.has(id))
    );
    if (free.size === 0) return [...moves];
    // The core shapes some declaration realises with every free attacker sent.
    const complete = new Set(
        declarations
            .filter((m) => omittedFree(m, free).length === 0)
            .map((m) => coreKey(m, free))
    );
    return moves.filter((m) => {
        if (m.kind !== "declare-attackers") return true;
        if (omittedFree(m, free).length === 0) return true;
        if (!complete.has(coreKey(m, free))) return true;
        onPruned?.(m);
        return false;
    });
}
