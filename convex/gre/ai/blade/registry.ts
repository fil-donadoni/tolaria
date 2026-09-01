/**
 * Blade-scenario suite — the registry (issue #1427, PRD #1423).
 *
 * A flat, code-side list of positions where the right play is not a matter of
 * opinion. Add an entry by COPYING one below: label, `spec` (the same
 * `ScenarioSpec` vocabulary the Debug panel speaks), the seat the bot plays,
 * an ITERATIONS budget, a tier, and an expectation.
 *
 * Tier discipline:
 *   - `must`    — the bot is expected to get this right TODAY. Blocking CI
 *                 (`bun run test:blade`). Never land an entry here red.
 *   - `stretch` — a position the bot is not expected to solve yet. Report-only
 *                 (`bun run test:blade:stretch`); it prints its verdict and
 *                 never fails the build. Promote it to `must` in the PR that
 *                 makes it pass.
 */

import type { BladeScenario, BladeSeat } from "./types";
import type { GameState } from "../../state";
import type { Move } from "../../moves";
import { enumerateMoves, enumerateRaisedTargetMoves } from "../../moves";
import { applyMoveInSearch, isDiscouragedRolloutMove } from "../../search";
import { raisedPendingTargetOwedBy } from "../../pendingTargetOrigin";
import { cloneGameState } from "../../clone";
import { instanceIdsForName, seatPlayerId } from "./matcher";
import { getCardByName } from "../../../cards";
import { activationSacrificeVictims } from "../../activationCostPicks";

/** CR 702.34a — five untapped Mountains, exactly Firebolt's {4}{R} flashback
 *  cost, shared by the two halves of the issue-#2971 graveyard-cast pair so the
 *  ONLY difference between them is the zone the Firebolt sits in. Basics rather
 *  than `landCount` because the flashback cost is coloured. */
const MOUNTAINS_5 = Array.from({ length: 5 }, () => ({
    name: "Mountain",
    owner: "me" as const,
    zone: "battlefield" as const,
    tapped: false,
}));

/** "The dominance pruner (issue #1887) still leaves the bot a cast to make" —
 *  the negative control for a position where the CHOSEN move is not a stable
 *  expectation (holding an instant through your own main phase is legitimate
 *  play, ADR 0021) but the surviving LEGAL SET is. */
function pruningKeepsACast(
    state: Parameters<typeof enumerateMoves>[0]
): boolean {
    const pid = state.players[0].id;
    return enumerateMoves(state, pid, { pruneDominatedNoOps: true }).some(
        (m) => m.kind === "cast-spell"
    );
}

/** "An 'up to X' cast with NO legal target on the board is EXECUTABLE" — the
 *  liveness guard for issue #2870 (CR 601.2c).
 *
 *  A `{ min: 0, max: X }` requirement on a board offering nothing to target has
 *  exactly one possible answer: zero targets. `selectTargets` rejects an empty
 *  array, so that answer is a confirm-ONLY submission — a cast declaring
 *  `confirmTargets: false` alongside an empty tuple sends NO mutation for its
 *  live `PendingTarget`, the following `tapForPayment` throws against an
 *  expected input of `"target"`, and the announcement strands at an owed target
 *  of ANNOUNCED origin, which the owed-target gate is fail-closed against by
 *  design. The Bot then answers `no-move`, the liveness ladder cancels the
 *  announcement, and the search — whose `applyMove` puts the spell straight on
 *  the stack and never opens a `PendingTarget` — re-picks the identical cast
 *  forever (~10s per cycle in the reported game).
 *
 *  Asserted as a POSITION guard on the LEGAL SET (the `pruningKeepsACast`
 *  shape) rather than as a positive move match, because whether casting a
 *  token-maker this turn is the best play is a matter of opinion while whether
 *  the offered cast can be COMPLETED is not — plus the CHOSEN move, when it is
 *  one of them, must be executable too. */
function upToXZeroTargetCastIsExecutable(
    move: Move | null,
    state: Parameters<typeof enumerateMoves>[0]
): boolean {
    const pid = state.players[0].id;
    const declined = enumerateMoves(state, pid).filter(
        (m) =>
            m.kind === "cast-spell" &&
            (m.chosenX ?? 0) >= 1 &&
            m.targets.length === 0
    );
    // The position must OFFER the declined-target cast at all — an entry that
    // stopped enumerating it would otherwise pass vacuously.
    if (declined.length === 0) return false;
    if (!declined.every((m) => m.kind === "cast-spell" && m.confirmTargets)) {
        return false;
    }
    return !(
        move?.kind === "cast-spell" &&
        (move.chosenX ?? 0) >= 1 &&
        move.targets.length === 0 &&
        !move.confirmTargets
    );
}

/** "The issue-#1890 reactive-timing discipline is a PREFERENCE, not a filter" —
 *  the weaker, POSITION-level negative control for the activation-timing
 *  entries below: in a window where the activation belongs, it is still
 *  ENUMERATED (the timing rules never touch legality) and carries NO rollout
 *  policy penalty. If items 1-2 ever widen into a mute button, this goes red.
 *
 *  It was, until issue #1920, the STRONGEST thing a blade could assert here.
 *  `applyMoveInSearch` applied an activation's COSTS and never put its effect on
 *  the stack, so in the world the search reasoned about every activation was
 *  pure cost — a Mother of Runes activation tapped a 1/1 and granted nothing.
 *  No blade could make the bot CHOOSE an activation for its payoff, because the
 *  payoff was invisible by construction. (That is also the deeper reason issue
 *  #1890's symptoms existed at all: with no payoff visible, every activation
 *  tied `pass` inside `OUTCOME_EPS` and the pick fell to rollout noise.)
 *
 *  Issue #1920 closed that: the ability now reaches the stack and `policyValue`
 *  resolves it one ply deep. So the blind spot this helper's docstring used to
 *  disclaim — "a change could leave the move enumerated and unpenalised while
 *  making the bot's CHOICE in that window deterministically decline it" — is now
 *  covered by real CHOSEN-MOVE entries in the `activation payoff:` group below,
 *  which is where new coverage of this kind belongs. This predicate is kept for
 *  the positions whose right answer is genuinely a legal-set property rather
 *  than a single best move. */
function activationStaysAvailable(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const pid = state.players[seat === "me" ? 0 : 1].id;
    const defId = getCardByName(cardName).id;
    const activations = enumerateMoves(state, pid, {
        pruneDominatedNoOps: true,
    }).filter(
        (m) =>
            m.kind === "activate-ability" &&
            state.players.some((p) =>
                p.battlefield.some(
                    (c) =>
                        c.id === m.cardInstanceId &&
                        (c.card as { id?: string }).id === defId
                )
            )
    );
    return (
        activations.length > 0 &&
        activations.every((m) => !isDiscouragedRolloutMove(state, pid, m))
    );
}

/** "An activation whose cost is paid by NAMING CARDS arrives at the executor
 *  already answered" (CR 602.1 / 118.3) — the guard for the tap-a-land-then-
 *  untap-it loop.
 *
 *  Asserted on the POSITION rather than the chosen move, for the same measured
 *  reason as `activationStaysAvailable` above: the search does not put an
 *  activated ability's EFFECT on the stack (issue #1920), so a tutor engine's
 *  payoff is invisible and no blade can make the bot CHOOSE this activation.
 *  What IS assertable — and what actually broke — is that every enumerated
 *  activation carries a legal, complete pick for its deferred cost leg. Without
 *  one the server parks a `pendingActivation` it can never commit, the payment
 *  rolls back, and the identical position re-produces the identical move
 *  forever.
 *
 *  It also asserts the pick is SEARCHED, not fixed: with two different
 *  creatures in hand there must be one variant per creature, or the bot has no
 *  way to express which one it wants to give up. */
function activationCostPicksArePaid(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const player = state.players[seat === "me" ? 0 : 1];
    const defId = getCardByName(cardName).id;
    const activations = enumerateMoves(state, player.id).filter(
        (m) =>
            m.kind === "activate-ability" &&
            player.battlefield.some(
                (c) =>
                    c.id === m.cardInstanceId &&
                    (c.card as { id?: string }).id === defId
            )
    );
    if (activations.length === 0) return false;
    const picked = new Set<string>();
    for (const move of activations) {
        if (move.kind !== "activate-ability") return false;
        const ids = move.costPicks?.discardIds;
        if (!ids || ids.length !== 1) return false;
        // The named card must really be in hand — a pick the server would
        // reject leaves the activation just as stuck as no pick at all.
        if (!player.hand.some((c) => c.id === ids[0])) return false;
        picked.add(ids[0]);
    }
    return picked.size === activations.length && picked.size >= 2;
}

/** Every permanent each enumerated activation of `cardName` would actually
 *  sacrifice, plus the source's own instance id (issue #2297).
 *
 *  Reads `activationSacrificeVictims` rather than `move.costPicks.sacrificeIds`
 *  because the two differ in exactly the case that matters: when the board
 *  leaves no real choice, the server auto-resolves the victim at announcement
 *  (`autoResolveFungible`) and it never appears in the submission list at all.
 *  Asserting on `sacrificeIds` would report "no victim" for the position where
 *  the source is the ONLY victim — a vacuous pass. */
function enumeratedSacrificeVictims(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): { sourceId: string; victims: string[][] } | null {
    const player = state.players[seat === "me" ? 0 : 1];
    const defId = getCardByName(cardName).id;
    const sources = player.battlefield.filter(
        (c) => (c.card as { id?: string }).id === defId
    );
    // Exactly one, or "the source" is ambiguous and the entry proves nothing.
    if (sources.length !== 1) return null;
    const source = sources[0];
    const victims: string[][] = [];
    for (const move of enumerateMoves(state, player.id)) {
        if (move.kind !== "activate-ability") continue;
        if (move.cardInstanceId !== source.id) continue;
        const ability = getCardByName(cardName).activatedAbilities?.find(
            (a) => a.id === move.abilityId
        );
        if (!ability) return null;
        victims.push(
            activationSacrificeVictims(
                state,
                player,
                source,
                ability,
                move.costPicks
            )
        );
    }
    return { sourceId: source.id, victims };
}

/** "A sac outlet whose whole effect is scoped to `$source` is never paid with
 *  the source itself" (issue #2297, CR 609.3) — the activation stays
 *  available, and every enumerated variant names some OTHER victim. */
function sacrificeVictimSparesTheSource(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const found = enumeratedSacrificeVictims(state, seat, cardName);
    if (!found) return false;
    if (found.victims.length === 0) return false;
    return found.victims.every(
        (v) => v.length > 0 && !v.includes(found.sourceId)
    );
}

/** "…and when the source is the only victim the board offers, the activation
 *  is not a move at all" — the same rule with nothing left to name. */
function noActivationEnumerated(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const found = enumeratedSacrificeVictims(state, seat, cardName);
    return found !== null && found.victims.length === 0;
}

/** The DISCRIMINATING HALF (issue #2297): a sac outlet whose payoff does NOT
 *  depend on its source keeps self-sacrifice enumerable. Sacrificing the last
 *  creature to an outlet that draws / adds mana / damages / reanimates is a
 *  real line (before a wrath; denying a gain-control effect), and pruning it
 *  would be invisible damage. If the guard above ever widens into a blanket
 *  ban on naming the source, this goes red. */
function selfSacrificeStaysEnumerable(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const found = enumeratedSacrificeVictims(state, seat, cardName);
    if (!found) return false;
    return found.victims.some((v) => v.includes(found.sourceId));
}

/** "A creature that already attacked this turn may attack AGAIN in the extra
 *  combat, provided it is untapped (CR 508.1a)." Asserted as a LEGALITY
 *  property — the named creature appears among the attackers the enumerator
 *  offers — never as a preference about whether the bot should send it, which
 *  would be a strength claim and seed-sensitive.
 *
 *  It also stops the CR 500.8 progress entry below from being satisfied by an
 *  EMPTY declaration: with `hasAttackedThisTurn` set and the creature untapped
 *  by vigilance, a regression that made a second attack illegal would leave the
 *  bot returning a legal-but-empty `declare-attackers` and the phase assertions
 *  alone would still pass. */
function mayAttackAgain(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const pid = seatPlayerId(state, seat);
    const ids = instanceIdsForName(state, cardName);
    const instance = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => ids.has(c.id));
    if (!instance || instance.isTapped) return false;
    if (instance.hasAttackedThisTurn !== true) return false;
    return enumerateMoves(state, pid, { pruneDominatedNoOps: true }).some(
        (m) =>
            m.kind === "declare-attackers" &&
            m.attackerIds.some((a) => ids.has(a))
    );
}

/** The exact MIRROR of {@link activationStaysAvailable} — the activation is
 *  enumerated (so the assertion is not vacuously satisfied by an illegal or
 *  unaffordable ability) AND carries the rollout-policy penalty. Written for
 *  the CR 500.8 pair below, whose two halves differ only in whether an extra
 *  combat is owed: without the mirror, "the carve-out fires" could be asserted
 *  while nothing had ever suppressed the move in the first place. */
function activationIsDiscouraged(
    state: GameState,
    seat: BladeSeat,
    cardName: string
): boolean {
    const pid = state.players[seat === "me" ? 0 : 1].id;
    const defId = getCardByName(cardName).id;
    const activations = enumerateMoves(state, pid, {
        pruneDominatedNoOps: true,
    }).filter(
        (m) =>
            m.kind === "activate-ability" &&
            state.players.some((p) =>
                p.battlefield.some(
                    (c) =>
                        c.id === m.cardInstanceId &&
                        (c.card as { id?: string }).id === defId
                )
            )
    );
    return (
        activations.length > 0 &&
        activations.every((m) => isDiscouragedRolloutMove(state, pid, m))
    );
}

export const BLADE_SCENARIOS: BladeScenario[] = [
    {
        // POSITIVE CONTROL (#1427). Deliberately the least ambiguous decision
        // in Magic: it is the bot's main phase, it has one land in hand, an
        // empty board, and nothing else it can do. Playing the land is
        // strictly non-negative (CR 305.2 — a land drop can never cost you
        // anything) and the engine guarantees it: `selectRootMove`'s
        // develop tie-break (search.ts, issue #149) takes an outcome-equal
        // `play-land` over `pass`.
        //
        // Its job is to validate the HARNESS end to end — spec → base state →
        // buildStateFromScenario → searchWithTrace → name-resolved matcher —
        // not to stress the bot. If this entry ever goes red, suspect the
        // harness (or a genuine land-drop regression) before the position.
        label: "positive-control: plays its only land on an empty board",
        spec: {
            cards: [{ name: "Forest", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        tier: "must",
        expect: { moves: [{ kind: "play-land", card: "Forest" }] },
        note: "Harness end-to-end control. Guards the issue-#149 land-drop invariant.",
    },
    {
        // STRETCH. A lone 3/3 facing an empty board: attacking is free damage
        // (no blockers, no crackback the position can produce) and passing the
        // combat step throws a turn away. It PASSES today; it is kept in the
        // stretch tier on purpose — it keeps the report-only path exercised,
        // and attacker-subset enumeration plus rollout noise make it the kind
        // of entry that can go seed-sensitive, which is exactly what this tier
        // is for. Promote it to `must` once it is proven stable across seeds.
        label: "stretch: attacks with a lone 3/3 into an empty board",
        spec: {
            cards: [
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        tier: "stretch",
        expect: {
            moves: [{ kind: "declare-attackers", card: "Hill Giant" }],
        },
        note: "Free damage: no possible blocker, no crackback in the position.",
    },
    {
        // CHARTER SCENARIO 1 (issue #1487, PRD #1423, charter gate #1434).
        //
        // Phyrexian Dreadnought is on the battlefield and its own self-ETB
        // punisher trigger (CR 118 — "sacrifice it unless you sacrifice
        // creatures with total power 12 or greater") is ON THE STACK,
        // unresolved. The bot holds Stifle and an untapped Island.
        //
        // FAIRNESS BY CONSTRUCTION (ADR 0070 §1): there is no judgement in
        // this position. Letting the trigger resolve loses the Dreadnought BY
        // FORCE — the board holds no other creature, so the punisher cost
        // (total power ≥ 12) can only be paid with the Dreadnought itself and
        // every legal answer to the may-pay sacrifices the 12/12. Countering
        // the trigger keeps a free
        // 12/12 and spends a card the position has nothing else to do with.
        // The wrong move loses a creature outright, not "on average".
        //
        // BUDGET (ADR 0070 §2): measured at authoring time to resolve
        // correctly at 100 iterations across five seeds — well inside the
        // production `DEFAULT_BUDGET = { iterations: 400 }` order of
        // magnitude. Declared BEFORE the position was tuned; never raise it
        // to make anything pass.
        //
        // SETUP (ADR 0070 §4): the trigger is put on the stack by the ENGINE
        // (`emitPermanentEntered` → `processPendingActionTriggers`, i.e.
        // `collectTriggers` + `placeTriggersOnStack`), not by a hand-built
        // StackItem. This entry is the reason `setup` exists, and it replaces
        // the hand-built state in `convex/gre/__tests__/dreadnought-stifle.bot.test.ts`
        // whose own comment admits it "mirrors processPendingActionTriggers".
        label: "charter: Stifles its own Phyrexian Dreadnought trigger",
        spec: {
            cards: [
                {
                    name: "Phyrexian Dreadnought",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Stifle", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            // One untapped Island per seat — the {U} for Stifle.
            landCount: 1,
            libraryCount: 20,
        },
        setup: [{ kind: "etb-trigger", card: "Phyrexian Dreadnought" }],
        bot: "me",
        budget: { iterations: 100 },
        // ADR 0070 §3 — a charter entry runs K≥3 seeds: if the right move is
        // forced by the rules, it must hold on ANY seed.
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Stifle",
                    target: "Phyrexian Dreadnought",
                },
            ],
        },
        note: "Charter scenario 1. Letting the trigger resolve loses the 12/12 by force (CR 118) — no judgement involved. Guards the choice-node traversal of issue #1425: before it, the playout halted at the may-pay and scored the losing line with the Dreadnought still alive.",
    },
    {
        // CHARTER SCENARIO 2 — the FETCH TARGET (issue #1491, PRD #1423,
        // charter gate #1434). The only charter entry whose root decision is a
        // CHOICE NODE: the live search-library choice of a cracked fetchland
        // (CR 701.23), reached by activating Polluted Delta through the real
        // activation path and resolving its ability (`setup` below).
        //
        // FAIRNESS BY CONSTRUCTION (ADR 0070 §1). The position is deliberately
        // narrow so that exactly one answer is FORCED, with no plan-quality
        // judgement in it. The bot's only land in play is a Mountain and its
        // only card in hand is Terror ({1}{B}). The library holds exactly one
        // Island and one Swamp the Delta can find (the rest is Plains, which
        // it cannot). Fetching the Swamp makes Terror castable THIS main
        // phase and the opponent's Hill Giant dies — by the rules, not on
        // average. Fetching the Island leaves {W}-less, {B}-less mana: Terror
        // is uncastable, the 3/3 lives, and the card in hand is dead. The
        // wrong pick loses a creature-kill outright.
        //
        // NOT a "which land does my plan want" position on purpose: a
        // realistic manabase decision pays off two or three turns later, past
        // what the search can see, which would make this a beyond-budget entry
        // rather than a blade.
        //
        // BUDGET (ADR 0070 §2): declared at the production 400. Measured at
        // authoring time to resolve correctly at 100, 200 and 400 iterations
        // across all five seeds below.
        //
        // SETUP (ADR 0070 §4): `activate` runs `activateAbilityOnState`
        // (`convex/game.ts`) — the exact function the `activateAbility`
        // mutation calls, extracted for this entry so no second copy of the
        // activation path exists. The {T} / Pay 1 life / Sacrifice cost is
        // really paid (the bot is at 19 and the Delta is in the graveyard),
        // and `resolve-top` resolves the ability through `resolveTopOfStack`,
        // which is what OPENS the choice. Nothing about the pending decision
        // is hand-built.
        //
        // SHOWN TO BITE (ADR 0070 §1): see the PR for #1491 — truncating the
        // choice node's candidate set to a single prior-ranked lead
        // (`CHOICE_TOP_K` 8 → 1, `choiceCandidates.ts`), so the prior — which
        // does not distinguish two basic lands — decides instead of the
        // search, flips the answer to Island on all five seeds and the entry
        // goes red.
        label: "charter: fetches the land that makes its removal castable",
        spec: {
            cards: [
                { name: "Polluted Delta", owner: "me", zone: "battlefield" },
                // The generic half of Terror's {1}{B}. Deliberately a colour
                // that pays no coloured pip of anything in hand, so the fetch
                // is the ONLY source of the {B}.
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Terror", owner: "me", zone: "hand" },
                // The two — and only two — cards Polluted Delta can find.
                { name: "Island", owner: "me", zone: "library" },
                { name: "Swamp", owner: "me", zone: "library" },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            // NO `libraryCount`: it would refill both libraries with basics
            // matching the board's colours (Swamps and Mountains here), which
            // would flood the fetch pool and destroy the two-candidate
            // decision. The synthetic base deck's leftover Plains are inert —
            // Polluted Delta cannot find them.
        },
        setup: [
            { kind: "activate", card: "Polluted Delta" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        // ADR 0070 §3 — K≥3 seeds on a charter entry.
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", card: "Swamp" }],
        },
        note: "Charter scenario 2 (the fetch target). Fetching the Island instead of the Swamp loses the Hill Giant kill BY FORCE: the bot's only other land is a Mountain, so Terror ({1}{B}) is uncastable without the Swamp and the 3/3 survives with the removal stranded in hand. The root decision is the live search-library choice (CR 701.23), reached by really activating and resolving the fetchland.",
    },
    {
        // DISCRIMINATING PAIR, HALF 1 of 2 (issue #1487).
        // PAIRED WITH: "discriminating pair: casts Phyrexian Dreadnought WITH
        // an out (Stifle)". NEITHER ENTRY PROVES ANYTHING ALONE — a bot that
        // never casts Dreadnought passes this one, and a bot that always casts
        // it passes the other. Only the pair distinguishes a bot that reads
        // the consequence. Deleting either half silently guts the other, which
        // is why each note names its partner.
        //
        // No Stifle, no other creature: casting the Dreadnought puts a trigger
        // on the stack whose punisher cost can only be paid by sacrificing the
        // Dreadnought itself, so every legal answer sacrifices the 12/12
        // immediately and the card is spent for nothing.
        label: "discriminating pair: does NOT cast Phyrexian Dreadnought with no out",
        spec: {
            cards: [
                { name: "Phyrexian Dreadnought", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 1,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        // Passes at its declared production-range budget. The pair is promoted
        // as a UNIT (ADR 0070 §1: a `forbidden` entry that a never-cast bot
        // also satisfies asserts nothing on its own); its partner now passes at
        // 400 too (its stale `beyondBudget` cleaned up under #1499), so both
        // are `must`.
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Phyrexian Dreadnought" }],
        },
        note: 'Half 1 of the discriminating pair — PAIRED WITH "discriminating pair: casts Phyrexian Dreadnought WITH an out (Stifle)". Neither half is meaningful alone. Both halves pass at 400 iterations across 3 seeds.',
    },
    {
        // DISCRIMINATING PAIR, HALF 2 of 2 (issue #1487).
        // PAIRED WITH: "discriminating pair: does NOT cast Phyrexian
        // Dreadnought with no out". Same position plus one card (Stifle) and
        // the mana for it: now the trigger can be countered, so casting the
        // Dreadnought is a free 12/12 and IS expected.
        label: "discriminating pair: casts Phyrexian Dreadnought WITH an out (Stifle)",
        spec: {
            cards: [
                { name: "Phyrexian Dreadnought", owner: "me", zone: "hand" },
                { name: "Stifle", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            // Two untapped Islands: {1} for the Dreadnought and {U} held up
            // for Stifle.
            landCount: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        // ADR 0070 §2 — measured, not guessed: `cast Phyrexian Dreadnought` on
        // all three seeds at 400, 800, 1600 and 3200 (monotone, no
        // converge-away). Once beyond budget with cause `horizon` (it needed
        // 1600 when authored), it is now solved at the production 400 — the
        // valuation cluster that reshaped this area (#1509 / #1520 / #1521)
        // brought the payoff inside the production budget, leaving this entry's
        // `beyondBudget` a STALE claim. This board has only basic Islands (no
        // fetchland), so the mana-proxy fix of #1499 does not touch its
        // valuation — measured identical before and after; the stale hint was
        // simply tracked to #1499 and is cleaned up here. Promoted to `must`
        // with its partner.
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Phyrexian Dreadnought" }],
        },
        note: 'Half 2 of the discriminating pair — PAIRED WITH "discriminating pair: does NOT cast Phyrexian Dreadnought with no out". Neither half is meaningful alone.',
    },
    {
        // CHARTER SCENARIO 2, TIMING HALF (issue #1488, PRD #1423, charter
        // gate #1434).
        //
        // Phyrexian Dreadnought is on the battlefield and its own self-ETB
        // punisher trigger (CR 118) is ON THE STACK, unresolved — the same
        // engine-real shape as charter scenario 1. The bot also controls a
        // Polluted Delta, its ONLY other permanent and its only route to
        // mana, and holds Stifle ({U}). The deck's only blue source is the
        // single Island seeded in the library.
        //
        // FAIRNESS BY CONSTRUCTION (ADR 0070 §1). THE FORBIDDEN MOVE LOSES A
        // CREATURE BY FORCE: if the bot passes, the opponent (empty board,
        // empty hand, no lands) passes and the trigger RESOLVES — the
        // punisher cost, sacrificing creatures with total power 12 or
        // greater, can only be paid by sacrificing the Dreadnought itself
        // (power 12, and the board's only creature), so EVERY legal answer to
        // the may-pay sacrifices the 12/12. There is no next
        // turn to defer to: the only window in which the trigger can be
        // answered is this priority round, Stifle is the only answer in the
        // position, and a fetchland has NO mana ability (CR 305.6 — a land
        // taps for mana only if it says so, and this one says "search your
        // library"), so cracking the Delta is the only way the position can
        // produce {U} at all. Passing loses the Dreadnought outright, not
        // "probably" and not "on average".
        //
        // WHY THIS POSITION AND NOT THE FIRST DRAFT (#1496 review). The
        // original siting was Bloodstained Mire + Lightning Bolt vs. a Hill
        // Giant at sorcery speed. That is a TEMPO loss, not a forced one: the
        // fetch has no timing restriction, so the bot could crack and Bolt on
        // the opponent's turn instead and lose nothing by rule. §1 rejects
        // "worse on average", so the position was re-sited onto a stack
        // decision that cannot be deferred.
        //
        // SETUP (ADR 0070 §4): the trigger is put on the stack by the ENGINE
        // (`emitPermanentEntered` → `processPendingActionTriggers`), never by
        // a hand-built StackItem.
        //
        // BUDGET (ADR 0070 §2): the production
        // `DEFAULT_BUDGET = { iterations: 400 }`, declared before measuring
        // and left there. The bot SOLVES this at 400 (K=5 seeds) and remains
        // correct at 1600 and 3200 — monotone in budget, no converge-away
        // residue — so it is a blocking `must` entry.
        //
        // WHAT WAS WRONG, AND THE FIX (issue #1499). The bot used to converge
        // AWAY from the crack as search deepened (measured 3/8 correct at 100,
        // 5/8 at 400, 1/8 at 800, 0/8 at 3200) — the signature of a MIS-VALUED
        // subtree. Root cause: the bot's coarse mana proxy counted EVERY
        // untapped land as a mana source (`isLand(perm) || hasManaAbility`),
        // so the Polluted Delta — a fetchland with NO mana ability (CR 305.6)
        // — was scored as a usable {U} source it is not. Cracking it then read
        // as a PURE 1-life loss with no offsetting gain: the phantom source it
        // sacrificed was already counted, and the real Island it fetched merely
        // replaced that phantom (the post-fetch mana term was byte-identical).
        // The leaf value of the fetch node was −8 (the life) versus passing;
        // more rollouts only reached that mis-valued leaf more reliably. The
        // fix scores a source only if it can ACTUALLY produce mana
        // (`isUntappedManaSource`, `constants.ts`): the Delta stops counting,
        // so the crack now correctly reads as +W_MANA (a real source arrives) +
        // flexibility (Stifle becomes castable) − 1 life = a net GAIN, and the
        // subtree is valued correctly. Its support is exactly zero on any board
        // whose untapped lands all produce mana (ADR 0070 §5).
        label: "charter: cracks its fetchland for the only answer to a trigger on the stack",
        spec: {
            cards: [
                {
                    name: "Phyrexian Dreadnought",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Polluted Delta", owner: "me", zone: "battlefield" },
                { name: "Stifle", owner: "me", zone: "hand" },
                // The ONE blue source in the deck, and the only card Polluted
                // Delta's "Island or Swamp" filter can find (the synthetic
                // base deck is all Plains) — so the fetch TARGET is forced
                // too. `libraryCount` is deliberately left unset: it resets
                // the library AFTER placement (`scenarioBuilder.ts`) and
                // would erase this Island, leaving the fetch nothing to find.
                { name: "Island", owner: "me", zone: "library", position: 1 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            // No basics: the fetchland must be the only route to mana.
            landCount: 0,
        },
        setup: [{ kind: "etb-trigger", card: "Phyrexian Dreadnought" }],
        bot: "me",
        // ADR 0070 §3 — a charter entry runs K≥3 seeds.
        seeds: [0xb1ade, 1, 2, 3, 4],
        budget: { iterations: 400 },
        tier: "must",
        expect: {
            moves: [{ kind: "activate-ability", card: "Polluted Delta" }],
        },
        note: "Charter scenario 2, TIMING half. Passing loses the Phyrexian Dreadnought BY FORCE: the trigger on the stack resolves this priority round, its punisher cost can only be paid by sacrificing the Dreadnought itself (the board's only creature), so every legal answer to the may-pay sacrifices the 12/12 — Stifle is the only answer that keeps it, and a fetchland produces no mana (CR 305.6) so cracking the Delta is the only route to {U} — there is no later turn to defer to. This entry does NOT exercise the choice-node priors: cracking a fetchland is an ordinary enumerated activated-ability move, and `expect` asserts the ROOT move only, so it passes regardless of what the search-library choice then finds — here the seeded Island is in any case the one card the filter can find, so that node has a single legal option and can discriminate nothing. The half that exercises those priors is the fetch TARGET, a separate entry. Do not read this one as covering the fetch charter on its own. SOLVED by issue #1499: the mana proxy no longer counts a no-mana-ability fetchland as a usable source, so cracking the Delta is valued as the net GAIN it is instead of a pure life loss — see the entry's header comment for the mis-valuation and the fix.",
    },
    {
        // CHARTER SCENARIO — the MODAL CHOICE (issue #1490, PRD #1423, charter
        // gate #1434). The root decision under test is the MODE of a modal
        // spell (CR 700.2): the bot holds Blue Elemental Blast — "Choose one —
        // Counter target red spell. • Destroy target red permanent." — and
        // must pick the mode the board calls for.
        //
        // THE POSITION. It is the opponent's turn (players[0] = "me" is the
        // active opponent; the BOT is "opp" = players[1]). The opponent casts
        // Disintegrate for X = 20 at the bot through the REAL cast pipeline
        // (the `cast` setup step, below), so a RED SPELL LETHAL TO THE BOT sits
        // on the stack, unresolved, with the bot holding priority to respond.
        // The opponent's board also holds Mons's Goblin Raiders, an irrelevant
        // red 1/1. The bot holds Blue Elemental Blast and an untapped Island
        // for its {U}.
        //
        // BOTH MODES ARE LEGAL THROUGHOUT (the trap ADR 0070 §1 / issue #1490
        // names): Counter has a legal target (Disintegrate, a red spell on the
        // stack) and Destroy has a legal target (Mons's Goblin Raiders, a red
        // permanent). The Mountains and the Island are colourless (CR 202.2),
        // so they are not red-permanent targets — Destroy's ONLY target is the
        // 1/1. The wrong mode is therefore LEGAL-AND-LOSING, never illegal:
        // the engine never removes it, so the bot choosing Counter is a real
        // choice, not the only option left.
        //
        // FAIRNESS BY CONSTRUCTION (ADR 0070 §1). The wrong mode loses THE GAME
        // by force, not on average. Counter: Disintegrate is countered, the bot
        // survives. Destroy (or pass): the 20-damage Disintegrate resolves into
        // a bot at 20 life → 0 life → the bot loses to the state-based action
        // (CR 104.3a / 704.5a). Destroy's entire accomplishment is a 1/1
        // removed while the bot dies. No judgement, no rollout margin.
        //
        // BUDGET (ADR 0070 §2): the production `DEFAULT_BUDGET = { iterations:
        // 400 }`, declared before measuring. Measured at authoring time to
        // choose Counter on ALL FIVE seeds below at 400 — the forced loss lands
        // on the VERY NEXT resolution, well inside the rollout horizon, so the
        // bot sees it without extra compute. It is a `must` entry because the
        // loss is one ply away — imminent death DOES enter the evaluation here,
        // because it is imminent. (The fetchland TIMING half (#1488) and the
        // lethal-block charter (#1489) were once `stretch` for the opposite
        // reason — a loss deeper in a subtree the rollout mis-valued — both now
        // fixed by a narrow valuation term, #1499 / #1489, and promoted to
        // `must`; this entry never depended on that defect, so it was `must`
        // from the start.)
        //
        // SHOWN TO BITE (ADR 0070 §1). The green is driven by the forced GAME
        // loss, not by the bot reflexively countering any red spell. The
        // discriminator changes ONE thing — the setup cast's `x` from 20 to 10,
        // so Disintegrate deals 10 (a bot at 20 SURVIVES; the wrong mode is no
        // longer losing). Measured: the bot then chooses `pass` on all five
        // seeds at 400 instead of Counter, and `expect: { moves: [Counter] }`
        // goes red on every seed. The entry passes ONLY while the threat is
        // lethal — exactly the property it is meant to assert.
        //
        // SETUP (ADR 0070 §4): the `cast` step runs Disintegrate onto the stack
        // through `enumerateMoves` (the production legality gate) +
        // `applyMoveInSearch` (the search's own cast application) — a spell the
        // engine really cast, not a hand-built StackItem the engine could never
        // have produced. It throws if the cast finds no purchase.
        label: "charter: picks the modal mode that survives a lethal red spell",
        spec: {
            cards: [
                // The active opponent's kill spell and the 21 Mountains that
                // pay {X}{R} at X = 20 (20 generic + {R}) — the ONLY route to a
                // 20-damage Disintegrate, so the setup cast is forced to the
                // lethal size.
                { name: "Disintegrate", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 21,
                },
                // The irrelevant red 1/1 — Destroy's only legal target, so that
                // mode stays legal-and-losing rather than illegal.
                {
                    name: "Mons's Goblin Raiders",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                // The bot: Blue Elemental Blast and the {U} to cast it.
                { name: "Blue Elemental Blast", owner: "opp", zone: "hand" },
                { name: "Island", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
        },
        setup: [
            {
                kind: "cast",
                card: "Disintegrate",
                by: "me",
                target: "opp",
                x: 20,
            },
        ],
        bot: "opp",
        // ADR 0070 §3 — a charter entry runs K≥3 seeds. If the right mode is
        // forced by the rules, it holds on any seed.
        seeds: [0xb1ade, 1, 2, 3, 4],
        budget: { iterations: 400 },
        tier: "must",
        expect: {
            // Countering the lethal Disintegrate. A `cast-spell` of Blue
            // Elemental Blast whose target is the red spell can only be the
            // Counter mode (Destroy targets a permanent, never a spell) — so
            // this both names the card and pins the mode.
            moves: [
                {
                    kind: "cast-spell",
                    card: "Blue Elemental Blast",
                    target: "Disintegrate",
                },
            ],
        },
        note: "Charter scenario (the modal choice). The wrong mode loses THE GAME by force: Blue Elemental Blast's Destroy mode removes only Mons's Goblin Raiders (a red 1/1) while the 20-damage Disintegrate resolves into the bot at 20 life and kills it (CR 104.3a); only the Counter mode — targeting the red spell on the stack — survives. Both modes are legal throughout (Counter targets the spell, Destroy the 1/1; the colourless Mountains/Island are not red-permanent targets), so the losing mode is offered and rejected, never absent. Chosen correctly on all five seeds at the production 400 budget — the loss is one resolution away, inside the rollout horizon — so this is `must`, and it does NOT cross-confirm the deeper-subtree death defects (#1488/#1499, #1489): imminent death enters the evaluation here precisely because it is imminent. Shown to bite by making the threat non-lethal (setup X 20→10): the bot then passes on all five seeds and the expectation goes red.",
    },
    {
        // CHARTER SCENARIO 4 (issue #1489, PRD #1423, charter gate #1434) — the
        // only charter entry that is an EVALUATION fix rather than a
        // choice-node fix.
        //
        // Four Craw Wurms (6/4) are attacking; the bot defends at 20 life with
        // one Grizzly Bears (2/2) untapped and an empty hand and board
        // otherwise.
        //
        // FAIRNESS BY CONSTRUCTION (ADR 0070 §1): 4 × 6 = 24 unblocked damage
        // against 20 life. Declining to block is lethal BY FORCE — CR 510.1c
        // deals it, CR 704.5a loses the game on the next SBA sweep, and the
        // position holds no instant, no mana and no life gain that could
        // change it. Blocking ANY one Wurm drops the incoming damage to 18 and
        // the bot lives at 2. There is no "probably" and no "on average" here:
        // one move loses the game outright, the other does not.
        //
        // …and it is a MATERIALLY LOSING block, which is the whole point: the
        // 2/2 dies to the 6/4 and kills nothing. Material says "don't throw the
        // creature away"; survival says "you must". Before the fix this entry
        // guards, material won.
        //
        // WHAT IT GUARDS (the measurement, issue #1489): at a declare-blockers
        // leaf the evaluation was BYTE-IDENTICAL for both moves — −1086.0 for
        // "chump" and for "take it" alike (margin −951.0, danger clock −135.0
        // in both). `declaredCombatDelta` is zero once blockers are confirmed,
        // the Danger Clock is steady-state and never reads `state.combat`, and
        // the material terms are the pre-damage snapshot. Worse, the
        // block-quality tie-break (`selectRootMove`) ranks blocks by
        // `declaredBlockDelta`, whose life clause is LINEAR and
        // lethality-blind: it priced the 24 incoming damage at 24 × W_LIFE =
        // 192 and therefore rated "die" (−192) ABOVE "chump and live" (−312).
        // The narrow-support `lethalUnblockedDelta` term (`evaluate.ts`) fixes
        // both sites; it is exactly zero in any position where a confirmed
        // block does not leave lethal damage on the table.
        //
        // BITE PROOF (ADR 0070 §1): red before the fix — at the declared 400
        // iterations the bot declined to block on 3 of these 5 seeds
        // (0xb1ade, 2, 4) and died. Non-monotonic in the budget, too: it
        // blocked on 5/5 at 100 iterations and 2/5 at 400, which is the
        // signature of a leaf carrying no signal at all and the choice falling
        // to rollout noise. Green on 5/5 seeds at 100 AND 400 after.
        //
        // BUDGET (ADR 0070 §2): the production `DEFAULT_BUDGET` itself.
        // SETUP (ADR 0070 §4): the attack is declared and priority walked to
        // the block window by the ENGINE (`applyMoveInSearch`), never by a
        // hand-seeded `combat.attackerIds`.
        label: "charter: chump-blocks to survive lethal (block or die)",
        spec: {
            cards: [
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    count: 4,
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            // No lands for either seat: no mana, no castable answer, so the
            // block is the ONLY thing that can change the outcome (and the
            // cautious-block penalty, which needs castable interaction in the
            // attacker's hand, is structurally zero here).
            landCount: 0,
            libraryCount: 20,
        },
        setup: [{ kind: "declare-attackers" }],
        // The DEFENDER is the bot: `me` (players[0]) is the active player and
        // attacks, `decidingPlayer` hands the open block window to `opp`.
        bot: "opp",
        budget: { iterations: 400 },
        // ADR 0070 §3 — a charter entry runs K≥3 seeds.
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "declare-blockers", card: "Grizzly Bears" }],
        },
        note: "Charter scenario 4 (evaluation, not choice-node). NOT blocking loses the game by force: 4 x Craw Wurm = 24 unblocked damage into 20 life (CR 510.1c / 704.5a), with no instant, mana or life gain in the position. Any single block leaves 18 and the bot lives at 2, at the cost of the 2/2 — a materially losing block that survival requires. Guards `lethalUnblockedDelta` (issue #1489): before it, the leaf evaluation was identical for both moves and the block-quality tie-break actively preferred dying.",
    },
    {
        // LIFE-DEPENDENT NEGATIVE CONTROL (issue #2147) — the exact SAME board
        // as charter scenario 4 above (4 x Craw Wurm attacking into a lone
        // Grizzly Bears), with only `life.opp` changed. This is the entry
        // `ScenarioSpec`'s missing `life` field was blocking: before #2147 no
        // scenario could pin "the bot at a life total other than 20", so a
        // life-dependent decision could only ever be tested at the default —
        // and scenario 4's own default-life board is ITSELF a case where the
        // right answer would silently flip if the field existed and nobody
        // used it: block only because 24 unblocked damage is lethal at 20.
        //
        // Here it is not. `life.opp = 40` puts the defender eleven safely
        // above the 24 incoming: taking it all leaves 16. Grizzly Bears (2/2)
        // trades with nothing — Craw Wurm is a 6/4, so the block kills
        // nothing and only prevents 6 of the 24 already-survivable damage.
        // Blocking here is a PURE material loss for zero survival benefit;
        // the correct move is to decline (an empty `declare-blockers`).
        //
        // MEASURED, NOT ASSERTED (both at `budget.iterations = 400`, seeds
        // [0xb1ade, 1, 2, 3, 4], via `runBladeScenario` on this exact board):
        //   - life.opp = 20 (scenario 4, default): the bot blocks with
        //     Grizzly Bears on ALL 5 seeds ("declare-blockers cards=[Grizzly
        //     Bears] targets=[Craw Wurm]") — it must, or it dies.
        //   - life.opp = 40 (this entry): the bot declines to block on ALL 5
        //     seeds (empty "declare-blockers", no assignments) — the same
        //     board, the same attackers, only the life total moved.
        // The chosen move flips 5/5 seeds solely on `life`; an entry that
        // opened at 4 life and "still passed" for the same reason it would at
        // 20 is exactly the silent false-green this field exists to close —
        // this entry is the other half of that pair, proving the FLIP rather
        // than one more position at the default.
        //
        // Before #2147 this position was simply unwritable: `ScenarioSpec`
        // had no way to say "opp at 40", so the only life-dependent board
        // reachable was the ambient default — which is what would have made
        // a "block or die" entry pass for the wrong reason had it been
        // authored without care.
        label: "life-dependent: does NOT chump-block when the incoming damage isn't lethal (issue #2147)",
        spec: {
            cards: [
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    count: 4,
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
            // The one line that differs from charter scenario 4: 24 unblocked
            // damage into 40 leaves 16, not a loss. `!== 20`, the base
            // state's default, is the entire point — this is the field the
            // issue exists for.
            life: { opp: 40 },
        },
        setup: [{ kind: "declare-attackers" }],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "declare-blockers", card: "Grizzly Bears" }],
        },
        note: "life-dependent negative control (issue #2147): same board as charter scenario 4 (4 x Craw Wurm vs. lone Grizzly Bears), only `life.opp` raised from the default 20 to 40. 24 unblocked damage no longer kills, so blocking (which trades the 2/2 for nothing against a 6/4) is pure material loss with zero survival benefit — the bot must decline. Measured 5/5 seeds: blocks at life 20 (scenario 4), declines at life 40 (this entry). Proves the ScenarioSpec `life` field actually reaches the built board and changes the bot's decision, not just the definition.",
    },
    {
        // DEEP LETHAL-BLOCK charter (issue #1505) — the LEAF companion to
        // charter scenario 4 above. Scenario 4's block-or-die decision sits at
        // the ROOT, where the `blockDeltaOf` tie-break (`search.ts`) fires; the
        // issue measured that removing `lethalUnblockedDelta` from `evaluate.ts`
        // while leaving `blockDeltaOf` intact keeps scenario 4 green 9/9,
        // because the root tie-break carries the term independently. This entry
        // exercises the OTHER seam: the shared leaf `evaluate` call (line ~338),
        // which is what values lethal-block positions reached DEEPER in the
        // search (inside rollouts), where `blockDeltaOf` — gated on
        // `best.move.kind === "declare-blockers"` — never fires.
        //
        // THE POSITION. It is the bot's OWN turn (`me` = players[0], the active
        // player, is the bot). The bot controls one Phantom Monster (3/3 flyer)
        // and nothing else; the opponent controls four Craw Wurms (6/4) and is
        // at 20. The bot's ROOT decision is its `declare-attackers`: swing the
        // flyer, or hold it back. The forbidden move is the GREEDY SWING.
        //
        //   * The swing is genuinely TEMPTING, not a wasteful attack (which the
        //     `isWastefulAttack` tie-break would already reject): the opponent
        //     has no flyer and no reach, so the 3/3 connects for 3 unanswered
        //     face damage. Nothing THIS turn punishes it.
        //   * But it taps the flyer, and the flyer is the bot's ONLY blocker.
        //     On the opponent's crackback the four Wurms swing for 24 into the
        //     bot's 20 (lethal, CR 510.1c/704.5a); held back, the flyer chumps
        //     one Wurm — 18 through, the bot lives at 2 — and the flyer untaps
        //     only on the bot's next turn, a turn too late. So the swing trades
        //     3 face now for the game next turn.
        //
        // WHY THE LEAF TERM, NOT THE ROOT TIE-BREAK. The root move is a
        // `declare-attackers`, so the `blockDeltaOf` block-quality tie-break is
        // structurally inert here. The only thing that can tell the search the
        // held-back line SURVIVES is the rollout: with the flyer untapped, the
        // crackback's forced chump-block must be valued as SURVIVAL rather than
        // as a materially-losing chump. That valuation is `lethalUnblockedDelta`
        // in the leaf `evaluate` (folded into `policyValue`, so it drives the
        // rollout default policy's block choice too). Without it the rollout
        // defender declines the chump — `declaredBlockDelta` alone rates 'die'
        // above 'lose the creature' (the scenario-4 measurement) — so BOTH the
        // swing and the hold-back lines end in death and the free 3 face tips
        // the bot into the swing.
        //
        // BITE PROOF (ADR 0070 §1), recorded because a `stretch` entry cannot
        // assert it live. Mutation: replace the `lethalUnblockedDelta(state,
        // playerId)` term in `evaluate` (`evaluate.ts`) with `0 *
        // lethalUnblockedDelta(...)` — the LEAF seam only; `blockDeltaOf`
        // (`search.ts`) is left calling the function untouched. At 900
        // iterations the five seeds below flip cleanly: WITH the term the bot
        // holds back on all five (survives); WITHOUT it the bot swings on all
        // five (dies). So the leaf term — not the root tie-break, which never
        // fires on a `declare-attackers` root — is exactly what this position
        // needs. (Measured on twelve seeds: WITH held 11/12 at 900, WITHOUT
        // 3/12; they reconverge to 12/12 by ~1000 once the SEARCH TREE, not the
        // rollout, expands the crackback to the real damage step and reads the
        // death off the life total directly, which is why the decisive window
        // is the rollout-reliant 900 and not higher.)
        //
        // TIER = STRETCH, cause HORIZON (ADR 0070 §2). At the production
        // `DEFAULT_BUDGET = { iterations: 400 }` the crackback is beyond the
        // rollout horizon: the bot swings on every one of these seeds and dies.
        // The payoff (surviving the crackback) only comes within reach at ~900,
        // where the rollout reliably reaches the block — so this is a genuine
        // horizon shortfall, not a priors or hidden-information one. Budget
        // STAYS at the production 400; `passesAt` records the 900 at which it
        // greens, per the ADR (raising the declared budget to force it green is
        // the forbidden move).
        label: "deep lethal block: does NOT greedily swing its only blocker",
        spec: {
            cards: [
                {
                    name: "Phantom Monster",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Craw Wurm",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                    count: 4,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        // ADR 0070 §3 — K ≥ 3 seeds. Every one of these swings at 400 (the
        // `beyondBudget` claim) and holds back at 900 WITH the leaf term / swings
        // at 900 WITHOUT it (the bite proof above).
        seeds: [1, 3, 5, 6, 8],
        tier: "stretch",
        beyondBudget: {
            cause: "horizon",
            passesAt: { iterations: 900 },
            note: "The crackback that punishes the swing is a full turn away; at the production 400-iteration budget the rollout does not reach it, so the greedy swing and the safe hold-back score alike and the free 3 face wins. The missing knowledge is depth to the payoff, not a term — `lethalUnblockedDelta` already values the pattern correctly; it only fires once the search reaches the block, which the rollout does reliably by ~900.",
        },
        expect: {
            forbidden: [{ kind: "declare-attackers", card: "Phantom Monster" }],
        },
        note: "Deep lethal-block charter (issue #1505): the LEAF companion to scenario 4. The bot's own-turn attack decision — swing the 3/3 flyer for a free 3, or hold it as the only blocker against a lethal crackback — is a `declare-attackers` root, so `blockDeltaOf` is inert; only the leaf `lethalUnblockedDelta` (via the rollout block policy) can tell the search the held-back line survives. Bite proof recorded in the block comment: at 900 iterations, WITH the leaf term the bot holds on all five seeds, WITHOUT it (0 * lethalUnblockedDelta in evaluate.ts, blockDeltaOf untouched) it swings on all five. Stretch/horizon because the crackback is beyond the 400 rollout horizon. A live-asserting regression guard for the same bite lives in `__tests__/deep-lethal-block.bot.test.ts`.",
    },
    {
        // ZERO-OUTPUT MANA SOURCE (issue #1889). The root decision is a cast
        // the bot can exactly afford: Incinerate ({1}{R}) with two untapped
        // Mountains, against an opponent creature that must be answered.
        //
        // THE TRAP. The bot also controls an Everflowing Chalice with NO
        // charge counters. Its ability reads "{T}: Add {C} for each charge
        // counter on this artifact" (CR 106.1 — a board-conditional
        // `manaAmount` hook), so its CURRENT output is {C}0: it may legally be
        // activated (CR 605.1a does not forbid a pointless activation) but it
        // can pay for nothing. Before #1889 the engine offered it anyway — a
        // zero-output entry in `getManaTapOptionsDetailed` — so the auto-tap
        // solver enumerated it as a contributing source, tapped it, gained
        // nothing, left the cost unpaid, and the bot abandoned the cast; and
        // the coarse mana proxy (`isUntappedManaSource`) counted it as one
        // more available mana in `evaluate`, inflating the position.
        //
        // WHY THIS POSITION. Same discipline as the fetchland charter above
        // (#1499): the phantom source is the ONLY thing that can mis-value
        // the line. Removal at exactly-affordable cost makes the payment
        // path — not a tempo judgement — the thing under test.
        //
        // BUDGET (ADR 0070 §2). The production 400-iteration budget, K = 5
        // seeds. The decision is a payment-legality question, not a depth
        // one, so it is stable at budget.
        label: "zero-output mana source: casts its removal instead of tapping a 0-counter Everflowing Chalice",
        spec: {
            cards: [
                {
                    name: "Everflowing Chalice",
                    owner: "me",
                    zone: "battlefield",
                },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 2,
                },
                { name: "Incinerate", owner: "me", zone: "hand" },
                {
                    name: "Serra Angel",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            // No extra basics: the two Mountains must be the whole mana base,
            // so the Chalice is the only other thing that looks like a source.
            landCount: 0,
        },
        bot: "me",
        seeds: [0x1889, 1, 2, 3, 4],
        budget: { iterations: 400 },
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Incinerate" }],
        },
        note: "Issue #1889 regression guard, in the reported shape: the bot holds a castable removal spell, the board has a 0-counter Everflowing Chalice plus JUST ENOUGH lands, and the bot must cast rather than stall. A mana ability whose CURRENT output is zero is not a payment source: `getManaTapOptionsDetailed` drops the option, so `buildAutoTapSources` never enumerates the 0-counter Everflowing Chalice, and the board-aware `isUntappedManaSource` stops counting it as one available mana in `evaluate`. Support is exactly zero on any board with no board-conditional (`manaAmount`) source — the same narrow-support discipline #1499 used for the fetchland. It is a POSITION guard, not a discriminator: measured at authoring time it also passes on the pre-#1889 engine, because the search-side payment planner (`getProducibleManaOptions`, rules.ts) already filtered zero-AMOUNT colours out of its map even while `getManaTapOptionsDetailed` still emitted the option. The engine paths that did NOT filter — `buildAutoTapSources` (autoTap.ts, the real server auto-tap the bot driver calls) and the coarse `isUntappedManaSource` proxy in `evaluate` — are pinned by the discriminating unit regressions in `convex/gre/__tests__/zeroOutputManaSource.test.ts`. This entry exists so the whole position stays solved end to end through the real search.",
    },

    // ── Dominance pruning (issue #1887) ──────────────────────────────────
    // The bot used to spend a card, the mana and the turn on a cast whose
    // resolution is a PROVABLE no-op, because the reward band saturates and a
    // no-op cast ties `pass` inside `OUTCOME_EPS`. `isDominatedNoOpMove`
    // (`gre/ai/dominance.ts`) proves the tie away at ENUMERATION, so the search
    // never sees the move. Each futile entry below is paired with a NEGATIVE
    // CONTROL in the same position shape but with the futility removed — the
    // pruning must have exactly-zero effect there.
    {
        label: "dominance: does not cast Damnation into an empty board",
        spec: {
            cards: [{ name: "Damnation", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Damnation" }] },
        note: "Issue #1887, symptom 1. With no creature on either battlefield, resolving Damnation changes nothing but the mover's own hand/graveyard/mana — dominated by `pass` by construction, so the move never reaches the tree.",
    },
    {
        label: "dominance NEGATIVE CONTROL: still casts Damnation into a real board",
        spec: {
            cards: [
                { name: "Damnation", owner: "me", zone: "hand" },
                {
                    name: "Craw Wurm",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                    count: 3,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Damnation" }] },
        note: "Issue #1887 negative control. Three Craw Wurms is 18 power of incoming; the sweeper is not close. Guards the dominance seam against over-pruning — the probe must find a real delta (three permanents leave the battlefield) and keep the move.",
    },
    {
        label: "dominance: does not cast Sheoldred's Edict at an empty opponent",
        spec: {
            cards: [{ name: "Sheoldred's Edict", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Sheoldred's Edict" }],
        },
        note: "Issue #1887, symptom 2. Modal (CR 700.2d): the mode is chosen at cast, so each mode is a separate enumerated move and EVERY one of them proves a no-op against an opponent with no creature and no planeswalker.",
    },
    {
        label: "dominance NEGATIVE CONTROL: still casts the Edict at a real creature",
        spec: {
            cards: [
                { name: "Sheoldred's Edict", owner: "me", zone: "hand" },
                {
                    name: "Craw Wurm",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (_move, state) => pruningKeepsACast(state),
            describe: "the dominance pruner leaves a castable Edict mode",
        },
        note: 'Issue #1887 negative control for the modal shape (CR 700.2d — the mode is chosen at cast, so each mode is its own enumerated move). The "sacrifice a creature" mode makes the opponent lose its only creature, so it is NOT a no-op and must survive; the "sacrifice a planeswalker" mode against an opponent with no planeswalker still IS one and is correctly dropped — which is why this asserts a surviving cast rather than a byte-identical move list. Asserted on the legal set rather than on the chosen move because the Edict is an INSTANT: holding it through the bot\'s own main phase is legitimate play (the ADR 0021 hold-the-trick rule), so the pick is seed-sensitive while the legal set is not.',
    },
    {
        label: "dominance: does not activate Sandstorm Salvager with no tokens out",
        spec: {
            cards: [
                {
                    name: "Sandstorm Salvager",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [
                { kind: "activate-ability", card: "Sandstorm Salvager" },
            ],
        },
        note: 'Issue #1887, symptom 3. "{2}, {T}: Put a +1/+1 counter on each creature token you control" over an EMPTY token set: the forEach body never runs, so the activation costs a tap and {2} for nothing.',
    },
    {
        label: "dominance NEGATIVE CONTROL: activates the Salvager once a token exists",
        spec: {
            cards: [
                {
                    name: "Sandstorm Salvager",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        // The Golem arrives through the card's OWN ETB trigger, resolved by the
        // real engine — never a hand-seeded token (ADR 0070 §4).
        setup: [
            { kind: "etb-trigger", card: "Sandstorm Salvager" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "activate-ability", card: "Sandstorm Salvager" }],
        },
        note: "Issue #1887 negative control for the activated-ability shape: with a 3/3 Golem token out the same activation adds a +1/+1 counter and trample — a real delta the probe must find, so the move survives enumeration and the search takes the free upside.",
    },
    {
        label: "dominance: does not cast Shallow Grave into a creature-less graveyard",
        spec: {
            cards: [{ name: "Shallow Grave", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 1000 },
        seeds: [0xb1ade, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Shallow Grave" }] },
        note: "Issue #2490. `moveZone`'s positional scan finds no creature to return, so `$revived` never binds — the `grantAbility`/`delayedTrigger` Ops that read it skip in turn (CR 608.2b). Before the fix the `delayedTrigger` Op scheduled \"exile it\" regardless, leaving an INERT `delayedTriggers[]` entry (would fire at the next end step and exile nothing) as the only difference from `pass` — residue that defeated this exact dominance proof and let the bot spend the card, the mana and the turn for nothing. The wider budget/seed set (vs. the 200/5-seed Damnation shape) is load-bearing here, not decoration: at 200 iterations x 5 seeds the pre-fix bug happened not to surface (measured — all 5 landed on the `pass` side of the tie); at 1000 x 10 seeds the pre-fix code chose the futile cast on 7 of 10 (verified by hand, reverting the interpreter fix — see PR #2490's receipt).",
    },
    {
        label: "dominance NEGATIVE CONTROL: still casts Shallow Grave onto a creature in the graveyard",
        spec: {
            // Griselbrand (also the GRE per-card test's reanimation target,
            // `mir/black.test.ts`): a hasty 7/7 flier that can pay life to
            // draw 7 cards with NO combat required, so the payoff is visible
            // to `evaluate` immediately — not contingent on rollout depth
            // reaching an actual attack step before the end-of-turn exile.
            cards: [
                { name: "Shallow Grave", owner: "me", zone: "hand" },
                { name: "Griselbrand", owner: "me", zone: "graveyard" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (_move, state) => pruningKeepsACast(state),
            describe: "the dominance pruner leaves a castable Shallow Grave",
        },
        note: "Issue #2490 negative control, pair (b): reanimating Griselbrand is a genuine board-state delta (independent of the delayedTriggers fix), so the cast survives dominance pruning. Asserted on the surviving legal set rather than the chosen move because Shallow Grave is an INSTANT (ADR 0021 hold-the-trick) — the same reasoning as the Edict negative control above; at this budget the search is not required to prefer proactively reanimating over holding the instant.",
    },
    {
        label: "dominance NEGATIVE CONTROL: a delayed-trigger card whose residue is NOT inert still casts (Battle Cry)",
        spec: {
            cards: [{ name: "Battle Cry", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (_move, state) => pruningKeepsACast(state),
            describe: "the dominance pruner leaves a castable Battle Cry",
        },
        note: 'Issue #2490 negative control against the OTHER wrong fix considered and rejected for this issue: blanket-adding `delayedTriggers` to `IGNORED_STATE_KEYS` in dominance.ts. With no white creature on the caster\'s battlefield, "untap all white creatures you control" iterates an empty set — the ENTIRE delta from `pass` is the scheduled "this-turn-creature-blocks" repeating delayed trigger itself (no `capture`, so the #2490 fix cannot touch it either): a real, armed effect, not residue. Blanket-ignoring the field would make this indistinguishable from `pass` and wrongly prune it — verified by hand: injecting that exact change into `IGNORED_STATE_KEYS` made the dominance unit test (`dominance.bot.test.ts`) fail on exactly this shape. Asserted on the surviving legal set rather than the chosen move because Battle Cry is an INSTANT: holding it for a real combat is legitimate play (ADR 0021 hold-the-trick), same reasoning as the Edict negative control above.',
    },

    // ── Cast-variant ranking (issue #1888) ────────────────────────────────
    // `enumerateCastMoves` emits one move per (mode × X × target-tuple), so
    // every announcement answer is a SIBLING move of the same card. Nothing
    // ranked them: they saturate the reward band together, tie inside
    // `OUTCOME_EPS`, and the pick fell to rollout noise — one bug with four
    // faces. `castVariantScore` (`search.ts`) ranks them by resolved material
    // payoff plus the per-Op beneficence sign (`ai/beneficence.ts`).
    {
        label: "cast variant: enchants its OWN land with Wild Growth",
        spec: {
            cards: [
                { name: "Wild Growth", owner: "me", zone: "hand" },
                {
                    name: "Forest",
                    owner: "me",
                    zone: "battlefield",
                    count: 2,
                },
                {
                    name: "Mountain",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [
                { kind: "cast-spell", card: "Wild Growth", target: "Mountain" },
            ],
        },
        note: "Issue #1888, symptom 1. Wild Growth's mana accrues to the ENCHANTED LAND's controller (CR 605.4, `manaBonusForPotential`), so enchanting a Mountain hands the opponent a Rampant Growth. The evaluator cannot see the difference — the aura permanent is the bot's either way, and the `mana` term counts untapped SOURCES, not the extra {G} — so both casts tie inside `OUTCOME_EPS` and the pick was noise. Asserted as `forbidden` rather than a positive Forest match because holding a 1-mana aura for a turn is legitimate play; giving it to the opponent never is.",
    },
    {
        label: "cast variant: casts Flash of Insight at X ≥ 1, never X = 0",
        spec: {
            cards: [
                { name: "Flash of Insight", owner: "me", zone: "hand" },
                {
                    name: "Island",
                    owner: "me",
                    zone: "battlefield",
                    count: 5,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move) =>
                !(
                    move?.kind === "cast-spell" &&
                    (move.chosenX ?? 0) === 0 &&
                    move.tapPlan.length > 0
                ),
            describe: "no X = 0 cast (which pays {1}{U} and does nothing)",
        },
        note: 'Issue #1888, symptom 2. "Look at the top X cards … put one into your hand" at X = 0 looks at nothing and draws nothing, so the branch is dominated by `pass` in exactly the #1887 sense — but the probe used to REFUSE Flash of Insight outright because it declares `additionalCosts`. Those costs (`flashbackExileFromGraveyard`) are owed only on a graveyard cast (CR 601.2a), and `applyProbeCast` casts from HAND, so they are vacuous on this path: `additionalCostsAreVacuousFromHand` (`ai/dominance.ts`) now lets the probe run and X = 0 is pruned at enumeration. This entry is a POSITION GUARD, not fully discriminating on its own — the X = 0 cast was one noise-tie among many — so the prune itself is pinned deterministically by `dominance.bot.test.ts`.',
    },
    {
        label: "cast variant: picks Vision Charm's mill mode at the opponent",
        spec: {
            cards: [
                { name: "Vision Charm", owner: "me", zone: "hand" },
                {
                    name: "Island",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [
                { kind: "cast-spell", card: "Vision Charm", target: "me" },
            ],
        },
        note: "Issue #1888, symptoms 3 and 4, plus the HARMFUL-at-the-opponent negative control. Vision Charm's three modes are three separate enumerated moves (CR 700.2d); `mill` is `harmful`, so milling ITSELF four cards is a misdirected slot and is ranked below the same mode aimed at the opponent — while the correct opponent-targeting is never suppressed, because the rule is a preference among outcome-equal siblings and never a filter. The land-type mode (which moves no material) loses on the resolved-payoff term.",
    },
    {
        label: "cast variant: Ancestral Recall draws for the BOT, not the opponent",
        spec: {
            cards: [
                { name: "Ancestral Recall", owner: "me", zone: "hand" },
                {
                    name: "Island",
                    owner: "me",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [
                { kind: "cast-spell", card: "Ancestral Recall", target: "opp" },
            ],
        },
        note: 'Issue #1888 sign check for the BENEFICIAL direction: `{ op: "draw", player: { target: 0 } }` is a gift, so the opponent slot is the misdirected one. This entry is a POSITION GUARD rather than a discriminating blade — three cards in the opponent\'s hand is a material swing the evaluator already sees, so the pre-fix bot mostly got it right too. It is here because it is the one shape that fails LOUDLY if the beneficence sign is ever inverted. The genuinely discriminating negative control — a misdirected variant that strictly out-rewards its siblings must still be chosen, i.e. the rule is never a filter — is a deterministic unit test (`selectRootMove` in `search.bot.test.ts`), since a blade cannot construct a reward gap on purpose.',
    },
    {
        label: "stretch: Chrome Mox imprints a card rather than nothing",
        spec: {
            cards: [
                { name: "Chrome Mox", owner: "me", zone: "battlefield" },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        // The choice arrives through the card's OWN imprint trigger, resolved
        // by the real engine (ADR 0070 §4) — never a hand-seeded pendingChoice.
        setup: [
            { kind: "etb-trigger", card: "Chrome Mox" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        beyondBudget: {
            cause: "valuation",
            note: "The PRIOR half of issue #1888 item 3 is done and is pinned deterministically in `ai/__tests__/beneficence.bot.test.ts`: the imprint pick is now an in-tree decision at all (`choose-hand-card` optional picks got a candidate generator — before, the client's minimal-legal policy answered every one of them with the empty submission), and the empty branch is PROVED a no-op by the dominance probe one level down and floored to `PRIOR_MIN` instead of sitting at `NEUTRAL_PRIOR`. What still declines the imprint is VALUATION, not ordering: `evaluate`'s `hand` term prices Lightning Bolt at its full `cardValue` while the Mox it powers is worth one `W_MANA` untapped source, so exiling the card reads as a strictly losing trade at every budget. Raising the budget converges harder on the wrong answer — the defining `valuation` signature. Promote to `must` in the PR that teaches the evaluator what a permanent mana source is worth.",
        },
        expect: {
            moves: [{ kind: "resolution-choice", card: "Lightning Bolt" }],
        },
        note: "Issue #1888, symptom 3 (the degenerate-branch penalty) at a live choice node.",
    },
    // -----------------------------------------------------------------------
    // Activation timing (issue #1890). Four entries, in strict pairs: the
    // misplay, then the negative control that proves the fix is not a mute
    // button. Nothing under test reads a card name — Mother of Runes is a
    // fixture for "a {T} instant-speed ability whose effect expires this turn"
    // and Mishra's Factory for "an `animatesSelf` one".
    // -----------------------------------------------------------------------
    {
        label: "activation timing: holds Mother of Runes at sorcery speed",
        spec: {
            cards: [
                {
                    name: "Mother of Runes",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Mother of Runes" }],
        },
        note: "Issue #1890, symptom 1. The bot's own precombat main, empty stack, nothing declared: the protection has nothing to answer, so granting it now taps Mother out of being an answer for the rest of the turn and buys a keyword against a colour nobody has cast. It is until END OF TURN, so it moves no material either — the activation and `pass` tied inside `OUTCOME_EPS` and the pick was rollout noise. DISCRIMINATING: measured RED on the pre-fix engine at all five seeds (it protected itself on four of them and the Hill Giant on the fifth), green after.",
    },
    {
        label: "activation timing: Mother of Runes stays available against removal on the stack",
        spec: {
            cards: [
                {
                    name: "Mother of Runes",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        // The Bolt reaches the stack through the REAL cast pipeline (ADR 0070
        // §4), so the position is the one a live game would produce — including
        // the priority hand-off: the caster's window auto-passes (CR 117.3c),
        // which is what puts the DEFENDING seat on the clock with a removal
        // spell aimed at its creature. The seats are inverted relative to the
        // entry above (`me` is always the active player in a `ScenarioSpec`, and
        // only the priority holder has a legal cast), so the bot plays `opp`.
        setup: [
            {
                kind: "cast",
                card: "Lightning Bolt",
                by: "me",
                target: "Mother of Runes",
            },
        ],
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (_move, state) =>
                activationStaysAvailable(state, "opp", "Mother of Runes"),
            describe:
                "the Mother activation is still enumerated in the response window and carries no rollout-policy penalty",
        },
        note: "Issue #1890 NEGATIVE CONTROL for the entry above — the same ability in the window where it BELONGS: a red removal spell on the stack aimed at its own source, on the opponent's turn. Asserted on the POSITION rather than the chosen move: what it pins is that the timing rules never touched legality and never penalised the reactive window. NOT DISCRIMINATING by construction — green before and after — which is exactly the job of a mute-button guard. It asserts enumeration, so a regression that left the move offered but made the bot CHOOSE `pass` here would slip past it; when this note was written that half was unassertable, because `applyMoveInSearch` never put the ability's effect on the stack (issue #1920). It is now covered directly by `activation payoff: Mother of Runes protects itself against removal on the stack` below, which asserts the CHOSEN move in this very position. Keep both: this one guards enumeration, that one guards the choice.",
    },
    // --- Activation PAYOFF (issue #1920) ------------------------------------
    // The group that could not exist before #1920. `applyMoveInSearch` now puts
    // an activated ability on the stack and `policyValue` resolves it one ply
    // deep, so the search can finally see what an activation BUYS — which makes
    // the chosen move, not merely the legal set, an assertable property in a
    // reactive window. Each entry below was measured on the pre-#1920 engine;
    // the ones that flip are marked DISCRIMINATING with their seed counts.
    {
        label: "activation payoff: Mother of Runes protects itself against removal on the stack",
        spec: {
            cards: [
                {
                    name: "Mother of Runes",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        setup: [
            {
                kind: "cast",
                card: "Lightning Bolt",
                by: "me",
                target: "Mother of Runes",
            },
        ],
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "activate-ability",
                    card: "Mother of Runes",
                    target: "Mother of Runes",
                },
            ],
        },
        note: "Issue #1920, the CHOICE half of the Mother negative control directly above. Same position, but asserting the chosen move: with a Bolt on the stack aimed at her, Mother protects herself and the Bolt fizzles on an illegal target (CR 608.2b / 702.16b). DISCRIMINATING: measured on the pre-#1920 engine at 4 of 5 seeds green and seed 0xb1ade RED (it passed and let her die) — precisely the documented failure shape, an activation tying `pass` inside `OUTCOME_EPS` with the pick falling to rollout noise. Green on all 5 seeds after. Worth reading as the pin on the WEAKEST link in this change: Mother's payoff sits behind a mid-resolution colour choice (CR 601.2b), so `policyValue`'s one-resolution lookahead sees NO payoff here at all — this entry passes because the deeper tree answers the choice node and resolves the Bolt. What makes the 1-ply leaf non-negative is the in-flight clause of the board flexibility term (`hasFlexibleActivation`, `gre/evaluate.ts`); without it the activation scores exactly W_FLEX below `pass` and drops out of `selectRolloutMove`'s exact-equality bucket.",
    },
    {
        label: "activation payoff: Prodigal Sorcerer zaps in response to removal aimed at it",
        spec: {
            cards: [
                {
                    name: "Prodigal Sorcerer",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Mons's Goblin Raiders",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        setup: [
            {
                kind: "cast",
                card: "Lightning Bolt",
                by: "me",
                target: "Prodigal Sorcerer",
            },
        ],
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "activate-ability",
                    card: "Prodigal Sorcerer",
                    target: "Mons's Goblin Raiders",
                },
            ],
        },
        note: "Issue #1920, use-it-or-lose-it. Tim is about to die to a Bolt on the stack, so his {T} ping is worth exactly one more activation and the only question is WHERE it goes: into the opposing 1/1, which it kills outright, rather than at a face at 20 life. The TARGET is the assertion and it is the whole point — DISCRIMINATING: on the pre-#1920 engine the bot chose the activation on all 5 seeds but aimed it at the opponent's FACE on 3 of them (seeds 1, 2, 3), because with no payoff resolving, every target of a zap that deals no damage scores identically and the pick is noise. After, all 5 seeds kill the Goblin. This is the cleanest demonstration that the payoff is genuinely visible rather than merely tie-broken: the margin at the policy level is +140.5 for killing the 1/1 versus +38 for `pass`, against a W_FLEX of 6.",
    },
    {
        label: "activation payoff: Iron-Shield Elf saves itself from removal on the stack",
        spec: {
            cards: [
                {
                    name: "Iron-Shield Elf",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Grizzly Bears", owner: "opp", zone: "hand" },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 3,
            libraryCount: 20,
        },
        setup: [
            {
                kind: "cast",
                card: "Lightning Bolt",
                by: "me",
                target: "Iron-Shield Elf",
            },
        ],
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "activate-ability", card: "Iron-Shield Elf" }],
        },
        note: "Issue #1920, the discard-cost mirror of the Mother entry: the Elf pays a card from hand to give itself indestructible until end of turn (CR 702.12b), which is worth paying with a Bolt already on the stack aimed at it. DISCRIMINATING and the strongest single result in this change: RED on ALL 5 seeds on the pre-#1920 engine — the bot passed and let the Elf die every time, because the discard was a visible cost and the indestructible was an invisible payoff — and green on all 5 after. Its NEGATIVE CONTROL is `activation timing: does not activate Iron-Shield Elf with no threat` below; the pair is what proves the fix bought discrimination rather than a blanket bias toward activating.",
    },
    {
        label: "activation timing: does not activate Iron-Shield Elf with no threat",
        spec: {
            cards: [
                { name: "Iron-Shield Elf", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Iron-Shield Elf" }],
        },
        note: "Issue #1920 NEGATIVE CONTROL for the entry above — and the pair is where the discrimination lives, not this entry alone. The reactive entry is RED on all 5 seeds pre-#1920 and green after; this one is green on all 5 both before and after. Together they say the fix bought DISCRIMINATION (activate when a threat is on the stack, not otherwise) rather than a blanket bias toward activating, which is exactly the failure mode making a payoff visible invites: the indestructible grant is a KEYWORD, so `evaluateCreature` prices it as material, and at the 1-ply policy level this activation measures +22 ABOVE `pass` in this very position. READ WITH CARE — this entry is a tripwire, not a tight guard. Measured insensitive to two deliberate breaks: disabling issue #1890 item 1's rollout guardrail (`isDiscouragedRolloutMove`) and making activation costs free again (reverting #2155's payment in the leaf) BOTH leave it green on all 5 seeds, because the root prefers `pass` here by a margin wider than either. Do not cite it as the pin on the guardrail or on cost payment; those are pinned in `activationCostsInSearch.bot.test.ts` and `activationPayoffInSearch.bot.test.ts`. Recorded in docs/findings/1920-noThreat-blade-entries-insensitive.md.",
    },
    {
        label: "defensive grant: does NOT buy indestructible for an UNBLOCKED attacker",
        spec: {
            cards: [
                {
                    name: "Iron-Shield Elf",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Plains", owner: "me", zone: "hand" },
                {
                    name: "Mons's Goblin Raiders",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 3,
            libraryCount: 20,
        },
        setup: [
            { kind: "declare-attackers", cards: ["Iron-Shield Elf"] },
            { kind: "declare-blockers" },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Iron-Shield Elf" }],
        },
        note: "Issue #2937, the position the pre-existing `does not activate Iron-Shield Elf with no threat` entry cannot express: blocks are already DECLARED and the Elf is unblocked, so the sorcery-window guardrail (`isDiscouragedRolloutMove`, issue #1890 item 1) does not fire and the activation is judged on value alone. Nothing will deal the Elf damage this turn and nothing is on the stack, so discarding a card AND tapping it buys nothing — this is the exact position `ai/defensiveGrants.ts` calls QUIET and the flat `KEYWORD_BONUS` credit is taken back off in. The discard fodder is deliberately the CHEAPEST card that can pay the cost (a spare land) rather than a real spell. Ships as a DISCRIMINATING PAIR with the entry below, which is the same board one block declaration apart. READ WITH CARE, exactly like the #1920 controls above: MEASURED insensitive to the valuation change it ships with — restoring the flat, threat-blind credit leaves BOTH halves of this pair green on all 5 seeds, because the root prefers each answer by a margin wider than 30 either way. The mechanism is pinned in `ai/__tests__/defensiveGrants.bot.test.ts` (proven breaks); this pair pins the POSITIONS, so a future change that collapses them into one answer is caught.",
    },
    {
        label: "defensive grant NEGATIVE CONTROL: buys indestructible against a lethal block",
        spec: {
            cards: [
                {
                    name: "Iron-Shield Elf",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Plains", owner: "me", zone: "hand" },
                {
                    name: "Mons's Goblin Raiders",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 3,
            libraryCount: 20,
        },
        setup: [
            { kind: "declare-attackers", cards: ["Iron-Shield Elf"] },
            {
                kind: "declare-blockers",
                blocks: [
                    {
                        blocker: "Mons's Goblin Raiders",
                        attacker: "Iron-Shield Elf",
                    },
                ],
            },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "activate-ability", card: "Iron-Shield Elf" }],
        },
        note: "Issue #2937, the mirror half of the pair above — the SAME board, one block declaration apart. The 1/1 Raiders is lethal to a 3/1 Elf (CR 510.1c / 704.5g), so a spare land is a cheap price for keeping the body: with indestructible the Elf survives the exchange and the Raiders still dies. Combat damage is headed at the Elf, so the position is NOT quiet and the grant keeps the full flat worth `main` gives it — this half is what makes the correction a narrowing rather than a blanket demotion of every defensive grant.",
    },
    {
        label: "activation timing: does not crack Sylvan Safekeeper with no threat",
        spec: {
            cards: [
                { name: "Sylvan Safekeeper", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [
                { kind: "activate-ability", card: "Sylvan Safekeeper" },
            ],
        },
        note: "Issue #1920 regression guard, the sacrifice-cost sibling of the Iron-Shield Elf control above: with nothing on the stack, sacrificing a land to give a creature shroud buys nothing and permanently costs a mana source. It is here because the cost half of this exact card (#2422, the bot sacrificing a land to Safekeeper with an empty stack) is a SHIPPED bug this change could plausibly have reopened from the payoff side — the shroud grant is now visible material. It does not: `pass` on all 5 seeds before and after. Same caveat as the Elf control above, and stronger here — this position is FAR from the decision boundary: with activation costs made free again AND the rollout guardrail disabled, the bot still passes on all 5 seeds. Treat it as a tripwire against a much larger future mis-valuation, not as a proof about any single mechanism. Its discriminating mirror is the entry below (issue #2938): the same two permanents with a Bolt on the stack aimed at the Bears, where the activation IS the expected move. When this note was first written that mirror could not be shipped — the bot passed there too, on all 5 seeds — and the cause was NOT the valuation: shroud gained in response did not make the Bolt fizzle at all (CR 608.2b), so paying a land bought literally nothing. Issue #2942 fixed the rules half; the pair discriminates now.",
    },
    {
        label: "activation payoff: cracks Sylvan Safekeeper against removal on the stack",
        spec: {
            cards: [
                {
                    name: "Sylvan Safekeeper",
                    owner: "opp",
                    zone: "battlefield",
                },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 3,
            libraryCount: 20,
        },
        // The Bolt reaches the stack through the REAL cast pipeline (ADR 0070
        // §4). The seats are inverted relative to the control above for the
        // same forced reason the #1890 Mother of Runes pair inverts them: `me`
        // is always the active player in a `ScenarioSpec`, and only the
        // priority holder has a legal cast, so the seat holding the Safekeeper
        // has to be `opp` for the threat to exist at all.
        setup: [
            {
                kind: "cast",
                card: "Lightning Bolt",
                by: "me",
                target: "Grizzly Bears",
            },
        ],
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            // The target is PINNED, exactly as the analogous Mother of Runes
            // payoff entry pins it: the ability reads "target creature you
            // control", so the Safekeeper itself is a second legal target, and
            // an activation aimed there would sacrifice a land and still let
            // the Bears die while satisfying a card-only matcher.
            moves: [
                {
                    kind: "activate-ability",
                    card: "Sylvan Safekeeper",
                    target: "Grizzly Bears",
                },
            ],
        },
        note: "Issue #2938, the DISCRIMINATING mirror of the no-threat control above — the same two permanents, one Bolt apart. Sacrificing a land is the textbook use of the ability here: the Bears gains shroud, the Bolt has no legal target on resolution and is countered by the game rules (CR 608.2b), and a 2/2 outlives a spare mana source. Chooses the activation on all 5 seeds. It is a REAL pair, not a tripwire: the two positions differ only in whether a threat is live, and the bot answers them differently. What makes it assertable is a RULES change, not a bot one — until #2942 the shroud grant did not counter the targeting spell, so the bot passing here was the correct play in this engine and teaching it to pay would have been teaching it a lie (the measurement is in #2938's investigation comment). Breaking the CR 608.2b protection re-check in `isTargetStillLegal` (`convex/gre/state.ts`) turns this entry red on all 5 seeds while the control above stays green — that is the proof this asserts the payoff and not the cost. The finding this retires is docs/findings/1920-safekeeper-reactive-depth.md (declined).",
    },
    {
        label: "activation timing: does not animate Mishra's Factory after its own combat",
        spec: {
            cards: [
                { name: "Mishra's Factory", owner: "me", zone: "battlefield" },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Mishra's Factory" }],
        },
        note: "Issue #1890, symptom 2. The bot's combat is over, so the 2/2 the animation buys can neither attack (no combat left this turn) nor block (an active player never blocks on their own turn); all it does is spend {1} and expose a land to removal and damage. That is a small NEGATIVE the saturating reward band cannot see, so it tied `pass` and won on noise. Deliberately NOT routed through the `ai/dominance.ts` exact-equality proof (issue #1887): the animation genuinely changes the board, so calling it futile is a judgement about the rest of the turn, not a proof. DISCRIMINATING: measured RED on the pre-fix engine at four of these five seeds, green after.",
    },
    {
        label: "activation timing: Mishra's Factory stays available before combat",
        spec: {
            cards: [
                { name: "Mishra's Factory", owner: "me", zone: "battlefield" },
            ],
            phase: "BEGINNING_OF_COMBAT",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (_move, state) =>
                activationStaysAvailable(state, "me", "Mishra's Factory"),
            describe:
                "the animation is still enumerated before combat and carries no rollout-policy penalty",
        },
        note: "Issue #1890 NEGATIVE CONTROL for the entry above — the SAME activation one step earlier, where the body it buys can still attack. Both suppressing rules are scoped away from this window (the guardrail's sorcery-speed branch needs a MAIN phase with an empty stack; the pointless-animation branch needs the mover's combat to be already over), and this entry is what fails if either ever widens. Position-asserted for the same measured reason as the Mother control: `applyMoveInSearch` never puts an activated ability's effect on the stack, so the search cannot see the 2/2 the animation would produce and a chosen-move assertion here would be riding rollout noise. NOT DISCRIMINATING by construction.",
    },
    {
        // CR 500.8 (issue #2886) — the DISCRIMINATING HALF of the pair below,
        // and the guard that the carve-out did not simply switch the rule off:
        // at the END_OF_COMBAT exit with NOTHING queued, the mover's combat
        // really is over and the issue-#1890 suppression must still fire.
        label: "activation timing: still declines to animate Mishra's Factory at end of combat with no extra combat owed",
        spec: {
            cards: [
                { name: "Mishra's Factory", owner: "me", zone: "battlefield" },
            ],
            phase: "END_OF_COMBAT",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            predicate: (_move, state) =>
                activationIsDiscouraged(state, "me", "Mishra's Factory"),
            describe:
                "the animation is enumerated at END_OF_COMBAT but carries the rollout-policy penalty, because no extra combat is owed",
        },
        note: "CR 500.8 pair, negative half (issue #2886). Position-asserted for the same measured reason as its siblings above — `applyMoveInSearch` never puts an activated ability's effect on the stack, so a chosen-move assertion here would ride rollout noise.",
    },
    {
        // CR 500.8 (issue #2886) — the POSITIVE half. `isPointlessSelfAnimation`
        // (search.ts) reads END_OF_COMBAT as "their combat is over"; with an
        // extra combat OWED that premise is false, so the body this animation
        // buys does get an attack after all and the suppression must lift.
        // ADR 0111 / #2884 asserted no monotonic phase assumption existed
        // anywhere in the bot; this is the one that did, and this entry is what
        // goes red if it comes back.
        label: "extra combat: animates Mishra's Factory at end of combat when an extra combat is owed (CR 500.8)",
        spec: {
            cards: [
                { name: "Mishra's Factory", owner: "me", zone: "battlefield" },
            ],
            phase: "END_OF_COMBAT",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        setup: [{ kind: "extra-combat", haltAfterGrant: true }],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            predicate: (_move, state) =>
                state.extraPhases?.length === 1 &&
                activationStaysAvailable(state, "me", "Mishra's Factory"),
            describe:
                "an extra combat is owed and the animation carries NO rollout-policy penalty, because the body it buys still gets an attack",
        },
        note: "CR 500.8 pair, positive half (issue #2886). Differs from the negative half above in exactly one thing: `state.extraPhases` is non-empty, granted through the real primitive by the `extra-combat` setup step. NOT a strength claim — no structural extra-combat credit is added anywhere (ADR 0111 decision 6): an extra combat is INSIDE the rollout horizon, so its value is measured, not credited.",
    },
    {
        label: "activation timing: holds a sacrifice engine through its own main phase",
        spec: {
            cards: [
                { name: "Zuran Orb", owner: "me", zone: "battlefield" },
                {
                    name: "Titania, Protector of Argoth",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Zuran Orb" }],
        },
        note: "Issue #2939, the HOLD half. Zuran Orb's payoff never decays — life, plus the Elemental Titania makes of the sacrificed land — so `isTransientOnlyAbility` is silent on it and, before this change, the bot converted lands in its own precombat main on 5/5 seeds. The other side of the trade is what makes that the worst window: the land keeps tapping for mana until the moment it is given up (`spendsStandingPermanent`), and the same activation is available at instant speed all the way to the opponent's end step. Measured at the root: `pass` and the activation are EXACTLY tied at mean 0.75 with 100 visits each, so this was never a mis-valuation — it was a tie decided by the material tie-break, which is precisely the shape the hold rule owns. Its discriminating mirror is the entry below.",
    },
    {
        label: "activation timing: converts a sacrifice engine at the opponent's end step",
        spec: {
            cards: [
                { name: "Zuran Orb", owner: "opp", zone: "battlefield" },
                {
                    name: "Titania, Protector of Argoth",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "END_STEP",
            turn: 5,
            landCount: 5,
            libraryCount: 20,
        },
        // `me` is always the ACTIVE player in a `ScenarioSpec`, so the seat
        // holding the engine has to be `opp` for this to be the OPPONENT's end
        // step from the bot's point of view. The built board hands priority to
        // the active player; one `pass` walks it to the bot (CR 513.1).
        setup: [{ kind: "pass", seat: "me" }],
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "activate-ability", card: "Zuran Orb" }],
        },
        note: "Issue #2939, the FIRE half — the same board one phase later, in the last window the bot holds priority before its own turn. Without it the hold rule would be a refusal rather than a discipline: the bot deferred here too, on 5/5 seeds, and simply never converted. The cause was NOT valuation: `pass` and the activation are again tied at mean 0.75, and the material tie-break preferred `pass` on a SUBTREE-accumulated margin (1781.7 against 1552.8) even though the immediate position after activating scores 729.5 against 482.0 (the number `firingBeatsHolding` computes: `policyValue` resolves one stack item, so the life gain is still on the stack; fully settled it is 745.5). Both subtrees hold the same future activation, so the accumulation measures rollout noise; `firingBeatsHolding` asks the immediate question instead. It is NOT the stop condition — on this board every conversion is a strict gain (482.0 -> 745.5 -> 1009.0 -> 1272.5 -> 1498.5 as the lands go), so it would say yes five times and strip the bot to zero lands in one end step. The stop is the once-per-turn clause in `isDeferredEngineActivation`: a tie-break redirects ONE outcome-equal pick, and the second conversion must earn itself on mean reward. That floor is pinned by the unit control `the SECOND conversion of the same turn is left held`, which a blade entry cannot express — `ScenarioSpec` has no `activationsThisTurn`.",
    },
    {
        label: "activation cost: names the discard for Survival of the Fittest",
        spec: {
            cards: [
                {
                    name: "Survival of the Fittest",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
                { name: "Craw Wurm", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (_move, state) =>
                activationCostPicksArePaid(
                    state,
                    "me",
                    "Survival of the Fittest"
                ),
            describe:
                "every enumerated Survival activation names a legal hand creature for its discard cost, one variant per candidate",
        },
        note: "Regression guard for the tap-a-land-then-untap-it loop. The three activation cost legs the server ALWAYS defers (discard / exile-from-graveyard / tap-other) are paid by naming cards; the bot's executor named none, so `tryAutoCommitPendingActivation` never fired, `rollbackPendingActivation` untapped the land when the bot next passed, and the byte-identical position re-produced the byte-identical move forever. Position-asserted rather than move-asserted for the same reason as the two controls above (issue #1920: the search cannot see a tutor's payoff, so it must not be asked to CHOOSE this activation). The end-to-end half — announce → name the discard → commit, through the real `activateAbilityOnState` / `selectActivationDiscardCostOnState` — is pinned in `src/lib/ai/__tests__/activation-cost-picks-integration.bot.test.ts`.",
    },
    {
        // ISSUE #2283 — the targeted-trigger freeze, shape 1 (Flickerwisp).
        //
        // The bot controls a permanent whose ETB trigger owes a REAL target
        // choice (CR 603.3d: "exile another target permanent", with two or more
        // legal permanents on board, so the engine's single-legal-target
        // auto-select never fires). The engine raises a `PendingTarget` of
        // `kind: "trigger"` and freezes priority on the bot.
        //
        // BEFORE THE FIX this position was a permanent hang: `enumerateMoves`
        // returned `[]` for ANY live `pendingTarget` — a blanket rule whose
        // premise ("a pending target is always a continuation the executor
        // drives atomically") holds only for a target the bot ANNOUNCED itself.
        // `decidingPlayer` returned null, the search returned null, the driver
        // idled, and NEITHER player could advance the game. Reported on
        // Flickerwisp, Badgermole Cub (below) and Azure Beastbinder.
        //
        // SETUP (ADR 0070 §4): the trigger reaches the stack — and the target
        // selection is raised — through the ENGINE's own path
        // (`emitPermanentEntered` → `processPendingActionTriggers` →
        // `placeTriggersOnStack` → `raiseTriggerTargetSelection`). Nothing about
        // the pending selection is hand-built.
        //
        // EXPECTATION: legality + progress, not WHICH permanent it exiles —
        // target quality is explicitly out of this issue's scope, and an
        // arbitrary-but-legal answer is already the difference between a
        // playable game and a dead one. See `answersRaisedTargetLegally`.
        label: "raised target: answers its own Flickerwisp ETB trigger (#2283)",
        spec: {
            cards: [
                {
                    name: "Flickerwisp",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                // A second legal permanent (plus the lands `landCount` adds),
                // so the requirement admits a REAL choice — with exactly one
                // legal target the engine auto-selects and the bot is never
                // asked, which is why this class stayed invisible for so long.
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 1,
            libraryCount: 20,
        },
        setup: [{ kind: "etb-trigger", card: "Flickerwisp" }],
        bot: "me",
        budget: { iterations: 100 },
        // A forced window — the bot has no other legal action at all — so the
        // answer must hold on ANY seed (ADR 0070 §3).
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                answersRaisedTargetLegally(move, state, "me"),
            describe:
                "a legal `submit-target` submission for the raised trigger target that clears `pendingTarget` and lands the targets on the trigger's stack item",
        },
        note: "Issue #2283. Shown to bite: flip `PENDING_TARGET_ORIGIN.trigger` to `announced` (or revert the raised branch in `enumerateMoves`) and the search returns null — the entry goes red with `chose [no move]`, which IS the freeze.",
    },
    {
        // ISSUE #2283 — the targeted-trigger freeze, shape 2 (Badgermole Cub).
        //
        // The same class through a DIFFERENT requirement shape: earthbend's
        // "target land you control" (`controller: "you"`, a single card type)
        // rather than Flickerwisp's any-permanent-except-me. Two lands the bot
        // controls make it a real choice. Kept as its own entry because the two
        // requirements exercise different filter lowerings on the way
        // `TargetRequirement` → `PendingTarget` → back to a requirement
        // (`requirementFromPendingTarget`), and a dropped filter there is the
        // documented way an enumerator offers a target the server then rejects.
        label: "raised target: answers its own Badgermole Cub earthbend trigger (#2283)",
        spec: {
            cards: [
                {
                    name: "Badgermole Cub",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            // Two lands per seat: the bot's own two are the legal targets
            // (`controller: "you"`); the opponent's two are not.
            landCount: 2,
            libraryCount: 20,
        },
        setup: [{ kind: "etb-trigger", card: "Badgermole Cub" }],
        bot: "me",
        budget: { iterations: 100 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                answersRaisedTargetLegally(move, state, "me"),
            describe:
                "a legal `submit-target` submission for the raised earthbend target that clears `pendingTarget` and lands the target on the trigger's stack item",
        },
        note: "Issue #2283, second reported shape. Also the `controller: you` half of the census: the enumerator must offer only the bot's OWN lands, because a submission naming an opponent's land is rejected by `applyOneTargetSelection` and re-freezes the bot.",
    },
    {
        // ISSUE #2283 shape 3, and issue #2384's "bot visibility" criterion —
        // the OPTIONAL ("up to one") targeted trigger, which neither entry
        // above covers: both of those lower a MANDATORY `count: 1`.
        //
        // Skyclave Apparition's ETB is `{ min: 0, max: 1 }` plus a filter stack
        // no other blade entry exercises — `mvFilter.max`, `isToken: false`,
        // `excludeTypes: "Land"`, `controller: "opponent"`. That combination is
        // the documented failure surface: the requirement makes a round trip
        // (`TargetRequirement` → `PendingTarget` → `requirementFromPendingTarget`)
        // and a filter DROPPED on the way back makes the enumerator offer a
        // target `applyOneTargetSelection` then rejects — which re-freezes the
        // bot exactly as hard as offering nothing. Here that would mean
        // offering the Shivan Dragon (mana value 6), one of the seat's own
        // permanents, or a land.
        //
        // EXPECTATION: legality + progress, NOT which permanent it exiles —
        // target quality is a matter of opinion (is the 2/2 flier worth more
        // than the 2/2 bear?) and is deliberately out of scope, exactly as in
        // the two entries above.
        label: "raised target: answers its own Skyclave Apparition ETB trigger (up to one, mv-filtered) (#2384)",
        spec: {
            cards: [
                {
                    name: "Skyclave Apparition",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                // TWO legal targets, so the requirement admits a REAL choice
                // (with exactly one the engine auto-selects and the bot is
                // never asked — the reason this class stayed invisible).
                {
                    name: "Hypnotic Specter",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                // ILLEGAL by mana value (6 > 4). A submission naming it is
                // rejected server-side, so the enumerator must not offer it.
                {
                    name: "Shivan Dragon",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            // Lands on both sides — excluded by `excludeTypes: "Land"`, so they
            // are the negative control for that leg of the filter stack.
            landCount: 2,
            libraryCount: 20,
        },
        setup: [{ kind: "etb-trigger", card: "Skyclave Apparition" }],
        bot: "me",
        budget: { iterations: 100 },
        // A forced window — the bot owes this selection and has no other legal
        // action — so the answer must hold on ANY seed (ADR 0070 §3).
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                answersRaisedTargetLegally(move, state, "me"),
            describe:
                "a legal `submit-target` submission for the raised Skyclave Apparition trigger target that clears `pendingTarget` and lands the target on the trigger's stack item",
        },
        note: "Issue #2384. The `{ min: 0, max: 1 }` + `mvFilter` lowering, which no other raised-target entry covers; also the deterministic proof that the ETB exile is reachable through Move enumeration at all (that issue's bot-visibility criterion).",
    },
    {
        label: "combo: casts Splinter Twin on Deceiver Exarch with both pieces assembled",
        spec: {
            cards: [
                {
                    name: "Deceiver Exarch",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Splinter Twin", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 4,
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Splinter Twin",
                    target: "Deceiver Exarch",
                },
            ],
        },
        note: "Twin combo recognition. The bot has Exarch on board and Twin in hand with 2RR available. It should enchant Exarch to start the combo. This is a `cast-spell` move, unrelated to `enumerateAbilityMoves` — it does not discharge #2469's acceptance criterion (a granted-ability activation), so it stays at `stretch` (review finding on #2495, round 2).",
    },
    {
        label: "combo: activates Splinter Twin on granted Grizzly Bears (#2469)",
        spec: {
            cards: [
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Splinter Twin",
                    owner: "me",
                    zone: "battlefield",
                    attachedTo: "Grizzly Bears",
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "activate-ability", card: "Grizzly Bears" }],
        },
        note: "Issue #2469 — the granted-ability activation the bot should take, on a host whose only activated ability is the granted one (CR 613.1 layer 6): Grizzly Bears is a vanilla 2/2, so the move can reach the enumerator through `getEffectiveActivatedAbilities` and nowhere else. The Deceiver Exarch variant below is the same enumeration shape and stays at `stretch` for a valuation reason, not an enumeration one. Measured (review finding on #2495, round 2): post-fix the bot chooses the activation on 5/5 seeds, reproduced on two consecutive runs; with the pre-fix `enumerateAbilityMoves` (the printed-list early return) it chooses `pass` on 5/5 seeds. This is the entry that discharges #2469's `must`-tier acceptance criterion — the cast-side sibling above does not, since it exercises `cast-spell`, not the granted-ability enumerator this issue fixed.",
    },
    {
        label: "combo: activates Splinter Twin on enchanted Deceiver Exarch",
        spec: {
            cards: [
                {
                    name: "Deceiver Exarch",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Splinter Twin",
                    owner: "me",
                    zone: "battlefield",
                    attachedTo: "Deceiver Exarch",
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            libraryCount: 20,
            landCount: 4,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        beyondBudget: {
            cause: "valuation",
            note: "The combo payoff (an infinite hasty-copy loop: Splinter Twin grants the host '{T}: create a token that's a copy of this creature, except it has haste', and the copied Deceiver Exarch's own ETB trigger untaps the original, so the activation can be repeated) isn't scored as a distinct pattern without `comboAnnotations.ts` support (explicitly out of scope for #2469), so more search does not converge toward the activation — it converges AWAY from it: measured at 400/1200/4000 iterations on the same 5 seeds, the activation is chosen 2/5, then 1/5, then 0/5 (review finding on #2495, round 2). Per ADR 0070 §2, `cause: valuation` has no budget at which it passes, so `passesAt` is intentionally omitted.",
        },
        expect: {
            moves: [{ kind: "activate-ability", card: "Deceiver Exarch" }],
        },
        note: "Twin combo execution. Twin attached to Exarch via attachedTo. Bot should activate '{T}:'. Issue #2469 fixed `enumerateAbilityMoves` to read the granted ability off `getEffectiveActivatedAbilities` — the move IS now enumerated (confirmed: `grantedAbilityEnumeration.bot.test.ts`), but this entry is NOT promoted to `must`: at `iterations: 400`, 3 of 5 seeds (727774 aka 0xb1ade, 2, 3) still choose `pass` over the activation. The gap is now valuation/search depth, not enumeration — the combo payoff (an infinite hasty-copy loop) isn't scored highly enough at this horizon without `comboAnnotations.ts` support, which is explicitly out of scope for #2469. See finding docs/findings/2469-twin-blade-still-stretch.md.",
    },
    {
        label: "channel: activates a player-level grant to fund a lethal Fireball (#2903)",
        spec: {
            cards: [
                { name: "Channel", owner: "me", zone: "hand" },
                { name: "Fireball", owner: "me", zone: "hand" },
                { name: "Forest", owner: "me", zone: "battlefield", count: 2 },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            life: { me: 2, opp: 1 },
            libraryCount: 20,
        },
        // Channel is a sorcery; casting + resolving it through the real move
        // pipeline grants "me" the CR 113.1b player-level mana ability (the two
        // Forests pay {G}{G}, leaving the Mountain untapped for Fireball's {R}).
        // The cast parks priority on "opp"; their `pass` drives the pass cycle
        // to 2, resolves Channel, and hands priority back to the active player
        // (CR 117.3b) — the window where "me" decides whether to spend life.
        // "me" is at 2 life against an opponent at 1 with a 2/2 attacker:
        // spending 1 life through the grant is the ONLY way to cast Fireball for
        // lethal (Fireball {X}{R} is X=0 off the lone Mountain), and passing
        // hands the opponent a lethal 2-damage swing. One activation, then the
        // lethal cast — the grant is the whole game.
        setup: [
            { kind: "cast", card: "Channel", by: "me" },
            { kind: "pass", seat: "opp" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "activate-granted-ability" }],
        },
        note: "Issue #2903 — a PLAYER-level granted ability (Channel's 'Pay 1 life: Add {C}.' until end of turn, CR 113.1b) is invisible to the enumerator's battlefield/graveyard/opponent scan, which reads only card instances. The bot holds the grant, a Mountain and a Fireball at 2 life against an opponent at 1 with a 2/2 attacker: the only way to cast Fireball for lethal is to spend 1 life through the grant (Fireball {X}{R} is X=0 off the lone Mountain), and passing hands the opponent a lethal swing. The chosen root move must be the grant activation — the enumeration and the search's life/mana application both prove themselves on this entry.",
    },
    // -----------------------------------------------------------------------
    // Protection-colour choice (issue #2306) — the Bot's colour pick for
    // "protection from the colour of your choice" (`protectionColorModes`,
    // `cards/abilities/index.ts`) read against the opponent's OBSERVED colour
    // footprint (`ai/observedColors.ts`) rather than an arbitrary generator
    // order. `setup`'s `activate` step's new `target` field (issue #2306)
    // reaches the colour choice itself: activate the targeted ability through
    // the real `enumerateMoves`/`applyMoveInSearch` seam, then `resolve-top`
    // to hit the `optionChoice` Op's suspending pick — the SAME mechanism the
    // Chrome Mox imprint entry above uses one Op earlier.
    // -----------------------------------------------------------------------
    {
        label: "protection colour choice: Mother of Runes picks the opponent's shown colour",
        spec: {
            cards: [
                {
                    name: "Merfolk of the Pearl Trident",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Unsummon", owner: "me", zone: "hand" },
                {
                    name: "Mother of Runes",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        // Only "me" (the active player) holds priority in a freshly built
        // board, so the OBSERVED side casts first — mirrors the seating of
        // the "Mother of Runes stays available / protects itself" entries
        // above, Mother on `opp` throughout. "me" shows EXACTLY one colour —
        // a blue permanent AND a blue spell on the stack (its one Island is
        // spent paying for Unsummon, so it contributes no UNTAPPED-source
        // evidence either): unambiguous acceptance-criterion-1 shape. Casting
        // hands priority to "opp" afterward, who then activates Mother.
        setup: [
            {
                kind: "cast",
                card: "Unsummon",
                by: "me",
                target: "Merfolk of the Pearl Trident",
            },
            {
                kind: "activate",
                card: "Mother of Runes",
                target: "Mother of Runes",
            },
            { kind: "resolve-top" },
        ],
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", option: "protection-blue" }],
        },
        note: 'Issue #2306 acceptance criterion 1 / the blade coda\'s positive case. Before the fix, `option-pick` candidates scored a flat NEUTRAL_PRIOR regardless of colour (`choiceCandidates.ts` dropped `option.color` in `toCandidate`, and `heuristicChoicePrior` had no branch for a `resolution-choice` move) — the pick was arbitrary generator-array order, which for `protectionColorModes(["W","U","B","R","G"])` is always "protection-white", never blue. Proof-of-failure: reverting the `colorModePrior` wiring in `choicePriors.ts` reds this at every seed (chosen option = protection-white).',
    },
    {
        label: "protection colour choice: Thornscape Master picks the opponent's shown colour (shared seam)",
        spec: {
            cards: [
                {
                    name: "Merfolk of the Pearl Trident",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Unsummon", owner: "me", zone: "hand" },
                {
                    name: "Thornscape Master",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Plains", owner: "opp", zone: "battlefield" },
                { name: "Plains", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        // A SECOND card built on the shared `protectionColorModes` helper,
        // proving the fix lives at the seam and not in a Mother-of-Runes-
        // shaped patch (`feedback_fix_bug_class_not_single_card`).
        // Thornscape Master's protection ability costs `{W}{W}, {T}` (needs
        // real mana, unlike Mother/Giver's plain tap) and targets "target
        // creature" with no controller restriction, so it can protect
        // itself — the two Plains fund the cost through the real
        // `enumerateMoves`/`applyMoveInSearch` seam the `activate` step's
        // `target` field uses. (Giver of Runes was tried first and dropped:
        // its `getTargetRequirement` closure hits a documented, pre-existing
        // gap in `moves.ts`'s ability enumerator — "conditional abilities
        // need a runtime predicate we don't replicate" — so the Bot can
        // never activate it at all, unrelated to colour choice. Out of
        // scope for #2306; see the PR description / findings note.)
        setup: [
            {
                kind: "cast",
                card: "Unsummon",
                by: "me",
                target: "Merfolk of the Pearl Trident",
            },
            {
                kind: "activate",
                card: "Thornscape Master",
                ability: "thornscape-master-protection",
                target: "Thornscape Master",
            },
            { kind: "resolve-top" },
        ],
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", option: "protection-blue" }],
        },
        note: "Issue #2306 acceptance criterion 2 — the SAME fix at the shared `protectionColorModes` seam, proven on a SECOND card.",
    },
    {
        label: "protection colour choice: negative control — the lethal threat's colour wins over evidence share",
        spec: {
            cards: [
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                {
                    name: "Mother of Runes",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        // The opponent's OBSERVED footprint favours GREEN (two green
        // permanents = evidence 6) over red (the Bolt on the stack alone =
        // evidence 3; the Mountain that paid for it is tapped by the time the
        // choice is scored, so it contributes no untapped-source evidence).
        // The heuristic is a PRIOR, not a filter (acceptance criteria): with
        // Bolt on the stack aimed at Mother herself, the search's real reward
        // — fizzling it (CR 608.2b) versus dying — must still win over the
        // evidence-led green bias.
        setup: [
            {
                kind: "cast",
                card: "Lightning Bolt",
                by: "me",
                target: "Mother of Runes",
            },
            {
                kind: "activate",
                card: "Mother of Runes",
                target: "Mother of Runes",
            },
            { kind: "resolve-top" },
        ],
        bot: "opp",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", option: "protection-red" }],
        },
        note: "Issue #2306's blade-coda negative control: proves `colorModePrior` stays a SOFT ordering bias — every mode is still opened (CHOICE_TOP_K comfortably covers 5 colours) and the search still finds the mechanically-forced correct answer even when it is the evidence-LOWER colour. Guards against the fix over-correcting into a hard filter that would drop this exact save.",
    },

    // ── Flash-permanent reactive timing (issue #2248) ────────────────────
    // The reactive-timing discipline built for instants (#219/#221/#222/#223,
    // generalised to activated abilities by #1890) treated "instant speed" as
    // `types.includes("Instant")` at two of its four sites, so a flash
    // PERMANENT carried none of the bias an instant gets: the bot dumped it in
    // its own main phase every time, never weighing the option to hold mana
    // open and cast reactively later. `hasInstantSpeed` (`constants.ts`) is now
    // the single authority every site routes through.
    //
    // Three entries, the discriminating triple the issue calls for: the FIX
    // itself (holds), and two NEGATIVE CONTROLS proving the bias is a
    // preference, not a mute button — a bias that fires too broadly is
    // structurally indistinguishable from a hard prune until something forces
    // it to fire and it doesn't.
    {
        label: "flash permanent: holds Containment Priest in its own main with no threat",
        spec: {
            cards: [{ name: "Containment Priest", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Containment Priest" }],
        },
        note: "Issue #2248, the fix itself. Empty board, no attack pending, nothing else to spend mana on: the only choice is cast-now vs hold-for-later, and later is never worse (Containment Priest has no haste, so casting now buys it nothing timing-wise — it cannot attack or use its replacement ability any sooner). Casting now forecloses the mana-open option for free; holding it to the opponent's end step is outcome-equal on material and strictly better on information, so the `isSorcerySpeedTrickDump` shape-3 tie-break (`search.ts`) redirects the outcome-equal cast to `pass`. Guards ONLY the root tie-break (`isSorcerySpeedTrickDump` shape 3): reverting shape 3 alone reds this entry (see PR proof-of-failure), but reverting the rollout-guardrail widening alone, or the own-main hold nudge alone, both leave it GREEN (review round 1 finding) — with nothing else to spend mana on, casting still wins outright once the tie-break itself is gone, so the tie-break is the only piece this position discriminates. The other two shipped pieces (`isDiscouragedRolloutMove`'s flash branch, `isReactiveHold`'s own-main shape) are unit-tested directly in `search.bot.test.ts` instead, where a synthetic RNG and a hand-built prior call can isolate each without a full search absorbing the difference.",
    },
    {
        label: "flash permanent NEGATIVE CONTROL: casts Containment Priest as the only surviving block",
        spec: {
            cards: [
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    count: 4,
                },
                { name: "Containment Priest", owner: "opp", zone: "hand" },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 2,
            libraryCount: 20,
        },
        // `me` (players[0]) is the active player and sends the attack; `opp`
        // holds Containment Priest and is the one the search runs for.
        setup: [{ kind: "declare-attackers", haltForDefenderResponse: true }],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Containment Priest" }],
        },
        note: "Issue #2248 negative control 1 — 'needed as a blocker against a lethal attack'. 4 x Craw Wurm is 24 unblocked power into 20 life (CR 510.1c/704.5a); with no other blocker, NOT casting Containment Priest is a loss by force, and the mid-DECLARE_ATTACKERS window `haltForDefenderResponse` stops at is the ONLY point a flash blocker can be cast INTO this combat — by DECLARE_BLOCKERS the blockers are locked (CR 509.1a) and the creature would already need to be on the battlefield. Does NOT discriminate a blanket 'prefer holding priority' bias, measured: dropping BOTH the mover check in `isDiscouragedRolloutMove` and the phase check in `isReactiveHold` (so either could fire in ANY window, for ANY mover) leaves this entry GREEN on all 5 seeds anyway (review round 1 finding) — casting is a forced win here, so mean reward swamps any bias, and `isSorcerySpeedTrickDump` can never even reach this position (it reads only `state.activePlayerId`'s hand, and the bot here is the DEFENDER). What this entry DOES guard: the `haltForDefenderResponse` blade infra addition (removing it throws `BladeSetupError` before the search even runs — see PR proof-of-failure) and, more weakly, that `isDiscouragedRolloutMove`/`isSorcerySpeedTrickDump` structurally cannot reach a non-active mover's cast regardless of their own gates (`pid !== state.activePlayerId` short-circuits both) — a hard prune would be needed to break THIS position, not a widened bias.",
    },
    {
        label: "flash permanent NEGATIVE CONTROL: still casts hasty Raging Kavu for lethal this turn",
        spec: {
            cards: [
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    count: 3,
                },
                { name: "Raging Kavu", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        // Higher than the suite's typical `must` budget on purpose: this is a
        // genuine TWO-PLY decision (cast, then choose an attacker subset out
        // of 2^4 declare-attackers combinations once Kavu joins the board),
        // not the one-shot choices most entries pose. Measured at authoring
        // time: `cast-spell` is NOT yet the top candidate at 400/800/1200
        // iterations on any of the 5 seeds (the search simply hasn't found
        // and confirmed the "cast + attack with everything" line yet — a
        // budget/branching gap orthogonal to issue #2248), and IS the top
        // candidate, by a margin of 0.067 mean reward (above `OUTCOME_EPS`),
        // on all 5 at 2000. This is a budget floor for THIS entry's shape,
        // not evidence that #2248's fix needs more search generally.
        budget: { iterations: 2000 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Raging Kavu" }],
        },
        note: "Issue #2248 negative control 2 — 'sorcery-speed cast with real reward'. 3 x Craw Wurm already on board is 18 power, short of the opponent's 20 life; Raging Kavu's Flash makes it structurally match `isSorcerySpeedTrickDump` shape 3 (a non-Instant flash permanent, cast by the active player at a main phase) exactly the way the fix entry's Containment Priest does, but Kavu also has HASTE — casting it THIS main phase adds 3 power to THIS combat and crosses lethal (21 into 20), where holding it for the opponent's end step forfeits the attack entirely and pushes the kill a full turn later against an opponent who gets to act in between. That gap is far outside `OUTCOME_EPS`, so the tie-break's own mean-reward gate must not fire: the position proves the fix is a preference among outcome-equal lines, never a rule that redirects a decisively-better cast to `pass`.",
    },
    {
        // MORPH — the face-down cast (CR 702.37a, issue #2705). Exalted Angel
        // costs {4}{W}{W}; the bot has THREE lands. The printed cast is not on
        // the table at all, so the only thing that can put a body on an empty
        // board this turn is the morph alternative cost — "{3} rather than
        // paying its mana cost". A 2/2 for three with the whole board empty
        // beats passing on the same develop tie-break the positive control
        // rides, and nothing in the position argues for holding the mana (no
        // instant, no untapped-mana payoff, nothing to respond to).
        //
        // Its job is to prove the cast is REACHABLE by the bot end to end:
        // enumerated with a synthesized `alternativeCostId`, tap-planned
        // against the {3}, and applied in-tree as a face-down 2/2 rather than
        // as a 4/5 flier. Before issue #2705 this entry could not even be
        // written — `enumerateCastMoves` emitted nothing for an unaffordable
        // printed cost.
        label: "morph: casts Exalted Angel face down for {3} on three lands",
        spec: {
            cards: [
                { name: "Exalted Angel", owner: "me", zone: "hand" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Exalted Angel" }] },
        note: "CR 702.37a face-down cast: the printed {4}{W}{W} is unaffordable, so the morph alternative cost is the only cast in the position.",
    },
    {
        // MORPH — the turn-face-up special action (CR 116.2b / 702.37e, issue
        // #2705). The bot controls a face-down Exalted Angel and four untapped
        // Plains, with nothing in hand and nothing on the stack. Paying
        // {2}{W}{W} turns a 2/2 vanilla into a 4/5 flier that gains life
        // whenever it deals damage — a strict, unconditional board upgrade,
        // with no mana sink competing for the four lands and no reason to hold
        // up an instant it does not have.
        //
        // The matcher names no card on purpose: a face-down permanent presents
        // the `FACE_DOWN_CARD_ID` sentinel, which is registered in the lookup
        // map only and is deliberately NOT in the name registry — resolving
        // "Exalted Angel" against this board would find nothing, exactly as it
        // should (that hiddenness is the mechanic). `{ kind: "turn-face-up" }`
        // is unambiguous here regardless: there is only one face-down
        // permanent in the position.
        label: "morph: turns a face-down Exalted Angel face up for its morph cost",
        spec: {
            cards: [
                {
                    name: "Exalted Angel",
                    owner: "me",
                    zone: "battlefield",
                    faceDown: true,
                    summoningSick: false,
                },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        tier: "must",
        expect: { moves: [{ kind: "turn-face-up" }] },
        note: "CR 702.37e special action: 2/2 vanilla → 4/5 lifegain flier for {2}{W}{W}, with no competing use for the mana.",
    },
    {
        // DISCRIMINATING PAIR, HALF 1 of 2 (issue #2491).
        // PAIRED WITH: "loyalty: does NOT reach for a −2 it cannot pay".
        // NEITHER ENTRY PROVES ANYTHING ALONE — a bot that never activates a
        // loyalty ability passes half 2 vacuously, and a bot that offers every
        // loyalty ability regardless of the CR 606 gates passes half 1. Only
        // the pair distinguishes a bot that reads the rule. Deleting either
        // half silently guts the other, which is why each note names its
        // partner.
        //
        // The bug: `enumerateAbilityMoves` skipped every ability with a signed
        // `cost.loyalty`, so all 13 shipped planeswalkers / 37 loyalty
        // abilities were unreachable and the bot cast Liliana of the Veil and
        // then passed for the rest of the game (53 `pass`, zero
        // `activate-ability` in the reported game's decision log).
        //
        // Position: the bot's own precombat main, empty stack (CR 606.3's
        // window), Liliana at her printed starting loyalty of 3, the bot's hand
        // empty so nothing competes, and the opponent's only permanent is a
        // 4/4 flier. The −2 edict (a sacrifice, CR 701.21) is the whole board.
        label: "loyalty: activates Liliana's −2 to eat the opponent's only creature",
        spec: {
            cards: [
                {
                    name: "Liliana of the Veil",
                    owner: "me",
                    zone: "battlefield",
                    counters: { loyalty: 3 },
                },
                {
                    name: "Serra Angel",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        // ADR 0070 §2 — measured, not guessed: `activate-ability
        // cards=[Liliana of the Veil] targets=[opp]` on all three seeds at the
        // production 400.
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "activate-ability",
                    card: "Liliana of the Veil",
                    // At 3 loyalty the −6 is unpayable (CR 606.6) and the +1
                    // takes no target, so a player target pins the −2 exactly.
                    target: "opp",
                },
            ],
        },
        note: 'Half 1 of the discriminating pair — PAIRED WITH "loyalty: does NOT reach for a −2 it cannot pay". Neither half is meaningful alone. Both halves pass at 400 iterations across 3 seeds.',
    },
    {
        // DISCRIMINATING PAIR, HALF 2 of 2 (issue #2491).
        // PAIRED WITH: "loyalty: activates Liliana's −2 to eat the opponent's
        // only creature". The SAME position with two counters fewer: the edict
        // that was the whole board in half 1 is now illegal, because CR 606.6
        // forbids a negative loyalty cost the permanent cannot pay. The +1
        // remains legal, so this is not a "does the bot activate at all"
        // question — it is "does the enumerator's CR 606.6 floor survive all
        // the way to the root decision".
        label: "loyalty: does NOT reach for a −2 it cannot pay",
        spec: {
            cards: [
                {
                    name: "Liliana of the Veil",
                    owner: "me",
                    zone: "battlefield",
                    counters: { loyalty: 1 },
                },
                {
                    name: "Serra Angel",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            forbidden: [
                {
                    kind: "activate-ability",
                    card: "Liliana of the Veil",
                    target: "opp",
                },
            ],
        },
        note: "Half 2 of the discriminating pair — PAIRED WITH \"loyalty: activates Liliana's −2 to eat the opponent's only creature\". Neither half is meaningful alone. Measured: the bot takes the +1 on all three seeds and never the illegal −2.",
    },
    {
        // Issue #1964. This used to be "half 1" of a discriminating pair with
        // a sibling entry ("hard-casts Ragavan on an empty board with
        // nothing to race") — review round 2 DELETED that sibling: mutation-
        // tested with the whole `moves.ts` dash-enumeration branch stubbed
        // out (`false &&`, so dash is never even offered), it still passed
        // PLAIN on all 3 seeds at 400 iterations, identical to the unmutated
        // registry. An entry that cannot go red under a mutation this PR can
        // make is vacuous (ADR 0070 §1) — it "proved" the Bot declines to
        // dash for no reason other than dash never being on the table, which
        // is not what its label claimed. This entry does not need a partner
        // to be meaningful: it is a straightforward reachability +
        // correctness check on its own.
        //
        // Review round 1 measured that this entry's chosen MOVE does not
        // flip when only the `moveZone` self-cost sign is reverted. Review
        // round 2 corrected the EXPLANATION round 1 gave for that: the term
        // is NOT "architecturally invisible" to a leaf, and `rollout()`'s
        // turn-boundary horizon does not make it structurally impossible to
        // see one. A dashed permanent that returns to hand before the
        // horizon (CR 702.109a's delayed return, "at the beginning of the
        // next end step") is scored there by the SAME latent `cardValue`
        // path (`evaluate.ts`) every hand card uses, and that path's
        // creature branch (`latentValue`, `cardValue.ts`) adds
        // `dslAbilityValue` — the card's OWN ability-script worth — to its
        // body; Ragavan carries no `aiValue` override to suppress it. So the
        // sign term IS present at the leaf: measured directly, 31.25 (fixed)
        // vs 58.75 (sign reverted) — 27.5 points of same-signed difference at
        // a real, non-lethal leaf. What actually keeps THIS entry from
        // proving the sign is narrower: this position is a same-turn WIN, so
        // it lands in the win/loss band (CLAUDE.md's "banded so a win
        // dominates material") regardless of a 27.5-point material term —
        // the win dominates the decision, not an invisible term. The sign
        // regression is pinned by the unit tests (`opValuers.bot.test.ts`,
        // `cardScriptValue.bot.test.ts`, `triggerGate.bot.test.ts`) AND by a
        // real, engine-built, `evaluate()`-level assertion
        // (`dashMoves.bot.test.ts` — "evaluate() correctly prices a dashed
        // Ragavan BELOW a hard-cast one"), which DOES flip the ROOT MOVE
        // CHOICE at its own position — immediately after casting, before any
        // rollout has diluted the term with everything else it scores
        // (measured -27 fixed / +83 reverted). This entry's own job is
        // narrower and different: prove the Bot REACHES and RECOGNIZES the
        // lethal dash line once `moves.ts`'s enumeration fix (same issue)
        // makes it reachable at all — `MoveMatcher` has no field for
        // `alternativeCostId`, the only thing distinguishing a dash cast from
        // a plain one of the same card, hence the `predicate` shape.
        //
        // Ragavan, Nimble Pilferer (printed {R}, dash {1}{R}) with two
        // Mountains: BOTH cast modes are affordable (this is what makes the
        // decision real — a position where only one mode is castable proves
        // reachability, not preference, the way the morph entries above do).
        // Three Craw Wurms (18 power) + a Llanowar Elves (1 power) are
        // already on the board, already able to attack (19 power, one short
        // of the opponent's 20 life): hard-casting Ragavan leaves it
        // summoning-sick (no attack this turn, CR 302.6), so the best the
        // Bot can do is 19 — one point short. DASHING grants haste (CR
        // 702.109a), so Ragavan's 2 power joins the attack and crosses
        // lethal (21 into 20) — this turn, not a future one, so it needs no
        // multi-turn lookahead and no life-total tuning (`ScenarioSpec` has
        // none yet, issue #2147) to construct.
        //
        // Before issue #1964 this position was not even REACHABLE — the same
        // issue's `moves.ts` fix is what put a dash-cast Move on the table at
        // all (`enumerateCastMoves` used to read only the PRINTED cost).
        label: "dashes Ragavan for the lethal attack",
        spec: {
            cards: [
                {
                    name: "Ragavan, Nimble Pilferer",
                    owner: "me",
                    zone: "hand",
                },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Craw Wurm", owner: "me", zone: "battlefield" },
                { name: "Craw Wurm", owner: "me", zone: "battlefield" },
                { name: "Craw Wurm", owner: "me", zone: "battlefield" },
                { name: "Llanowar Elves", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        // BEYOND-BUDGET, cause "branching" (`types.ts`'s own vocabulary: "too
        // many candidate moves at one decision — the right move is in the
        // set but never gets enough visits") — REVIEW ROUND 2: an independent
        // re-sweep (3 seeds each) found FAIL at 400/800/1200/2000, PASS at
        // 3000-6000, and FAIL AGAIN at 8000. That non-monotone shape settles
        // the interpretation round 1 left open: this is NOT "needs more
        // search" (a genuine compute shortfall reads monotone — once enough
        // visits land on the right line, more search only holds it, never
        // loses it again) — it is right-by-noise inside a 3000-6000 window.
        // So the shipped bot, at ANY production budget (`hard`'s ceiling is
        // 1200), does not reliably make this play; a `must` entry housed a
        // window that only looks solved from inside it. Demoted to `stretch`
        // and the declared `budget` brought back to this registry's norm
        // (every other entry is ≤400 except one 2000 precedent) instead of
        // living at 5000 — a `must`/blocking budget that size would add
        // ~35s of real ISMCTS to every `bun run test`, to buy a pass that the
        // 8000 point already shows is not a real solve. The 3000-6000
        // plateau is recorded via `beyondBudget.passesAt` below, not
        // smuggled into the declared budget (ADR 0070 §2 forbids raising the
        // budget to turn an entry green — the same rule this demotion is
        // now honoring instead of evading via an unset `beyondBudget` field).
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "stretch",
        beyondBudget: {
            cause: "branching",
            passesAt: { iterations: 5000 },
            note: "A four-attacker combinatorial decision (which of 19 already-attacking power plus a newly-hasty Ragavan crosses lethal) needs enough visits to find the right line, but the visits it gets are noisy: FAIL at 400/800/1200/2000, PASS at 3000-6000, FAIL AGAIN at 8000 (review round 2 re-sweep, 3 seeds each). `passesAt: 5000` sits at the center of the one confirmed stable plateau, not a ceiling the entry monotonically clears — production `hard` (1200 iterations) never reaches even the edge of that plateau, so the bot does not make this play at any budget a real game runs.",
        },
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "cast-spell" &&
                move.alternativeCostId === "dash",
            describe:
                "casts Ragavan, Nimble Pilferer via its dash cost (not the plain cast)",
        },
        note: '19 power already in play + Ragavan hasty = 21, crossing the opponent\'s 20 life; hard-casting caps this turn\'s attack at 19 (summoning sickness, CR 302.6) — one short. BEYOND-BUDGET, cause "branching" (review round 2): the right line is found only inside a 3000-6000 iteration plateau, not at production budgets or above — see `beyondBudget` for the honest, non-monotone shape. (Formerly "half 1" of a discriminating pair — the other half was deleted, review round 2, as vacuous: see the header comment above.)',
    },
    {
        // Issue #2297 — the reported bug, as a position. The outlet's only
        // effect pumps `$source`, and its cost says "a creature", not
        // "another" (CR 109.2), so the source is a legal victim of its own
        // ability. Paying with it means the ability resolves with nothing to
        // pump (CR 609.3): a creature spent for an empty resolution.
        label: "sac outlet: never eats itself when its whole payoff is on the source",
        spec: {
            cards: [
                { name: "Fallen Angel", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (_move, state) =>
                sacrificeVictimSparesTheSource(state, "me", "Fallen Angel"),
            describe:
                "every enumerated activation of the self-pumping sac outlet names a victim other than the outlet itself",
        },
        note: "Asserted on the LEGAL SET rather than the chosen move: the two variants differ only in which creature `costPicks` names, which no `MoveMatcher` field can express, and the wrong one must not be searchable at all — not merely out-preferred. Half 1 of a discriminating pair; half 2 is the Goblin Chirurgeon entry below.",
    },
    {
        // The same rule with nothing left to name (issue #2297): the server
        // would auto-resolve this selection to the source itself
        // (`autoResolveFungible` — one candidate, one needed), so the victim
        // never reaches `costPicks` and only the final-victim check sees it.
        label: "sac outlet: does not activate at all when it is its own only victim",
        spec: {
            cards: [{ name: "Fallen Angel", owner: "me", zone: "battlefield" }],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (_move, state) =>
                noActivationEnumerated(state, "me", "Fallen Angel"),
            describe:
                "the self-pumping sac outlet, alone on the battlefield, produces no activate-ability move",
        },
        note: "An empty pick list is how `enumerateMoves` drops an activation with no legal payment; here the payment is legal but self-defeating, and the same channel carries it. The engine is unchanged — `sacrifice-cost-activation.test.ts` asserts a human may still name the source.",
    },
    {
        // NEGATIVE CONTROL (issue #2297). Goblin Chirurgeon is itself a
        // Goblin, so it is a legal victim of its own "Sacrifice a Goblin"
        // cost — but its effect regenerates a TARGETED creature, which
        // survives the Chirurgeon's death. Eating itself to save something
        // better is a real play and must stay searchable.
        label: "sac outlet: still eats itself when the payoff is independent of the source",
        spec: {
            cards: [
                { name: "Goblin Chirurgeon", owner: "me", zone: "battlefield" },
                {
                    name: "Mons's Goblin Raiders",
                    owner: "me",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (_move, state) =>
                selfSacrificeStaysEnumerable(state, "me", "Goblin Chirurgeon"),
            describe:
                "a source-independent sac outlet keeps a variant that names itself as the sacrifice victim",
        },
        note: "Half 2 of the discriminating pair. Without it the fix could be a blanket 'never name your own source' ban and every `must` entry above would still be green.",
    },

    // ── The informed opponent: play around what the deck can still hold ─────
    //
    // A DISCRIMINATING PAIR (issue #2789, PRD #2787). The two entries below are
    // byte-identical boards — same creatures, same lands, and the same single
    // card physically in the opponent's hand — differing ONLY in the decklist
    // the search is allowed to know. That is what makes them a measurement of
    // the opponent model and of nothing else: no other input varies, so a
    // difference in the chosen move can only come from what the bot DEDUCED
    // about a card it cannot see.
    //
    // THE POSITION. The bot is `me` (players[0], the active player) and owes
    // its `declare-attackers`. It has a Hill Giant (3/3). The opponent has a
    // Grizzly Bears (2/2), an untapped Forest, and one card in hand.
    //
    //   * With no trick, the Bears cannot profitably block a 3/3 — it dies for
    //     nothing — so the attack is 3 free damage and correct.
    //   * With Giant Growth, the Bears blocks as a 5/5, kills the Hill Giant
    //     and survives. The attack trades the bot's only creature for nothing.
    //
    // The consequence is forced by the rules, not probabilistic: each decklist
    // holds exactly one card and nothing of the opponent's sits in a public
    // zone to subtract, so `unseenRemainder` admits exactly ONE identity and
    // the sampled hand is the same on every seed and every iteration.
    //
    // WHY THIS IS AN ATTACK AND NOT A BLOCK. Measured while authoring: the
    // mirror-image BLOCK position does not discriminate, because a block is
    // settled by `selectRootMove`'s combat tie-breaks, which read the REAL root
    // state rather than a determinized world — so no opponent model can reach
    // them. An attack root leaves the decision to the tree and the rollouts,
    // which do see the sampled worlds. That gap is real and is NOT fixed here;
    // it is reported in the PR as a follow-up rather than papered over.
    //
    // WHAT IT WAS BEFORE. Measured on this exact board with the trick sitting
    // PHYSICALLY in the opponent's hand and no deck knowledge: the bot attacks
    // on all five seeds anyway. The blind path pools that hand with a 20-card
    // library and re-deals, so Giant Growth reaches the imagined hand about one
    // iteration in twenty-one — the textbook `hidden-information` dilution.
    // Sampling from the decklist is what makes it visible every iteration.
    {
        label: "informed opponent: does NOT attack into the trick its deck must be holding",
        spec: {
            cards: [
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Forest", owner: "opp", zone: "battlefield" },
                // Physically a Mountain in BOTH entries — `determinize`
                // re-derives this seat's hidden zones from the decklist, so
                // what sits here is never what the bot reasons about.
                { name: "Mountain", owner: "opp", zone: "hand" },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        deckKnowledge: [{ seat: "opp", cards: ["Giant Growth"] }],
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "declare-attackers", card: "Hill Giant" }],
        },
        note: "Twin of the entry below; only the decklist differs (issue #2789).",
    },
    {
        label: "informed opponent: DOES attack when the deck cannot hold the trick",
        spec: {
            cards: [
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Forest", owner: "opp", zone: "battlefield" },
                { name: "Mountain", owner: "opp", zone: "hand" },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        // Same board, same card in hand — but this deck admits only a land, so
        // there is no trick to walk into and holding back donates 3 damage.
        deckKnowledge: [{ seat: "opp", cards: ["Mountain"] }],
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "declare-attackers", card: "Hill Giant" }],
        },
        note: "Twin of the entry above; only the decklist differs (issue #2789).",
    },
    {
        // CR 500.8 (issue #2886). The bot is handed the SECOND combat phase of
        // a turn — a position that did not exist before the extra-phase queue
        // shipped, reached by the `extra-combat` setup step through the real
        // primitive and the real `advancePhase` seam.
        //
        // What it asserts is PROGRESS, not attack quality: the bot returns a
        // real `declare-attackers` decision in the re-entered step instead of
        // no move at all. Attacking-or-not with a lone creature into an empty
        // board is deliberately a `stretch`-tier judgement elsewhere in this
        // file and would make a seed-sensitive `must`; freezing in a phase the
        // engine can now re-enter is not a judgement at all.
        //
        // A VIGILANT attacker, not a vanilla body, for a second reason:
        // vigilance (CR 702.20) leaves Ardent Soldier UNTAPPED after combat #1,
        // so it is still a legal attacker in combat #2 (CR 508.1a) even though
        // `hasAttackedThisTurn` is set — the "attacked already, may attack
        // again if untapped" clause, exercised through the engine rather than
        // asserted about it. The defender's Grizzly Bears is what OPENS the
        // block window the `declare-attackers` step walks to (a board with no
        // legal block never reaches it); the `extra-combat` step then declines
        // the block (CR 509.1) on its way to the second combat.
        label: "extra combat: does not stall in the second combat phase (CR 500.8)",
        spec: {
            cards: [
                {
                    name: "Ardent Soldier",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            libraryCount: 20,
        },
        setup: [
            { kind: "declare-attackers", cards: ["Ardent Soldier"] },
            { kind: "extra-combat" },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                state.phase === "DECLARE_ATTACKERS" &&
                (state.extraCombatsThisTurn ?? 0) === 1 &&
                mayAttackAgain(state, "me", "Ardent Soldier") &&
                move !== null &&
                move.kind === "declare-attackers",
            describe:
                "the position is the SECOND combat's declare-attackers step (extraCombatsThisTurn === 1), the creature that already attacked may legally attack again because vigilance left it untapped (CR 508.1a), and the bot returns a declare-attackers move there rather than stalling",
        },
        note: "CR 500.8 extra-phase queue (issue #2886, ADR 0111). Guards PROGRESS in a re-entered combat phase; deliberately no structural extra-combat credit — an extra combat is INSIDE the rollout horizon (ADR 0111 decision 6).",
    },
    {
        // CR 609.4b (issue #2890) — "You may spend white mana as though it were
        // red mana" (Sunglasses of Urza). The bot's only untapped source is a
        // Plains, it holds Lightning Bolt, and the opponent is at 3.
        //
        // FAIRNESS BY CONSTRUCTION (ADR 0070 §1): the substitution makes the
        // Bolt payable and the Bolt is EXACT lethal, so there is one move that
        // wins on the spot and nothing else the position can do. No judgement,
        // one ply, no rollout noise to hide behind.
        //
        // WHAT IT DISCRIMINATES: mana substitution was honoured by the PAYMENT
        // layer (`isManaCostCovered`) but by neither the castability census
        // (`coloredCostLeftover`, rules.ts) nor the Bot's payment planner
        // (`planManaPayment`, moves.ts) — so the Bolt was never ENUMERATED and
        // the bot passed with lethal in hand, for as long as Sunglasses has
        // shipped. Reverting either widening turns this entry red. It is the
        // Bot-side twin of the North Star / Robber of the Rich cast-scoped
        // grants #2890 adds, which ride the exact same seam.
        label: "sunglasses of urza: spends white mana as red for exact lethal (CR 609.4b)",
        spec: {
            cards: [
                {
                    name: "Sunglasses of Urza",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
            life: { opp: 3 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                { kind: "cast-spell", card: "Lightning Bolt", target: "opp" },
            ],
        },
        note: "CR 609.4b: without substitution-aware enumeration the Bolt is not a legal move at all.",
    },
    {
        // WHY THIS POSITION: the reported freeze (issue #2870, game
        // `jh7c2symenzqjz5tyjmx90eby98d8n7k` at seq 124) is exactly this board —
        // Pest Infestation, "Destroy up to X target artifacts and/or
        // enchantments", cast for X ≥ 1 with NO artifact and NO enchantment
        // anywhere in play. CR 601.2c's "up to" has no lower bound, so the
        // announcement is legal and its ONLY possible answer is zero targets.
        //
        // FAIRNESS BY CONSTRUCTION (ADR 0070 §1): nothing here asks the bot to
        // judge whether the cast is good. The assertion is that every declined-
        // target cast the position OFFERS can actually be completed — the
        // legal-set shape, not a preference — so no rollout noise can reach it.
        //
        // WHAT IT DISCRIMINATES: the ENUMERATOR half of the old predicate —
        // restoring `isVariableCount(req) && targets.length > 0` turns this red.
        // The blade runner stops at the chosen `Move` and never calls
        // `executeMove`, so the executor's own `&& move.targets.length > 0` term
        // is out of its reach by construction; that half is guarded by
        // `up-to-x-zero-target-cast-integration.bot.test.ts`, which drives the
        // real mutation sequence. (The mutation-level "declining all targets is
        // a legal confirm" case already passed before the fix — the defect lived
        // entirely in what the Bot SENT.)
        label: "up to X target: an 'up to X' cast with no legal target confirms zero targets (CR 601.2c)",
        spec: {
            cards: [
                { name: "Pest Infestation", owner: "me", zone: "hand" },
                {
                    name: "Forest",
                    owner: "me",
                    zone: "battlefield",
                    count: 5,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: upToXZeroTargetCastIsExecutable,
            describe:
                "every offered 'up to X' cast with zero targets carries confirmTargets (a confirm-only submission), so the announcement can complete",
        },
        note: "Issue #2870. The Bot froze in a cast → submit-error → cancel-target → re-cast loop because a variable-count selection answered with ZERO targets sent no mutation at all: `selectTargets` rejects an empty array and `confirmTargets` was suppressed by a non-empty-tuple guard. The same predicate is wrong at the other end of the range too — a selection filled to its max auto-finalized on the last pick, so a confirm afterwards throws — which is why the flag is now derived from the RESOLVED count reaching its max (`announcedTargetCount`, shared with `announceCast`).",
    },
    {
        // DISCRIMINATING PAIR, HALF 1 of 2 (issue #2686) — the positive-control
        // half, `stretch` (see WHY STRETCH below).
        //
        // PAIRED WITH: "discriminating pair: does NOT sacrifice a land to
        // Zuran Orb for 2 life". Neither half is meaningful alone: a bot that
        // never activates Zuran Orb passes the other, and a bot that always
        // activates it passes this one. Only the pair distinguishes a bot that
        // prices the land — and only the OTHER half bears the `manaDevelopment`
        // term this ticket ships.
        //
        // THE POSITION. The bot controls Titania (5/3), Zuran Orb, and five
        // basic lands, holds a 6-MV Craw Wurm it cannot yet cast, and faces an
        // opponent's 2/2. Sacrificing a land to Zuran Orb nets 2 life AND — via
        // Titania's own PERMANENT_LEFT trigger (CR 603.10) — a 5/3 Elemental
        // token worth far more than the land.
        //
        // WHY IT MOVED WINDOW, AND WHY IT IS NOW `must` (issue #2939).
        // As shipped by #2686 this position sat in the bot's own precombat main
        // and was `stretch`, because "activate now" and "activate later"
        // converged at the turn-boundary horizon and the root pick was seed
        // noise (measured 10/12) — the "search cannot price timing" ceiling
        // #2687 tracks. Its own note promised promotion "when #2687 lands".
        //
        // #2939 supplies that timing discipline from the tie-break side rather
        // than from search depth, and it settles the question the other way for
        // the ORIGINAL window: with the land still tapping for mana until the
        // moment it is given up, the bot's own main phase is the WRONG window,
        // and the bot now holds there deterministically (3/3). Left where it
        // was, this entry would have asserted a play the engine has since
        // decided is a mistake. So the position moves to the window where the
        // conversion IS right — the opponent's end step (CR 513.1) — keeping
        // the pair's axis (does Titania pay the land off?) exactly as #2686
        // drew it, and only the window changes. There it is deterministic on
        // all 3 of its original seeds at its original 400-iteration budget, so
        // the promotion its note asked for is taken here.
        //
        // The seats invert for the forced reason every reactive entry inverts
        // them: `me` is always the ACTIVE player in a `ScenarioSpec`, so the
        // seat holding the engine has to be `opp` for this to be the
        // OPPONENT's end step. One `pass` walks priority to the bot.
        //
        // The token payoff was never the problem and still is not:
        // `applyActivationCostsForSearch` sacrifices the land through
        // `removePermanentTo`, which queues PERMANENT_LEFT, and
        // `processPendingActionTriggers` stacks Titania's trigger; it resolves a
        // ply later (measured: material margin 427.5 → 654.5 on resolution).
        label: "discriminating pair: activates Zuran Orb when Titania pays the land off (issue #2686)",
        spec: {
            cards: [
                {
                    name: "Titania, Protector of Argoth",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Zuran Orb", owner: "opp", zone: "battlefield" },
                // The hand card that puts the bot's 5 lands ON CURVE: a 6-MV
                // card it cannot cast yet, so each of its 5 lands still has
                // development value (`handNeed 6 > lands 5`).
                { name: "Craw Wurm", owner: "opp", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "END_STEP",
            turn: 6,
            landCount: 5,
            libraryCount: 20,
        },
        setup: [{ kind: "pass", seat: "me" }],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            moves: [{ kind: "activate-ability", card: "Zuran Orb" }],
        },
        note: 'Half 1 of the discriminating pair (positive control) — PAIRED WITH "discriminating pair: does NOT sacrifice a land to Zuran Orb for 2 life (issue #2686)". The 5/3 token IS simulated (CR 603.10 PERMANENT_LEFT → trigger); the pair still asks the only question #2686 wanted asked — does the bot convert a land when Titania pays it off, and refuse when she is not there. Re-pointed and promoted `stretch` → `must` by issue #2939: the original PRECOMBAT_MAIN window was seed noise (10/12) at the timing ceiling #2687 tracks, and #2939 resolves that ceiling AGAINST the original window (the land keeps tapping for mana until it is given up, so the bot now deterministically holds in its own main phase — the sibling `activation timing: holds a sacrifice engine through its own main phase` asserts exactly that). Moved to the window where the conversion is right, it is deterministic on all 3 original seeds at the original 400-iteration budget. The term-bearing half is still the partner; this one rides the token, not `manaDevWeight`.',
    },
    {
        // DISCRIMINATING PAIR, HALF 2 of 2 (issue #2686).
        // PAIRED WITH: "discriminating pair: activates Zuran Orb when Titania
        // pays the land off". Same board minus Titania: sacrificing a land now
        // nets only 2 life for a land the `manaDevelopment` term prices at 29
        // on curve (the hand's 6-MV Craw Wurm still wants that sixth land), a
        // decisive -13 — the blunder the flat eval (17 vs 16) used to leave
        // inside the rollout-noise band, which is how the bot gave a land away
        // for 2 life on 1/5 seeds.
        label: "discriminating pair: does NOT sacrifice a land to Zuran Orb for 2 life (issue #2686)",
        spec: {
            cards: [
                { name: "Zuran Orb", owner: "me", zone: "battlefield" },
                { name: "Craw Wurm", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            landCount: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Zuran Orb" }],
        },
        note: 'Half 2 of the discriminating pair — PAIRED WITH "discriminating pair: activates Zuran Orb when Titania pays the land off (issue #2686)". Sacrificing a land nets only 2 life (16) for an on-curve land worth 29 under the `manaDevelopment` term, a decisive loss; before the term the flat eval priced a land at 17 vs 2 life at 16 — inside the rollout-noise band — and the bot gave a land away for 2 life on 1/5 seeds. Proven to fail by zeroing `manaDevWeight`.',
    },

    // ── Wasted-mana hold (the Metamorphosis report) ───────────────────────
    // A cast whose resolution leaves the bot holding floating mana NOTHING in
    // the position can spend is a card — and, behind an additional sacrifice
    // cost, a creature — traded for a resource that empties unused at the end
    // of the step (CR 106.4). The leaf evaluation says so plainly (`pass`
    // scored 218 against the cast's -12 in the reported position), but the
    // root pick is settled on the ACCUMULATED `meanMargin`, and the `pass`
    // edge's own subtree contains the same blunder one ply deeper, dragging
    // its mean BELOW the cast's — so the cast won the material tie-break at
    // every budget, `hard` included. `isWastedManaCast` (`search.ts`) holds
    // instead, whenever `pass` is outcome-equal. Each futile entry is paired
    // with a NEGATIVE CONTROL in the same shape with a spender added, where
    // the hold must have exactly zero effect.
    {
        label: "wasted mana: does not cast Metamorphosis with no creature spell to spend it on",
        spec: {
            cards: [
                { name: "Metamorphosis", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Craw Wurm", owner: "me", zone: "library", count: 10 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 1200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Metamorphosis" }] },
        note: "The reported game, reproduced: with an otherwise empty hand the bot sacrificed a Grizzly Bears and spent the card to make three creature-only mana it had no creature spell to pay for. Reproduces on EVERY seed at the `hard` budget (and 4/10 at `easy`), and only once the library holds creatures — a big body inflates the rollout margins on both sides, which is what pushes the cast's accumulated mean past `pass`'s. The creature-only mana is real inside the tree only since the cast-side sacrifice snapshot landed (`applyCastSacrificeVictims`); before that Metamorphosis resolved to nothing at all in the sandbox.",
    },
    {
        label: "wasted mana: does not burn Dark Ritual into an empty hand",
        spec: {
            cards: [{ name: "Dark Ritual", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 1200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Dark Ritual" }] },
        note: "The same blunder without the sacrifice cost, which is why the fix is not card-shaped: the bot burned the Ritual with nothing to cast, on every seed, with and without creatures in the library. Here the evaluator is actively WRONG rather than merely ignored — `availableManaFor` counts pool mana per unit (the issue #2247 asymmetry), so tapping one Swamp into three black reads as +24 at the leaf — and the hold is what corrects the pick.",
    },
    {
        label: "wasted mana NEGATIVE CONTROL: casts Dark Ritual when it turns on a Craw Wurm",
        spec: {
            cards: [
                { name: "Dark Ritual", owner: "me", zone: "hand" },
                { name: "Craw Wurm", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 1200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Dark Ritual" }] },
        note: "Negative control for the hold. One Swamp pays the Ritual, and its three black mana plus the three remaining lands exactly cover the 6-MV Craw Wurm, so a spender IS in the position and `isWastedManaCast` must not fire. Measured against the pre-fix tree, which casts here too: the guard provably costs this line nothing. One land fewer and the Wurm is a mana short — then holding is correct and the guard fires by design.",
    },
    {
        // BOAST, HALF 1 — THE GATE (CR 702.142a, issue #2375). The negative
        // half of a discriminating pair: the SAME board, before combat.
        //
        // Fair by construction in the strongest available sense — the answer
        // is forced by the RULES, not by judgement. Broadside Bombardiers has
        // not attacked this turn, so its boast ability is not activatable at
        // all (CR 702.142a: "Activate only if this creature attacked this
        // turn"). Any move is acceptable here EXCEPT that activation, which is
        // why the expectation is `forbidden` rather than a list of good plays:
        // whether the bot attacks, casts or passes is a preference, and this
        // entry has no opinion on it.
        //
        // What it guards: `requiresAttackedThisTurn` is a DECLARATIVE field
        // precisely so `enumerateAbilityMoves` (`gre/moves.ts`) can read it —
        // a `canActivate` closure is skipped wholesale by that enumerator, so
        // a closure-gated Boast would be invisible rather than gated. Drop the
        // enumerator's gate and the move is offered a turn early: the bot eats
        // its own Grizzly Bears for a boast the server would refuse, which in
        // live play is a frozen action, not a bad one.
        label: "boast: does not activate Broadside Bombardiers before it has attacked",
        spec: {
            cards: [
                {
                    name: "Broadside Bombardiers",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                // The only legal victim for the "another creature or artifact"
                // cost (CR 109.2), so the sacrifice leg has exactly one shape
                // and cannot be what makes the activation unattractive.
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                // The boast's natural target: 2 + Grizzly Bears' mana value 2
                // = 4 damage, lethal to a 3/3.
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 300 },
        // Forced by the rules, so it must hold on ANY seed (ADR 0070 §3).
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [
                { kind: "activate-ability", card: "Broadside Bombardiers" },
            ],
        },
        note: "Half 1 of the Boast pair (issue #2375). Guards the CR 702.142a activation-timing gate in `enumerateAbilityMoves`; half 2 is the same board after the attack, where the activation becomes the expected move.",
    },
    {
        // BOAST, HALF 2 — THE PAYOFF (CR 702.142a / 608.2h, issue #2375).
        // Same three permanents, walked through a real attack: the boast is
        // now legal, and it is the only thing left in the turn worth doing.
        //
        // Fair by construction: the position is deliberately narrow. Combat is
        // past blocks, so nothing about the attack is still being decided; the
        // bot's only other permanent is the Grizzly Bears the cost eats, and
        // the boast's 2 + 2 = 4 damage is lethal to the opponent's 3/3
        // (CR 704.5g). Trading a 2/2 for a 3/3 and clearing the only blocker
        // is material-positive by the evaluator's own arithmetic — no plan
        // quality, no race judgement, and no life total (which `ScenarioSpec`
        // cannot express anyway, issue #2147) is involved.
        //
        // What it guards is the POSITIVE direction of the CR 702.142a gate:
        // that a boast is genuinely reachable and preferred once the creature
        // has attacked, not merely gated. Half 1 and half 2 fail on OPPOSITE
        // breaks of the same `enumerateAbilityMoves` line — remove the gate and
        // half 1 reds (the boast is offered a turn early); make the gate always
        // fire and half 2 reds (the boast is never offered at all) — which is
        // what makes this a discriminating pair rather than two spellings of
        // one assertion. Both directions were measured.
        //
        // What it does NOT guard, measured rather than assumed: restoring the
        // `applyActivationCostsForSearch` snapshot bug this issue also closed
        // leaves BOTH halves green. The search prefers the boast off the
        // grounded announcement value, not off the damage the tree resolves, so
        // that seam is pinned by its own unit test
        // (`convex/cards/sets/lcc/__tests__/red.test.ts`), not here.
        label: "boast: eats its Grizzly Bears to boast for lethal after attacking",
        spec: {
            cards: [
                {
                    name: "Broadside Bombardiers",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                // TWO defenders: Bombardiers has menace (CR 702.111a), so a
                // single creature could not legally block it and the engine
                // would never open the DECLARE_BLOCKERS window the
                // `declare-blockers` step needs.
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            // The `declare-attackers` setup step walks the DECLARATION, not
            // the phase, so the built state must already be at the window.
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        setup: [
            // Only the Bombardiers attacks — the Bears stays home so it is
            // still on the battlefield to be eaten, and so the position is not
            // also asking "was that attack good?".
            { kind: "declare-attackers", cards: ["Broadside Bombardiers"] },
            // No blocks: a real declaration (CR 509.1), which lands the
            // position in the attacker's own priority round with the attack
            // already made — the window where CR 702.142a first admits the
            // boast.
            { kind: "declare-blockers" },
        ],
        bot: "me",
        budget: { iterations: 800 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                { kind: "activate-ability", card: "Broadside Bombardiers" },
            ],
        },
        note: "Half 2 of the Boast pair (issue #2375). The positive direction of the CR 702.142a gate: a boast must be reachable and preferred once the creature has attacked. Measured: reds when the enumerator gate is made to always fire, while half 1 stays green.",
    },

    // ── Cast from the graveyard (issue #2971) ────────────────────────────
    // A DISCRIMINATING PAIR. The only difference between the two positions is
    // the ZONE the Firebolt sits in: the graveyard, where CR 702.34a licenses
    // a flashback cast, or the library, where nothing does. The enumerator fed
    // `enumerateCastMoves` from the hand, the retrace loop and the library top
    // only, so the first position had no winning move in the Bot's move set at
    // all — `getLegalActions` said "cast", the candidate SET never asked.
    {
        label: "graveyard-cast: flashes back Firebolt from the graveyard for lethal",
        spec: {
            // Firebolt: {R} Sorcery, "deals 2 damage to any target",
            // Flashback {4}{R} (CR 702.34). Five Mountains is exactly the
            // flashback cost, so the line is affordable and unique.
            cards: [
                { name: "Firebolt", owner: "me", zone: "graveyard" },
                ...MOUNTAINS_5,
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            // The whole point of the position: two damage is lethal, and
            // `evaluate` is banded so a win dominates every material term —
            // no seed can make passing look better.
            life: { me: 20, opp: 2 },
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Firebolt" }] },
        note: "Issue #2971, half 1. The Bot must reach a cast it can only make from the GRAVEYARD. Before the graveyard loop landed, `enumerateMoves` never fed a non-retrace graveyard card to `enumerateCastMoves`, so this lethal was not in the move set and the Bot passed.",
    },
    {
        label: "graveyard-cast: does not reach for a Firebolt sitting in the library",
        spec: {
            // The SAME board, one field changed. No cast-from-top permission
            // is in play, so the library card is unreachable — and the Bot
            // must not invent a cast for it, which is the failure mode a
            // zone-blind widening of the affordance would have produced.
            cards: [
                { name: "Firebolt", owner: "me", zone: "library" },
                ...MOUNTAINS_5,
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            life: { me: 20, opp: 2 },
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Firebolt" }] },
        note: "Issue #2971, half 2 — the discriminating twin. Same lethal-shaped board, the Firebolt one zone away. The new graveyard loop gates on `graveyardCastMechanism` before the affordance precisely so the candidate set stays the cards a mechanism actually permits.",
    },
    // -----------------------------------------------------------------------
    // The reflexive MADNESS cast window (CR 702.35a) — issue #2983.
    //
    // A DISCRIMINATING PAIR: the same card, discarded the same way, differing
    // only in how many Mountains are untapped. The pair is what makes this a
    // measurement of the DECISION rather than of a preference — a bot that
    // hardcodes "cast" passes the first and fails the second, and the
    // hardcoded "decline" that shipped before this issue fails the first and
    // passes the second for the wrong reason.
    // -----------------------------------------------------------------------
    {
        label: "madness-cast-when-affordable",
        spec: {
            cards: [
                // Basking Rootwalla, Madness {0}: the cast costs LITERALLY
                // nothing and yields a 1/1 body, while declining bins the card
                // (CR 702.35a "or put it into their graveyard"). There is no
                // trade-off to weigh in either direction, which is what makes
                // this a `must` rather than a judgement call.
                { name: "Basking Rootwalla", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        setup: [
            { kind: "discard", card: "Basking Rootwalla" },
            // Resolve the reflexive madness trigger — this is what OPENS the
            // Cast/Decline window the entry measures.
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 200 },
        // ADR 0070 §3 — a forced line must hold on ANY seed.
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Basking Rootwalla" }],
        },
        note: "Issue #2983. A free (Madness {0}) creature the bot is about to lose either way: casting strictly dominates, since declining bins it for nothing. Before #2983 the window had no candidate generator, so `enumerateMoves` returned an EMPTY list here and the bot fell to a hardcoded decline — it threw the card away every time.",
    },
    {
        label: "madness-decline-when-unaffordable",
        spec: {
            cards: [
                // Anje's Ravager: printed {2}{R}, Madness {1}{R}. ONE Mountain
                // cannot pay the madness cost, so the ONLY legal answer is the
                // decline — forced by the rules, no judgement involved.
                { name: "Anje's Ravager", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    tapped: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        setup: [
            { kind: "discard", card: "Anje's Ravager" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "madness-decline" }] },
        note: "Issue #2983, the discriminating twin of `madness-cast-when-affordable`. The generator must FAIL CLOSED: with the madness cost unaffordable it emits the decline ALONE, never a cast the `announceCast` mutation would reject. Its twin proves the same generator does offer the cast when the mana is there — one entry alone would pass for a bot that hardcodes either answer.",
    },
    {
        label: "known top: digs with a cantrip because it knows the Bolt is there",
        spec: {
            // Island + Mountain is EXACTLY {U} + {R}: Thought Scour and then
            // the Bolt it draws, or the Robber, never both. The two lines
            // compete for the same two mana, which is what makes this a
            // decision rather than a sequencing question.
            cards: [
                { name: "Thought Scour", owner: "me", zone: "hand" },
                { name: "Robber of the Rich", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                // Index 0 of the bot's library — the card the `setup` step
                // makes it know, exactly as a scry keep would.
                {
                    name: "Lightning Bolt",
                    owner: "me",
                    zone: "library",
                    position: 1,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            // Opponent at 3: the Bolt the cantrip finds is exactly lethal, and
            // `evaluate` is banded so a win dominates every material term.
            life: { me: 20, opp: 3 },
            landCount: 0,
            // Filler basics, so a blind dig is worth a 1-in-21 shot at the
            // Bolt — which is what the line WAS worth before the pin.
            libraryCount: 20,
        },
        setup: [{ kind: "know-library-top" }],
        bot: "me",
        budget: { iterations: 1200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Thought Scour" }] },
        note: "Issue #1524, half 1. The bot has scryed a Lightning Bolt to the top and the opponent is at 3: the cantrip draws it and the Mountain burns them out this turn. Before #1524 `determinize` reshuffled the whole library on EVERY ISMCTS iteration, so the search never saw the Bolt on top — the dig was worth a 1-in-21 blind draw and the 2/2 haste body won the comparison, which is exactly what the twin below still asserts.",
    },
    {
        label: "known top: plays the creature instead when the known top is a blank",
        spec: {
            // The SAME board, ONE card changed: a Swamp on top instead of the
            // Bolt. The dig now finds nothing, and the 2/2 haste is the play.
            cards: [
                { name: "Thought Scour", owner: "me", zone: "hand" },
                { name: "Robber of the Rich", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "library", position: 1 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            life: { me: 20, opp: 3 },
            landCount: 0,
            libraryCount: 20,
        },
        setup: [{ kind: "know-library-top" }],
        bot: "me",
        budget: { iterations: 1200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Robber of the Rich" }],
        },
        note: 'Issue #1524, half 2 — the discriminating twin of "known top: digs with a cantrip because it knows the Bolt is there"; the two are only evidence together, so neither may be deleted alone. The pin is what makes half 1 pass, so this half proves the pin is carrying INFORMATION rather than just biasing the bot towards its cantrip: swap the pinned card and the preference flips. A pin that leaked identity, or a search that had simply learned to like Thought Scour, would pass one of these two and not the other.',
    },
];

/** "The bot answered the ENGINE-RAISED target selection with a submission the
 *  server would accept, and the game moved on" (issue #2283).
 *
 *  Deliberately NOT a shape-only `{ kind: "submit-target" }` matcher. The bug
 *  this guards is not "the bot picked the wrong permanent" (target QUALITY is
 *  explicitly out of scope) — it is that the bot produced NO action at all and
 *  the game froze forever. So the assertion is the two properties that
 *  distinguish a fix from a hang, both checked through the real engine:
 *
 *    1. LEGALITY — the chosen submission is one the enumerator actually offers
 *       for this selection (same target ids, same `confirmTargets` flag). An
 *       illegal or over-picked submission is rejected server-side and re-freezes
 *       the bot exactly as hard as no submission at all, so "did not throw" is
 *       not sufficient evidence.
 *    2. PROGRESS — replaying it through `applyMoveInSearch` (the engine's own
 *       move-application chokepoint) CLEARS `pendingTarget` and writes the
 *       chosen targets onto the trigger's stack item, i.e. the position really
 *       advances to the next priority window.
 */
function answersRaisedTargetLegally(
    move: Move | null,
    state: GameState,
    seat: BladeSeat
): boolean {
    if (!move || move.kind !== "submit-target") return false;
    const playerId = seatPlayerId(state, seat);
    const pt = raisedPendingTargetOwedBy(state, playerId);
    if (!pt) return false;

    const key = (m: Move) =>
        m.kind === "submit-target"
            ? `${m.confirmTargets}|${m.targets
                  .map((t) => `${t.type}:${t.id}`)
                  .join(",")}`
            : "";
    const legal = enumerateRaisedTargetMoves(state, playerId);
    if (!legal.some((m) => key(m) === key(move))) return false;

    // CR 603.3d — replay it and demand the selection is actually committed.
    const after = cloneGameState(state);
    applyMoveInSearch(after, playerId, move);
    if (after.pendingTarget !== undefined) return false;
    const trigger = after.stack.find((s) => s.id === pt.cardInstanceId);
    if (!trigger) return false;
    const chosen = new Set(move.targets.map((t) => `${t.type}:${t.id}`));
    const landed = trigger.targets ?? [];
    return (
        landed.length === move.targets.length &&
        landed.every((t) => chosen.has(`${t.type}:${t.id}`))
    );
}

/** Entries of one tier, in registry order. */
export function bladeScenariosForTier(
    tier: BladeScenario["tier"]
): BladeScenario[] {
    return BLADE_SCENARIOS.filter((s) => s.tier === tier);
}

/**
 * Look up one entry by its exact `label` (issue #1432 — the Debug panel's
 * read-only blade loader resolves the entry server-side from a client-
 * supplied label, so the registry — not the client — is the sole source of
 * the `spec` that gets applied to a board).
 */
export function findBladeScenario(label: string): BladeScenario | undefined {
    return BLADE_SCENARIOS.find((s) => s.label === label);
}
