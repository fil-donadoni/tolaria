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

import type { BladeScenario } from "./types";

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
        // (total power ≥ 12) is unpayable and every legal answer to the
        // may-pay sacrifices the 12/12. Countering the trigger keeps a free
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
        // (CR 701.19), reached by activating Polluted Delta through the real
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
        note: "Charter scenario 2 (the fetch target). Fetching the Island instead of the Swamp loses the Hill Giant kill BY FORCE: the bot's only other land is a Mountain, so Terror ({1}{B}) is uncastable without the Swamp and the 3/3 survives with the removal stranded in hand. The root decision is the live search-library choice (CR 701.19), reached by really activating and resolving the fetchland.",
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
        // on the stack whose punisher cost is unpayable, so the 12/12 is
        // sacrificed immediately and the card is spent for nothing.
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
        // Passes at its declared production-range budget TODAY — but the pair
        // is promoted as a UNIT or not at all (ADR 0070 §1: a `forbidden`
        // entry that a never-cast bot also satisfies asserts nothing on its
        // own). Its partner is beyond budget, so both stay report-only.
        tier: "stretch",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Phyrexian Dreadnought" }],
        },
        note: 'Half 1 of the discriminating pair — PAIRED WITH "discriminating pair: casts Phyrexian Dreadnought WITH an out (Stifle)". Neither half is meaningful alone. Passes at 400 iterations across 3 seeds; held at `stretch` until its partner passes at a production-range budget.',
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
        tier: "stretch",
        // ADR 0070 §2 — measured, not guessed: `pass` at 400 and at 800 on all
        // three seeds; `cast Phyrexian Dreadnought` on all three at 1600. The
        // budget below STAYS at the production 400; raising it to turn the
        // entry green is exactly the move the ADR forbids.
        beyondBudget: {
            cause: "horizon",
            passesAt: { iterations: 1600 },
            note: "The cast only pays off once the surviving 12/12 converts to damage, several plies past the rollout horizon; nearer the leaf the protected line scores the same as passing. The missing knowledge is VALUATION — the bot has no term for 'a threat I hold the answer to protect', so 4x the production budget is needed to reach the payoff by search alone.",
        },
        expect: {
            moves: [{ kind: "cast-spell", card: "Phyrexian Dreadnought" }],
        },
        note: 'Half 2 of the discriminating pair — PAIRED WITH "discriminating pair: does NOT cast Phyrexian Dreadnought with no out". Neither half is meaningful alone.',
    },
    {
        // CHARTER SCENARIO 2, TIMING HALF (issue #1488, PRD #1423, charter
        // gate #1434).
        //
        // Bloodstained Mire is the bot's ONLY permanent and its only mana
        // source; the hand holds Lightning Bolt ({R}); the deck's only red
        // source is the single Mountain seeded on top of the library; the
        // opponent has an untapped Hill Giant (3/3). It is the bot's
        // precombat main phase and it has no land to play.
        //
        // FAIRNESS BY CONSTRUCTION (ADR 0070 §1). No judgement: a fetchland
        // has NO mana ability (CR 305.6 — a land taps for mana only if it
        // says so, and this one says "search your library"), so cracking it
        // is the ONLY way the position can produce {R} this turn. Declining
        // it leaves Lightning Bolt uncastable for the whole turn BY FORCE —
        // the Hill Giant lives and the card stays in hand. Not "probably",
        // not "on average": there is no second red source anywhere.
        //
        // NO `setup` (ADR 0070 §4 does not apply): the decision exists the
        // moment the board is built, so this is a plain `ScenarioSpec` plus a
        // root-move expectation — the shape a future entry copies when its
        // position needs no walking forward.
        //
        // BUDGET (ADR 0070 §2): declared at the production
        // `DEFAULT_BUDGET = { iterations: 400 }` BEFORE the position was
        // tuned, and left there. Measured afterwards on eight seeds: 7/8 at
        // 400, 8/8 at 800 and at 1600 — so the entry lands `stretch` with its
        // cause classified below, NOT `must` at a raised budget.
        label: "charter: cracks its fetchland to cast the spell it can only cast this turn",
        spec: {
            cards: [
                {
                    name: "Bloodstained Mire",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                // The ONE red source in the deck, on top of the library, and
                // the only card Bloodstained Mire's "Swamp or Mountain"
                // filter can find (the synthetic base deck is all Plains).
                // `libraryCount` is deliberately left unset — it resets the
                // library AFTER placement (`scenarioBuilder.ts`) and would
                // erase this Mountain, leaving the fetch nothing to find.
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "library",
                    position: 1,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            // No basics: the fetchland must be the only route to mana.
            landCount: 0,
        },
        bot: "me",
        budget: { iterations: 400 },
        // ADR 0070 §3 — a charter entry runs K≥3 seeds.
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        // ADR 0070 §2 — measured, not guessed. Eight seeds (0xb1ade, 1..7):
        // `pass` on one seed at 400, the fetch on all eight at 800 and at
        // 1600. The classification is the point, and it was measured too:
        // adding a SECOND Hill Giant — one more candidate for the Bolt inside
        // the fetch subtree, nothing else changed — dropped 400 from 7/8 to
        // 5/8 while 800 stayed 8/8. The shortfall tracks candidate count, not
        // depth.
        beyondBudget: {
            cause: "branching",
            passesAt: { iterations: 800 },
            note: "The fetch only pays off through a sub-decision the search must also get right — which target the Bolt takes after the Mountain arrives — so the activate node's value is an average over mostly-idle continuations, and at 400 one seed never visits the killing line often enough. The missing knowledge is move PRIORS: the bot has no ordering that says 'removal spell → the only creature on the board', so the right continuation competes on equal footing with every other target. Doubling the candidate targets doubles the failure rate at a fixed budget, which is the signature of a priors gap rather than a depth gap.",
        },
        expect: {
            moves: [{ kind: "activate-ability", card: "Bloodstained Mire" }],
        },
        note: "Charter scenario 2, TIMING half. Not cracking the fetchland leaves Lightning Bolt uncastable for the whole turn by force — a fetchland produces no mana (CR 305.6) and the Mountain it retrieves is the deck's only red source — so the Hill Giant lives and the card rots in hand. This entry does NOT exercise the choice-node priors: cracking a fetchland is an ordinary enumerated activated-ability move, so it passes even if the search-library priors are wrong; the half that exercises those is the fetch TARGET, a separate entry. Do not read this one as covering the fetch charter on its own.",
    },
];

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
