/**
 * The blade entries (issue #5942). See `registry.ts` for the tier discipline
 * and how to add an entry.
 *
 * This file merges with the `append-only` driver (`.gitattributes`): two PRs
 * that each append an entry at the end both keep theirs, whole, instead of
 * conflicting; an edit to an existing line still conflicts. Append new entries
 * at the END. A helper or constant SHARED by entries belongs in
 * `scenarioPredicates.ts`. The lane's `tsc` and the blade suite still judge
 * every merged result.
 */

import type { RegistryBladeScenario } from "./types";
import { isDiscouragedRolloutMove } from "../../search";
import { instanceIdsForName, matchesMove, seatPlayerId } from "./matcher";
import { getCardByName } from "../../../cards";
import { SPLICE_COST_ID_PREFIX } from "../../splice";
import { isCategorizedPickLegal } from "../../categorizedPick";
import { damageSplitAtDamageStep } from "./damageSplitProbe";
import {
    MOUNTAINS_5,
    NINJUTSU_LANDS_4,
    floodedLandEarnsNoDevelopmentBonus,
    pruningKeepsACast,
    upToXZeroTargetCastIsExecutable,
    activationStaysAvailable,
    activationCostPicksArePaid,
    activationDiscardsCard,
    sacrificeVictimSparesTheSource,
    noActivationEnumerated,
    selfSacrificeStaysEnumerable,
    mayAttackAgain,
    timingMeasurement,
    activationIsDiscouraged,
    abilityMovesOf,
    abilityIsUnavailableOrDiscouraged,
    abilityStaysAvailable,
    DENSE_LIBRARY,
    PAYOFF_BODY,
    STIFLE_BACKUP,
    TITANIA_PAYOFF,
    EXTRA_PLAINS,
    SEVEN_POISON,
    answersRaisedTargetLegally,
    submitsSoleTarget,
    boundedGraveyardCastIsOffered,
} from "./scenarioPredicates";

export const BLADE_SCENARIOS: RegistryBladeScenario[] = [
    {
        // ORDERED TARGET GROUP reachability (CR 601.2c / 702.33g, issue
        // #4193). Kicked Jilt announces TWO targets through one widened
        // requirement and reads them positionally: slot 0 is returned to its
        // owner's hand, slot 1 is dealt 2 damage. The bot's main phase, four
        // untapped basics (exactly {1}{U} plus the {1}{R} kicker), and the
        // opponent holding a Serra Angel and a Grizzly Bears.
        //
        // Only one assignment is right, and it is not a matter of opinion:
        // bounce the 4/4 — the 2 damage cannot kill it — and burn the 2/2,
        // which dies. The other way round bounces a 2/2 for value, leaves the
        // 4/4 on the board with two damage on it, and hands the opponent a
        // card back.
        //
        // What it guards is REACHABILITY, not preference. `combinations`
        // emitted each target SET once, in board order, so exactly one of the
        // two assignments was ever a Move: the search could not have chosen
        // the other at any budget and no evaluation weight could have helped.
        // `orderedGroupFlags` (`gre/moves.ts`) is what puts both on the
        // table, and `announcedTargetSlotsDiffer` is what keeps every
        // symmetric group (Magma Burst) on the cheaper combination path.
        label: "ordered targets: bounces the Angel and burns the Bears, not the reverse",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an Angel the burn spell can kill",
            },
        },
        spec: {
            cards: [
                { name: "Jilt", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                // Bears BEFORE Angel, deliberately: `combinations` walks the
                // legal targets in board order, so the one tuple it used to
                // emit is `[bears, angel]` — the WRONG assignment. An entry
                // with the two swapped passes without the fix and proves
                // nothing.
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Serra Angel", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 600 },
        tier: "must",
        expect: {
            predicate: (move, state) => {
                if (move === null || move.kind !== "cast-spell") return false;
                const targets = move.targets ?? [];
                if (targets.length !== 2) return false;
                const angels = instanceIdsForName(state, "Serra Angel");
                const bears = instanceIdsForName(state, "Grizzly Bears");
                // Slot 0 is the bounce, slot 1 the burn (CR 601.2c).
                return angels.has(targets[0].id) && bears.has(targets[1].id);
            },
            describe:
                "kicks Jilt announcing Serra Angel first (bounced) and Grizzly Bears second (burned)",
        },
        note: "CR 601.2c ordered announcement. `MoveMatcher.target` matches ANY target, so it cannot state an ORDER — and order is the whole decision here — hence the predicate shape (as for adventure / mdfc). Issue #4193.",
    },
    {
        // KICKER {X} reachability (CR 107.3a / 702.33a, issue #2141). The
        // bot's main phase, an empty board, Verdeloth the Ancient in hand and
        // nine untapped Forests: {4}{G}{G} for the 4/7, the other three buy
        // X = 3 on its "Kicker {X}" — three Saprolings that the anthem makes
        // 2/2. Nothing else in hand wants the mana, so the full kick is
        // strictly better than any smaller X and than the bare cast.
        //
        // What it guards is REACHABILITY. The X of a Kicker {X} lives on a
        // card whose printed cost has none, and the enumerator used to key
        // its X axis off the printed cost only: the kicked cast was offered
        // with no `chosenX` at all, which `announceCast` refuses. With the
        // per-variant axis (`kickerXValues`, `moves.ts`) the X = 3 kick is a
        // Move, and nothing but this entry and `kickerXBot.bot.test.ts` goes
        // red if it stops being one.
        label: "Kicker {X}: kicks Verdeloth for every spare mana",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a second spell in hand to spend the spare mana on",
            },
        },
        spec: {
            cards: [
                { name: "Verdeloth the Ancient", owner: "me", zone: "hand" },
                ...Array.from({ length: 9 }, () => ({
                    name: "Forest",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                })),
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        // A PREDICATE for the reason the depletion-land entry below gives: a
        // reachability claim, kept out of the weight fit.
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "cast-spell" &&
                (move.kickerPayments?.kicker ?? 0) > 0 &&
                move.chosenX === 3,
            describe:
                "casts Verdeloth the Ancient kicked with X = 3, spending every spare mana",
        },
        note: "CR 107.3a / 702.33a Kicker {X} reachability — the deterministic halves (enumeration, both sandboxes charging X) are in `kickerXBot.bot.test.ts`. Issue #2141.",
    },
    {
        // DEPLETION-LAND reachability (CR 605.1a / 118.3 / 701.21, issue
        // #2712). The bot's main phase, an empty board, one Grizzly Bears
        // ({1}{G}) in hand and ONE land: Hickory Woodlot, untapped, entering
        // the scenario with the two depletion counters its own CR 614.1c
        // replacement gives it. A single tap of that land makes {G}{G} — the
        // whole cost — so casting is the only line that is not `pass`, and a
        // 2/2 on an empty board is strictly better than holding it.
        //
        // The claim is REACHABILITY, not preference, and nothing else goes red
        // when it breaks. The land's mana is gated behind a FIXED
        // `cost.removeCounter` leg, and `planManaPayment` credits a {T}
        // ability's GROSS yield only for legs in
        // `TAP_YIELD_CREDITABLE_COST_LEGS` (deny-by-default, issue #3027): an
        // uncredited `removeCounter` made the land worth ONE mana, so the plan
        // for a two-mana cast came back null and the bot simply held the Bears
        // forever — with every suite green, the same silent failure the
        // adventure and MDFC entries below exist for.
        label: "depletion land: casts a two-drop off one tap of Hickory Woodlot",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Hickory Woodlot", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        tier: "must",
        // A `predicate`, deliberately, not a `moves` matcher — the adventure and
        // MDFC entries' shape. This is a REACHABILITY claim ("the bot can spend
        // this land at all"), not a verdict about which of two moves is better,
        // and `expect.moves` is what `verdictsFromRegistry` turns into a fitted
        // VERDICT (ADR 0124 §5). Feeding a reachability position to the weight
        // fit moved the vector far enough to flip an unrelated `must` entry
        // ("choice-behind payoff: the re-type mode denies the opponent the
        // colour it is visibly using", then still seed-pinned around a tie and
        // red at seed 19; issue #3534 has since re-expressed it as an
        // unpinned preference) — a preference regression bought
        // with a claim that has no preference in it. The entry still blocks at
        // `must`; what it no longer does is vote on the weights.
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "cast-spell" &&
                // ONE tap funds the whole {1}{G}: the discriminating half. A
                // depletion land credited one mana yields no plan at all, so
                // there is no cast to match; two entries here would mean the
                // land was not the source.
                move.tapPlan?.length === 1,
            describe: "casts Grizzly Bears off a single tap of Hickory Woodlot",
        },
        note: "CR 605.1a depletion-land reachability. Also the end-to-end cover for `removeCounter` in `TAP_YIELD_CREDITABLE_COST_LEGS` (moves.ts) and for the scenario builder defaulting a battlefield land's entry counters from `resolveEntersWithCounters` — a land placed with zero counters is not a mana source at all, so this entry fails on either half.",
    },
    {
        // FINITE MANA SOURCE — the SPARE half of the discriminating pair
        // (CR 118.3 / 122.1 / 605.1a, issue #3530). The bot's main phase,
        // Hickory Woodlot at full charge beside two Forests, and a Grizzly
        // Bears ({1}{G}) in hand. Both payments cover the cost exactly: two
        // Forests, or ONE tap of the Woodlot — which spends a charge the land
        // can never get back and brings it one activation from sacrificing
        // itself (CR 701.21).
        //
        // Until issue #3530 the position held ONE cast candidate, because
        // `planManaPayment` returned one plan and settled the payment inside
        // itself; this entry is only writable at all because the two payments
        // are now two Moves. And the evaluation, measured on this exact board,
        // scored the Woodlot payment +1.000000 ABOVE the Forests one — one
        // source tapped instead of two, with nothing counting what the tap
        // spent. Both halves are needed: the term without the candidates is
        // unfittable, the candidates without the term hand the search a choice
        // it evaluates backwards.
        label: "depletion land: pays the two-drop with the basics, sparing the land's charge",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Fireball in hand that is lethal only with the land's last charge",
            },
        },
        spec: {
            cards: [
                { name: "Hickory Woodlot", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Grizzly Bears",
                    // EXACT, and the whole entry: the two candidates differ in
                    // nothing else, so a partial matcher would accept both and
                    // state no preference at all.
                    taps: ["Forest", "Forest"],
                },
            ],
        },
        note: "Issue #3530, the SPARE half. Read with its twin below: neither alone separates a Brain that reads scarcity from one that never spends a finite source, or always does. Guards the `finiteManaUses` evaluation term AND the second tap plan `castTapPlans` (moves.ts) emits — deleting either leaves this entry with one candidate or with the wrong one on top.",
    },
    {
        // FINITE MANA SOURCE — the SPEND half (CR 118.3 / 701.21, issue
        // #3530). Sandstone Needle on its LAST charge beside two Mountains,
        // Fireball ({X}{R}) in hand, the opponent at 3. Four mana on the board
        // and no other way to reach them: X=3 is lethal and it is payable only
        // by tapping the Needle, which removes its last depletion counter and
        // sacrifices the land (CR 701.21).
        //
        // The pair is the point. A Brain that simply never spends a finite
        // source passes the entry above and fails this one by casting a
        // smaller Fireball; a Brain that always spends fails the entry above.
        // Only one that PRICES the charge — and lets a win dominate it, as
        // `evaluate`'s terminal band does — answers both.
        label: "depletion land: spends the last charge because it is the only lethal",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Sandstone Needle",
                    owner: "me",
                    zone: "battlefield",
                    counters: { depletion: 1 },
                },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Fireball", owner: "me", zone: "hand" },
            ],
            life: { opp: 3 },
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        tier: "must",
        // A `predicate`, like the reachability entry above and for a reason
        // MEASURED on this position: `expect.moves` is what
        // `verdictsFromRegistry` turns into a fitted verdict (ADR 0124 §5), and
        // the claim here is a TERMINAL one. A win's magnitude is scaled by no
        // fittable weight, so the Eval Pair "X=3 over X=2" carries an all-zero
        // feature basis — it landed in the fit's own CONTRADICTORY bucket
        // ("identical feature vectors, opposite order") beside every other
        // win-decided pair, contributing noise to the vector rather than a
        // preference. The entry still blocks at `must`; what it does not do is
        // vote on the weights. The entry ABOVE is the half that carries the
        // preference into the corpus.
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "cast-spell" &&
                // X=3 is the lethal one, and only it needs all three sources —
                // the third being the Needle's last charge.
                move.chosenX === 3 &&
                move.tapPlan.length === 3,
            describe:
                "casts Fireball for X=3 off all three sources, spending Sandstone Needle's last charge",
        },
        note: "Issue #3530, the SPEND half of the pair opened above. Also the guard that the scarcity weight stays under a win: a fit that priced a charge above the terminal band would take the smaller Fireball and this entry reds.",
    },
    {
        // FLOATING-MANA reachability (CR 106.6, issue #3235). `me` has NO
        // permanents at all and one {1}{R} creature in hand; the only mana on
        // the board is two red floating in the TAGGED `restrictedMana` list —
        // Arena of Glory's bare-rider shape, a unit that carries no
        // `restriction` and no `castableCardId` and is therefore spendable on
        // absolutely anything (`restrictedUnitAllowsSpell` returns true for it
        // unconditionally). Casting is the only line that is not `pass`.
        //
        // The claim is REACHABILITY, not preference, and nothing else goes red
        // when it breaks — which is the whole reason the entry exists.
        // `getLegalActions` (rules.ts) has always folded eligible restricted
        // mana into its affordability census, but `planManaPayment` (moves.ts)
        // read `player.manaPool` alone, so the two authorities disagreed in the
        // direction that makes the bot WEAKER: the cast was legal for a human
        // and simply never enumerated for the bot, which passed holding mana
        // (`docs/findings/3354-bot-mana-readers-miss-restricted-pool.md`).
        //
        // That finding called it latent "unless a shipped restricted source
        // ever becomes auto-tappable". Firebending (CR 702.189a) is that
        // source: its four red arrive from an attack trigger the bot cannot
        // decline, so the gap is no longer reachable-only-on-purpose. This
        // entry pins the CLASS — `unrestrictedFloatingMana` (gre/state.ts)
        // admits the rider unit below and firebending's lifetime unit by the
        // same predicate — rather than the card, because a firebending board
        // needs a live combat step and would test the mana through a second
        // mechanism at the same time.
        label: "floating mana: casts off a tagged-but-unrestricted unit with no permanent on the board",
        classification: { kind: "absolute" },
        spec: {
            cards: [{ name: "Goblin Ski Patrol", owner: "me", zone: "hand" }],
            restrictedMana: {
                me: [{ color: "R", amount: 2, hasteRider: true }],
            },
            phase: "PRECOMBAT_MAIN",
            turn: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        tier: "must",
        // A `predicate`, like the depletion-land entry below and for the same
        // reason: a reachability claim carries no preference, and feeding one
        // to `verdictsFromRegistry` would move the fitted weights on a
        // question that has no verdict in it (ADR 0124 §5).
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "cast-spell" &&
                // The discriminating half: `me` controls NOTHING, so a plan
                // with any tap in it would mean the mana came from somewhere
                // this board does not have. Pool-sourced mana is a zero-tap
                // `PlanSource` by construction (`cardInstanceId` undefined).
                (move.tapPlan?.length ?? 0) === 0,
            describe:
                "casts its two-drop off the floating unrestricted unit, taps nothing",
        },
        note: "CR 106.6 floating-mana reachability. Covers `unrestrictedFloatingMana` at both readers that consume it — `planManaPayment` (gre/moves.ts, which decides whether the cast is enumerated at all) and `poolUnits`/`manaCensusFor` (gre/manaAvailability.ts, the colour-aware castability census). Genuinely RESTRICTED units are deliberately still excluded from both, since their eligibility depends on the cost being paid.",
    },
    {
        // ADVENTURE reachability (CR 715.3, issue #3303). The bot holds one
        // card with two castable halves and only two lands: the creature half
        // ({2}{R}) is unaffordable, the Adventure ({1}{R}) kills the
        // opponent's only creature outright. Every other line on this board —
        // pass, play nothing — leaves a 2/2 alive for free.
        //
        // The claim is REACHABILITY, not preference, and it is the claim worth
        // pinning: an Adventure is not a cheaper price for the same spell, it
        // is a DIFFERENT spell with its own cost, type line and script (CR
        // 715.3b), reached only if `enumerateMoves` offers the alternative cast
        // option and the commit path stamps it. Nothing else goes red when that
        // seam breaks — the bot simply never plays the half, the same silent
        // failure the ninjutsu entry above exists for.
        //
        // It also covers this slice's new Op end to end: Stomp's script is
        // `suppressDamagePrevention` followed by `dealDamage`, so a valuer or
        // beneficence row that read the first Op as a reason NOT to cast would
        // show up here as a bot that declines a free kill.
        label: "adventure: casts Stomp to kill the blocker, not the Giant it cannot afford",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Bonecrusher Giant", owner: "me", zone: "hand" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        tier: "must",
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "cast-spell" &&
                (move.alternativeCostId ?? "").startsWith("adventure:"),
            describe: "casts Bonecrusher Giant as its Adventure half (Stomp)",
        },
        note: "CR 715.3 Adventure reachability. `MoveMatcher` has no field for `alternativeCostId`, so the predicate shape (as for overload / dash). Also the end-to-end cover for the `suppressDamagePrevention` Op inside Stomp's script.",
    },
    {
        // PREPARATION reachability (CR 722.3c). The bot controls a PREPARED
        // Skycoach Conductor — the builder stages "enters prepared" with its
        // exiled copy of All Aboard — one Island, and a Flametongue Kavu; the
        // opponent has a Serra Angel. Casting the copy flickers the Kavu: it
        // returns as a new object (CR 400.7) and its enters trigger deals 4
        // damage to the Angel. Passing leaves the Angel alive and the copy
        // unused; nothing else on the board costs {U}.
        //
        // The claim is REACHABILITY of the copy's cast: a card in exile whose
        // `card.id` is a twin, castable only through `castableFromExileBy`.
        // A seam that dropped it — the non-hand cast enumeration, the twin's
        // targeting or timing, the CR 601.2i unprepare — makes the bot pass.
        label: "preparation: casts the prepare spell's exiled copy to re-buy an enters trigger",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Skycoach Conductor",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Flametongue Kavu", owner: "me", zone: "battlefield" },
                { name: "Serra Angel", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        tier: "must",
        expect: {
            // A `predicate`, not a `moves` matcher: the claim is that the
            // cast is REACHABLE and taken (the adventure entry's shape), not a
            // preference between two legal moves the weight fit should learn.
            predicate: (move, state) =>
                matchesMove(state, move, {
                    kind: "cast-spell",
                    card: "All Aboard",
                    target: "Flametongue Kavu",
                }),
            describe: "casts the exiled copy of All Aboard on Flametongue Kavu",
        },
        note: "CR 722.3c prepare-copy cast reachability: the copy is matched by the prepare spell's own name, which resolves to the registered twin the exiled instance carries.",
    },
    {
        // MDFC LAND-PLAY reachability (CR 712.12, ADR 0122, issue #3311). The
        // bot's main phase, an empty board, and ONE card in hand: Sink into
        // Stupor — whose printed type line says Instant. Its land face is the
        // only thing it can do that is not `pass`, and the land drop is
        // strictly non-negative (CR 305.2), so the position is deliberately as
        // unambiguous as the Forest control below.
        //
        // What it guards is not the preference but the REACHABILITY: before
        // this slice `enumerateMoves` filtered land plays on
        // `types.includes("Land")`, which is false for this card in every
        // zone (CR 712.8a), so the bot would hold it forever and pass. The
        // matcher resolves the card by its FRONT face's name, which is the
        // card's own name (CR 712.8a) — there is no second name to match on.
        label: "mdfc: plays the land face of a card whose front face is an instant",
        classification: { kind: "absolute" },
        spec: {
            cards: [{ name: "Sink into Stupor", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        tier: "must",
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "play-land" &&
                move.face === "back",
            describe:
                "plays Sink into Stupor as Soporific Springs (its back face)",
        },
        note: 'CR 712.12 land-play reachability. `MoveMatcher` has no field for the chosen FACE, so the predicate shape (as for adventure / overload): a `{ kind: "play-land", card: "Sink into Stupor" }` matcher would pass on a front-face play that cannot legally exist, which is the one outcome this entry has to be able to fail on.',
    },
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
        classification: { kind: "absolute" },
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
        // OVERLOAD preference (CR 702.96, issue #3215). Damn's two cast modes
        // are two different spells, not a cheap price and a dear one: printed
        // ({B}{B}) it destroys ONE creature, overloaded ({2}{W}{W}) it destroys
        // EACH of them. This position makes the choice unambiguous — the
        // opponent has three Craw Wurms, the bot has no creature of its own, so
        // the overload mode's one real cost (it hits your board too, CR 702.96a
        // — "target" becomes "each" everywhere, with no "you don't control"
        // clause on Damn) is priced at zero here.
        //
        // BOTH modes are affordable, which is what makes this a PREFERENCE
        // entry rather than a reachability one: two Swamps cover the printed
        // {B}{B} and four Plains cover the overload {2}{W}{W}. A tree that
        // enumerated only the printed cast, or that enumerated both but
        // stamped no `overloaded` marker (so the overload line resolved as the
        // same one-creature removal spell — the exact erasure issue #2796
        // documented for bestow), would take the printed cast or split on
        // noise. Three-for-one against one-for-one is a wide enough gap that
        // it needs no lookahead: the board after is visible at depth 1.
        label: "overloads Damn to wrath three creatures instead of killing one",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a creature of the bot's own the overloaded wrath would also kill",
            },
        },
        spec: {
            cards: [
                { name: "Damn", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Craw Wurm", owner: "opp", zone: "battlefield" },
                { name: "Craw Wurm", owner: "opp", zone: "battlefield" },
                { name: "Craw Wurm", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        tier: "must",
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "cast-spell" &&
                move.alternativeCostId === "overload",
            describe: "casts Damn via its overload cost (not the printed cast)",
        },
        note: "CR 702.96 reachability AND preference in one position: three opposing Craw Wurms, no creature of the bot's own, both cast modes affordable. `MoveMatcher` has no field for `alternativeCostId` — the only thing distinguishing an overloaded cast from a printed one of the same card — hence the `predicate` shape, the same one the dash entry uses.",
    },
    {
        // NINJUTSU reachability (CR 702.49a, issue #2390). The bot attacks with
        // a lone 2/2, the defender declines to block, and the position lands in
        // the priority round after blocks are declared — the ONLY window in
        // which the ninjutsu cost is payable at all, because CR 509.1h makes an
        // attacker neither blocked nor unblocked before then.
        //
        // The claim is REACHABILITY, not preference: swapping an unblocked 2/2
        // for a 5/4 that keeps attacking is not a matter of opinion, but the
        // reason this entry exists is that until this issue `enumerateMoves`
        // never scanned the HAND for activated abilities at all
        // (`enumerateAbilityMoves` took the battlefield and the graveyard), so
        // EVERY `activateFromHand` ability — Cycling included — was a move the
        // bot could not see. That failure is invisible to every other suite:
        // nothing goes red, the bot simply never ninjutsus.
        label: "ninjutsu: swaps its unblocked attacker for Fallen Shinobi",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Fallen Shinobi", owner: "me", zone: "hand" },
                // A body the defender COULD block with — `declare-blockers`
                // with no blocks is still a real declaration, and the engine
                // never opens the window for a defender with nothing to
                // declare.
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                // {2}{U}{B} — basics rather than `landCount` because the
                // ninjutsu cost is coloured: two Islands and two Swamps cover
                // the {U}, the {B} and the {2}.
                ...NINJUTSU_LANDS_4,
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
        setup: [
            { kind: "declare-attackers", cards: ["Grizzly Bears"] },
            { kind: "declare-blockers" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "activate-ability", card: "Fallen Shinobi" }],
        },
        note: "Bot reachability for Ninjutsu (issue #2390). Guards the hand scan `enumerateAbilityMoves` gained in the same change: without it no `activateFromHand` ability is ever enumerated, and the bot holds a Fallen Shinobi it can never play. The window is the cost's own (CR 509.1h), which is why the setup walks all the way through the block declaration.",
    },
    {
        // ATTACK-TRIGGER VISIBILITY (CR 508.1m, issue #3222). Until this
        // change neither search sandbox emitted ATTACKERS_DECLARED at all —
        // `applyMoveInSearch`'s `declare-attackers` marked the attackers and
        // went straight to priority, while its `declare-blockers` sibling two
        // cases below had always called `emitBlockersConfirmedEvents`. So every
        // attack trigger in the catalogue was invisible to the bot: battle
        // cry's pump, exalted's, annihilator's sacrifice, a token-making swing.
        //
        // DISCRIMINATING BY CONSTRUCTION, and MEASURED both ways: the
        // opponent sits at 5 behind a TAPPED Craw Wurm (6/4) — it cannot block
        // (CR 509.1a) but it untaps and swings for six next turn, and the bot
        // is at 4. Sanguine Evangelist (2/1, battle cry) plus a Grizzly Bears
        // (2/2) is FOUR printed power, one short; the CR 702.91a trigger pumps
        // the Bears to 3/2 and makes the swing exactly lethal. With the
        // trigger visible, attacking with BOTH wins on the spot; with it
        // unseen the same swing leaves the opponent at 1 and hands the bot a
        // lethal crackback it kept no blocker for, so keeping the Bears home
        // to chump scores better. The Wurm is deliberately a GROUND fatty: a
        // flier the Bears could not block would make holding back worthless
        // and the position would swing all-in either way.
        //
        // MEASURED at 400 iterations across all five seeds: WITH the emission
        // the chosen move is `declare-attackers` with both creatures on every
        // seed; with `emitAttackersDeclaredEvents` deleted from
        // `applyMoveInSearch` it is `declare-attackers` with an EMPTY attacker
        // set on every seed. The two worlds pick different moves, which is
        // what makes this a pin rather than a position the bot swings into
        // regardless.
        label: "battle cry: swings for exactly-lethal only the pump provides",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Sanguine Evangelist",
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
                {
                    name: "Craw Wurm",
                    owner: "opp",
                    zone: "battlefield",
                    tapped: true,
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 3,
            libraryCount: 20,
            life: { me: 4, opp: 5 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "declare-attackers",
                    cards: ["Sanguine Evangelist", "Grizzly Bears"],
                },
            ],
        },
        note: 'Issue #3222 — the attack-trigger seam, pinned by the one shape that cannot be argued with: five life, four printed power, and the fifth point coming only from battle cry\'s +1/+0 on the OTHER attacker (CR 702.91a). Guards `emitAttackersDeclaredEvents` in `applyMoveInSearch` (`gre/search.ts`); deleting it flips every seed from "attack with both" to "attack with nobody", measured. Not battle-cry-specific by construction — the emission is the class fix, and exalted / annihilator / attack-token triggers ride the same line.',
    },
    {
        // MUST. The attack-target seam (CR 508.1b / 510.1b, issue #2798). A
        // 3/3 faces an opposing Garruk Wildspeaker at its starting 3 loyalty,
        // no blocker, the opponent at 20: three damage at the walker kills it
        // (CR 120.3c, 704.5i) and ends a permanent that makes a 3/3 every
        // turn; three at the face is 15% of a life total. Kill the walker.
        //
        // MEASURED at 400 iterations across all five seeds: with the fix the
        // chosen move attacks Garruk on every seed; before it, the in-tree
        // declaration dropped `attackTargets` and the combat predictor read
        // a walker attack as face damage, so the two declarations were ONE
        // position to the search and seed 2 swung at the player.
        label: "attack target: kills the planeswalker rather than chipping the player",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Garruk Wildspeaker",
                    owner: "opp",
                    zone: "battlefield",
                    counters: { loyalty: 3 },
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "declare-attackers",
                    card: "Hill Giant",
                    target: "Garruk Wildspeaker",
                },
            ],
        },
        note: "Issue #2798 — the declared attack target, end to end in the search: `applyMoveInSearch` carries `attackTargets` (shared `declaredAttackTargets`), and `predictCombatOutcome` routes an unblocked walker attacker's damage to `walkerDamage` (loyalty, CR 120.3c) instead of `faceDamage`. Without either, an attack at the walker and the same attack at the player are one position to the search and the pick is seed noise.",
    },
    {
        // MUST. The other half of the attack-target pair: the SAME board, the
        // opponent at 3 life. Now the 3/3 at the player is lethal (CR 704.5a)
        // and Garruk is irrelevant — swing at the face.
        //
        // MEASURED at 400 iterations across all five seeds: with the fix the
        // bot attacks the player on every seed; before it, it sent the lethal
        // attacker at Garruk on every seed — the in-tree declaration played
        // the walker attack as a face attack, so it "won" in the search too.
        label: "attack target: takes the lethal swing at the player over the planeswalker",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Garruk Wildspeaker",
                    owner: "opp",
                    zone: "battlefield",
                    counters: { loyalty: 3 },
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 3,
            libraryCount: 20,
            life: { opp: 3 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move) =>
                move?.kind === "declare-attackers" &&
                move.attackerIds.length > 0 &&
                Object.keys(move.attackTargets ?? {}).length === 0,
            describe:
                "declare-attackers with the Hill Giant at the player — no attacker aimed at the planeswalker",
        },
        note: "Issue #2798 — discriminating pair with the entry above (only the opponent's life differs): it pins that the walker preference comes from the walker's worth, not from a bias toward walker targets. Before the fix every seed attacked Garruk with lethal on the table.",
    },
    {
        // MUST. The CR 508.1g optional-attack-cost seam (issue #3214, exert).
        // Glorybringer 4/4 flier swings into an untapped Serra Angel, the one
        // creature on the board that can block it — and trades with it exactly.
        // Exerting is the whole card: 4 damage kills the Angel before blockers
        // are declared, so the swing connects AND the blocker is gone, for the
        // price of one missed untap. Declining trades a 5-drop for a 5-drop.
        //
        // Written as a `predicate` because `MoveMatcher` has no exert field:
        // the decision here is not WHICH creatures attack (there is only one)
        // but whether the declaration pays the optional cost, which lives on
        // `Move.exertIds`. Guards the whole chain in one line — enumeration
        // (`enumerateAttackerMoves` emitting the paid variant at all),
        // application (`applyMoveInSearch` carrying `exertIds` into
        // `combat.exertedIds`) and payment (`emitAttackersDeclaredEvents` →
        // `payDeclaredExertCosts`, whose linked trigger is what kills the
        // Angel). Drop any one of them and the paid variant is either never
        // offered or scores identically to declining.
        label: "must: exerts Glorybringer to kill the blocker it would trade with",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an opposing attacker Glorybringer must stay untapped to block next turn",
            },
        },
        spec: {
            cards: [
                {
                    name: "Glorybringer",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Serra Angel",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 9,
            landCount: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xe8e27, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move) =>
                move?.kind === "declare-attackers" &&
                (move.exertIds ?? []).length > 0,
            describe:
                "declares an attack that PAYS the optional exert cost (CR 508.1g / 701.43d)",
        },
        note: "Issue #3214 — the exert seam. The position is chosen so the exert payoff and its price cannot be confused: 4 damage removes the only blocker (which would otherwise trade one-for-one with Glorybringer), and the price — not untapping next turn — is a cost the search only sees beyond its horizon, so a passing entry proves the payoff reaches the root decision rather than that the price was mispriced.",
    },
    {
        // MUST. The CR 508.1c set-dependent attack restriction (issue #5495).
        // Scarred Puma "can't attack unless a black or green creature also
        // attacks"; its only companion is a red Gray Ogre, into an empty board.
        // The one legal attack is the Ogre ALONE. Before the fix
        // `enumerateAttackerMoves` offered Ogre + Puma (more damage, so the
        // search took it) and `confirmAttackers` threw on it, freezing the game.
        label: "must: never declares Scarred Puma without a black or green co-attacker",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Scarred Puma",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Gray Ogre",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0x5495, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move, state) => {
                if (move?.kind !== "declare-attackers") return false;
                const pumas = instanceIdsForName(state, "Scarred Puma");
                const ogres = instanceIdsForName(state, "Gray Ogre");
                return (
                    move.attackerIds.some((id) => ogres.has(id)) &&
                    !move.attackerIds.some((id) => pumas.has(id))
                );
            },
            describe:
                "attacks with Gray Ogre ALONE — Scarred Puma has no black or green co-attacker (CR 508.1c)",
        },
        note: "Issue #5495 — the enumeration seam for `declared-attack-restriction`. `enumerateAttackerMoves` prunes subsets through `declaredAttackRestrictionViolation`, the same predicate `validateDeclaredAttackers` throws on at confirm; deleting the filter puts the illegal Ogre + Puma declaration back in the move list, where it out-scores the Ogre alone.",
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an opposing creature that cracks back for lethal",
            },
        },
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
        // MUST (issue #3376), the anchor of the risk-free-attack pair.
        label: "discriminating pair: does NOT attack with Walking Ballista into an untapped Hill Giant",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "the untapped opposing Hill Giant removed — an empty board",
            },
        },
        spec: {
            cards: [
                {
                    name: "Walking Ballista",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    counters: { "+1/+1": 2 },
                },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                // Real cards, not `hiddenHand`: a blade position must load
                // into a live game (issue #1432); basic lands stand in as
                // slots whose value no board changes.
                { name: "Forest", owner: "opp", zone: "hand", count: 5 },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [
                { kind: "declare-attackers", card: "Walking Ballista" },
            ],
        },
        note: 'Issue #3376, the anchor of the risk-free-attack pair: a 2/2 Walking Ballista facing one untapped 3/3 the opponent blocks with. The block kills the Ballista and survives it, so the attack is a loss and holding it back is right. Its right-hand half, "discriminating pair: attacks with a counter-bodied Walking Ballista into an empty board", removes the Hill Giant; the pair is what proves the #3376 fix bought discrimination rather than a blanket bias toward attacking (this half is green before and after the fix, before on `wasteful-attack`).',
    },
    {
        // MUST (issue #3376). The risk-free attack, on a body whose counters
        // ARE its toughness: a 2/2 Walking Ballista, four lands, the
        // opponent's board empty. Nothing can block it and nothing in the
        // position punishes the tap, so declining the attack throws away two
        // damage. The vanilla twin of this position (Hill Giant / Grizzly
        // Bears) attacked on every seed; the Ballista did not.
        label: "discriminating pair: attacks with a counter-bodied Walking Ballista into an empty board",
        pairOf: {
            anchor: "discriminating pair: does NOT attack with Walking Ballista into an untapped Hill Giant",
            discriminant: {
                kind: "card",
                detail: "the untapped opposing Hill Giant removed — an empty board",
            },
        },
        spec: {
            cards: [
                {
                    name: "Walking Ballista",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    counters: { "+1/+1": 2 },
                },
                // Real cards, not `hiddenHand`: a blade position must load
                // into a live game (issue #1432); basic lands stand in as
                // slots whose value no board changes.
                { name: "Forest", owner: "opp", zone: "hand", count: 5 },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "declare-attackers", card: "Walking Ballista" }],
        },
        note: "Issue #3376. MEASURED before the fix, 400 iterations: the attack on 2 of 12 seeds, every pick `material-tiebreak` inside `outcomeEps`, the declined attack ahead by up to 8 margin points. The root leaves of the two edges are identical (no damage is dealt at the declaration); the gap came from below. The rollout's ε draw and the tree's own children kept firing the shoot ability — one variant per player and creature against one `pass` — and each shot spends a +1/+1 counter, i.e. a slice of the body (`costShrinksSource`). A declared attack opens three more bot windows (blocks, damage, end of combat) than a declined one, so the attack edge's subtree lost the Ballista more often and its own two damage drowned in that. `isSourceBodyDamageConversion` drops those shots from both sites below the root; attack on 12 of 12 seeds at 1, 2 and 3 counters, 0 to 6 lands, with or without hands.",
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
        classification: { kind: "absolute" },
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
        // (`convex/gre/activation.ts`) — the exact function the `activateAbility`
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a blue spell in hand needing the Island, in place of Terror",
            },
        },
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
        // DISCRIMINATING PAIR, HALF 1 of 2 (issue #1487) — the ANCHOR of a
        // Minimal Pair declared in data (issue #4797): the right-hand half
        // names this entry in its `pairOf`. NEITHER ENTRY PROVES ANYTHING ALONE — a bot that
        // never casts Dreadnought passes this one, and a bot that always casts
        // it passes the other. Only the pair distinguishes a bot that reads
        // the consequence. Deleting either half silently guts the other, which
        // is why the half's `pairOf` names this one.
        //
        // No Stifle, no other creature: casting the Dreadnought puts a trigger
        // on the stack whose punisher cost can only be paid by sacrificing the
        // Dreadnought itself, so every legal answer sacrifices the 12/12
        // immediately and the card is spent for nothing.
        label: "discriminating pair: does NOT cast Phyrexian Dreadnought with no out",
        classification: { kind: "conditional", discriminant: STIFLE_BACKUP },
        spec: {
            cards: [
                { name: "Phyrexian Dreadnought", owner: "me", zone: "hand" },
            ],
            // The postcombat main phase, matched to the partner (issue
            // #4882): the pair still differs by the out alone.
            phase: "POSTCOMBAT_MAIN",
            turn: 3,
            // Two Islands, matched to the partner (issue #4797): the declared
            // Minimal Pair differs by Stifle alone, so the second Island that
            // would pay for it sits here too — idle, as no out needs it.
            landCount: 2,
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
        note: "Half 1 of the discriminating pair — the anchor of the Minimal Pair its right-hand half declares by `pairOf`. Neither half is meaningful alone. Both halves pass at 400 iterations across 3 seeds.",
    },
    {
        // FODDER BOARD, NO OUT (issue #4825) — the refusal Test Position that
        // keeps "Dreadnought is castable" from reading as "always cast it".
        // Same Dreadnought as the pair above, still no Stifle, but now the
        // punisher cost (CR 118: sacrifice creatures with total power 12 or
        // greater) CAN be paid without the Dreadnought itself.
        //
        // FAIRNESS BY CONSTRUCTION (ADR 0070 §1): four Hill Giants carry
        // exactly the 12 power the trigger asks for. Casting pays for a 12/12
        // trampler with the whole board — four bodies worth about 800 for one
        // worth about 513 — and the position holds no lethal and no race the
        // 12/12 decides (the opponent has an empty board and the default 20
        // life). The narrow boards where this trade pays off are NOT asserted
        // either way.
        //
        // BUDGET (ADR 0070 §2): the pair's own production-range 400, declared
        // before the position was built and never raised to make it pass.
        label: "refusal: does NOT cast Phyrexian Dreadnought onto a fodder board with no out",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "Stifle in hand, with a land to cast it",
            },
        },
        spec: {
            cards: [
                { name: "Phyrexian Dreadnought", owner: "me", zone: "hand" },
                ...Array.from({ length: 4 }, () => ({
                    name: "Hill Giant",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    summoningSick: false,
                })),
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 3,
            landCount: 1,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Phyrexian Dreadnought" }],
        },
        note: 'Refusal entry for issue #4825, beside the empty-board refusal of the discriminating pair. Four Hill Giants (12 power) can pay the punisher cost, so the cast is legal and affordable — and a loss: four bodies for one 12/12. Casting it here is a Bot bug, never a reason to move the position. See "discriminating pair: casts Phyrexian Dreadnought WITH an out (Stifle)" for the play the pair exists to show.',
    },
    {
        // DISCRIMINATING PAIR, HALF 2 of 2 (issue #1487) — the right-hand half
        // of the Minimal Pair its `pairOf` declares (issue #4797). Same
        // position plus one card (Stifle), whose mana the anchor holds idle: now the trigger can be countered, so casting the
        // Dreadnought is a free 12/12 and IS expected.
        label: "discriminating pair: casts Phyrexian Dreadnought WITH an out (Stifle)",
        pairOf: {
            anchor: "discriminating pair: does NOT cast Phyrexian Dreadnought with no out",
            discriminant: STIFLE_BACKUP,
        },
        spec: {
            cards: [
                { name: "Phyrexian Dreadnought", owner: "me", zone: "hand" },
                { name: "Stifle", owner: "me", zone: "hand" },
            ],
            // The LAST main phase of the turn (issue #4882): `pass` here
            // defers the 12/12 a whole turn cycle. In the precombat main
            // phase `pass` reaches the postcombat one with the same cast
            // still open, and with no attacker casting before or after
            // combat is a coin a human does not care about — so that board
            // asked a question with two right answers.
            phase: "POSTCOMBAT_MAIN",
            turn: 3,
            // Two untapped Islands: {1} for the Dreadnought and {U} held up
            // for Stifle.
            landCount: 2,
            libraryCount: 20,
            // Opponent at the default 20 on purpose. The answer does not
            // depend on a clock: a protected 12/12 in play now beats the same
            // 12/12 and its counterspell held for a turn, at any life total
            // and at the price of both cards. Issue #4882 measured why this
            // read as a tie: the hand term priced a creature at a FIXED 0.85
            // of its body, so Dreadnought (396) + Stifle (118) in hand summed
            // to the 12/12 in play (513) and deploying it was material-neutral.
            // `latentCreatureDiscount` is now fitted, and this entry is the
            // Verdict that moves it.
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        // ADR 0070 §2 — measured, not guessed, on the precombat board before
        // issue #4882 (re-measured since only at the production 400):
        // `cast Phyrexian Dreadnought` on
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
        note: "Half 2 of the discriminating pair — the right-hand half of the Minimal Pair its `pairOf` declares. Neither half is meaningful alone.",
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
        classification: { kind: "absolute" },
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
        classification: { kind: "absolute" },
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
        classification: {
            kind: "conditional",
            discriminant: { kind: "life", detail: "the bot at 40 life" },
        },
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
        // WHAT CARRIES THE VERDICT, and why this entry went red once (PR #3092).
        // The reward scale is SATURATED here: the position sits ~1 100
        // `evaluate` points behind, past `materialFull` (500), so
        // `materialSignal` clips and both branches map to the same reward —
        // the spread that remains is rollout terminal residue, and it favours
        // the chump by a stable 0.035 at every budget from 400 to 3 200
        // iterations. Both saturation-proof measures say decline (`meanMargin`
        // -1103 vs -1185, `blockDeltaOf` -192 vs -312), and both sit behind
        // `selectRootMove`'s `outcomeEps` (0.05) gate — so the correct move
        // rode a 0.015 clearance. #3092's restored declare-blockers priority
        // window moved the sampling noise and seed 727774 crossed to 0.052,
        // taking the entry red with nothing about the bot's PREFERENCE having
        // changed. `selectRootMove` now admits the empty declaration — the
        // baseline `blockDeltaOf` is defined against — unconditionally, so the
        // verdict no longer depends on that clearance: measured 0/12 seeds
        // blocking at 200, 400, 800 and 1 600 iterations.
        //
        // Before #2147 this position was simply unwritable: `ScenarioSpec`
        // had no way to say "opp at 40", so the only life-dependent board
        // reachable was the ambient default — which is what would have made
        // a "block or die" entry pass for the wrong reason had it been
        // authored without care.
        label: "life-dependent: does NOT chump-block when the incoming damage isn't lethal (issue #2147)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "life",
                detail: "the bot at 20 life, where the unblocked damage is lethal",
            },
        },
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
        // DOMINATED BLOCK (issue #6914), lowered from a real game. A 6/6 attacks
        // a defender at 2 life holding a 4/4, a 2/2 and a 1/1; the attacker
        // keeps red open for the 6/6's own "{R}, sacrifice: 6 damage to each
        // creature and each player", which at 3 life against 2 is a draw. The
        // defender must block. Throwing the 4/4 in front alone is the one block
        // that is strictly worse than another legal block: the 1/1 chump also
        // kills nothing and also stops all 6, losing less; the 4/4 + 2/2 double
        // block kills the attacker.
        //
        // At a time-capped budget each declaration gets a handful of visits,
        // and the attacker's node under each is still an average over its
        // untried replies, the draw-sacrifice among them. MEASURED before the
        // fix at this budget: the lone 4/4 out-rewarded both better blocks by
        // more than `outcomeEps` on seeds 6 and 16, so the block-quality
        // tie-break never saw them (`blockDeltaOf` ranked the lone 4/4 last).
        // Admitting any block whose exchange dominates a contender's
        // (`blockOutcomeDominates`) closes it; with no red source for the
        // attacker the same board never produced the blunder.
        label: "dominated block: never throws the 4/4 alone in front of a 6/6 when the 1/1 chump does the same job (issue #6914)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Bloodfire Colossus",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Slimy Kavu",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Mogg Jailer",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Quirion Explorer",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield", count: 2 },
                {
                    name: "Darigaaz's Caldera",
                    owner: "me",
                    zone: "battlefield",
                },
                {
                    name: "Geothermal Crevice",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Tinder Farm", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "hand" },
                {
                    name: "Glade Gnarr",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Benalish Lancer",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Dega Disciple",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Plains", owner: "opp", zone: "battlefield", count: 5 },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 4 },
                { name: "Yavimaya Barbarian", owner: "opp", zone: "hand" },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 30,
            landCount: 0,
            libraryCount: 18,
            life: { me: 3, opp: 2 },
        },
        setup: [{ kind: "declare-attackers", cards: ["Bloodfire Colossus"] }],
        bot: "opp",
        // The time-capped regime the blunder lives in: at 160+ iterations the
        // means converge and the reward band admits every survival block.
        budget: { iterations: 50 },
        seeds: [1, 2, 6, 16],
        tier: "must",
        expect: {
            predicate: (move, state) => {
                if (move === null || move.kind !== "declare-blockers")
                    return false;
                if (move.assignments.length === 0) return false;
                const gnarr = instanceIdsForName(state, "Glade Gnarr");
                return !(
                    move.assignments.length === 1 &&
                    gnarr.has(move.assignments[0].blockerId)
                );
            },
            describe:
                "blocks the 6/6 with anything but the lone Glade Gnarr (the 1/1 chump dominates it)",
        },
        note: "Issue #6914 — a block whose exchange is dominated (kills no more, stops no more, loses more) must never be picked over the block that dominates it, even when rollout noise at a time-capped budget out-rewards it by more than `outcomeEps`. Lowered from a real game's Copy State. Red before the fix on seeds 6 and 16 at 50 iterations; the lone 2/2 block stays legal here because the engine values the 2/2 and the 1/1 equally.",
    },
    {
        // POISON-LETHAL (issue #5153) — charter scenario 4's question, block or
        // die, asked of the OTHER loss: the bot holds 8 poison counters and the
        // attacker is a 2/2 with infect, so the 2 unblocked damage arrives as
        // the ninth and tenth counter (CR 702.90b) and loses the game at the
        // next SBA check (CR 704.5c). Life is irrelevant — the bot is at 20 and
        // the attack takes none of it, which is exactly why a life-only
        // `lethalUnblockedDelta` read "take it" as a 2-point chip. The 1/1
        // chump trades nothing (it cannot kill a 2/2), so the block is the
        // materially losing move survival requires.
        label: "poison-lethal: chump-blocks the infect attacker whose damage is the tenth poison counter (issue #5153)",
        classification: {
            kind: "conditional",
            discriminant: { kind: "other", detail: "the bot at 8 poison" },
        },
        spec: {
            cards: [
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Savannah Lions",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            continuousEffects: [
                {
                    layer: 6,
                    affected: { me: ["Grizzly Bears"] },
                    controller: "me",
                    payload: { kind: "keyword-grant", keyword: "infect" },
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
            poison: { opp: 8 },
        },
        setup: [{ kind: "declare-attackers" }],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "declare-blockers", card: "Savannah Lions" }],
        },
        note: "Issue #5153. The 2/2 infect attacker's 2 unblocked damage is the bot's ninth and tenth poison counter (CR 702.90b / 704.5c); the 1/1 chump is the only way to live. Guards the correct play, NOT the poison branch of `lethalUnblockedDelta`: measured 5/5 seeds blocking at 400 iterations on the base before that branch existed and with it removed — the rollout reaches the real damage step and the SBA records the loss. The discriminating entries are the `poison clock` pair below. Side measurement: the bot also chumps a VANILLA 2/2 with this 1/1 at 20 life (5/5), so no `does not chump at 0 poison` control is written here (docs/findings).",
    },
    {
        // POISON CLOCK, HALF 1 of 2 (issue #5153) — a Terror and two targets: a
        // vanilla Hill Giant (3/3) and a Grizzly Bears granted infect (2/2).
        // With no poison on the bot the bigger body is the bigger threat (3
        // of 20 life a turn against 2 of 10 counters) and the bigger loss to
        // the opponent, so Terror takes the Giant.
        label: "poison clock: Terror takes the bigger vanilla Hill Giant when the bot holds no poison (issue #5153)",
        classification: { kind: "conditional", discriminant: SEVEN_POISON },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Swamp",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Terror", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
            ],
            continuousEffects: [
                {
                    layer: 6,
                    affected: { opp: ["Grizzly Bears"] },
                    controller: "opp",
                    payload: { kind: "keyword-grant", keyword: "infect" },
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                { kind: "cast-spell", card: "Terror", target: "Hill Giant" },
            ],
        },
        note: "Issue #5153, half 1 of the poison-clock pair. No poison on the bot: Terror takes the bigger vanilla body, 5/5 seeds at 400 iterations, on the base and with the poison model alike. The anchor proves the 7-poison half below flips on the poison counters alone.",
    },
    {
        // POISON CLOCK, HALF 2 of 2 (issue #5153) — the same board with the bot
        // at seven poison counters: the infect 2/2 now kills in two attacks
        // (7 → 9 → 11, CR 704.5c) where the Giant needs seven, so it is the
        // creature to answer.
        label: "poison clock: Terror takes the infect Grizzly Bears over the bigger Hill Giant at seven poison (issue #5153)",
        pairOf: {
            anchor: "poison clock: Terror takes the bigger vanilla Hill Giant when the bot holds no poison (issue #5153)",
            discriminant: SEVEN_POISON,
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Swamp",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Terror", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
            ],
            continuousEffects: [
                {
                    layer: 6,
                    affected: { opp: ["Grizzly Bears"] },
                    controller: "opp",
                    payload: { kind: "keyword-grant", keyword: "infect" },
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
            poison: { me: 7 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                { kind: "cast-spell", card: "Terror", target: "Grizzly Bears" },
            ],
        },
        note: "Issue #5153, half 2 of the poison-clock pair. At seven poison the infect 2/2 kills in two attacks, past the rollout's one-round horizon, so only the evaluation can see it. Measured 5/5 seeds at 400 iterations: Terror on Grizzly Bears with the poison model; on the base (no poison term, life-only danger clock) Terror on Hill Giant 5/5. Proof of failure: `poisonWeight` 0 → the bot passes 5/5; the danger clock's poison fraction removed → Hill Giant 5/5.",
    },
    {
        // RECIPIENT-KEYED SOURCE SHIELD (issue #5410) — charter scenario 4's
        // board again (4 x Craw Wurm into a lone Grizzly Bears, bot at 20),
        // plus a Protective Sphere the bot activated with {G} BEFORE the
        // attack, choosing one Craw Wurm: "prevent all damage that would be
        // dealt to you this turn by" it (CR 615.1a). Built through the real
        // activation, resolution and choice (`setup`), never a hand-placed
        // shield. That Wurm's 6 never reaches the bot, so the unblocked total
        // is 18 into 20 — not lethal — and the 2/2 chump is pure material
        // loss, exactly as in the life-40 control above.
        //
        // The shield carries `recipientPlayerId`, so only the recipient-KEYED
        // call `declaredFaceDamage` makes for the defending player reads it;
        // the recipient-agnostic call alone does not.
        label: "recipient-keyed source shield: no chump-block when one attacker's damage to you is prevented (issue #5410)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "Protective Sphere's shield on one Craw Wurm",
            },
        },
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
                {
                    name: "Protective Sphere",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
            manaPool: { opp: { G: 1 } },
            priority: "opp",
        },
        setup: [
            { kind: "activate", card: "Protective Sphere", controller: "opp" },
            { kind: "resolve-top" },
            { kind: "choose", cards: ["Craw Wurm"] },
            { kind: "declare-attackers" },
        ],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "declare-blockers", card: "Grizzly Bears" }],
        },
        note: "Issue #5410: charter scenario 4's board plus a Protective Sphere shield (activated with {G}, one Craw Wurm chosen) — that Wurm's damage dealt to the bot is prevented (CR 615.1a), so 18 unblocked into 20 is not lethal and the chump-block is pure material loss. Guards the recipient-keyed `sourcePreventionShieldApplies` call in `declaredFaceDamage`. MEASURED at 400 iterations on all 5 seeds: declines with that call, chump-blocks 5/5 with it removed (the evaluator then counts the shielded Wurm's 6 as landing).",
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "life",
                detail: "the bot at a life total the crackback does not kill",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no opposing creature for the removal to hit",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: { kind: "card", detail: "three opposing Craw Wurms" },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no creature on either battlefield",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an opposing creature to sacrifice",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an opponent with no creature and no planeswalker",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a creature token of the bot's own",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no creature token of the bot's own",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a creature card in the bot's graveyard",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a graveyard with no creature card",
            },
        },
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
        classification: { kind: "absolute" },
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
        classification: { kind: "absolute" },
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
        label: "ability variant: fateseals atop the OPPONENT's library, never its own",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Jace, the Mind Sculptor",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Island", owner: "me", zone: "battlefield", count: 4 },
                {
                    name: "Mountain",
                    owner: "opp",
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
                {
                    kind: "activate-ability",
                    card: "Jace, the Mind Sculptor",
                    target: "me",
                },
            ],
        },
        note: "Issue #3006 — the ABILITY-half twin of the Wild Growth entry above, found by censusing `OP_BENEFICENCE`. Jace's `+2` is CR 701.29 fateseal: `targetRequirement: { type: \"player\" }` offers BOTH seats (CR 115.1), and `scryReorder` carried no sign, so it read `neutral` and every target tuple tied inside `OUTCOME_EPS`. The reorder moves no card between zones, so `resolvedMarginDelta` is blind by construction — the sign is the only term that can separate the two variants. `scryReorder` is now a PARAMETRIZED case (`opBeneficence`): `chooser` set means somebody else decides what stays on top of `player`'s library, which is an attack on `player`; `chooser` unset is a plain scry and a gift. `forbidden` rather than a positive `target: opp` match, because declining to activate the `+2` at all — banking loyalty, or taking the `0` — is legitimate play. Naming yourself is not forbidden because it is never right: with `chooser` set to you it degenerates to a plain scry (CR 701.22), which is occasionally the better line. It is forbidden because `opBeneficence` signs an Op WITHOUT reading the board (the rule the `addPlayerCounter` case is tested against), so one sign has to cover both, and the sign that matches the standard play is `harmful`. The cost is that this `must` entry closes off the self-scry line; the alternative was leaving the slot unranked entirely.",
    },
    {
        label: "cast variant: casts Flash of Insight at X ≥ 1, never X = 0",
        classification: { kind: "absolute" },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a graveyard payoff of the bot's own (e.g. a reanimation target in hand)",
            },
        },
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
        label: "choice-behind payoff: no self-only re-type of the sole mana source",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "opposing Forests the re-type mode can reach",
            },
        },
        spec: {
            cards: [
                { name: "Vision Charm", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield", count: 1 },
                { name: "Counterspell", owner: "me", zone: "hand", count: 2 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 1,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [12, 14, 15, 16, 18, 19, 25, 27],
        tier: "must",
        expect: {
            predicate: (move) =>
                !(
                    move?.kind === "cast-spell" &&
                    move.chosenModeIds?.[0] === "land-type"
                ),
            describe:
                "not the land-type mode (which can only re-type the bot's own sole blue source)",
        },
        note: "Issue #3194, position A of the discriminating pair. The only land on either battlefield is the bot's own Island, so the land-type mode can do nothing but re-type its own single blue source — and passing, or the mill mode aimed at the opponent, is free. Three seams each failed to see it, and the fix is measured on THESE seeds: before it, all eight cast the self-only mode (8 of 30 swept seeds); after it, none of the thirty does. The seeds are the failing ones on purpose — an entry seeded where the noise already fell the right way proves nothing. Pair with position B below, which is the SAME mode in a position where it is correct and which this fix leaves untouched (7 of 30 seeds picked it, before and after, byte-identical, when #3194 measured it; issue #3534 re-expressed B around the colour axis and it is now 30 of 30).",
    },
    {
        label: "choice-behind payoff: the re-type mode denies the opponent the colour it is visibly using",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "only the bot's own Island on the battlefield",
            },
        },
        spec: {
            cards: [
                { name: "Vision Charm", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield", count: 1 },
                { name: "Counterspell", owner: "me", zone: "hand", count: 2 },
                {
                    name: "Forest",
                    owner: "opp",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 1,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        // ADR 0070 §3 — the canonical K>=3 seed set, NOT a pinned list. Issue
        // #3534 measured the whole 0..29 sweep this entry used to be seeded
        // from: 30 of 30 pick the mode. There is no longer a tie to seed
        // around, so the seeds carry no information beyond "not a single
        // draw".
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move) =>
                move?.kind === "cast-spell" &&
                move.chosenModeIds?.[0] === "land-type",
            describe:
                "the land-type mode, which strips the opponent of the colour it is visibly using",
        },
        note: "Issue #3194, position B — the discriminating twin, and the reason position A's guard is a preference and not a ban. The opponent controls three Forests, so the same mode reaches the opponent's mana base and `reachesOnlyOwnSideThroughChoice` (search.ts) answers false on the very first branch that re-types one of them: no penalty, no hold. PROVEN to still discriminate: with `reachesOnlyOwnSideThroughChoice` forced true for every cast, every seed here stops casting. WHAT CHANGED (issue #3534): until #3532 this entry was a pinned list of the seeds where rollout noise fell the right way, because the mode's whole payoff — the opponent loses green — priced at exactly zero on a colour-blind SOURCE COUNT, and the entry's own note said so. `colorCoverage` (`ai/colorCoverage.ts`) is that axis, and it needs the demand to OUTLIVE the supply: three Forests and nothing else re-base the estimate with the re-type (the Forests become Islands, so {G} leaves the demand set with the last source that evidenced it) and the denial prices at zero even now. The Grizzly Bears is the surviving evidence — the same shape as #3532's own pair, where the Bears is what makes killing the Forest better than killing the Plains — so re-typing the Forests leaves a demanded colour with no source. MEASURED over seeds 0..29 at 200 iterations: 8 of 30 picked the mode without the Bears (22 took the mill mode), 30 of 30 with it. The entry now asserts a PREFERENCE.",
    },
    {
        label: "cast variant: Ancestral Recall draws for the BOT, not the opponent",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the opponent's library down to two cards, so the draw decks them",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no spell in hand the extra mana could cast",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "stack",
                detail: "a removal spell on the stack aimed at Mother of Runes",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "stack",
                detail: "an empty stack in the bot's own main phase",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "stack",
                detail: "an empty stack in the bot's own main phase",
            },
        },
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
        note: "Issue #1920, the CHOICE half of the Mother negative control directly above. Same position, but asserting the chosen move: with a Bolt on the stack aimed at her, Mother protects herself and the Bolt fizzles on an illegal target (CR 608.2b / 702.16b). DISCRIMINATING: measured on the pre-#1920 engine at 4 of 5 seeds green and seed 0xb1ade RED (it passed and let her die) — precisely the documented failure shape, an activation tying `pass` inside `OUTCOME_EPS` with the pick falling to rollout noise. Green on all 5 seeds after. Worth reading as the pin on the WEAKEST link in this change: Mother's payoff sits behind a mid-resolution colour choice (CR 601.2b), so `policyValue`'s one-resolution lookahead sees NO payoff here at all — this entry passes because the deeper tree answers the choice node and resolves the Bolt. Still true after issue #3293 taught that lookahead to SETTLE a suspended resolution: it settles one only when the suspended item is the sole thing on the stack, and here the Bolt sits underneath it, so this position is deliberately left exactly as it was. That restriction is not incidental — settling through it measured `pass` ranked above the activation and reds `activationTiming.bot.test.ts`. What makes the 1-ply leaf non-negative is the in-flight clause of the board flexibility term (`hasFlexibleActivation`, `gre/evaluate.ts`); without it the activation scores exactly W_FLEX below `pass` and drops out of `selectRolloutMove`'s exact-equality bucket.",
    },
    {
        label: "activation payoff: Prodigal Sorcerer zaps in response to removal aimed at it",
        classification: {
            kind: "conditional",
            discriminant: { kind: "life", detail: "the opponent at 1 life" },
        },
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
        classification: {
            kind: "conditional",
            discriminant: { kind: "stack", detail: "an empty stack" },
        },
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
        label: "activation timing: does not shoot away its own last counter at a face on 20",
        classification: {
            kind: "conditional",
            discriminant: { kind: "life", detail: "the opponent at 1 life" },
        },
        spec: {
            cards: [
                {
                    name: "Walking Ballista",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    counters: { "+1/+1": 1 },
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 2,
            libraryCount: 20,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Walking Ballista" }],
        },
        note: "Issue #3192, the HOLD half — the reported blunder, reduced to its position: a 1/1 whose whole body is one +1/+1 counter, and paying the shoot cost puts it in the graveyard (CR 704.5f) to move a 20-life face to 19. MEASURED at 400 iterations, seed 0xb1ade, before the fix: the shot at the opponent's face won on `mechanism: material-tiebreak` with visits 102 / mean 0.4963 / meanMargin -7.32 against `pass` at visits 100 / mean 0.4928 / meanMargin -14.44, all four root moves inside `outcomeEps` (`contenderCount: 4`, `gapReward` 0.0035 against a 0.05 band). The issue and issue #3296 both assumed a ~126-point evaluation gap kept this position out of the tie-break's reach; it does not, because the gate is on mean REWARD and reward saturates. What made the accumulated margin agree with the blunder is rollout noise of exactly the shape #2939 documented: the ε-random branch throws the Ballista away inside the `pass` subtree too, measured as a leaf material margin of 3.53 at ε=0.25 against 165 at ε=0. After the fix the pick is `mechanism: hold-trick` on all 5 seeds. Its discriminating twin is the FIRE half directly below.",
    },
    {
        label: "activation payoff: shoots its own last counter at a face on 1",
        classification: {
            kind: "conditional",
            discriminant: { kind: "life", detail: "the opponent at 20 life" },
        },
        spec: {
            cards: [
                {
                    name: "Walking Ballista",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    counters: { "+1/+1": 1 },
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 2,
            libraryCount: 20,
            life: { me: 20, opp: 1 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "activate-ability",
                    card: "Walking Ballista",
                    target: "opp",
                },
            ],
        },
        note: "Issue #3192, the FIRE half — the identical board with the opponent at 1, and the reason the hold half is not satisfied by a blanket \"never remove the last counter\" prune. The counter buys the game here, so the hold tie-break must never see it: MEASURED at 400 iterations, seed 0xb1ade, BOTH before and after the fix, the shot wins on `mechanism: mean-reward` with `exploredSize: 1` / `contenderCount: 1` at mean 0.9150 and meanMargin 160.00, against `pass` at visits 68 / mean 0.7621 / meanMargin 152.44 — a gap of 0.153 against the 0.05 outcome-equality band, so the tie-break is never consulted at all. Deleting the hold half's clause leaves this entry green, and deleting the clause's board-awareness (promoting `removeCounter` wholesale) leaves it green too; only the pair pins both directions. Re-measured by issue #3376: `pass`'s 0.76 was rollout noise — its subtree shot the Ballista away before the lethal attack in a quarter of its lines. With that noise gone (`isSourceBodyDamageConversion`) `pass` reads as the lethal attack a combat later with the Ballista alive, a richer win than the shot, and took the pick (0.938 against 0.915); the shot is back on `mean-reward` because a won leaf now pays for the game time it took (`scoreLeaf`'s `since`), which puts the win now more than `outcomeEps` above the win a combat later.",
    },
    {
        label: "counter count: holds an Etched Oracle whose payment removes its last four counters",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "one more +1/+1 counter on the Etched Oracle",
            },
        },
        spec: {
            cards: [
                {
                    name: "Etched Oracle",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    counters: { "+1/+1": 4 },
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 3,
            libraryCount: 20,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Etched Oracle" }],
        },
        note: "Issue #3296, the HOLD half of the counter-count pair: an Etched Oracle (a 0/0 whose body is its counters) carrying exactly the four counters its draw-three cost removes. Paying it leaves a 0/0 that dies (CR 704.5f), so the activation spends the permanent although the definition says no sacrifice. MEASURED at 400 iterations on all 5 seeds: `pass` on `mechanism: mean-reward`; with the `costDestroysSource` clause neutralised the same position activates on all 5 seeds on `material-tiebreak`, so this half is what turns red when the board-awareness is removed. (Walking Ballista cannot carry this half any more: since issue #3376 its last-counter hold is decided by mean reward whatever the clause says.) Its twin is the entry directly below.",
    },
    {
        label: "counter count: draws with an Etched Oracle that keeps a counter after paying",
        pairOf: {
            anchor: "counter count: holds an Etched Oracle whose payment removes its last four counters",
            discriminant: {
                kind: "other",
                detail: "one more +1/+1 counter on the Etched Oracle",
            },
        },
        spec: {
            cards: [
                {
                    name: "Etched Oracle",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    counters: { "+1/+1": 5 },
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 3,
            libraryCount: 20,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "activate-ability", card: "Etched Oracle" }],
        },
        note: "Issue #3296, the FIRE half: the identical board with FIVE counters, so the payment leaves a 1/1 standing and gives up no body. MEASURED at 400 iterations on all 5 seeds: the activation, on `mechanism: material-tiebreak`. This is the half that keeps the clause positional: promoting every `removeCounter` cost to a standing spend would hold this activation too, and the bot would be frozen on counter costs it can afford.",
    },
    {
        label: "activation timing: does not shoot away its own last counter at the opponent's end step",
        classification: {
            kind: "conditional",
            discriminant: { kind: "life", detail: "the opponent at 1 life" },
        },
        spec: {
            cards: [
                {
                    name: "Walking Ballista",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                    counters: { "+1/+1": 1 },
                },
            ],
            phase: "END_STEP",
            turn: 5,
            landCount: 2,
            libraryCount: 20,
            life: { me: 20, opp: 20 },
        },
        // `me` is always the ACTIVE player in a `ScenarioSpec`, so the seat
        // holding the Ballista has to be `opp` for this to be the OPPONENT's
        // end step from the bot's point of view. The built board hands priority
        // to the active player; one `pass` walks it to the bot (CR 513.1).
        setup: [{ kind: "pass", seat: "me" }],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Walking Ballista" }],
        },
        note: "Issue #3319 — the HOLD half of the pair above, one window later, and the window a real game actually loses the Ballista in. The issue-#3192 fix rides on the hold-the-trick rule, which is gated on `isSorceryTimingFor`: it only ever looks at the bot's OWN sorcery window, so the entry above passed while the identical board at the opponent's end step still threw the creature away. MEASURED at 400 iterations on seeds 0xb1ade/1/2, before this change: PRECOMBAT_MAIN picked `pass` on `mechanism: hold-trick` and END_STEP picked the shot at the face on `mechanism: material-tiebreak`, `contenderCount: 4` with `gapReward` 0.0038 against the 0.05 outcome band — all four root moves outcome-equal, so mean reward never decided it and the subtree-accumulated margin did. The fix is the `standing-spend-hold` tie-break, the missing direction of the issue-#2939 last-window FIRE rule: FIRE converts when the robust pick is `pass` and firing pays, this holds when the robust pick IS the spend and firing does not. After it the pick is `pass` on `mechanism: standing-spend-hold` on all 5 seeds. Its discriminating twin is the entry directly below.",
    },
    {
        label: "activation payoff: shoots its own last counter at the opponent's end step for lethal",
        classification: {
            kind: "conditional",
            discriminant: { kind: "life", detail: "the opponent at 20 life" },
        },
        spec: {
            cards: [
                {
                    name: "Walking Ballista",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                    counters: { "+1/+1": 1 },
                },
            ],
            phase: "END_STEP",
            turn: 5,
            landCount: 2,
            libraryCount: 20,
            life: { me: 1, opp: 20 },
        },
        setup: [{ kind: "pass", seat: "me" }],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "activate-ability",
                    card: "Walking Ballista",
                    target: "me",
                },
            ],
        },
        note: "Issue #3319, the FIRE half — the same end-step board with the opponent on 1, and the proof that `standing-spend-hold` bought discrimination rather than a blanket refusal to ever spend a permanent outside the bot's own main phase. MEASURED at 400 iterations on all 5 seeds, both before and after the change: the shot wins on `mechanism: mean-reward`, so it out-rewards `pass` by more than `OUTCOME_EPS` and the new tie-break is never consulted at all. It is protected by TWO independent gates and neither alone is load-bearing, MEASURED: removing only `firingBeatsHolding` leaves it green (no `pass` sits within `OUTCOME_EPS`, so the rule finds nothing to hold), and removing only the `OUTCOME_EPS` gate leaves it green too (firing wins the game, so `firingBeatsHolding` is true and the rule is silent). Removing BOTH turns this entry AND the PRECOMBAT_MAIN fire half above red together — which is what proves the pair is not vacuous, and that the new rule is live in every window rather than only this one.",
    },
    {
        label: "activation timing: does not shoot away its own last counter after attacking with it",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an opposing 2/2 blocking the Ballista",
            },
        },
        spec: {
            cards: [
                {
                    name: "Walking Ballista",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    counters: { "+1/+1": 1 },
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 2,
            libraryCount: 20,
            life: { me: 20, opp: 20 },
        },
        // Attack, then walk priority forward to the damage step: the Ballista
        // is UNBLOCKED (the opponent controls no creature), so it has already
        // dealt its combat damage and is standing exactly as it would outside
        // combat.
        setup: [
            {
                kind: "declare-attackers",
                cards: ["Walking Ballista"],
                haltForDefenderResponse: true,
            },
            { kind: "pass", seat: "opp" },
            { kind: "pass", seat: "me" },
            { kind: "pass", seat: "opp" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Walking Ballista" }],
        },
        note: "Issue #3369 — the reported blunder, and the third window the same board had to be pinned in. The issue-#3192 pair covers the bot's own sorcery window and the issue-#3319 pair the opponent's end step; BOTH shipped while the bot still attacked with the Ballista and threw it away one step later, because `standing-spend-hold` was gated on `!rootState.combat` and hold-the-trick is gated on `isSorceryTimingFor`, so the whole combat was unowned. MEASURED at 400 iterations, seed 0xb1ade, before this change: at COMBAT_DAMAGE the shot at the face won on `mechanism: material-tiebreak`, `contenderCount: 4`, `gapReward` 0.0042 against the 0.05 band — the creature had already dealt its combat damage and was spent for one more point at 19 life. After it the pick is `pass` on `mechanism: standing-spend-hold`, and the walk shows the Ballista surviving every later window of the turn as well (END_OF_COMBAT and END_STEP on `standing-spend-hold`, POSTCOMBAT_MAIN on `hold-trick`). Its discriminating twin is the entry directly below, where the same creature is blocked and SHOULD be spent.",
    },
    {
        label: "activation payoff: shoots its own last counter when the block has already doomed it",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no blocker on the Ballista",
            },
        },
        spec: {
            cards: [
                {
                    name: "Walking Ballista",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    counters: { "+1/+1": 1 },
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
            landCount: 2,
            libraryCount: 20,
            life: { me: 20, opp: 20 },
        },
        setup: [
            { kind: "declare-attackers", cards: ["Walking Ballista"] },
            {
                kind: "declare-blockers",
                blocks: [
                    { blocker: "Grizzly Bears", attacker: "Walking Ballista" },
                ],
            },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "activate-ability", card: "Walking Ballista" }],
        },
        note: "Issue #3369, the FIRE half, and the reason the hold could not simply be extended over the whole combat. A 1/1 whose body is one +1/+1 counter, blocked by a 2/2, is DEAD either way (CR 510.1c): the counter is worth nothing held, so shooting it before damage is free value rather than the blunder the hold rule exists to stop. MEASURED at 400 iterations on all 5 seeds: green on `origin/staging`, RED on the intermediate version of this change that removed the `!rootState.combat` gate without adding `isInPendingCombatExchange` (the bot held the Ballista and let it die for nothing on `mechanism: standing-spend-hold`), green again with the exchange predicate in place. That predicate is deliberately NOT a lethality calculation — it fails open on any pending exchange rather than re-deriving assignment, deathtouch and prevention outside the modules that own them — so an attacker blocked by something too small to kill it is left to mean reward, sub-optimal at worst.",
    },
    {
        label: "activation timing: does not shoot away its own last counter after surviving a block",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "step",
                detail: "the declare-blockers step, before combat damage, with the 2/2 block pending",
            },
        },
        spec: {
            cards: [
                {
                    name: "Walking Ballista",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    counters: { "+1/+1": 1 },
                },
                {
                    name: "Wall of Stone",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 2,
            libraryCount: 20,
            life: { me: 20, opp: 20 },
        },
        // Blocked by a 0/8 — the Ballista deals its 1 damage into the wall and
        // comes through the exchange untouched, so by COMBAT_DAMAGE it is
        // standing again with its counter intact.
        setup: [
            { kind: "declare-attackers", cards: ["Walking Ballista"] },
            {
                kind: "declare-blockers",
                blocks: [
                    { blocker: "Wall of Stone", attacker: "Walking Ballista" },
                ],
            },
            { kind: "pass", seat: "me" },
            { kind: "pass", seat: "opp" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Walking Ballista" }],
        },
        note: "Issue #3369 review finding 2 — the blunder ONE BLOCKER away from the entry above, and the reason `isInPendingCombatExchange` needs a PHASE guard rather than `blockersConfirmed`. `state.combat` — `confirmed`, `blockersConfirmed`, `attackerIds` and `blockerAssignments` all included — SURVIVES both damage steps and is torn down only as END_OF_COMBAT ends (CR 511.3); `evaluate.ts`'s `declaredFaceDamage` already carries the same guard for the same reason. A 0/8 Wall of Stone cannot kill a 1/1, so the Ballista comes through the exchange standing, but the stale declaration made the predicate read it as still blocked and the hold rule went silent for the rest of the turn. MEASURED at 400 iterations before the guard: `activate-ability` targeting the face on ALL 5 seeds, at COMBAT_DAMAGE, at 20 life. `FIRST_STRIKE_DAMAGE` is deliberately left inside the exchange window — regular damage is still coming (CR 510.4) — so this entry pins the post-damage half only.",
    },
    {
        label: "activation timing: does not activate Iron-Shield Elf with no threat",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "stack",
                detail: "a Lightning Bolt on the stack aimed at the Elf",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a 1/1 blocker assigned to the Elf",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: { kind: "card", detail: "the Elf unblocked" },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "stack",
                detail: "a Bolt on the stack aimed at the Bears",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: { kind: "stack", detail: "an empty stack" },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "step",
                detail: "the bot's beginning of combat, before attackers",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "step",
                detail: "the bot's second main phase, its combat over",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "an extra combat owed after this one (CR 500.8)",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: { kind: "other", detail: "no extra combat owed" },
        },
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
        label: "manland animation: declines a summoning-sick Mishra's Factory on its own turn",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the land entered this turn (summoning sick)",
            },
        },
        spec: {
            cards: [
                {
                    name: "Mishra's Factory",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: true,
                },
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
                abilityIsUnavailableOrDiscouraged(
                    state,
                    "me",
                    "Mishra's Factory",
                    "mishras-factory-animate"
                ),
            describe:
                "the animation carries the rollout-policy penalty: a sick body can neither attack nor, on the mover's own turn, block",
        },
        note: "Issue #4238 (a manland turned into a body that cannot fight). Position-asserted for the same measured reason as the issue-#1890 siblings: `applyMoveInSearch` never puts an activated ability's effect on the stack, so a chosen-move assertion would ride rollout noise. Placed at BEGINNING_OF_COMBAT, not PRECOMBAT_MAIN: a main phase with an empty stack is already the sorcery-speed window, which discourages every deferrable activation whatever the body is, so a main-phase entry could not tell the new clause from the old one. Sick-body clause (CR 302.6, CR 508.1a).",
    },
    {
        label: "manland animation: keeps animating a Mishra's Factory that is not summoning sick",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the land entered this turn (summoning sick)",
            },
        },
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
                abilityStaysAvailable(
                    state,
                    "me",
                    "Mishra's Factory",
                    "mishras-factory-animate"
                ),
            describe:
                "the animation is enumerated with no rollout-policy penalty",
        },
        note: "Issue #4238 (a manland turned into a body that cannot fight). Position-asserted for the same measured reason as the issue-#1890 siblings: `applyMoveInSearch` never puts an activated ability's effect on the stack, so a chosen-move assertion would ride rollout noise. Placed at BEGINNING_OF_COMBAT, not PRECOMBAT_MAIN: a main phase with an empty stack is already the sorcery-speed window, which discourages every deferrable activation whatever the body is, so a main-phase entry could not tell the new clause from the old one. Discriminating control of the sick-body entry: the same board with the flag cleared.",
    },
    {
        label: "manland animation: keeps animating a summoning-sick Mishra's Factory on the opponent's turn",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the turn being the mover's own (a sick body can still block)",
            },
        },
        spec: {
            cards: [
                {
                    name: "Mishra's Factory",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: true,
                },
            ],
            phase: "BEGINNING_OF_COMBAT",
            activePlayer: "opp",
            priority: "me",
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
                abilityStaysAvailable(
                    state,
                    "me",
                    "Mishra's Factory",
                    "mishras-factory-animate"
                ),
            describe:
                "the animation is enumerated with no rollout-policy penalty: the flag survives the opponent's turn and a sick body can still block",
        },
        note: "Issue #4238 (a manland turned into a body that cannot fight). Position-asserted for the same measured reason as the issue-#1890 siblings: `applyMoveInSearch` never puts an activated ability's effect on the stack, so a chosen-move assertion would ride rollout noise. Placed at BEGINNING_OF_COMBAT, not PRECOMBAT_MAIN: a main phase with an empty stack is already the sorcery-speed window, which discourages every deferrable activation whatever the body is, so a main-phase entry could not tell the new clause from the old one. Control of the sick-body entry: the flag outlives the controller's turn, and there the body can block.",
    },
    {
        label: "manland animation: declines a tapped Mishra's Factory on its own turn",
        classification: {
            kind: "conditional",
            discriminant: { kind: "other", detail: "the land being tapped" },
        },
        spec: {
            cards: [
                {
                    name: "Mishra's Factory",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                },
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
                abilityIsUnavailableOrDiscouraged(
                    state,
                    "me",
                    "Mishra's Factory",
                    "mishras-factory-animate"
                ),
            describe:
                "the animation carries the rollout-policy penalty: a tapped body can neither attack nor block (CR 508.1a, CR 509.1a)",
        },
        note: "Issue #4238 (a manland turned into a body that cannot fight). Position-asserted for the same measured reason as the issue-#1890 siblings: `applyMoveInSearch` never puts an activated ability's effect on the stack, so a chosen-move assertion would ride rollout noise. Placed at BEGINNING_OF_COMBAT, not PRECOMBAT_MAIN: a main phase with an empty stack is already the sorcery-speed window, which discourages every deferrable activation whatever the body is, so a main-phase entry could not tell the new clause from the old one. Tapped-body clause, already tapped.",
    },
    {
        label: "manland animation: declines a tapped Mishra's Factory on the opponent's turn",
        classification: {
            kind: "conditional",
            discriminant: { kind: "other", detail: "the land being tapped" },
        },
        spec: {
            cards: [
                {
                    name: "Mishra's Factory",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                },
            ],
            phase: "BEGINNING_OF_COMBAT",
            activePlayer: "opp",
            priority: "me",
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
                abilityIsUnavailableOrDiscouraged(
                    state,
                    "me",
                    "Mishra's Factory",
                    "mishras-factory-animate"
                ),
            describe:
                "the animation carries the rollout-policy penalty on the opponent's turn too: the tap outlives the animation (CR 502.3)",
        },
        note: "Issue #4238 (a manland turned into a body that cannot fight). Position-asserted for the same measured reason as the issue-#1890 siblings: `applyMoveInSearch` never puts an activated ability's effect on the stack, so a chosen-move assertion would ride rollout noise. Placed at BEGINNING_OF_COMBAT, not PRECOMBAT_MAIN: a main phase with an empty stack is already the sorcery-speed window, which discourages every deferrable activation whatever the body is, so a main-phase entry could not tell the new clause from the old one. Tapped-body clause in the opponent's window; its control is the untapped sick-body control above.",
    },
    {
        label: "manland animation: declines when Mishra's Factory is the only source that could pay",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "a second untapped land able to pay",
            },
        },
        spec: {
            cards: [
                { name: "Mishra's Factory", owner: "me", zone: "battlefield" },
            ],
            phase: "BEGINNING_OF_COMBAT",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (_move, state) =>
                abilityIsUnavailableOrDiscouraged(
                    state,
                    "me",
                    "Mishra's Factory",
                    "mishras-factory-animate"
                ),
            describe:
                "the animation, whose only possible payment taps the very land it animates, carries the rollout-policy penalty",
        },
        note: "Issue #4238 (a manland turned into a body that cannot fight). Position-asserted for the same measured reason as the issue-#1890 siblings: `applyMoveInSearch` never puts an activated ability's effect on the stack, so a chosen-move assertion would ride rollout noise. Placed at BEGINNING_OF_COMBAT, not PRECOMBAT_MAIN: a main phase with an empty stack is already the sorcery-speed window, which discourages every deferrable activation whatever the body is, so a main-phase entry could not tell the new clause from the old one. Tapped-body clause, self-paid: the Factory is the only source, so the enumerator falls back to the plan that taps it and `isPointlessSelfAnimation` reads that plan.",
    },
    {
        label: "manland animation: pays with the other land, leaving Mishra's Factory untapped",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "a second untapped land able to pay",
            },
        },
        spec: {
            cards: [
                { name: "Mishra's Factory", owner: "me", zone: "battlefield" },
            ],
            phase: "BEGINNING_OF_COMBAT",
            turn: 3,
            landCount: 1,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (_move, state) =>
                abilityStaysAvailable(
                    state,
                    "me",
                    "Mishra's Factory",
                    "mishras-factory-animate"
                ) &&
                abilityMovesOf(
                    state,
                    "me",
                    "Mishra's Factory",
                    "mishras-factory-animate"
                ).every((m) =>
                    m.tapPlan.every(
                        (t) =>
                            t.cardInstanceId !==
                            abilityMovesOf(
                                state,
                                "me",
                                "Mishra's Factory",
                                "mishras-factory-animate"
                            )[0]!.cardInstanceId
                    )
                ),
            describe:
                "the animation is enumerated and its tap plan spends the other land, never the Factory",
        },
        note: "Issue #4238 (a manland turned into a body that cannot fight). Position-asserted for the same measured reason as the issue-#1890 siblings: `applyMoveInSearch` never puts an activated ability's effect on the stack, so a chosen-move assertion would ride rollout noise. Placed at BEGINNING_OF_COMBAT, not PRECOMBAT_MAIN: a main phase with an empty stack is already the sorcery-speed window, which discourages every deferrable activation whatever the body is, so a main-phase entry could not tell the new clause from the old one. Discriminating control of the self-paid entry: one more land.",
    },
    {
        label: "manland self-pump: declines to tap an animated Mishra's Factory to pump itself on its own turn",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the pumped creature being a committed blocker, a response, or another permanent",
            },
        },
        spec: {
            cards: [
                {
                    name: "Mishra's Factory",
                    owner: "me",
                    zone: "battlefield",
                    animated: {
                        power: 2,
                        toughness: 2,
                        subtype: "Assembly-Worker",
                        additionalTypes: ["Artifact"],
                        duration: { phase: "end-of-turn" },
                    },
                },
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
                abilityIsUnavailableOrDiscouraged(
                    state,
                    "me",
                    "Mishra's Factory",
                    "mishras-factory-pump"
                ),
            describe:
                "the self-pump carries the rollout-policy penalty: the tap spends the body for a bonus it cannot use",
        },
        note: "Issue #4238 (a manland turned into a body that cannot fight). Position-asserted for the same measured reason as the issue-#1890 siblings: `applyMoveInSearch` never puts an activated ability's effect on the stack, so a chosen-move assertion would ride rollout noise. Placed at BEGINNING_OF_COMBAT, not PRECOMBAT_MAIN: a main phase with an empty stack is already the sorcery-speed window, which discourages every deferrable activation whatever the body is, so a main-phase entry could not tell the new clause from the old one. Self-pump clause (`isPointlessSelfPump`).",
    },
    {
        label: "manland self-pump: declines to tap an animated Mishra's Factory to pump itself on the opponent's turn",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the pumped creature being a committed blocker, a response, or another permanent",
            },
        },
        spec: {
            cards: [
                {
                    name: "Mishra's Factory",
                    owner: "me",
                    zone: "battlefield",
                    animated: {
                        power: 2,
                        toughness: 2,
                        subtype: "Assembly-Worker",
                        additionalTypes: ["Artifact"],
                        duration: { phase: "end-of-turn" },
                    },
                },
            ],
            phase: "BEGINNING_OF_COMBAT",
            activePlayer: "opp",
            priority: "me",
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
                abilityIsUnavailableOrDiscouraged(
                    state,
                    "me",
                    "Mishra's Factory",
                    "mishras-factory-pump"
                ),
            describe:
                "the self-pump carries the rollout-policy penalty before blocks: tapped, the body cannot block",
        },
        note: "Issue #4238 (a manland turned into a body that cannot fight). Position-asserted for the same measured reason as the issue-#1890 siblings: `applyMoveInSearch` never puts an activated ability's effect on the stack, so a chosen-move assertion would ride rollout noise. Placed at BEGINNING_OF_COMBAT, not PRECOMBAT_MAIN: a main phase with an empty stack is already the sorcery-speed window, which discourages every deferrable activation whatever the body is, so a main-phase entry could not tell the new clause from the old one. Self-pump clause in the opponent's window.",
    },
    {
        label: "manland self-pump: pumping ANOTHER Assembly-Worker stays available",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the pumped creature being a committed blocker, a response, or another permanent",
            },
        },
        spec: {
            cards: [
                {
                    name: "Mishra's Factory",
                    owner: "me",
                    zone: "battlefield",
                    animated: {
                        power: 2,
                        toughness: 2,
                        subtype: "Assembly-Worker",
                        additionalTypes: ["Artifact"],
                        duration: { phase: "end-of-turn" },
                    },
                },
                {
                    name: "Mishra's Factory",
                    owner: "me",
                    zone: "battlefield",
                    animated: {
                        power: 2,
                        toughness: 2,
                        subtype: "Assembly-Worker",
                        additionalTypes: ["Artifact"],
                        duration: { phase: "end-of-turn" },
                    },
                },
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
                abilityMovesOf(
                    state,
                    "me",
                    "Mishra's Factory",
                    "mishras-factory-pump"
                ).some(
                    (m) =>
                        !isDiscouragedRolloutMove(
                            state,
                            state.players[0]!.id,
                            m
                        ) && m.targets.every((t) => t.id !== m.cardInstanceId)
                ),
            describe:
                "a pump aimed at the other animated Factory carries no rollout-policy penalty",
        },
        note: "Issue #4238 (a manland turned into a body that cannot fight). Position-asserted for the same measured reason as the issue-#1890 siblings: `applyMoveInSearch` never puts an activated ability's effect on the stack, so a chosen-move assertion would ride rollout noise. Placed at BEGINNING_OF_COMBAT, not PRECOMBAT_MAIN: a main phase with an empty stack is already the sorcery-speed window, which discourages every deferrable activation whatever the body is, so a main-phase entry could not tell the new clause from the old one. Control of the self-pump entry (c): a second animated Assembly-Worker is on the board and the activation that targets it is untouched.",
    },
    {
        label: "activation timing: holds a sacrifice engine through its own main phase",
        classification: {
            kind: "conditional",
            discriminant: { kind: "step", detail: "the opponent's end step" },
        },
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
            phase: "PRECOMBAT_MAIN",
            activePlayer: "opp",
            turn: 5,
            landCount: 5,
            libraryCount: 20,
        },
        bot: "opp",
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
        pairOf: {
            anchor: "activation timing: holds a sacrifice engine through its own main phase",
            discriminant: { kind: "step", detail: "the opponent's end step" },
        },
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
            // The opponent's end step (CR 513.1): `me` is the active
            // player, the bot (`opp`) holds priority.
            activePlayer: "me",
            priority: "opp",
            turn: 5,
            landCount: 5,
            libraryCount: 20,
        },
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "activate-ability", card: "Zuran Orb" }],
        },
        note: "Issue #2939, the FIRE half — the same board one phase later, in the last window the bot holds priority before its own turn. Without it the hold rule would be a refusal rather than a discipline: the bot deferred here too, on 5/5 seeds, and simply never converted. The cause was NOT valuation: `pass` and the activation are again tied at mean 0.75, and the material tie-break preferred `pass` on a SUBTREE-accumulated margin (1781.7 against 1552.8) even though the immediate position after activating scores 729.5 against 482.0 (the number `firingBeatsHolding` computes: `policyValue` resolves one stack item, so the life gain is still on the stack; fully settled it is 745.5). Both subtrees hold the same future activation, so the accumulation measures rollout noise; `firingBeatsHolding` asks the immediate question instead. It is NOT the stop condition — on this board every conversion is a strict gain (482.0 -> 745.5 -> 1009.0 -> 1272.5 -> 1498.5 as the lands go), so it would say yes five times and strip the bot to zero lands in one end step. The stop is the once-per-turn clause in `isDeferredEngineActivation`: a tie-break redirects ONE outcome-equal pick, and the second conversion must earn itself on mean reward. That floor is pinned by the unit control `the SECOND conversion of the same turn is left held`, which a blade entry could not express until issue #3448 gave `ScenarioCard` an `activations` field; it is still a unit control here, and promoting it to a blade entry is now possible.",
    },
    {
        label: "activation cost: names the discard for Survival of the Fittest",
        classification: { kind: "absolute" },
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
        classification: { kind: "absolute" },
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
        classification: { kind: "absolute" },
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
        classification: { kind: "absolute" },
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
        classification: { kind: "absolute" },
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
        beyondBudget: {
            cause: "horizon",
            sweptTo: { iterations: 12000 },
            note: "The payoff sits behind a LOOP, not behind a mis-valuation (ADR 0102, issue #3138): Splinter Twin grants the host '{T}: create a token that's a copy of this creature, except it has haste', and the copied Deceiver Exarch's own ETB trigger untaps the original, so activate → trigger → resolve → activate repeats for ~40 plies of identical moves before the evaluation sees lethal. A 1-ply-greedy rollout never walks that, and no budget a browser Worker gets buys it. Measured post-removal on these five seeds, this entry is chosen 0/5 at 400, 1200, 4000 AND 12000 iterations — no passing budget, hence `passesAt` omitted and `sweptTo` at the ceiling actually swept. What collapses the loop to ONE Move whose payoff the evaluation sees a single ply later is the CR 732 shortcut primitive (PRD #2687); the per-card boost layer that used to sit here was deleted by issue #3138 because, being a function of the state, it scored identically before and after the activation and saturated the material signal, so more search converged AWAY from the combo. The classification rests on that mechanism argument, not on the sweep: a `valuation` entry also fails at every budget, so flat data alone does not discriminate.",
        },
        note: "Twin combo recognition. The bot has Exarch on board and Twin in hand with 2RR available. It should enchant Exarch to start the combo. This is a `cast-spell` move, unrelated to `enumerateAbilityMoves` — it does not discharge #2469's acceptance criterion (a granted-ability activation), so it stays at `stretch` (review finding on #2495, round 2). Its beyond-budget cause is `horizon`, classified by issue #3138.",
    },
    {
        label: "combo: activates Splinter Twin on granted Grizzly Bears (#2469)",
        classification: { kind: "absolute" },
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
        note: "Issue #2469 — the granted-ability activation the bot should take, on a host whose only activated ability is the granted one (CR 613.1 layer 6): Grizzly Bears is a vanilla 2/2, so the move can reach the enumerator through `getEffectiveActivatedAbilities` and nowhere else. The Deceiver Exarch variant below is the same enumeration shape and stays at `stretch` for a HORIZON reason (issue #3138 reclassified it from `valuation`), not an enumeration one. Measured (review finding on #2495, round 2): post-fix the bot chooses the activation on 5/5 seeds, reproduced on two consecutive runs; with the pre-fix `enumerateAbilityMoves` (the printed-list early return) it chooses `pass` on 5/5 seeds. This is the entry that discharges #2469's `must`-tier acceptance criterion — the cast-side sibling above does not, since it exercises `cast-spell`, not the granted-ability enumerator this issue fixed.",
    },
    {
        label: "combo: activates Splinter Twin on enchanted Deceiver Exarch",
        classification: { kind: "absolute" },
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
            cause: "horizon",
            sweptTo: { iterations: 12000 },
            note: "The payoff sits behind a LOOP, not behind a mis-valuation (ADR 0102, issue #3138): Splinter Twin grants the host '{T}: create a token that's a copy of this creature, except it has haste', and the copied Deceiver Exarch's own ETB trigger untaps the original, so activate → trigger → resolve → activate repeats for ~40 plies of identical moves before the evaluation sees lethal. A 1-ply-greedy rollout never walks that, and no budget a browser Worker gets buys it. Measured post-removal on these five seeds: 0/5 at 400, 0/5 at 1200, 2/5 at 4000, back to 0/5 at 12000. Non-monotone at K=5 is rollout noise, not a clearing budget — hence `passesAt` omitted and `sweptTo` at the ceiling actually swept. What collapses the loop to ONE Move whose payoff the evaluation sees a single ply later is the CR 732 shortcut primitive (PRD #2687); the per-card boost layer that used to sit here was deleted by issue #3138 because, being a function of the state, it scored identically before and after the activation and saturated the material signal, so more search converged AWAY from the combo. The classification rests on that mechanism argument, not on the sweep: a `valuation` entry also fails at every budget, so flat data alone does not discriminate.",
        },
        expect: {
            moves: [{ kind: "activate-ability", card: "Deceiver Exarch" }],
        },
        note: "Twin combo execution. Twin attached to Exarch via attachedTo. Bot should activate '{T}:'. Issue #2469 fixed `enumerateAbilityMoves` to read the granted ability off `getEffectiveActivatedAbilities` — the move IS now enumerated (confirmed: `grantedAbilityEnumeration.bot.test.ts`), but this entry is NOT promoted to `must`: at `iterations: 400`, 3 of 5 seeds (727774 aka 0xb1ade, 2, 3) still choose `pass` over the activation. The gap is the search HORIZON, not enumeration and not valuation: the payoff is an infinite hasty-copy loop whose lethal end is ~40 identical plies away, and issue #3138 reclassified this entry `valuation` → `horizon` when it deleted the per-card boost layer ADR 0102 measured converging away. See finding docs/findings/2469-twin-blade-still-stretch.md (declined).",
    },
    {
        label: "channel: activates a player-level grant to fund a lethal Fireball (#2903)",
        classification: { kind: "absolute" },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a lethal red attacker on the opponent's board",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a lethal red attacker on the opponent's board",
            },
        },
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
        // gap in `moves.ts`'s ability enumerator — a dynamic target
        // requirement is skipped outright — so the Bot can
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no red attacker on the opponent's board",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: { kind: "step", detail: "the opponent's end step" },
        },
        spec: {
            cards: [{ name: "Containment Priest", owner: "opp", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            activePlayer: "opp",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "opp",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Containment Priest" }],
        },
        note: "Issue #2248; since issue #4757 guarded by `last-window-deferral` (it absorbed `isSorcerySpeedTrickDump` shape 3). Empty board, no haste: casting now buys nothing and forecloses the mana-open option, so the outcome-equal cast waits for the opponent's end step. Red under `BLADE_VARIANT=no-rule:last-window-deferral`; the rollout-guardrail and own-main hold-nudge pieces are unit-tested in `search.bot.test.ts`.",
    },
    {
        label: "flash permanent NEGATIVE CONTROL: casts Containment Priest as the only surviving block",
        classification: {
            kind: "conditional",
            discriminant: { kind: "life", detail: "the Bot at 30 life" },
        },
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
        classification: {
            kind: "conditional",
            discriminant: { kind: "life", detail: "the opponent at 30 life" },
        },
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
    // --- Keep mana open: the last-window deferral (issue #4757, PRD #4754) --
    // Discriminating pairs: each deferrable action (the perimeter of
    // `ai/deferral.ts`) is held in the bot's own main phase and taken at the
    // opponent's end step. The Containment Priest hold above is the flash
    // body's hold half; its fire half is here. A fetch crack is a standing
    // spend, owned by `standing-spend-hold` / `last-window-fire`.
    {
        label: "keep mana open: holds Impulse in its own main with no threat",
        classification: {
            kind: "conditional",
            discriminant: { kind: "step", detail: "the opponent's end step" },
        },
        spec: {
            cards: [{ name: "Impulse", owner: "opp", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            activePlayer: "opp",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "opp",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Impulse" }],
        },
        note: "Issue #4757, `last-window-deferral` HOLD half: Impulse now or at the opponent's end step reaches the same board, so the outcome-equal cast waits (a store timing verdict). Mirror: the entry below.",
    },
    {
        label: "keep mana open: casts Impulse at the opponent's end step",
        pairOf: {
            anchor: "keep mana open: holds Impulse in its own main with no threat",
            discriminant: { kind: "step", detail: "the opponent's end step" },
        },
        spec: {
            cards: [{ name: "Impulse", owner: "opp", zone: "hand" }],
            phase: "END_STEP",
            // The opponent's end step (CR 513.1): `me` is the active
            // player, the bot (`opp`) holds priority.
            activePlayer: "me",
            priority: "opp",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "opp",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Impulse" }],
        },
        note: "Issue #4757, `last-window-deferral` FIRE half: at the opponent's end step (CR 513.1) deferring buys nothing, so the outcome-equal pass becomes the cast. Mirror: the entry above.",
    },
    {
        label: "keep mana open: holds Accumulated Knowledge in its own main with no threat",
        classification: {
            kind: "conditional",
            discriminant: { kind: "step", detail: "the opponent's end step" },
        },
        spec: {
            cards: [
                { name: "Accumulated Knowledge", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            activePlayer: "opp",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "opp",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Accumulated Knowledge" }],
        },
        note: "Issue #4757, `last-window-deferral` HOLD half: Accumulated Knowledge now or at the opponent's end step reaches the same board, so the outcome-equal cast waits (a store timing verdict). Mirror: the entry below.",
    },
    {
        label: "keep mana open: casts Accumulated Knowledge at the opponent's end step",
        pairOf: {
            anchor: "keep mana open: holds Accumulated Knowledge in its own main with no threat",
            discriminant: { kind: "step", detail: "the opponent's end step" },
        },
        spec: {
            cards: [
                { name: "Accumulated Knowledge", owner: "opp", zone: "hand" },
            ],
            phase: "END_STEP",
            // The opponent's end step (CR 513.1): `me` is the active
            // player, the bot (`opp`) holds priority.
            activePlayer: "me",
            priority: "opp",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "opp",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Accumulated Knowledge" }],
        },
        note: "Issue #4757, `last-window-deferral` FIRE half: at the opponent's end step (CR 513.1) deferring buys nothing, so the outcome-equal pass becomes the cast. Mirror: the entry above.",
    },
    {
        label: "keep mana open: casts Containment Priest at the opponent's end step",
        pairOf: {
            anchor: "flash permanent: holds Containment Priest in its own main with no threat",
            discriminant: { kind: "step", detail: "the opponent's end step" },
        },
        spec: {
            cards: [{ name: "Containment Priest", owner: "opp", zone: "hand" }],
            phase: "END_STEP",
            // The opponent's end step (CR 513.1): `me` is the active
            // player, the bot (`opp`) holds priority.
            activePlayer: "me",
            priority: "opp",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "opp",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Containment Priest" }],
        },
        note: "Issue #4757: the fire half of the issue-#2248 hold. At the opponent's end step (CR 513.1) the flash body is cast; the search already does so on mean reward (green under the no-rule variant).",
    },
    // --- Removal / response timing (issue #4765, PRD #4754) ----------------
    // Report-only measurements of whether the SEARCH already times
    // interaction: removal and combat responses are outside the deferral
    // perimeter by design (their timing depends on what the opponent does,
    // so only the search's leaves can price it). One hold position and three
    // reactive windows, each walked forward through the real engine. Each is
    // a `timingMeasurement` predicate, so none of them reaches the weight fit.
    {
        label: "removal timing: holds Terror in its own main with no immediate threat",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "step",
                detail: "the opponent's declare attackers step, the Bears attacking",
            },
        },
        spec: {
            cards: [
                { name: "Terror", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        expect: timingMeasurement({ kind: "cast-spell", card: "Terror" }, true),
        note: "Issue #4765. Nothing else to spend mana on and the opposing Bears is no threat this turn: Terror (CR 304.1, instant) kills it as well after it attacks, or at the end step, while the untapped mana keeps the answer open against whatever the opponent casts next. Casting it at sorcery speed buys nothing.",
    },
    {
        label: "removal timing: exiles the attacker in the last window before damage",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "step",
                detail: "the Bot's own precombat main, the Bears not yet attacking",
            },
        },
        spec: {
            cards: [
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Ornithopter",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Swords to Plowshares", owner: "opp", zone: "hand" },
                { name: "Plains", owner: "opp", zone: "battlefield" },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            libraryCount: 20,
        },
        // `me` attacks, `opp` declares no block (the Ornithopter could block,
        // which is what opens the declare-blockers window at all), `me` passes
        // — the defender's LAST priority window before combat damage: an
        // unblocked attacker deals its damage to the player (CR 510.1b), so
        // passing here is taking 6.
        setup: [
            { kind: "declare-attackers", cards: ["Craw Wurm"] },
            { kind: "declare-blockers" },
            { kind: "pass", seat: "me" },
        ],
        bot: "opp",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        expect: timingMeasurement({
            kind: "cast-spell",
            card: "Swords to Plowshares",
            target: "Craw Wurm",
        }),
        note: "Issue #4765. The removal belongs HERE, after attackers are declared: the attacker is committed, no later window precedes its damage, and exiling it now saves 6 life on top of the creature. A pass is not a deferral to a later window but a strictly worse line. This is the COMPLEMENT of the Terror hold above, not a timing discrimination on its own: it measures that a held removal is actually fired once the attack gives it a reason, so the hold is never a mute button. The earlier window (`haltForDefenderResponse`) is deliberately not the position: there casting now and casting after blocks are both correct.",
    },
    {
        label: "response timing: bolts the attacker in response to its pump",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "stack",
                detail: "the pump already resolved, the stack empty",
            },
        },
        spec: {
            cards: [
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Giant Growth", owner: "me", zone: "hand" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Lightning Bolt", owner: "opp", zone: "hand" },
                { name: "Mountain", owner: "opp", zone: "battlefield" },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            libraryCount: 20,
        },
        // The Bears attacks into a Hill Giant block, then pumps itself; the
        // `cast` step passes the caster's window (as the Mother entries do),
        // so the blocker's controller holds priority with Giant Growth on the
        // stack.
        setup: [
            { kind: "declare-attackers", cards: ["Grizzly Bears"] },
            {
                kind: "declare-blockers",
                blocks: [{ blocker: "Hill Giant", attacker: "Grizzly Bears" }],
            },
            {
                kind: "cast",
                card: "Giant Growth",
                by: "me",
                target: "Grizzly Bears",
            },
        ],
        bot: "opp",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        expect: timingMeasurement({
            kind: "cast-spell",
            card: "Lightning Bolt",
            target: "Grizzly Bears",
        }),
        note: "Issue #4765. Bolting the 2/2 in response kills it before the pump resolves, and Giant Growth then has no legal target (CR 608.2b): a two-for-one that also keeps the Hill Giant. Passing lets the pump resolve: even a Bolt afterwards only trades the 5/5 for the Hill Giant, where responding kills it and keeps the Giant.",
    },
    {
        label: "response timing: saves its blocker by pumping it in response to removal",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "stack",
                detail: "no Bolt on the stack, the stack empty",
            },
        },
        spec: {
            cards: [
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Giant Growth", owner: "opp", zone: "hand" },
                { name: "Forest", owner: "opp", zone: "battlefield" },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            libraryCount: 20,
        },
        // The Bears attacks, the Hill Giant blocks, and the attacker Bolts the
        // blocker; the blocker's controller holds priority with the Bolt on the
        // stack.
        setup: [
            { kind: "declare-attackers", cards: ["Grizzly Bears"] },
            {
                kind: "declare-blockers",
                blocks: [{ blocker: "Hill Giant", attacker: "Grizzly Bears" }],
            },
            {
                kind: "cast",
                card: "Lightning Bolt",
                by: "me",
                target: "Hill Giant",
            },
        ],
        bot: "opp",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        expect: timingMeasurement({
            kind: "cast-spell",
            card: "Giant Growth",
            target: "Hill Giant",
        }),
        note: "Issue #4765. Giant Growth in response makes the Hill Giant a 6/6: it survives the Bolt's 3 damage (CR 704.5g) and still kills the attacking Bears. Passing loses the blocker for nothing.",
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "mana",
                detail: "six lands including two Plains",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a better spell in hand competing for the four mana",
            },
        },
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
        // MORPH — the face-up TRIGGER (CR 708.8, issue #5227). The bot controls
        // a face-down Skirk Marauder and three untapped Mountains; the opponent
        // is at 2 life behind a Wall of Stone that blocks the 2/2 all day.
        // Turning the Marauder up for {2}{R} is lethal ONLY through "When this
        // creature is turned face up, it deals 2 damage to any target": the
        // face-up 2/1 body gains nothing over the face-down 2/2. So the entry
        // discriminates: a search whose turn-up fires no trigger sees a
        // worthless special action and passes (measured: it does, on the
        // entry's seed, with the event withheld).
        //
        // Like the entry above, the matcher names no card: the face-down
        // permanent presents the sentinel, and it is the only one in play.
        label: "morph: turns a face-down Skirk Marauder face up so its trigger deals the last 2 damage",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "life",
                detail: "the opponent at 2 life, within reach of the face-up trigger's damage",
            },
        },
        spec: {
            cards: [
                {
                    name: "Skirk Marauder",
                    owner: "me",
                    zone: "battlefield",
                    faceDown: true,
                    summoningSick: false,
                },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                {
                    name: "Wall of Stone",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
            life: { opp: 2 },
        },
        bot: "me",
        budget: { iterations: 400 },
        tier: "must",
        expect: { moves: [{ kind: "turn-face-up" }] },
        note: "CR 708.8 face-up trigger: the turn-up is lethal only through 'it deals 2 damage to any target'; the opponent's wall stops the attack.",
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "Liliana at one loyalty, too low for the \u22122",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "Liliana with three loyalty to pay the \u22122",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: { kind: "life", detail: "the opponent at 30 life" },
        },
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
        // BEYOND-BUDGET, cause "valuation" — RECLASSIFIED by issue #2796,
        // which invalidated the measurement this entry used to record.
        //
        // The earlier sweep found FAIL at 400/800/1200/2000, PASS at 3000-6000,
        // FAIL AGAIN at 8000, and read that non-monotone shape as
        // "branching": right-by-noise inside a window. It was taken on a tree
        // that could not simulate Dash AT ALL — `applyMoveInSearch` stamped no
        // `dashed`, so `dashTrigger` never fired and the hasty attacker the
        // whole line depends on did not exist in any rollout. The dash cast and
        // the hard cast were therefore the SAME position but for the cost, and
        // the "plateau" was two identical lines trading places on noise.
        //
        // Re-swept on the fixed tree, same 3 seeds: FAIL at 400, 1200, 3000,
        // 5000 and 8000 — 0/3 at every point. Monotone, and with the mode now
        // fully modelled the verdict is no longer about visits: the search SEES
        // the hasty Ragavan and still prefers not to dash, i.e. the subtree is
        // mis-valued rather than under-visited. That is `cause: "valuation"`
        // (`types.ts`), the one cause that carries NO `passesAt` — there is no
        // budget to record. Same family as
        // `project_combat_eval_washed_at_horizon`.
        //
        // The declared budget stays at this registry's norm; ADR 0070 §2
        // forbids raising it to turn an entry green, and there is now no
        // budget that would.
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "stretch",
        beyondBudget: {
            cause: "valuation",
            note: "A four-attacker decision (19 already-attacking power plus a newly-hasty Ragavan crosses the opponent's 20) that the bot declines at every budget measured — FAIL at 400/1200/3000/5000/8000, 0 of 3 seeds each, re-swept for issue #2796 on a tree that models Dash correctly. More search does not help, so this is a missing VALUATION of the pattern (the extra hasty attacker's contribution to lethal), not a visit shortfall. The previous `branching` classification with a 3000-6000 pass plateau was measured before `applyMoveInSearch` stamped `dashed` at all, i.e. on a tree in which the dash line was literally unsimulable — that plateau was noise between two identical positions and no longer exists.",
        },
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "cast-spell" &&
                move.alternativeCostId === "dash",
            describe:
                "casts Ragavan, Nimble Pilferer via its dash cost (not the plain cast)",
        },
        note: '19 power already in play + Ragavan hasty = 21, crossing the opponent\'s 20 life; hard-casting caps this turn\'s attack at 19 (summoning sickness, CR 302.6) — one short. BEYOND-BUDGET, cause "valuation" (reclassified by issue #2796): the bot declines the dash at every budget measured, on a tree that now models Dash correctly — see `beyondBudget` for the sweep and for why the previous "branching / passes at 3000-6000" reading was an artifact of a tree that could not simulate the line at all. (Formerly "half 1" of a discriminating pair — the other half was deleted, review round 2, as vacuous: see the header comment above.)',
    },
    {
        // Issue #2297 — the reported bug, as a position. The outlet's only
        // effect pumps `$source`, and its cost says "a creature", not
        // "another" (CR 109.2), so the source is a legal victim of its own
        // ability. Paying with it means the ability resolves with nothing to
        // pump (CR 609.3): a creature spent for an empty resolution.
        label: "sac outlet: never eats itself when its whole payoff is on the source",
        classification: { kind: "absolute" },
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
        classification: { kind: "absolute" },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "the payoff printed on the source itself",
            },
        },
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
    // mirror-image BLOCK position did not discriminate, because a block was
    // settled by `selectRootMove`'s combat tie-breaks, which read the REAL
    // root state rather than a determinized world — so no opponent model
    // could reach them. An attack root leaves the decision to the tree and
    // the rollouts, which do see the sampled worlds. CLOSED by issue #2876:
    // the block-quality tie-break now reads the same sampled worlds
    // (`makeBlockDeltaLens`), and the mirror BLOCK pair is the entry two
    // below this one.
    //
    // WHAT IT WAS BEFORE. Measured on this exact board with the trick sitting
    // PHYSICALLY in the opponent's hand and no deck knowledge: the bot attacks
    // on all five seeds anyway. The blind path pools that hand with a 20-card
    // library and re-deals, so Giant Growth reaches the imagined hand about one
    // iteration in twenty-one — the textbook `hidden-information` dilution.
    // Sampling from the decklist is what makes it visible every iteration.
    {
        label: "informed opponent: does NOT attack into the trick its deck must be holding",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a decklist that cannot hold the combat trick",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a decklist that must be holding the combat trick",
            },
        },
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
        // THE BLOCK MIRROR OF THE #2789 PAIR (issue #2876). The entry above
        // ends with a confession: the mirror-image BLOCK position did not
        // discriminate, because a block was settled by `selectRootMove`'s
        // block-quality tie-break, which read the REAL root state rather than
        // a determinized world — so no opponent model could reach it. This
        // pair is that gap closed. The tie-break now reads the SAME sampled
        // worlds the tree and the rollouts do (`makeBlockDeltaLens`,
        // search.ts), so what the bot deduces about the attacker's hand
        // changes whether it blocks.
        //
        // THE POSITION. `me` (players[0], the active player) attacks with
        // Savannah Lions (2/1) and holds one card with an untapped Forest
        // behind it. The bot is `opp` and owes its `declare-blockers` with a
        // lone Ironroot Treefolk (3/5).
        //
        //   * With no trick, the Treefolk eats the Lions for free: 3 power is
        //     lethal to a 1-toughness attacker (CR 510.1a/704.5g) and 2 power
        //     back does not dent a 5-toughness blocker. Declining donates 2.
        //   * With Giant Growth the Lions blocks out as a 5/4: 3 power no
        //     longer kills it, and its 5 power is exactly lethal to the
        //     Treefolk. The block trades the bot's best creature for nothing.
        //
        // WHY IT DISCRIMINATES AT ALL, mechanically: `cautiousBlockPenalty`
        // (evaluate.ts, ADR 0021) asks the ATTACKER's hand what it can cast
        // this combat, and on the wire that hand is opaque placeholders. Only
        // a determinized world puts a real card there — and only deck
        // knowledge puts THE card there on every sample.
        //
        // THE ANSWER IS NEVER IN THE ROOT POSITION (the acceptance criterion
        // #2789's pair also had to meet): both entries physically hold a
        // Mountain, and `determinize` re-derives this seat's hidden zones from
        // the decklist, so what sits in that hand is never what the bot
        // reasons about. Each decklist admits exactly ONE identity, so the
        // sampled hand is the same on every seed and every world.
        //
        // WHAT IT WAS BEFORE (measured on this exact board, `runBladeScenario`,
        // 400 iterations, these 5 seeds): the bot blocked on 5/5 seeds in BOTH
        // arms — the decklist changed nothing, which is exactly the structural
        // blindness the issue reports.
        label: "informed defender: does NOT block into the trick the attacker's deck must be holding",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a decklist that cannot hold the combat trick",
            },
        },
        spec: {
            cards: [
                {
                    name: "Savannah Lions",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                // The mana the trick needs — `castableHeldInteraction` gates on
                // open, untapped sources (CR 601.2g at this resolution), and an
                // attacking Lions never taps it.
                { name: "Forest", owner: "me", zone: "battlefield" },
                // Physically a Mountain in BOTH entries — see above.
                { name: "Mountain", owner: "me", zone: "hand" },
                {
                    name: "Ironroot Treefolk",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        // The attack is declared by the ENGINE, never a hand-seeded
        // `combat.attackerIds` (ADR 0070 §4); it also walks priority to the
        // block window, where `decidingPlayer` hands the decision to `opp`.
        setup: [{ kind: "declare-attackers" }],
        bot: "opp",
        deckKnowledge: [{ seat: "me", cards: ["Giant Growth"] }],
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [
                { kind: "declare-blockers", card: "Ironroot Treefolk" },
            ],
        },
        note: "Twin of the entry below; only the decklist differs (issue #2876).",
    },
    {
        label: "informed defender: DOES block when the attacker's deck cannot hold the trick",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a decklist that must be holding the combat trick",
            },
        },
        spec: {
            cards: [
                {
                    name: "Savannah Lions",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "hand" },
                {
                    name: "Ironroot Treefolk",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        setup: [{ kind: "declare-attackers" }],
        bot: "opp",
        // Same board, same card in hand — but this deck admits only a land, so
        // there is no trick to play around and declining donates 2 damage and
        // a free kill.
        deckKnowledge: [{ seat: "me", cards: ["Mountain"] }],
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "declare-blockers", card: "Ironroot Treefolk" }],
        },
        note: "Twin of the entry above; only the decklist differs (issue #2876).",
    },
    {
        // ISSUE #3531 — the COLOUR arm of the same board. The two entries above
        // vary the attacker's DECKLIST; this one varies nothing but the COLOUR
        // of the attacker's single untapped land, with the trick-holding
        // decklist of the first entry unchanged.
        //
        // The defender is entitled to the whole of this: an opponent's
        // battlefield is public (CR 400.2), and whether an open Mountain can
        // pay {G} is a rules fact, not a read of a hidden zone. Before this
        // slice `castableHeldInteraction` asked `manaValue(cost) <=
        // availableManaFor(player)` — one open land, Giant Growth's mana value
        // 1, "castable" — so the defender played around a trick the attacker
        // could not cast off a Mountain, declined the block and donated 2
        // damage plus a free kill on every seed.
        label: "informed defender: DOES block when the attacker's open land cannot PAY for the trick",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "mana",
                detail: "the open land of the colour that pays for the trick",
            },
        },
        spec: {
            cards: [
                {
                    name: "Savannah Lions",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                // A MOUNTAIN — the single difference from the first entry of
                // this trio. Giant Growth costs {G}.
                { name: "Mountain", owner: "me", zone: "battlefield" },
                // Physically a Mountain in every entry of the trio — see the
                // first one for why the physical hand is never what the bot
                // reasons about.
                { name: "Mountain", owner: "me", zone: "hand" },
                {
                    name: "Ironroot Treefolk",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        setup: [{ kind: "declare-attackers" }],
        bot: "opp",
        // The SAME trick-holding decklist as the first entry: the deck really
        // does hold Giant Growth, and it is still unpayable on this board.
        deckKnowledge: [{ seat: "me", cards: ["Giant Growth"] }],
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "declare-blockers", card: "Ironroot Treefolk" }],
        },
        note: "Issue #3531. Discriminating pair with the first entry of this trio: same board, same decklist, only the untapped land's colour different.",
    },
    {
        // THE ANTI-CLAIRVOYANCE ARM of the same board (issue #2876 review
        // finding 3). Same position, same physical Giant Growth in the
        // attacker's hand — and NO deck knowledge, so nothing lawfully tells
        // the bot the trick is there. It blocks, and that is the correct
        // answer: a defender who declines HERE is reading a hidden zone it has
        // no entitlement to.
        //
        // WHY THIS ENTRY EXISTS RATHER THAN BEING OBVIOUS. Before issue #2876
        // the block tie-break read the REAL root state, so on a CI /
        // self-play position — which `determinize.ts` searches at FULL
        // information — `cautiousBlockPenalty` saw the actual Giant Growth and
        // the bot declined. That is root-only clairvoyance: the tree and the
        // rollouts were already forbidden it (they run on determinized
        // worlds), and `evaluate.ts`'s `declaredCombatDelta` already gates its
        // own held-pump read on `ownView`. The lens removes it, and MEASURED
        // at the seam this board flips by 178 points — `block − decline` goes
        // from −29.5 (old lens, reading the true hand) to +148.8 (12
        // determinized worlds, 0 of which dealt the pooled trick into a
        // one-card hand).
        //
        // So this is the entry that WOULD HAVE GONE RED on that diff, in the
        // direction nothing else covers: the pair above only pins the
        // deck-knowledge path, and every other block entry in this file
        // (charter scenario 4 and its #2147 twin) is `landCount: 0` with empty
        // hands, where `cautiousBlockPenalty` is structurally zero. Without
        // this entry the whole full-information behaviour change is unguarded
        // in both directions.
        label: "blind defender: blocks anyway — the trick is in hand, but nothing lawfully says so",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the attacker's decklist known to the Bot, holding the trick",
            },
        },
        spec: {
            cards: [
                {
                    name: "Savannah Lions",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Forest", owner: "me", zone: "battlefield" },
                // The real Giant Growth, and no `deckKnowledge` naming it.
                { name: "Giant Growth", owner: "me", zone: "hand" },
                {
                    name: "Ironroot Treefolk",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        setup: [{ kind: "declare-attackers" }],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "declare-blockers", card: "Ironroot Treefolk" }],
        },
        note: "Anti-clairvoyance guard for the pair above (issue #2876). The bot may not price a trick it has no lawful way to know about; before the block tie-break read determinized worlds it declined here on the strength of the real hand. Blocks 5/5 seeds.",
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
        classification: { kind: "absolute" },
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
        classification: {
            kind: "conditional",
            discriminant: { kind: "life", detail: "the opponent at 10 life" },
        },
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
        classification: { kind: "absolute" },
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
        // half (`must`; it was `stretch` until issue #2939 promoted it).
        //
        // The right-hand half of the Minimal Pair its `pairOf` declares
        // (issue #5108). Neither half is meaningful alone: a bot that
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
        // them: `me` is by default the ACTIVE player in a `ScenarioSpec`, so the
        // seat holding the engine has to be `opp` for this to be the
        // OPPONENT's end step. One `pass` walks priority to the bot.
        //
        // The token payoff was never the problem and still is not:
        // `applyActivationCostsForSearch` sacrifices the land through
        // `removePermanentTo`, which queues PERMANENT_LEFT, and
        // `processPendingActionTriggers` stacks Titania's trigger; it resolves a
        // ply later (measured: material margin 427.5 → 654.5 on resolution).
        label: "discriminating pair: activates Zuran Orb when Titania pays the land off (issue #2686)",
        pairOf: {
            anchor: "discriminating pair: does NOT sacrifice a land to Zuran Orb for 2 life (issue #2686)",
            discriminant: TITANIA_PAYOFF,
        },
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
        note: "Half 1 of the discriminating pair (positive control) — its partner in the declared Minimal Pair. The 5/3 token IS simulated (CR 603.10 PERMANENT_LEFT → trigger); the pair still asks the only question #2686 wanted asked — does the bot convert a land when Titania pays it off, and refuse when she is not there. Re-pointed and promoted `stretch` → `must` by issue #2939: the original PRECOMBAT_MAIN window was seed noise (10/12) at the timing ceiling #2687 tracks, and #2939 resolves that ceiling AGAINST the original window (the land keeps tapping for mana until it is given up, so the bot now deterministically holds in its own main phase — the sibling `activation timing: holds a sacrifice engine through its own main phase` asserts exactly that). Moved to the window where the conversion is right, it is deterministic on all 3 original seeds at the original 400-iteration budget. The term-bearing half is still the partner; this one rides the token, not `manaDevWeight`.",
    },
    {
        // DISCRIMINATING PAIR, HALF 2 of 2 (issue #2686).
        // The ANCHOR of the Minimal Pair its right-hand half declares (issue
        // #5108): the half's board and window minus Titania. Sacrificing a land now
        // nets only 2 life for a land the `manaDevelopment` term prices at 29
        // on curve (the hand's 6-MV Craw Wurm still wants that sixth land), a
        // decisive -13 — the blunder the flat eval (17 vs 16) used to leave
        // inside the rollout-noise band, which is how the bot gave a land away
        // for 2 life on 1/5 seeds.
        label: "discriminating pair: does NOT sacrifice a land to Zuran Orb for 2 life (issue #2686)",
        classification: { kind: "conditional", discriminant: TITANIA_PAYOFF },
        spec: {
            // The partner's board and window (the opponent's end step), minus
            // Titania: the pair differs by that one card only.
            cards: [
                { name: "Zuran Orb", owner: "opp", zone: "battlefield" },
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
            forbidden: [{ kind: "activate-ability", card: "Zuran Orb" }],
        },
        note: "Half 2 of the discriminating pair — its partner in the declared Minimal Pair. Sacrificing a land nets only 2 life (16) for an on-curve land worth 29 under the `manaDevelopment` term, a decisive loss; before the term the flat eval priced a land at 17 vs 2 life at 16 — inside the rollout-noise band — and the bot gave a land away for 2 life on 1/5 seeds.",
    },
    {
        // THE FLOODED READING (issue #2927) — the third leg of the
        // `manaDevelopment` set, and the one #2686's demand proxy left
        // unreachable in play.
        //
        // The two Zuran Orb halves above pin the ON-CURVE reading (a land the
        // hand still wants outprices 2 life). This one pins its opposite on a
        // REALISTIC position: five Forests against a hand topping out at MV 2.
        // Under #2686's SUM proxy that hand demanded 2 + 2 + 2 + 2 = 8 lands —
        // more than the five on the board — so the position read as on curve
        // and the flooded branch never fired. No real hand ever sums below its
        // land count, which is why the branch was dead everywhere, not just
        // here.
        //
        // WHY A PREDICATE AND NOT A CHOSEN MOVE. `manaDevWeight` is 12 and the
        // flooded floor is `permanentWeight + manaWeight` = 17, so pinning this
        // reading through a decision needs a play whose alternative is valued
        // inside (17, 29). Measured against the catalogue, nothing lands there:
        // Zuran Orb's 2 life is 16 (below the floor, so the bot refuses under
        // BOTH readings), a card in hand is ~28 and a +2/+2 counter 58 (above
        // the ceiling, so it acts under both). A chosen-move entry here would
        // therefore pass identically before and after the fix — vacuous. The
        // predicate asserts the two readings directly, on a state built through
        // the real ScenarioSpec pipeline, and dies when `manaDevWeight` is
        // zeroed.
        label: "flooded base: a land the hand's curve no longer wants earns no development bonus (issue #2927)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a hand whose curve still wants the fifth land",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 5 }, () => ({
                    name: "Forest",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                // Curve tops out at MV 2 — but four of them, so the hand SUMS
                // to 8 and the retired proxy would have called this on curve.
                ...Array.from({ length: 4 }, () => ({
                    name: "Grizzly Bears",
                    owner: "me" as const,
                    zone: "hand" as const,
                })),
                // The on-curve half of the comparison, drawn by the predicate:
                // a 6-MV card that puts the same five lands back to work.
                { name: "Craw Wurm", owner: "me", zone: "library" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 60 },
        seeds: [0xb1ade],
        tier: "must",
        expect: {
            predicate: floodedLandEarnsNoDevelopmentBonus,
            describe:
                "on a board of five lands whose hand tops out at MV 2, the marginal land is priced flat (17, no development bonus) — and drawing the 6-MV card in the library restores exactly manaDevWeight (12) to it",
        },
        note: "Issue #2927. The flooded leg of the `manaDevelopment` set (the Zuran Orb pair above is the on-curve leg). #2686 derived demand from the SUM of the hand's mana values, which in this position is 8 against five lands — so the board read as ON CURVE and the flooded branch, the half of #2686 that priced a surplus land DOWN, never fired in any realistic position. Demand is now the curve's top end (MV 2 here), so the fifth land is flat 17 and the same land is 29 once the library's Craw Wurm reaches hand. Proven to fail by zeroing `manaDevWeight` (the two readings collapse into each other) and by restoring the sum proxy (the position reads on curve and the flat-17 assertion goes red).",
    },
    {
        // CAST-INVARIANCE (issue #2928) — the fourth leg of the
        // `manaDevelopment` set, and the one that reaches a DECISION.
        //
        // THE POSITION. Eight untapped Forests and an 8-MV Aladdin's Ring in
        // hand, against an opponent 2/2. Casting is plainly right: the Ring is
        // exactly affordable, it is a mana sink the board has nothing else to
        // spend on, and a card held in hand does nothing.
        //
        // WHY IT WAS WRONG. Demand used to be read off the HAND alone, so the
        // Ring was worth `manaDevWeight` on each of the eight lands it
        // justified — 96 points the term took away the instant the card left
        // the hand. Since a card's latent worth in hand and the permanent's
        // realized worth roughly cancel across a cast by design (ADR 0018),
        // that 96 was the tie-break: measured, the bot chose `pass` on all
        // three seeds rather than pay it. Counting the board's non-land
        // permanents in the same demand makes the cast shift the card between
        // two halves of one number, and the bot casts on all three.
        //
        // WHY AN 8-MV MANA SINK AND NOT A CREATURE. The toll is
        // `manaDevWeight x MV`, so it only decides the pick when the spell's
        // own board impact is smaller than that. Measured and discarded on the
        // way here: a 4-MV Hill Giant (toll 48) and a 6-MV Craw Wurm (toll 72,
        // with and without a cheap alternative in hand) are cast on every seed
        // BOTH before and after the fix — bodies that big outrun the toll, and
        // an entry built on one would have been vacuous.
        label: "cast-invariance: casts an affordable creature off a base its curve already justifies (issue #2928)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "a base too small to justify the cast, a land short",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 8 }, () => ({
                    name: "Forest",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Aladdin's Ring", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Aladdin's Ring" }],
        },
        note: "Issue #2928. The decision leg of the `manaDevelopment` set: with demand read off the hand alone, casting the card that set the curve's top end cost `manaDevWeight` per land it justified — 96 here — and since a card's latent hand value and the permanent's realized worth roughly cancel across a cast (ADR 0018), that toll was the tie-break and it pointed at holding. Counting non-land permanents in the same demand makes a cast net zero. Proven to fail against the pre-fix formula (hand-only demand): the bot chose `pass` on all 3 seeds. A 4-MV or 6-MV creature does NOT write this entry — measured, both are cast on every seed either way, because a body that size outruns the toll.",
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a creature spell in hand to spend the mana on",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a spell in hand the Ritual turns on",
            },
        },
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
        note: "The same blunder without the sacrifice cost, which is why the fix is not card-shaped: the bot burned the Ritual with nothing to cast, on every seed, with and without creatures in the library. Here the evaluator was actively WRONG rather than merely ignored — the old `availableManaFor` proxy counted pool mana per unit but an untapped source as exactly one (the issue #2247 asymmetry), so tapping one Swamp into three black read as +24 at the leaf. Issue #3531 retired that proxy (`manaUnitsFor`, gre/manaAvailability.ts, counts one unit per mana a source taps for, in the pool and on the battlefield alike), so the inflation is gone and the entry now stands on the hold alone — which is what it was always asserting.",
    },
    {
        label: "wasted mana NEGATIVE CONTROL: casts Dark Ritual when it turns on a Craw Wurm",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "mana",
                detail: "one land fewer, the Craw Wurm a mana short",
            },
        },
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
        // What it guards: `enumerateAbilityMoves` (`gre/moves.ts`) reads the
        // DECLARATIVE `requiresAttackedThisTurn` field as its Boast gate. Drop the
        // enumerator's gate and the move is offered a turn early: the bot eats
        // its own Grizzly Bears for a boast the server would refuse, which in
        // live play is a frozen action, not a bad one.
        label: "boast: does not activate Broadside Bombardiers before it has attacked",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "sequence",
                detail: "Broadside Bombardiers has attacked this turn",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "sequence",
                detail: "Broadside Bombardiers has not attacked this turn",
            },
        },
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
    {
        // ACTIVATION RESTRICTION CLOSURE, HALF 1 — THE GATE (CR 602.5, issue
        // #3441). The negative half of a discriminating pair: Barbarian Ring's
        // threshold ability ("Activate only if seven or more cards are in your
        // graveyard") with SIX cards there. Forced by the rules: the ability is
        // not activatable, so the one forbidden move is that activation, even
        // with the opponent at 2 life where it would be lethal.
        //
        // What it guards: `enumerateAbilityMoves` (`gre/moves.ts`) evaluates
        // the printed restriction — since issue #3685 the declarative
        // `activationCondition`, before it a `canActivate` closure — through
        // `activationPreconditionViolation`, the predicate the mutation reads. Drop that evaluation and the move is
        // offered with the restriction failing — a move the server refuses.
        label: "activation restriction: does not sacrifice Barbarian Ring below threshold",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "seven cards in the graveyard, threshold reached",
            },
        },
        spec: {
            cards: [
                { name: "Barbarian Ring", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "graveyard",
                    count: 6,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            life: { opp: 2 },
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Barbarian Ring" }],
        },
        note: "Half 1 of the activation-restriction pair (issue #3441). Guards that the enumerator evaluates the `canActivate` closure rather than offering the ability unconditionally.",
    },
    {
        // ACTIVATION RESTRICTION CLOSURE, HALF 2 — THE PAYOFF (CR 602.5, issue
        // #3441). Same board with a SEVENTH graveyard card: the threshold
        // ability is legal and deals the opponent's last 2 life — the only
        // winning play, no judgement involved. Before issue #3441 the
        // enumerator skipped every ability carrying a `canActivate` closure,
        // so this move did not exist in the Bot's move set at all. Half 1 and
        // half 2 red on OPPOSITE breaks of the same enumerator line.
        label: "activation restriction: sacrifices Barbarian Ring at threshold for lethal",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "six cards in the graveyard, below threshold",
            },
        },
        spec: {
            cards: [
                { name: "Barbarian Ring", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "graveyard",
                    count: 7,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            life: { opp: 2 },
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 800 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "activate-ability",
                    card: "Barbarian Ring",
                    target: "opp",
                },
            ],
        },
        note: "Half 2 of the activation-restriction pair (issue #3441). The positive direction: a `canActivate` ability whose restriction holds is reachable and taken.",
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "Firebolt in the library instead of the graveyard",
            },
        },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "Firebolt in the graveyard instead of the library",
            },
        },
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
    // ── A GRANTED flashback (CR 702.34a) — issue #4756 ────────────────────
    // Snapcaster Mage's ETB is now a `grantFlashback` Effect Script instead of
    // a `resolve()` closure. The decision is the one the grant CREATES: the
    // Bolt sits in the graveyard with no printed flashback, so a cast of it
    // exists in the Bot's move set only if the ETB really stamped
    // `grantedFlashback` and `graveyardCastMechanism` reads that stamp.
    // Casting the Mage itself is NOT the decision: a flash 2/1 is worth
    // casting anyway, so it would pass with the grant broken.
    {
        label: "granted-flashback: casts the Lightning Bolt Snapcaster Mage's ETB granted flashback, for lethal",
        classification: {
            kind: "conditional",
            discriminant: { kind: "life", detail: "the opponent at 10 life" },
        },
        spec: {
            cards: [
                {
                    name: "Snapcaster Mage",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Lightning Bolt", owner: "me", zone: "graveyard" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    tapped: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            // Three damage is lethal and `evaluate` is banded so a win
            // dominates every material term — no seed can prefer passing.
            life: { me: 20, opp: 3 },
            landCount: 0,
            libraryCount: 20,
        },
        // The ETB, through the engine's own trigger placement: the Bolt is
        // the only instant or sorcery in the graveyard, so the CR 603.3d
        // target is the only legal one; resolving it runs `grantFlashback`.
        setup: [
            { kind: "etb-trigger", card: "Snapcaster Mage" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Lightning Bolt" }] },
        note: "Issue #4756. The Bot must cast a graveyard card whose ONLY cast permission is the flashback Snapcaster Mage's ETB granted at its own mana cost ({R}, CR 702.34a). A broken `grantFlashback` executor, or a graveyard enumerator blind to an instance-level grant, removes the Bolt from the move set and the Bot passes on lethal.",
    },
    // ── The ESCAPE cast (CR 702.138a) — issue #2980 ──────────────────────
    // A DISCRIMINATING PAIR. The only difference between the two positions is
    // how much FODDER the graveyard holds: enough to pay "exile three other
    // cards" or one short of it. Escape (and a non-mana flashback cost) used to
    // be excluded from the enumerator outright — the `cast-spell` Move had no
    // field for the exile, so the Bot never once escaped a card, silently.
    //
    // Underworld Breach rather than a printed-escape card on purpose: its grant
    // is the zone-wide one (CR 702.138 — "each nonland card in your graveyard
    // has escape"), so the position also pins that a GRANTED cost is priced and
    // charged like a printed one. Lightning Bolt's own {R} is the escape mana
    // cost under the grant, and the single Mountain is exactly that.
    {
        label: "escape: reaches for a Lightning Bolt Underworld Breach made escapable",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "one fewer card of graveyard fodder",
            },
        },
        spec: {
            cards: [
                { name: "Underworld Breach", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Lightning Bolt", owner: "me", zone: "graveyard" },
                // Three OTHER cards — exactly the granted escape cost. Lands,
                // which the grant can never make castable, so nothing here is a
                // rival play.
                { name: "Forest", owner: "me", zone: "graveyard", count: 3 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            // Three damage is lethal, and `evaluate` is banded so a win
            // dominates every material term — no seed can prefer passing.
            life: { me: 20, opp: 3 },
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Lightning Bolt" }] },
        note: "Issue #2980, half 1. The lethal is only reachable through an ESCAPE cast, which `searchCanModelGraveyardCast` refused to enumerate until the exile cost could ride on the Move. Measured: reds when the escape branch of the enumerator's graveyard loop is skipped.",
    },
    {
        label: "escape: does not reach for it when the graveyard cannot pay the exile cost",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "one more card of graveyard fodder",
            },
        },
        spec: {
            cards: [
                { name: "Underworld Breach", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Lightning Bolt", owner: "me", zone: "graveyard" },
                // TWO other cards where the granted cost demands three. The
                // ONLY field that differs from half 1.
                { name: "Forest", owner: "me", zone: "graveyard", count: 2 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            life: { me: 20, opp: 3 },
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Lightning Bolt" }] },
        note: "Issue #2980, half 2 — the discriminating twin. Same lethal-shaped board, one fewer card of fodder. Two independent gates suppress the cast — `hasPayableEscapeExileCost` (gre/rules.ts) and `planCastCostPicks` returning null — and either alone is sufficient, so the measured proof reds this entry only with BOTH removed; a cast offered past them is the announce-then-abort freeze shape.",
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
        classification: { kind: "absolute" },
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
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "mana",
                detail: "mana to pay the madness cost",
            },
        },
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
    // -----------------------------------------------------------------------
    // STORM counts inside the search tree (CR 702.40a, ADR 0052) — issue #3026.
    //
    // A DISCRIMINATING PAIR whose two halves differ in ONE thing: whether a
    // spell has already been cast this turn. Both hand-built search sandboxes
    // pushed their StackItem without ever calling `emitSpellCastEvent`, so
    // `spellsCastThisTurn` stayed 0 for the whole tree and every storm spell
    // copied zero times — half 1 was unwinnable to a bot that cannot count its
    // own casts, and half 2 passed for the wrong reason (it never counted
    // them there either).
    //
    // Cast off Mountains with the spells in HAND: no alternative mana source
    // and no graveyard mechanic, so the pair measures the storm count alone and
    // stays independent of the one-source-one-mana sibling issue.
    // -----------------------------------------------------------------------
    {
        label: "storm: Grapeshot is lethal because the search counts the spell cast before it",
        pairOf: {
            anchor: "storm: does NOT reach for Grapeshot one prior cast short",
            discriminant: {
                kind: "sequence",
                detail: "a prior cast this turn, so Grapeshot's storm count is one",
            },
        },
        spec: {
            cards: [
                // Three Mountains: the setup cast below taps one, leaving
                // exactly Grapeshot's {1}{R}.
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                    tapped: false,
                },
                { name: "Grapeshot", owner: "me", zone: "hand" },
                { name: "Mons's Goblin Raiders", owner: "me", zone: "hand" },
                { name: "Ironclaw Orcs", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            // Two life: Grapeshot's own 1 damage is NOT lethal; the one storm
            // copy the prior cast buys makes it exactly lethal, and `evaluate`
            // is banded so a win dominates every material term.
            life: { me: 20, opp: 2 },
            landCount: 0,
            libraryCount: 20,
        },
        // The prior cast the storm count is made of — through the REAL move
        // pipeline, so `spellsCastThisTurn` is raised by the same choke point
        // the search itself must now reach.
        setup: [
            { kind: "cast", card: "Mons's Goblin Raiders" },
            // CR 117.3b — the cast leaves priority with the caster, who
            // auto-passes it to the opponent; the opponent's pass completes the
            // cycle, resolves the Raiders and hands the decision back to the
            // active player, which is the position measured.
            { kind: "pass", seat: "opp" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Grapeshot", target: "opp" }],
        },
        note: "Issue #3026, half 1. Reds when the `cast-spell` leaf of `applyMoveInSearch` does not call `emitSpellCastEvent`: with no cast counted, the storm trigger never exists, Grapeshot is one damage short of lethal in every rollout, and the bot prefers the body.",
    },
    {
        label: "storm: does NOT reach for Grapeshot one prior cast short",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "sequence",
                detail: "a prior cast this turn, so Grapeshot's storm count is one",
            },
        },
        spec: {
            cards: [
                // Three Mountains like half 1, but the prior cast has NOT
                // happened yet: Grapeshot now is storm count zero, one damage
                // into a 2-life opponent. The prior cast is the whole
                // difference (the pair's `sequence` Discriminant).
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                    tapped: false,
                },
                { name: "Grapeshot", owner: "me", zone: "hand" },
                { name: "Mons's Goblin Raiders", owner: "me", zone: "hand" },
                { name: "Ironclaw Orcs", owner: "me", zone: "hand" },
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
        expect: {
            forbidden: [
                { kind: "cast-spell", card: "Grapeshot" },
                { kind: "cast-spell", card: "Grapeshot", target: "opp" },
            ],
        },
        note: "Issue #3026, half 2 — the discriminating twin, re-cut as the ANCHOR of a Minimal Pair (issue #5108): half 1's board with the prior cast not yet made (a `sequence` Discriminant). Grapeshot now is storm count 0: one damage into two life wins nothing and spends the turn. A bot that reads storm as \"always at least one copy\" passes half 1 and fails here. The bot's measured answer is another cast (Ironclaw Orcs) rather than the Raiders-then-Grapeshot line that is lethal this turn — a search shortfall this entry does not assert, since `forbidden` is the claim the pair needs.",
    },
    {
        label: "known top: digs with a cantrip because it knows the Bolt is there",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a blank pinned on top in place of the Lightning Bolt",
            },
        },
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
        pairOf: {
            anchor: "known top: digs with a cantrip because it knows the Bolt is there",
            discriminant: {
                kind: "card",
                detail: "a blank pinned on top in place of the Lightning Bolt",
            },
        },
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
    {
        // DISCRIMINATING PAIR, HALF 1 of 2 (issue #3027).
        // PAIRED WITH: "burst mana: does NOT reach the two-mana kill off a
        // ONE-mana source".
        //
        // No lands at all. The whole mana base is one untapped Black Lotus
        // ("{T}, Sacrifice this artifact: Add three mana of any one color"),
        // and the only card in hand is Incinerate ({1}{R}, 3 damage to any
        // target) with the opponent at exactly 3. The kill is a TWO-mana spell
        // funded by ONE source, which is precisely what `planManaPayment`
        // could not express before this issue: it built one `PlanSource` per
        // permanent and let it pay one pip, so `enumerateCastMoves` dropped
        // the cast and the bot passed with lethal in hand — while
        // `getLegalActions` told the human the Cast was legal.
        label: "burst mana: kills with a two-mana spell off a single Black Lotus",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "mana",
                detail: "a Mox Ruby in place of the Black Lotus",
            },
        },
        spec: {
            cards: [
                {
                    name: "Black Lotus",
                    owner: "me",
                    zone: "battlefield",
                    tapped: false,
                },
                { name: "Incinerate", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            // The point of the entry: the Lotus is the entire mana base.
            landCount: 0,
            libraryCount: 20,
            life: { me: 20, opp: 3 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            // `target: "opp"` is what makes this discriminating rather than
            // merely "casts something": the face is the lethal, and the only
            // other legal target is its own controller.
            moves: [{ kind: "cast-spell", card: "Incinerate", target: "opp" }],
        },
        note: 'Half 1 of the discriminating pair — PAIRED WITH "burst mana: does NOT reach the two-mana kill off a ONE-mana source". Neither half is meaningful alone: half 2 shares every line but the mana source, so a bot that simply liked casting Incinerate would pass one and fail the other. Measured on `98ed936f4` this half was UNREACHABLE — `planManaPayment` returned null for {1}{R} off one Lotus and the cast was never enumerated.',
    },
    {
        // DISCRIMINATING PAIR, HALF 2 of 2 (issue #3027).
        // PAIRED WITH: "burst mana: kills with a two-mana spell off a single
        // Black Lotus". Identical position with the burst source replaced by a
        // ONE-mana producer (Mox Ruby, "{T}: Add {R}"): {1}{R} is genuinely
        // unpayable, so the cast must NOT be offered. This is the half that
        // stops the yield model from becoming yield-UNBOUNDED — a planner that
        // let any source cover any number of pips would pass half 1 and fail
        // here.
        label: "burst mana: does NOT reach the two-mana kill off a ONE-mana source",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "mana",
                detail: "a Black Lotus in place of the Mox Ruby",
            },
        },
        spec: {
            cards: [
                {
                    name: "Mox Ruby",
                    owner: "me",
                    zone: "battlefield",
                    tapped: false,
                },
                { name: "Incinerate", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
            life: { me: 20, opp: 3 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Incinerate" }],
        },
        note: 'Half 2 of the discriminating pair — PAIRED WITH "burst mana: kills with a two-mana spell off a single Black Lotus". Neither half is meaningful alone (ADR 0070 §1: a `forbidden` entry a never-casting bot also satisfies asserts nothing by itself). One untapped Mox Ruby makes exactly one mana, so {1}{R} cannot be paid and the cast must stay unenumerated. Measured under a deliberate break that made the planner floating pool unbounded (issue #3027 proof-of-failure): this half stayed GREEN, because the census (`canPotentiallyPayCost`) refuses the cast before the planner is ever consulted. So what this half pins is that the difference between the two halves is the SOURCE and not an appetite for Incinerate; the PLANNER upper bound is pinned instead by the unit tests in `burstManaSources.bot.test.ts` ("cannot pay a FOURTH pip", "Sol Ring pays {2} off one tap and stops at {3}"), both proven red under that same break.',
    },
    {
        // The Underworld Breach probe, reduced to one root decision.
        //
        // Breach is out, one untapped Black Lotus is the entire mana base, and
        // the graveyard holds a Lightning Bolt plus six inert lands as escape
        // fodder. The opponent is at 9 cards. The kill is NOT the Bolt: it is
        // to cast Brain Freeze, let the Lotus reach the GRAVEYARD paying for
        // it, escape the Lotus, tap it a SECOND time for a different colour,
        // and escape Brain Freeze itself with a storm count — which mills the
        // opponent out (CR 104.3c / 704.5b).
        //
        // Every piece of that needs something this entry guards:
        //   - the Lotus reaches the graveyard at all: `applyTapPlanInSearch` models a
        //     sacrifice-cost mana source leaving the battlefield;
        //   - the graveyard is worth filling: the `graveyard` eval term;
        //   - milling the opponent out is a WIN: the `library` term and
        //     `deckOutDelta`.
        //
        // MEASURED on the parent commit (all three absent), same board, same
        // seeds, at 400 AND 1200 iterations: the bot cast the Lightning Bolt
        // from the graveyard and then had nothing, leaving the opponent at 8
        // cards. On this branch it plays the line above on every seed and every
        // budget measured, and the opponent's library reaches 0.
        label: "decking: casts the storm kill that recurs its own Black Lotus",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "an opponent library too deep for the storm count to mill out",
            },
        },
        spec: {
            cards: [
                { name: "Underworld Breach", owner: "me", zone: "battlefield" },
                {
                    name: "Black Lotus",
                    owner: "me",
                    zone: "battlefield",
                    tapped: false,
                },
                { name: "Brain Freeze", owner: "me", zone: "hand" },
                { name: "Lightning Bolt", owner: "me", zone: "graveyard" },
                // Inert escape fodder — lands, so Breach's "each NONLAND card"
                // grant never makes them castable and they only ever pay an
                // exile cost.
                { name: "Island", owner: "me", zone: "graveyard", count: 6 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            // NOTE: `libraryCount` seeds BOTH libraries, so the bot is as close
            // to decking as its opponent. That is not a weakness of the entry —
            // it means the `library` term cannot be passed by a sign error, and
            // milling the opponent has to be chosen over milling nobody.
            libraryCount: 9,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            moves: [
                { kind: "cast-spell", card: "Brain Freeze", target: "opp" },
            ],
        },
        note: "Guards all three halves of the Underworld Breach probe at once: the search-side sacrifice model (`applyTapPlanInSearch`), the `graveyard` eval term, and the `library` term plus `deckOutDelta`. Red on the parent commit at 400 and 1200 iterations across the same seeds — it cast Lightning Bolt from the graveyard and stopped, leaving the opponent at 8 cards instead of 0. Not paired: a positive `moves` expectation stands alone (ADR 0070 §1 concerns `forbidden` halves).",
    },
    {
        // DISCRIMINATING PAIR, HALF 1 of 2 (issue #2796).
        // PAIRED WITH: "cast mode: never bestows the Aura onto the OPPONENT's
        // creature".
        //
        // Springheart Nantuko ({1}{G}, 1/1, "Bestow {1}{G}", "Enchanted
        // creature gets +1/+1") in hand, two untapped Forests, and the ONLY
        // creature on the board is the opponent's. So the bestow line can point
        // at nothing but the opponent's Hill Giant — a strictly self-harming
        // play that spends the card and the mana to hand the opponent a
        // permanent +1/+1 and keeps no body — while the printed-cost cast puts
        // a 1/1 on the bot's own board.
        //
        // Half 1 is the POSITIVE half, and it is what makes half 2 mean
        // something: a bot that simply never cast the card would satisfy half
        // 2's `forbidden` and fail here. The two boards are not identical —
        // half 2 adds a creature the bot controls, since a choice of HOST is
        // the decision it exists to pin — so what half 1 rules out is the
        // never-casting bot in general, not that same bot on half 2's exact
        // board (PR #3056 review finding 7). Half 1's board is the harder of
        // the two: it is the one where the bestow line has no correctly-
        // directed sibling to fall back on.
        label: "cast mode: casts the creature for its printed cost rather than gifting the bestow",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an own creature to bestow onto",
            },
        },
        spec: {
            cards: [
                { name: "Springheart Nantuko", owner: "me", zone: "hand" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            // A predicate, not a `{ card }` matcher: BOTH cast variants act
            // with the same card, so the only thing that separates the printed
            // cast from the bestow one is that the bestow cast TARGETS (CR
            // 702.103b — an Aura spell must). Matching on shape alone would
            // accept the blunder.
            predicate: (move) =>
                move?.kind === "cast-spell" && move.targets.length === 0,
            describe:
                "casts Springheart Nantuko with NO target (the printed-cost creature cast), not the bestow variant",
        },
        note: 'Half 1 of the discriminating pair — PAIRED WITH "cast mode: never bestows the Aura onto the OPPONENT\'s creature". Red on the parent commit: `applyMoveInSearch` (the ISMCTS in-tree cast executor) stamped no bestow characteristics, so both variants resolved into the same board — a plain 1/1 entering — and the two lines tied at every depth and every budget, leaving the root pick to rollout noise (measured 4/6 in favour of the GIFT over 10 seeds at both 400 and 2000 iterations). With the shared cast-mode census in place the bestow line resolves as the Aura it is and `policyValue` separates them by 297 points (132.92 vs −163.88), and all ten seeds cast for the printed cost.',
    },
    {
        // DISCRIMINATING PAIR, HALF 2 of 2 (issue #2796).
        // PAIRED WITH: "cast mode: casts the creature for its printed cost
        // rather than gifting the bestow". Same board plus one creature the BOT
        // controls, so a bestow line now has two possible hosts and the choice
        // between them is the whole decision. Bestowing onto the opponent's
        // creature stays perfectly LEGAL (CR 702.103b — "enchant creature"
        // names no controller, and there are real reasons to do it); what it
        // must never be is the bot's PREFERENCE over the same Aura on its own
        // creature, or over simply casting the 1/1.
        label: "cast mode: never bestows the Aura onto the OPPONENT's creature",
        // Absolute (issue #4797 review): removing the Bot's own host gives
        // its partner's board, where bestowing onto the opponent is still
        // wrong — no single change makes the gift right.
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Springheart Nantuko", owner: "me", zone: "hand" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            // The two creatures carry DIFFERENT names precisely so a
            // name-based matcher can tell whose creature the Aura landed on.
            forbidden: [
                {
                    kind: "cast-spell",
                    card: "Springheart Nantuko",
                    target: "Hill Giant",
                },
            ],
        },
        note: 'Half 2 of the discriminating pair — PAIRED WITH "cast mode: casts the creature for its printed cost rather than gifting the bestow" (ADR 0070 §1: a `forbidden` half a never-casting bot also satisfies asserts nothing alone). This is the reported blunder from issue #2796 verbatim. Red on the parent commit across the same seeds; the triage tally over 10 seeds was 3 printed cast / 2 bestow-onto-own / 5 bestow-onto-OPPONENT, identical at 400 and at 2000 iterations, which is the signature of a pick decided by noise rather than by search.',
    },
    {
        // DISCRIMINATING PAIR, HALF 1 of 2 (issue #2707).
        // Oath of Druids' "may" is a real decision, and the two halves of this
        // pair differ in ONE thing only: what the bot's own library holds. The
        // Op valuer cannot see a library, so if the bot got this right by
        // valuing the announcement it would answer both halves the same way —
        // which is exactly what makes the pair discriminating.
        //
        // HALF 1: an all-creature library. Accepting reveals exactly one card,
        // puts a free 6/4 onto a board where the opponent controls the only
        // creatures (which is also what makes Oath's target legal at all,
        // CR 601.2c) and mills NOTHING; declining gets nothing. Twenty copies
        // of ONE fat creature rather than a single deep fatty, on purpose and
        // for two separate reasons. (a) The observer's own library ORDER is
        // hidden and re-shuffled per determinization (`determinize.ts`), so a
        // card seeded at a known depth is a position the search cannot see;
        // a uniform library makes the reveal identical on every
        // determinization. (b) The body has to be big enough that the entry
        // is LOAD-BEARING: proven by routing the match leg to `rest` instead
        // of the battlefield, which turns accepting into a bare self-mill —
        // red on all three seeds with a 6/4, still GREEN with a 2/2, because
        // a 2/2 of material sits inside the outcome epsilon and the pick
        // falls to a tie-break (ADR 0070 §1 — an entry that passes on a tie
        // asserts nothing).
        label: "oath: takes the free body when its library is creature-dense",
        pairOf: {
            anchor: "oath: declines the dig when its library holds no creature",
            discriminant: DENSE_LIBRARY,
        },
        spec: {
            cards: [
                { name: "Oath of Druids", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "library",
                    count: 20,
                },
            ],
            phase: "UPKEEP",
            turn: 4,
            landCount: 0,
            libraryCount: 0,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        setup: [{ kind: "phase-trigger" }, { kind: "resolve-top" }],
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: { moves: [{ kind: "may-pay", accept: true }] },
        note: "Half 1 of the discriminating pair. Also the FIRST blade position whose decision is a phase trigger: it needs the `phase-trigger` setup step (issue #2707), since a ScenarioSpec names a phase but only describes a board and no step advanced the turn, so no upkeep/draw/end-step trigger could previously be the decision under test. The reveal is CR 701.20a, the free arrival CR 400.7.",
    },
    {
        // DISCRIMINATING PAIR, HALF 2 of 2 (issue #2707).
        // Same board, same trigger, one difference: the library holds NO
        // creature card. Same library SIZE, same everything — only the card
        // TYPE differs, which is what makes the pair discriminating. Accepting
        // reveals the WHOLE library and mills it (the `match` leg's "that card"
        // has no referent, so CR 101.3 ignores that clause while CR 609.3 still
        // performs the `rest` clause), taking the library from 20 to 0 and
        // straight through the decking term's 12-card horizon (`libraryTerm`,
        // evaluate.ts). That is the exact reason the printed clause is a "may".
        //
        // This is the half a valuer alone can never get right: `revealUntilMatch`
        // scores the same announcement in both positions, so a bot answering
        // from the valuer accepts here too. Getting it right requires the
        // SEARCH to apply the Op through the real GRE and score the emptied
        // library.
        label: "oath: declines the dig when its library holds no creature",
        classification: { kind: "conditional", discriminant: DENSE_LIBRARY },
        spec: {
            cards: [
                { name: "Oath of Druids", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
                {
                    name: "Forest",
                    owner: "me",
                    zone: "library",
                    count: 20,
                },
            ],
            phase: "UPKEEP",
            turn: 4,
            landCount: 0,
            libraryCount: 0,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        setup: [{ kind: "phase-trigger" }, { kind: "resolve-top" }],
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: { moves: [{ kind: "may-pay", accept: false }] },
        note: "Half 2 of the discriminating pair. Accepting empties a twenty-card library, which `libraryTerm` (evaluate.ts, CR 104.3c / 704.5b) scores steeply negative below its 12-card horizon; declining costs nothing. The pair is what proves the answer comes from the search applying the Op, not from the announcement's flat valuation — the valuer scores the two announcements identically.",
    },
    {
        // Issue #6761 — a "may search" tutor whose find is a strict gain. CR
        // 701.23b lets the searcher fail to find, so Tinker's choice admits an
        // empty pick (`count: { min: 0, max: 1 }`, PR #6562). ISMCTS backs the
        // MEAN of the choice node up to the cast, so the visits the empty branch
        // takes (an Ornithopter sacrificed for nothing) pulled the cast below
        // `pass`, and the bot never cast Tinker at all.
        label: "may-search tutor: casts Tinker for the artifact the find puts onto the battlefield",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Tinker", owner: "me", zone: "hand" },
                { name: "Ornithopter", owner: "me", zone: "battlefield" },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Juggernaut", owner: "me", zone: "library" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 100 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Tinker" }] },
        note: "Issue #6761 (RED @ b77aa85e). The find goes from the searcher's own library onto its battlefield, the script only moves it, and the library stays above the decking horizon, so `failToFindIsDominated` (`gre/ai/choiceCandidates.ts`) drops the `search-library:none` branch from the tree. The empty submission stays legal. Proof-of-failure: disabling that prune makes the bot pass on every seed at this budget (it casts again from about 200 iterations, once the visits concentrate on the find).",
    },
    {
        // DISCRIMINATING PAIR, HALF 1 of 2 (issue #3282).
        // Hand-bound land search: the land leg of `libraryTargetWorth` prices a
        // fetched land by its source quality and by whether it supplies a
        // colour a valuable card in the searcher's own hand needs.
        label: "land search: fetches the utility land when the hand's colours are covered",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a green card added to hand",
            },
        },
        spec: {
            cards: [
                { name: "Demonic Tutor", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Mishra's Factory", owner: "me", zone: "library" },
                { name: "Arid Mesa", owner: "me", zone: "library" },
                { name: "Badlands", owner: "me", zone: "library" },
                { name: "Bayou", owner: "me", zone: "library" },
                { name: "Blood Crypt", owner: "me", zone: "library" },
                { name: "Bloodstained Mire", owner: "me", zone: "library" },
                { name: "Breeding Pool", owner: "me", zone: "library" },
                { name: "Flooded Strand", owner: "me", zone: "library" },
                { name: "Forest", owner: "me", zone: "library" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 0,
            life: { me: 20, opp: 20 },
        },
        setup: [
            { kind: "cast", card: "Demonic Tutor", by: "me" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", card: "Mishra's Factory" }],
        },
        note: "Half 1 of the discriminating pair (issue #3282) — PAIRED WITH the Forest entry. Nothing in hand needs a colour the board lacks, so source quality decides: the utility land outranks the basic on `libraryTargetWorth`'s land leg. Proof-of-failure: reverting the land leg to the bare fetch curve ties every land and reds this entry.",
    },
    {
        // DISCRIMINATING PAIR, HALF 2 of 2 (issue #3282).
        // Hand-bound land search: the land leg of `libraryTargetWorth` prices a
        // fetched land by its source quality and by whether it supplies a
        // colour a valuable card in the searcher's own hand needs.
        label: "land search: fetches the basic that is the only source of the hand's colour",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a green card in hand",
            },
        },
        spec: {
            cards: [
                { name: "Demonic Tutor", owner: "me", zone: "hand" },
                { name: "Serra Angel", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "library" },
                { name: "Arid Mesa", owner: "me", zone: "library" },
                { name: "Badlands", owner: "me", zone: "library" },
                { name: "Blood Crypt", owner: "me", zone: "library" },
                { name: "Bloodstained Mire", owner: "me", zone: "library" },
                { name: "Flooded Strand", owner: "me", zone: "library" },
                { name: "Forest", owner: "me", zone: "library" },
                { name: "Island", owner: "me", zone: "library" },
                { name: "Mountain", owner: "me", zone: "library" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 0,
            life: { me: 20, opp: 20 },
        },
        setup: [
            { kind: "cast", card: "Demonic Tutor", by: "me" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", card: "Plains" }],
        },
        note: "Half 2 of the discriminating pair (issue #3282) — PAIRED WITH the utility-land entry. Serra Angel needs {W}{W}, the board (Swamp, Island) produces no white, so the Plains is the decisive source and outranks every dual whose colours are already covered. Nine distinct land identities against `CHOICE_TOP_K` (8): the Plains sorts last, so under a bare-curve tie the generator prunes it and no reward can choose it.",
    },
    {
        // DISCRIMINATING PAIR, HALF 1 of 2 (issue #3041).
        // PAIRED WITH: "entomb: buries the self-reachable card, not the bigger
        // body". Both halves are the SAME graveyard-bound search; what differs
        // is which card the searcher can actually get back, and the pair is
        // what proves the fix is a PRICING fix rather than an "always entomb
        // the fatty" rule.
        //
        // THE OBSERVED BUG (owner, 2026-09-02): the bot cast Entomb and put
        // Breeding Pool into its graveyard. Every `search-library` candidate
        // was priced destination-blind — a land by the fetch curve, everything
        // else by what it would do if CAST — and nothing asked where the source
        // effect actually PUTS the find. Entomb's own script says
        // `moveZone … to: "graveyard"` (issue #3041 reads it there), and a land
        // in a graveyard produces no mana at all.
        //
        // WHY THE LIBRARY IS CROWDED, and this is the whole point of the entry.
        // The generator is SELF-PRUNING: it collapses the pool to distinct card
        // identities, ranks them by the same worth, and emits only
        // `CHOICE_TOP_K` (8) leads. On a two-card library a bad PRIOR is
        // harmless — the search opens both branches and the reward corrects the
        // order (measured: with the fix reverted, a two-card version of this
        // entry still passes, so it asserts nothing). Nine distinct identities
        // is where the bug becomes uncorrectable: destination-blind, each land
        // prices at 50 (`LAND_SEARCH_BASE - 2 * LAND_SEARCH_STEP`,
        // `candidateValue.ts`) and Sengir Vampire's 4/4 body at 42, so the
        // Vampire ranks tenth of nine slots and is never emitted at all. A
        // candidate that does not exist is one no amount of reward can choose.
        //
        // FAIRNESS BY CONSTRUCTION (ADR 0070 §1). Reanimate sits in hand, so
        // the graveyard is genuinely reachable (`graveyardReach.ts` reach shape
        // 2): burying the Vampire is a 4/4 flier for {B}, and burying any of
        // the lands buries nothing — a land is not castable from a graveyard,
        // and Reanimate returns only a CREATURE card. No plan-quality
        // judgement, no averages.
        label: "entomb: buries the reanimation target, not one of eight lands",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "the reanimation spell removed from hand",
            },
        },
        spec: {
            cards: [
                { name: "Entomb", owner: "me", zone: "hand" },
                // Reach shape 2 — recursion the searcher HOLDS.
                { name: "Reanimate", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                // The one card worth burying …
                { name: "Sengir Vampire", owner: "me", zone: "library" },
                // … and eight DISTINCT land identities to crowd it out of the
                // top-K under the old pricing. Distinct names, not copies:
                // `stableCardIdentity` collapses copies of one land to a single
                // candidate, which prunes nothing.
                { name: "Breeding Pool", owner: "me", zone: "library" },
                { name: "Hallowed Fountain", owner: "me", zone: "library" },
                { name: "Blood Crypt", owner: "me", zone: "library" },
                { name: "Plains", owner: "me", zone: "library" },
                { name: "Island", owner: "me", zone: "library" },
                { name: "Mountain", owner: "me", zone: "library" },
                { name: "Forest", owner: "me", zone: "library" },
                { name: "Taiga", owner: "me", zone: "library" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 0,
            life: { me: 20, opp: 20 },
        },
        setup: [
            { kind: "cast", card: "Entomb", by: "me" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            // Strictly stronger than the `forbidden` naming the land the issue
            // asks for: every other legal answer IS a land, so "must be the
            // Vampire" forbids all of them by construction.
            moves: [{ kind: "resolution-choice", card: "Sengir Vampire" }],
        },
        note: 'Half 1 of the discriminating pair (issue #3041) — PAIRED WITH "entomb: buries the self-reachable card, not the bigger body". The root decision is the live search-library choice (CR 701.23) of a GRAVEYARD-bound tutor, reached by really casting and resolving Entomb. Before the fix, `libraryTargetWorth` priced every land on the LAND FETCH CURVE (50 at two lands in play) against Sengir Vampire\'s prospective body worth (42), so the eight lands filled all eight `CHOICE_TOP_K` slots and the Vampire was pruned out of the candidate set entirely. Proof-of-failure: dropping the `destination` argument at the `choiceCandidates.ts` / `choicePriors.ts` call sites (back to the destination-blind `libraryTargetWorth(state, searcherId, card, ctx)`) reds this entry on every seed.',
    },
    {
        // DISCRIMINATING PAIR, HALF 2 of 2 (issue #3041).
        // PAIRED WITH: "entomb: buries the reanimation target, not one of eight
        // lands". Same tutor, same graveyard destination, same crowd — the
        // recursion is REMOVED from hand and the right answer changes, which is
        // the whole point: the fix prices a find by whether its owner can REACH
        // it out of the graveyard, not by how big it is.
        //
        // With nothing to return them, the eight huge creatures are buried
        // dead, however large they are. Lingering Souls' printed Flashback
        // (CR 702.34) makes it usable from the graveyard on its own
        // (`graveyardReach.ts` reach shape 1) for {1}{B}, which the two Swamps
        // can actually pay, so it is two 1/1 fliers rather than nothing. That
        // is the leg an "always entomb the fatty" rule fails, and it is why the
        // fix routes through the reachability gate instead of through size.
        //
        // THE CROWD IS FATTIES HERE, not lands, and for a measured reason. The
        // pruning is what makes the bug uncorrectable, so the crowd has to
        // out-rank the right answer under the OLD blind pricing: Lingering
        // Souls' blind script worth is 78.8 — ABOVE a land's 50, so a crowd of
        // lands leaves it admitted second and the reward simply corrects the
        // order (measured: that version passes with the fix reverted and
        // asserts nothing). Every creature below has a blind body worth of 108
        // or more (`permanentWorth`, p² + t² + 10), so blind admission fills
        // all eight `CHOICE_TOP_K` slots with cards that do nothing in a
        // graveyard and never emits the one that does.
        label: "entomb: buries the self-reachable card, not the bigger body",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a reanimation spell in hand",
            },
        },
        spec: {
            cards: [
                { name: "Entomb", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                // Reach shape 1 — castable out of the graveyard on its own,
                // for a cost this board can pay.
                { name: "Lingering Souls", owner: "me", zone: "library" },
                // Eight far larger bodies, every one of them ranked above
                // Lingering Souls by the blind pricing and worth nothing in a
                // graveyard with no recursion anywhere.
                { name: "Force of Nature", owner: "me", zone: "library" },
                { name: "Lord of the Pit", owner: "me", zone: "library" },
                { name: "Colossus of Sardia", owner: "me", zone: "library" },
                { name: "Polar Kraken", owner: "me", zone: "library" },
                { name: "Cosmic Horror", owner: "me", zone: "library" },
                {
                    name: "Island Fish Jasconius",
                    owner: "me",
                    zone: "library",
                },
                { name: "Chaos Lord", owner: "me", zone: "library" },
                { name: "Draco", owner: "me", zone: "library" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 0,
            life: { me: 20, opp: 20 },
        },
        setup: [
            { kind: "cast", card: "Entomb", by: "me" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", card: "Lingering Souls" }],
        },
        note: 'Half 2 of the discriminating pair (issue #3041) — PAIRED WITH "entomb: buries the reanimation target, not one of eight lands". Removing the recursion from hand flips the correct answer from the largest card to the self-reachable one, which is what proves the change is a destination-and-reachability PRICING fix and not a size rule: half 1 alone passes for a bot that always buries the biggest thing it can find. Proof-of-failure: the same call-site revert reds this entry — destination-blind, the eight bodies (108 to 252) all out-rank Lingering Souls (78.8) and fill every `CHOICE_TOP_K` slot, so the one card that does anything from a graveyard is never emitted and the bot buries a creature it can never get back.',
    },
    {
        // Lifted from the AI-diagnosis harness, episode #9 (issue #2436).
        //
        // The bot's 3/5 faces a 2/4 reach blocker: NO defending creature has 5
        // power, so nothing kills the attacker — but Giant Spider (toughness 4 >
        // 3 power) blocks and SURVIVES, absorbing every point for free. The best
        // realistic case is a neutral exchange; the downside is real (the 3/5 is
        // tapped out of defence, and the defender has six untapped lands plus a
        // card). Swinging for an at-best-neutral result is the blunder, and it is
        // ruled out STRUCTURALLY (`isWastefulAttack`, search.ts) rather than by
        // the material tie-break: the rollout margin actually favours the swing,
        // because a survived attacker leaves board material unchanged.
        label: "wasteful attack: does not swing a 3/5 into a blocker that absorbs it for free",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no untapped blocker able to absorb the 3/5",
            },
        },
        spec: {
            cards: [
                {
                    name: "Ironroot Treefolk",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Giant Spider",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Hypnotic Specter",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Birds of Paradise",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                // Open mana and a card in hand: the swing also runs into a
                // possible trick, which is part of why it is not worth making.
                {
                    name: "Forest",
                    owner: "opp",
                    zone: "battlefield",
                    count: 6,
                },
                { name: "Grizzly Bears", owner: "opp", zone: "hand" },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [
                { kind: "declare-attackers", card: "Ironroot Treefolk" },
            ],
        },
        note: "The leaf half of the same episode — `predictCombatOutcome` must report the free absorbing block rather than 3 face damage — is a deterministic assertion on the predictor and lives in `evaluate.bot.test.ts`.",
    },
    {
        // Lifted from the AI-diagnosis harness, episode #10 (issue #2436).
        //
        // The defender holds Scryb Sprites (1/1 flying) and Birds of Paradise
        // (0/1 flying) against a lone Hypnotic Specter (2/2 flying). Their
        // COMBINED power is 1, below the Specter's 2 toughness, so no block kills
        // it (CR 510.1d — the blockers assign 1 damage in total to a 2-toughness
        // attacker) while its 2 power is lethal to either 1-toughness blocker
        // (CR 704.5g).
        // Double-blocking therefore loses TWO creatures to kill nothing — it is
        // strictly dominated by the single block, which is dominated in turn by
        // taking 2. Only the double block is forbidden here: choosing between
        // "chump one" and "take it" is a judgement, throwing two creatures away
        // for nothing is not.
        label: "chump block: never double-blocks a 2/2 with two bodies that cannot kill it",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Hypnotic Specter",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Scryb Sprites",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Birds of Paradise",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        // The attack is declared by the ENGINE and priority walked to the block
        // window (ADR 0070 §4), never by a hand-seeded `combat.attackerIds`.
        setup: [{ kind: "declare-attackers", cards: ["Hypnotic Specter"] }],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [
                {
                    kind: "declare-blockers",
                    cards: ["Scryb Sprites", "Birds of Paradise"],
                },
            ],
        },
        note: "The leaf half of the same episode — `declaredBlockDelta` must score the double block strictly below the single one — is a deterministic assertion on the term and lives in `evaluate.bot.test.ts`.",
    },
    {
        // TRAMPLE OVERFLOW (issue #5785) — THE DISCRIMINATING PAIR.
        //
        // Skizzik (5/3 trample) attacks a defender holding Hill Giant (3/3),
        // Savannah Lions (2/1) and Mons's Goblin Raiders (1/1). The 2/1 + 1/1
        // double block kills the 5/3 for the two cheapest bodies, but owes only
        // 1 + 1 lethal (CR 702.19b), so 3 tramples over. Any block that
        // includes the 3/3 owes at least 3 and lets at most 2 through.
        //
        // At 3 life the 3 overflow is lethal (CR 704.5a); at 5 it is not, and
        // the cheap double block is an acceptable trade. The two entries
        // differ ONLY in `life.opp`: a trample-blind leaf (pre-fix, a blocked
        // attacker dealt the player nothing in both `lethalUnblockedDelta`
        // and `declaredBlockDelta`) fails the must; one that over-reads
        // lethal and throws every body in fails the control.
        //
        // BITE PROOF: red before the fix — the bot declared the 2/1 + 1/1
        // double block on all five seeds at 3 life and died. Green on all
        // five after (Hill Giant + Mons's Goblin Raiders).
        label: "trample overflow: never double-blocks a trampler with two chumps whose overflow is lethal (issue #5785)",
        classification: {
            kind: "conditional",
            discriminant: { kind: "life", detail: "the bot at 5 life" },
        },
        spec: {
            cards: [
                {
                    name: "Skizzik",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Savannah Lions",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Mons's Goblin Raiders",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            // No lands: no castable answer, the block is the whole decision.
            landCount: 0,
            libraryCount: 20,
            life: { opp: 3 },
        },
        setup: [{ kind: "declare-attackers", cards: ["Skizzik"] }],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            // Exactly the blocks that include the 3/3 survive: alone it lets 2
            // through, beside a chump at most 1. Every block without it lets
            // ≥ 3 through (no block: 5).
            moves: [{ kind: "declare-blockers", card: "Hill Giant" }],
        },
        note: "Deterministic halves of the same fix — `lethalUnblockedDelta` and `declaredBlockDelta` counting trample overflow past lethal to every blocker, deathtouch included — live in `trample-overflow.bot.test.ts`.",
    },
    {
        // LIFE-DEPENDENT NEGATIVE CONTROL (issue #5785) — the SAME board as the
        // entry above at 5 life, where every block survives and no block
        // (5 damage) does not. The 2/1 + 1/1 double block stays acceptable:
        // it kills the 5/3 and its 3 overflow leaves the bot at 2. What is
        // ruled out is the triple block: the 5/3 owes 3 + 1 + 1 and kills all
        // three bodies (CR 702.19b), so it spends the Lions on top of the
        // Giant + Raiders block to save a single life point. Measured: the
        // bot picks the double block on all five seeds, before and after.
        label: "trample overflow: survivable overflow does not buy a three-body block (issue #5785)",
        classification: {
            kind: "conditional",
            discriminant: { kind: "life", detail: "the bot at 3 life" },
        },
        spec: {
            cards: [
                {
                    name: "Skizzik",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Savannah Lions",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Mons's Goblin Raiders",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
            life: { opp: 5 },
        },
        setup: [{ kind: "declare-attackers", cards: ["Skizzik"] }],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [
                {
                    kind: "declare-blockers",
                    cards: [
                        "Hill Giant",
                        "Savannah Lions",
                        "Mons's Goblin Raiders",
                    ],
                },
            ],
        },
    },

    // -----------------------------------------------------------------------
    // ORDERED TOP (issue #2996) — Scry (CR 701.22) / Surveil (CR 701.25) /
    // Explore's keep-or-bin tail (CR 701.44a).
    //
    // THE DISCRIMINATING PAIR. Both positions are the SAME board, the same
    // spell and the same budget; the only thing that differs is which cards sit
    // on top of the library and which fill the rest of it. In one, keeping is
    // right; in the other, binning is. A change that made the bot always keep
    // (the pre-#2996 behaviour) or always bin passes neither.
    //
    // WHY PREORDAIN. "Scry 2, then draw a card" puts the payoff INSIDE the same
    // resolution: the card left on top is the card drawn, and a drawn card
    // moves `evaluate`'s `hand` term immediately. A scry whose payoff is next
    // turn's draw is beyond the rollout horizon at any production budget, and
    // the entry would then measure the horizon rather than the decision
    // (`project_combat_eval_washed_at_horizon`, same class).
    //
    // WHY IT COULD NOT WORK BEFORE THE PEEK PIN. Scry does NOT mark the
    // looked-at cards known until the choice is APPLIED, so `determinize` used
    // to re-deal the very cards `candidateIds` names, every iteration — the
    // search would decide "keep this card" about a card that is not there, and
    // `SpellContext.orderTop`'s resume would then throw. `openPeekTopCount`
    // (`gre/libraryKnownRuns.ts`) pins the open peek's top run, which is what
    // makes these two positions differ at all.
    {
        label: "scry: bottoms two dead cards to draw off a deck of bombs",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "two bombs on top of a deck of blanks",
            },
        },
        spec: {
            cards: [
                { name: "Preordain", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield" },
                // The rest of the deck: every card a real threat, so a card
                // drawn blind off the top is worth far more than either of the
                // two on top. `libraryCount: 0` clears the builder's filler
                // basics first (it seeds BEFORE placement), so the library is
                // exactly what this spec says and nothing else — and 18 cards
                // keeps it clear of `deckingHorizon` (12), whose term would
                // otherwise swamp the decision with a CR 704.5b panic.
                { name: "Craw Wurm", owner: "me", zone: "library", count: 18 },
                // The looked-at window, top-first. Two 0/2 artifact creatures
                // for {0}: legal draws, worth almost nothing.
                {
                    name: "Ornithopter",
                    owner: "me",
                    zone: "library",
                    position: 1,
                },
                {
                    name: "Ornithopter",
                    owner: "me",
                    zone: "library",
                    position: 2,
                },
                { name: "Forest", owner: "opp", zone: "battlefield" },
                // `libraryCount: 0` clears BOTH libraries, so the opponent
                // needs its own or the position is a decked-out win before the
                // decision is even reached (CR 704.5b) and every branch scores
                // in the win band, where a one-card difference is invisible.
                { name: "Forest", owner: "opp", zone: "library", count: 20 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 0,
        },
        setup: [
            { kind: "cast", card: "Preordain", by: "me" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "resolution-choice",
                    second: ["Ornithopter", "Ornithopter"],
                },
            ],
        },
        note: "Issue #2996, the BIN half of the discriminating pair. Both looked-at cards are Ornithopters (0/2 for {0}); every other card in the deck is a Craw Wurm. Preordain draws immediately after the scry, so bottoming both and drawing blind is worth strictly more than keeping either — and it is the answer the bot could not even express before this issue, because the `Move` union carried no second list and `brain.ts`'s minimal-legal default returned `bestFirst(candidates)` with an empty `secondZoneIds`. Proof-of-failure: dropping `secondZoneIds` from the `resolution-choice` Move (or unregistering `order-top` from `CHOICE_CANDIDATE_GENERATORS`) reds this at every seed.",
    },
    {
        label: "scry: keeps two bombs on top of a deck of blanks",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "two blanks on top of a deck of bombs",
            },
        },
        spec: {
            cards: [
                { name: "Preordain", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield" },
                // The mirror deck: blanks below, bombs on top.
                {
                    name: "Ornithopter",
                    owner: "me",
                    zone: "library",
                    count: 18,
                },
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "library",
                    position: 1,
                },
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "library",
                    position: 2,
                },
                { name: "Forest", owner: "opp", zone: "battlefield" },
                // `libraryCount: 0` clears BOTH libraries, so the opponent
                // needs its own or the position is a decked-out win before the
                // decision is even reached (CR 704.5b) and every branch scores
                // in the win band, where a one-card difference is invisible.
                { name: "Forest", owner: "opp", zone: "library", count: 20 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 0,
        },
        setup: [
            { kind: "cast", card: "Preordain", by: "me" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", second: [] }],
        },
        note: "Issue #2996, the KEEP half of the discriminating pair — the same board, spell and budget as the entry above with the library's two halves swapped. `second: []` asserts that NOTHING was sent to the bottom, so a bot that learned to bin unconditionally fails here while a bot that never bins fails the entry above. Neither position is solvable by a policy that ignores what the cards are.",
    },
    {
        label: "explore: bins the revealed blank instead of leaving it as the next draw",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a bomb revealed instead of the blank",
            },
        },
        spec: {
            cards: [
                // CR 111.10 — the Map token (LCI): "{1}, {T}, Sacrifice this
                // token: Target creature you control explores." The vehicle for
                // Explore's own keep-or-bin (CR 701.44a), which is `orderTop`
                // at n = 1 with `destination: "graveyard"` — the one member of
                // this family where the un-kept card goes somewhere that can
                // still be worth something.
                { name: "Map", owner: "me", zone: "battlefield", token: true },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Craw Wurm", owner: "me", zone: "library", count: 18 },
                // The revealed card: a nonland, so CR 701.44a's second branch
                // runs (a +1/+1 counter, then the keep-or-bin), and a blank,
                // so leaving it on top means next turn's draw is wasted.
                {
                    name: "Ornithopter",
                    owner: "me",
                    zone: "library",
                    position: 1,
                },
                { name: "Forest", owner: "opp", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "library", count: 20 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 0,
        },
        setup: [
            // Sorcery-speed activation, targeting the one creature. `activate`
            // with a `target` goes through `enumerateMoves` +
            // `applyMoveInSearch`, the real legality gate.
            { kind: "activate", card: "Map", target: "Grizzly Bears" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", second: ["Ornithopter"] }],
        },
        note: "Issue #2996 — Explore's keep-or-bin tail (CR 701.44a), the sharper consumer of this family: for a scry the fixed default was merely suboptimal, but the keep-or-bin IS the decision the nonland branch exists to offer, and the bot always chose \"top\", so a blank revealed off an explore was always next turn's draw. The window is a single card, so the generator emits exactly two branches (keep / bin) — the n = 1 collapse of the four policies. Shipped Explore consumers today: the Map token and Sentinel of the Nameless City (issue #2376).",
    },
    {
        // BOARD CAST PERMISSION reachability (CR 601.3 / 118.9, issue #2706).
        // Aluren is on the battlefield and the bot has NO land at all, so the
        // printed {1}{G} is unpayable and the ONLY way a creature reaches the
        // stack is the permission's zero-mana alternative cost. Casting
        // anything here therefore proves two things at once: the free-cast
        // variant was enumerated (`enumerateCastMoves` re-enters its own
        // builder with the cost replaced), and the search preferred a free 2/2
        // to passing.
        //
        // The claim is REACHABILITY, not preference — a free body on an empty
        // board is not a matter of opinion. The entry exists because a missed
        // enumeration seam here is invisible to every other suite: nothing goes
        // red, the bot simply never uses the Aluren it controls, which is the
        // whole point of the card.
        label: "cast permission: casts a creature for free under Aluren with no lands",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Aluren", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Grizzly Bears" }] },
        note: "Issue #2706 — the first `cast-permission` static. With landCount 0 the printed cost cannot be paid, so a `cast-spell` move at all IS the free cast; no other line exists.",
    },
    {
        // The Aluren deck's engine piece reaches the stack (issue #2718, the
        // Premodern Tier 1 list). Same zero-land shape as the entry above, so a
        // `cast-spell` IS the free cast — but on a mana value 3 creature whose
        // ETB (`lookDistribute`) and Echo upkeep (`mayPay`) the search must then
        // simulate through. A search that could not answer either would
        // stall on the rollout, and the move would never be preferred.
        label: "cast permission: casts Raven Familiar for free under Aluren with no lands",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Aluren", owner: "me", zone: "battlefield" },
                { name: "Raven Familiar", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Raven Familiar" }] },
        note: "Issue #2718 — reachability, not preference: a free card-advantage body on an empty board has no competing line.",
    },
    {
        // DISCRIMINATING PAIR, HALF 1 of 2 (issue #3081).
        // PAIRED WITH: "self-tap source: pays a {T} ability entirely from the
        // OTHER lands".
        //
        // Abandoned Air Temple carries BOTH a `{T}: Add {W}` mana ability and
        // a `{3}{W}, {T}: Put a +1/+1 counter on each creature you control`
        // ability. The {T} leg spends the land, so the mana leg has to come
        // from somewhere else — and here there are only THREE other Plains
        // against a four-mana cost. The activation is unpayable and must not
        // be offered at all.
        //
        // Before this issue the planner built its source list from every
        // untapped permanent the player controlled, the temple included, so
        // the temple funded its own activation and the Move was enumerated on
        // a board one source short. What followed was SILENT: the Bot
        // announces with an empty pool, so the server defers and leaves the
        // temple untapped (a {T} cost is re-checked untapped at commit,
        // CR 302.1); the executor's tap plan then taps the temple FOR MANA,
        // the mana leg is paid in full, and the commit finds the source
        // already tapped, reads a benign double-commit race and discards the
        // whole activation without an error. Observed live as "the Bot taps
        // four permanents every turn and nothing reaches the stack" — and
        // adding a fifth land did not change the count, because the plan is
        // minimum-cardinality and still selected the source itself.
        label: "self-tap source: does NOT activate a {T} ability its OTHER lands cannot pay",
        classification: { kind: "conditional", discriminant: EXTRA_PLAINS },
        spec: {
            cards: [
                {
                    name: "Abandoned Air Temple",
                    owner: "me",
                    zone: "battlefield",
                    tapped: false,
                },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                // Two creatures, so the payoff is real: the out-of-scope
                // "should it WANT this at all on an empty board" question
                // never enters the position.
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            // The three Plains above ARE the whole mana base — one short.
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            forbidden: [
                { kind: "activate-ability", card: "Abandoned Air Temple" },
            ],
        },
        note: 'Half 1 of the discriminating pair — PAIRED WITH "self-tap source: pays a {T} ability entirely from the OTHER lands". Neither half is meaningful alone: half 2 shares every line but ONE extra Plains, so a bot that had simply been taught to never activate this land would pass half 1 and fail half 2. The mana ability is deliberately left on the card — the temple stays a legal source for any OTHER cost, and only its own activation may not have it.',
    },
    {
        // DISCRIMINATING PAIR, HALF 2 of 2 (issue #3081).
        // PAIRED WITH: "self-tap source: does NOT activate a {T} ability its
        // OTHER lands cannot pay". Identical position with a FOURTH Plains:
        // {3}{W} is now payable from the other lands alone, so the activation
        // must be taken — and its tap plan must name only those lands.
        //
        // This is the half that stops the fix from becoming "never activate a
        // {T} ability on a permanent that also taps for mana": a bar that
        // over-reached would pass half 1 and fail here.
        //
        // BUDGET (issue #3401). 400, not the 200 this entry shipped with. The
        // Weight Fit's first refit reddened it on one of its three seeds, and
        // the measurement says the refit is not what is wrong with it: at the
        // leaf the fitted vector prefers the activation MORE (the 1-ply policy
        // gap over `pass` widens from 52 margin points to 62), and swept over
        // eight seeds at 200 iterations the HAND-PICKED vector fails one of
        // them too — seed 7, which this entry simply never declared. Both
        // vectors are 8/8 from 300 iterations upward, at every budget measured
        // to 1200. So 200 was under this position's convergence threshold all
        // along and the entry was passing on its seed selection; the refit
        // moved the noise, not the preference.
        label: "self-tap source: pays a {T} ability entirely from the OTHER lands",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Abandoned Air Temple",
                    owner: "me",
                    zone: "battlefield",
                    tapped: false,
                },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            // A `moves` matcher would only say "it activated the temple". The
            // acceptance criterion is stronger — the cost must be PAID from
            // the other lands — and the tap plan is where that is observable,
            // so the assertion reads the chosen Move's own plan.
            predicate: (move, state) =>
                move?.kind === "activate-ability" &&
                state.players[0].battlefield.some(
                    (c) =>
                        c.id === move.cardInstanceId &&
                        (c.card as { id?: string }).id ===
                            getCardByName("Abandoned Air Temple").id
                ) &&
                move.tapPlan.length === 4 &&
                move.tapPlan.every(
                    (t) => t.cardInstanceId !== move.cardInstanceId
                ),
            describe:
                "activates Abandoned Air Temple's {3}{W}, {T} ability with a four-tap plan that never names the temple itself",
        },
        note: 'Half 2 of the discriminating pair — PAIRED WITH "self-tap source: does NOT activate a {T} ability its OTHER lands cannot pay". One extra Plains is the ONLY difference between the halves. The predicate asserts the tap plan, not just the choice: before issue #3081 a plan on this board could still name the temple (minimum-cardinality selection prefers the source it is already committed to), and such a plan is exactly what got the activation discarded at commit for a source the plan itself had tapped.',
    },
    {
        // REACHABILITY — a spell whose TARGET is a stack object filtered by
        // what THAT object targets (issue #2708). Nothing else in this
        // registry casts a counter in response to an opponent's ACTIVATION,
        // and nothing outside it would notice if the move stopped being
        // enumerated: the app suite proves the targeting filter admits the
        // ability, never that `enumerateMoves` ever offers the cast.
        //
        // The `setup` puts the opponent's Icy Manipulator activation on the
        // stack through the real activation path, pinned to the Forest — the
        // one land whose name is unambiguous here, since `landCount` gives
        // both seats Islands. That makes the position exact: an opponent's
        // ability, on the stack, targeting a land the bot controls, which is
        // precisely Teferi's Response's target requirement.
        //
        // The claim is REACHABILITY, not judgement. Passing lets the ability
        // resolve; casting counters it, destroys the Icy Manipulator (CR
        // 113.7a — the permanent whose ability it was) and draws two. There is
        // no line in which the pass is better, so it must hold on any seed.
        label: "reachability: counters an opponent's land-targeting activation with Teferi's Response",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "Icy Manipulator's activation targeting a creature, not a land",
            },
        },
        spec: {
            cards: [
                {
                    name: "Icy Manipulator",
                    owner: "opp",
                    zone: "battlefield",
                    // Explicit: the spec builder leaves an opponent's
                    // permanents tapped, and a tapped source cannot pay the
                    // {T} leg — the activation would never be enumerated and
                    // `setup` would throw rather than silently build a
                    // different position.
                    tapped: false,
                },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Teferi's Response", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            // Two untapped Islands per seat: {1}{U} for Teferi's Response on
            // one side, the {1} half of Icy Manipulator's cost on the other.
            landCount: 2,
            libraryCount: 20,
        },
        setup: [
            // The bot is the active player, so the opponent cannot activate
            // anything until priority reaches them (CR 117.3a). One pass is
            // the whole setup: the activation itself resets the pass cycle and
            // hands priority back, leaving the ability on the stack
            // UNRESOLVED — exactly the response window a human would answer.
            // A second pass would make it two consecutive passes and RESOLVE
            // the ability (CR 117.4), building a different position entirely.
            { kind: "pass", seat: "me" },
            {
                kind: "activate",
                card: "Icy Manipulator",
                controller: "opp",
                target: "Forest",
            },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        beyondBudget: {
            cause: "valuation",
            sweptTo: { iterations: 12000 },
            note: "The MOVE is enumerated — `stack-target-reachability.bot.test.ts` asserts it deterministically, so this entry is not covering a missing seam. What is missing is a VALUATION term: `evaluate` scores no non-creature artifact an opponent controls, so destroying the Icy Manipulator is worth nothing to it, and the counter itself is worth nothing either (a countered ability leaves no trace the leaf can see). All the search can price is the two cards drawn against the mana spent, and a 0/5 that stays 0/5 at 200, 1000, 4000 and 12000 iterations is the signature of a mis-valued subtree rather than a compute shortfall.",
        },
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Teferi's Response",
                    target: "Icy Manipulator",
                },
            ],
        },
        note: "Issue #2708 — the first entry whose announced target is a stack ITEM chosen by a property of that item's OWN targets (`spellTargetsPermanentFilter`). Filed at `stretch` deliberately: the reachability half is proven green elsewhere, and raising a budget to turn an entry green is not a legitimate move (ADR 0070 §2).",
    },

    // ── A controller-chosen sacrifice is a COST (issue #3292) ─────────────
    // A DISCRIMINATING PAIR on the SIGN of a picks-set `sacrifice`. The Op is
    // the same in both positions; what differs is WHO picks the permanents.
    // The value model used to price every bare-picks sacrifice as an edict
    // (+120 discounted removal) without asking, so a `sacrifice` the CASTER
    // chooses — their own permanent, a cost — read as removal aimed at the
    // opponent, on nine shipped cards.
    // ── Cheat a creature into play (issue #3293) ─────────────────────────
    // A DISCRIMINATING PAIR whose two positions differ ONLY in the creature in
    // hand: one whose worth is in what it does on the way out, one a vanilla
    // body of the SAME mana value — so Flash's {2}-reduced cost (CR 118.7a) is
    // identical and unpayable in both, and the trailing sacrifice is the only
    // reachable end of the resolution either way.
    //
    // Both halves are `must` at the production budget since issue #3388. The
    // split that used to exist here — negative control forced, positive half
    // `stretch` — was the honest state of a shape the bot could only ever
    // REFUSE, and issue #3388 closed the other direction (`resolved-payoff`,
    // `search.ts`): a self-confined cast whose SETTLED resolution strictly
    // improves the mover's material margin now beats an outcome-equal `pass`,
    // on the same measurement and the same gate the self-harm hold already
    // refuses on. 0/5 → 5/5 at the unchanged 400 iterations.
    //
    // Two slices got here. The first fixed the 1-ply probe: `policyValue` now
    // settles a suspended resolution, so cast-vs-pass and put-vs-decline are
    // both correctly signed and correctly SPLIT by what is in hand (pinned
    // deterministically in `ai/__tests__/cheat-into-play-payoff.bot.test.ts`).
    // The root ignored all of it, because `selectRootMove`'s material tie-break
    // reads a `meanMargin` accumulated over the whole SUBTREE and the `pass`
    // subtree explores casting the same spell one ply later — so `pass` carries
    // the identical loss and loses to the branch that already paid it.
    //
    // The second slice made the REFUSAL leaf-decisive instead of leaving it to
    // that mean: issue #3194's self-confined hold already fires on a cast whose
    // whole reach is the mover's own side and whose settled margin drops, and it
    // was measured INERT here for a reason unrelated to Flash — its confinement
    // probe counted the state-level bookkeeping a self-inflicted death writes
    // (`deathsThisTurn`, `lastKnownCopiable`), so a resolution that never left
    // the mover's side read as reaching the opponent. 0/5 → 5/5 at 400.
    //
    // What that could not do is make the bot WANT the payoff line: a hold rule
    // only ever refuses, and the positive half needed 1200 iterations to
    // separate its cast from `pass` at the root. The THIRD slice (issue #3388)
    // is that missing direction, and it took two fixes:
    //
    //   * the settle stopped bailing on a choice raised with an EMPTY STACK.
    //     CR 603.3b asks the simultaneous-trigger ORDER before the triggers go
    //     on the stack, so the sacrifice at the end of this resolution empties
    //     the stack and immediately queues a `trigger-order` choice — and the
    //     settle loop, conditioned on the stack alone, exited on it. Every
    //     dies-trigger payoff was therefore invisible to every probe;
    //   * `resolved-payoff` (`selectRootMove`) credits the cast the hold would
    //     have refused had the sign gone the other way.
    //
    // The WURM entry below is what is still open, and it is not a budget
    // question — see its own note.
    {
        label: "cheat into play: casts for a body that pays on the way out",
        pairOf: {
            anchor: "cheat into play NEGATIVE CONTROL: passes for a vanilla body of the same mana value",
            discriminant: PAYOFF_BODY,
        },
        spec: {
            cards: [
                { name: "Flash", owner: "me", zone: "hand" },
                { name: "Vaultborn Tyrant", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Flash" }] },
        note: "Issues #3293 and #3388, the half the shape exists for. Cheating a seven-drop in for {1}{U} and sacrificing it is a REAL play when the body pays on the way out: the Tyrant leaves a token copy of itself behind when the sacrifice takes it, and the 1-ply probe prices that correctly (the settled cast scores 756.4 against 509.8 for passing, +201.6 on material margin). DISCRIMINATING at the DEFAULT budget: 0/5 seeds at 400 while the root pick fell to `selectRootMove`'s material tie-break — which reads a mean accumulated over the whole SUBTREE, and the `pass` subtree casts the same spell one ply later, so the two means differ by rollout noise — and 5/5 at the same 400 once `resolved-payoff` (issue #3388) credited the cast on the leaf-decisive measurement the self-harm hold already refuses on. The negative control below is byte-identically unchanged by that rule, which is what says it reads the SIGN of the resolution rather than the shape.",
    },
    {
        label: "cheat into play NEGATIVE CONTROL: passes for a vanilla body of the same mana value",
        classification: { kind: "conditional", discriminant: PAYOFF_BODY },
        spec: {
            cards: [
                { name: "Flash", owner: "me", zone: "hand" },
                { name: "Lady Orca", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Flash" }] },
        note: "Issue #3293's negative control, and the half that is now forced. Lady Orca is a 7/4 vanilla of the same mana value as the Tyrant above, so every cost in the position is identical and the ONLY difference is that nothing survives the sacrifice: two cards and the turn's mana for an empty board. DISCRIMINATING: 0/5 seeds before the confinement probe stopped counting the death bookkeeping a self-inflicted sacrifice writes, 5/5 after, at the same 400 iterations — and byte-identically unchanged on the payoff half above, which is what says the fix reads the position rather than the card.",
    },
    {
        label: "cheat into play: the reported Worldspine Wurm position",
        pairOf: {
            anchor: "cheat into play NEGATIVE CONTROL: passes for a vanilla body of the same mana value",
            discriminant: PAYOFF_BODY,
        },
        spec: {
            cards: [
                { name: "Flash", owner: "me", zone: "hand" },
                { name: "Worldspine Wurm", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        beyondBudget: {
            cause: "valuation",
            note: "Issue #3388's ORIGINAL report, kept as the record of what is still open on this shape — and filed `valuation` with no `passesAt` on purpose: no budget clears it, because the position is scored wrong rather than reached too rarely. The settle half of #3388 IS working here: the probe now settles through the hand pick, the forced sacrifice and the CR 603.3b trigger-order batch, and reads the real outcome — three 5/5 trample tokens (825 `creatures` + 15 `permanents`) with the Wurm shuffled back into the library. It loses to 932 for keeping the Wurm in hand, because the `hand` term prices an {8}{G}{G}{G} 15/15 held on TWO LANDS at full latent worth: there is no castability factor anywhere in `cardValue`, so a card nine turns from castable scores what it would score on eleven lands. `self-harm-removal` then refuses a cast whose settled margin drops, which is the right rule reading the one wrong number in the position. Fixing it is a change to a term on every ISMCTS leaf in every game, not a line in a settle fix — drafted in `docs/findings/3388-hand-term-prices-an-uncastable-fatty-at-full-latent-worth.md`. The pair above discriminates the MECHANISM this issue was about at the same 400 iterations; this entry pins the VALUATION that is left.",
        },
        expect: { moves: [{ kind: "cast-spell", card: "Flash" }] },
        note: "Issue #3388. The position a real game produced — three consecutive turns holding Flash + Worldspine Wurm with the mana up, passing every time. Its Minimal Pair (declared in `pairOf`) is the same shape on a body whose hand worth its payoff can actually beat.",
    },
    // Issue #4218 — the OPTIONAL own-hand put onto the battlefield (Show and
    // Tell's per-player pick; Sneak Attack's and an Elvish Piper put ride the
    // same gate). Two things were wrong, and each entry below is red without
    // either:
    //   * the pick was priced as a COST: `choiceFindDestination` matched the
    //     live choice id against the `choice` Op's authored one, and a choice
    //     inside a `forEach` body carries its iteration scope (`$picked@0:1`),
    //     so the destination read `undefined` and the #3388 sign flip never
    //     reached a symmetric put;
    //   * the decline won the material tie-break: pick and decline tie inside
    //     `OUTCOME_EPS`, and the SUBTREE `meanMargin` prefers keeping the card
    //     in hand at its latent worth over a body the rollouts trade off.
    //     `resolved-payoff`'s choice half reads the SETTLED margins instead.
    {
        label: "free put: the caster puts a permanent in off its own Show and Tell",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Show and Tell", owner: "me", zone: "hand" },
                { name: "Brightglass Gearhulk", owner: "me", zone: "hand" },
                { name: "Subtlety", owner: "me", zone: "hand" },
                { name: "Figure of Destiny", owner: "me", zone: "hand" },
                { name: "Phantasmal Image", owner: "me", zone: "hand" },
                { name: "Vaultborn Tyrant", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 14,
            landCount: 6,
            libraryCount: 20,
        },
        setup: [
            { kind: "cast", card: "Show and Tell" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 100 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                { kind: "resolution-choice", card: "Brightglass Gearhulk" },
                { kind: "resolution-choice", card: "Subtlety" },
                { kind: "resolution-choice", card: "Figure of Destiny" },
            ],
        },
        note: 'Issue #4218, the reported shape: the Bot casts Show and Tell and is the first chooser (APNAP, CR 101.4), holding the four permanents of the reported hand. Phantasmal Image is left out of the accepted answers on purpose — with nothing on either battlefield to copy it enters as a 0/0 and dies, and its settled margin reads below declining. The budget is the LOW one on purpose: the live Bot searches on a wall clock on the player\'s machine, and 100 iterations is where the reported decline reproduced. DISCRIMINATING: 1/5 seeds declined at 100 before the fix (seed 4), 5/5 pick after. PAIRED WITH "free put: the second chooser still puts its creature in after the opponent\'s bigger one" and the negative control "free put NEGATIVE CONTROL: declines a pick that dies on entry".',
    },
    {
        label: "free put: the second chooser still puts its creature in after the opponent's bigger one",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Show and Tell", owner: "me", zone: "hand" },
                { name: "Shivan Dragon", owner: "me", zone: "hand" },
                { name: "Serra Angel", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 3,
            libraryCount: 20,
        },
        setup: [
            { kind: "cast", card: "Show and Tell" },
            { kind: "resolve-top" },
            { kind: "choose", cards: ["Shivan Dragon"] },
        ],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", card: "Serra Angel" }],
        },
        note: "Issue #4218, the triage's second shape. The caster has just put a Shivan Dragon in; the Bot, second chooser, holds a Serra Angel it cannot cast on three lands. The settled pick reads −41 on material margin against −89 for declining, yet the edges tie inside `OUTCOME_EPS` (0.404 vs 0.407) and the subtree `meanMargin` ranked the decline first (−133 vs −178): after the put the rollouts see the Angel outclassed and traded off, while the card kept in hand holds its latent worth to the horizon. DISCRIMINATING: 5/5 seeds declined at 400 (and at 1500) before the fix, 5/5 pick after — and the same position with the caster declining picked the Angel 5/5 before the fix too, which is what says the opponent's put was the trigger.",
    },
    {
        label: "free put NEGATIVE CONTROL: declines a pick that dies on entry",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a creature on the battlefield for Phantasmal Image to copy",
            },
        },
        spec: {
            cards: [
                { name: "Show and Tell", owner: "me", zone: "hand" },
                { name: "Phantasmal Image", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 3,
            libraryCount: 20,
        },
        setup: [
            { kind: "cast", card: "Show and Tell" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [
                { kind: "resolution-choice", card: "Phantasmal Image" },
            ],
        },
        note: "Issue #4218's negative control. The only legal pick is a clone with nothing on either battlefield to copy: it enters as a 0/0 and the state-based check puts it in the graveyard, so putting it in only throws the card away. The resolved-payoff choice half credits a pick only when its SETTLED margin strictly beats the settled decline, and here it does not, so the decline stands — at 100 and at 400 iterations, before and after the fix. A POSITION GUARD rather than a discriminating blade: the clone's pick loses on reward outright here, so it never reaches the tie the credit reads, and dropping the settled-decline baseline leaves this entry green. The discriminating half of that clause is deterministic — `ai/__tests__/optional-put-payoff.bot.test.ts` builds the exact tie and goes red without the baseline.",
    },
    {
        label: "sacrifice sign: does not cast a creature whose ETB eats its own board",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a 1/1 token as the only other creature to sacrifice",
            },
        },
        spec: {
            cards: [
                { name: "Kjeldoran Dead", owner: "me", zone: "hand" },
                {
                    name: "Craw Wurm",
                    owner: "me",
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
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Kjeldoran Dead" }],
        },
        note: 'Issue #3292. Kjeldoran Dead is a 3/1 whose ETB is `choice { player: "controller" } -> sacrifice($sac)` (CR 701.21) — the caster picks one of their OWN creatures. With a 6/4 Craw Wurm as the only other body, casting it is strictly worse than passing whichever creature the sacrifice takes, so the bot must not cast. It used to, because the ability script priced that sacrifice as +120 board removal: the permanent was credited a standing EDICT it does not have, and `dslRealizedAbilityScriptValue` puts that credit on the board at EVERY search leaf — measured at 590 points before the fix against 430 after (a 160-point swing), on the same two-creature board. Discriminating, measured at authoring time on all five seeds: `cast-spell` before the valuer split, `pass` after. SECOND cause, found by issue #3377: it was ALSO leaning on the `mana` term counting untapped sources, so a 3-mana cast started 36 points down whatever it did. Making that term tap-aware turned this entry red and exposed the real gap — `sacrifice-permanents` had no candidate generator, so `settleStackForBreakdown` could not get past the suspended choice and the margin scored the ENTERING BODY with both creatures still on the battlefield (512, sacrifice invisible). With the generator registered the cast settles to `pendingChoices: 0` and a margin delta of −149 points, and the entry holds on its own reason.',
    },
    {
        // Issue #3545 — `choose-permanents` "up to N" (CR 608.2), the MAX
        // extreme. The root decision is Frantic Search's live untap pick,
        // reached by really casting it (the cast taps all three Islands),
        // resolving it and answering the mandatory discard first.
        //
        // Onulet in hand is what makes the answer unhedged, and it is the whole
        // point of the entry, measured: with nothing to spend the mana on, one
        // untapped land is worth about one evaluation point before the next
        // untap step, every cardinality ties inside rollout noise, and the pick
        // splits across 0 / 1 / 2 / 3 by seed. With a {3} body in hand only all
        // three lands cast it this turn.
        //
        // The opponent's two TAPPED Mountains are the discriminating half: the
        // pool is all-controllers (`allControllers: true`), so "untap three
        // lands" can name theirs, and the generator does emit that branch (the
        // opponent-side prefix) — the predicate rejects any id the chooser does
        // not control.
        label: "choose-permanents: Frantic Search untaps all three of its own lands, never the opponent's",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Frantic Search", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "hand", count: 2 },
                { name: "Onulet", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield", count: 3 },
                {
                    name: "Mountain",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                    tapped: true,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
        setup: [
            { kind: "cast", card: "Frantic Search", by: "me" },
            { kind: "resolve-top" },
            { kind: "choose", cards: ["Grizzly Bears", "Grizzly Bears"] },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            // A `predicate`: the claim is a CARDINALITY plus a side, which a
            // partial `moves` matcher cannot state (three copies of one name
            // match a single Island).
            predicate: (move, state) => {
                if (move?.kind !== "resolution-choice") return false;
                const chooser = state.pendingChoices?.[0]?.playerId;
                const own = new Set(
                    state.players
                        .find((p) => p.id === chooser)
                        ?.battlefield.map((c) => c.id) ?? []
                );
                return (
                    move.cardInstanceIds.length === 3 &&
                    move.cardInstanceIds.every((id) => own.has(id))
                );
            },
            describe: "untaps exactly three lands, all of them the bot's own",
        },
        note: 'Issue #3545. `choose-permanents` had no candidate generator: the choice was no search node, so `brain.ts`\'s minimal-legal default submitted `min` — zero — for every "up to N", and the settle could not get past the suspended choice. Measured at authoring time: 5/5 seeds choose the three own Islands. Proof-of-failure: unregistering `choose-permanents` from `CHOICE_CANDIDATE_GENERATORS` reds this entry.',
    },
    {
        // Issue #3545 — the per-pick-cost shape: Magnetic Mountain's "choose any
        // number of tapped blue creatures … pay {4} for each". Mana for exactly
        // ONE payment, so the decline and the max-pick both end with nothing
        // untapped and only a size-1 branch does anything. The generator emits
        // that branch (the intermediate cardinality); the SEARCH cannot price it.
        label: "choose-permanents: Magnetic Mountain picks exactly the one creature it can pay for",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Magnetic Mountain",
                    owner: "opp",
                    zone: "battlefield",
                },
                {
                    name: "Craw Wurm",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                    summoningSick: false,
                },
                {
                    name: "Phantom Monster",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                    summoningSick: false,
                },
                {
                    name: "Air Elemental",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                    summoningSick: false,
                },
            ],
            phase: "UPKEEP",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
            life: { me: 20, opp: 20 },
        },
        setup: [{ kind: "phase-trigger" }, { kind: "resolve-top" }],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        beyondBudget: {
            cause: "valuation",
            note: 'Measured on issue #3545, and filed `valuation` with no `passesAt` because no budget clears it: 2-3/5 seeds at 400 and at 1200 iterations, at opponent life 20 AND at 4 (where the untapped 4-power flier is lethal over two ground Wurms). The candidate set is right — decline, both extremes at max, and both size-1 branches — and the visits split evenly across them. The reason is the settle through the pay-per-pick `may-pay`: `bestBranchThroughChoice` takes the branch with the best material margin, paying {4} costs mana-term points and an untapped creature is worth nothing to `evaluate`, so "choose one" settles to the SAME state as the decline (eval total 781.7 on every branch on the two-flier board; the reward also saturates at 1 − terminalBand when the margin clips). Pricing a creature\'s readiness is a leaf term on every ISMCTS node, not a candidate generator — drafted in `docs/findings/3545-untapped-creature-readiness-is-unpriced.md`.',
        },
        expect: {
            predicate: (move) =>
                move?.kind === "resolution-choice" &&
                move.cardInstanceIds.length === 1,
            describe: "chooses exactly one of the two tapped blue creatures",
        },
        note: "Issue #3545's sharpest cardinality case, kept as the record of what the generator alone cannot reach. The generator half is guarded deterministically instead — `choose-permanents-choice-node.bot.test.ts` asserts the size-1 branch is emitted for this pool shape.",
    },
    {
        // NUMERIC-NOMINATION reachability (CR 107.3f / 615.1, issue #1701).
        // `opp` has Errant Minion on the bot's Grizzly Bears; at the bot's
        // upkeep the Aura asks THEM to "pay any amount of mana" and then deals
        // 2, preventing X. The bot is at 2 life, so the 2 damage is lethal and
        // the two floating mana buy the game — nominating anything below 2 is
        // losing on the spot.
        //
        // The claim is REACHABILITY, not preference: before the `number-pick`
        // generator the kind was no search node at all, so `brain.ts`'s
        // minimal-legal fallback answered the FLOOR — zero — and the bot died
        // to a card it had the mana to survive, with every suite green.
        label: "variable mana payment: pays to prevent lethal from Errant Minion",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "life",
                detail: "the Bot at a life total above Errant Minion's damage",
            },
        },
        spec: {
            cards: [
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Errant Minion",
                    owner: "opp",
                    zone: "battlefield",
                    attachedTo: "Grizzly Bears",
                },
            ],
            phase: "UPKEEP",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
            // Floating, not untapped lands: while a pending choice is the head
            // the only moves enumerated are its own answers, so the mana the
            // nomination spends has to be in the pool already. (A human gets
            // the CR 608.2g window to tap for it; that seam has its own
            // full-path test.)
            manaPool: { me: { U: 2 } },
            life: { me: 2, opp: 20 },
        },
        setup: [{ kind: "phase-trigger" }, { kind: "resolve-top" }],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            // A `predicate`, not a `moves` matcher: the claim is a THRESHOLD
            // ("enough to live"), and it is a reachability claim, so it must not
            // vote on the weight fit (ADR 0124 §5 — see the depletion-land entry
            // above for the regression that rule exists for).
            predicate: (move) =>
                move !== null &&
                move.kind === "number-choice" &&
                move.amount >= 2,
            describe: "nominates at least 2, preventing both points of damage",
        },
        note: "CR 107.3f numeric-nomination reachability (issue #1701). Also the end-to-end cover for the `number-pick` entry in CHOICE_CANDIDATE_GENERATORS: unregister it and the brain's minimal-legal fallback nominates 0, which is lethal here. The generator half is guarded deterministically too — `numberPickCandidates.bot.test.ts` asserts the emitted set spans both ends of the live range.",
    },
    {
        label: "sacrifice sign NEGATIVE CONTROL: still casts a genuine edict",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no creature on the opponent's battlefield",
            },
        },
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
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Sheoldred's Edict" }],
        },
        note: "Issue #3292 negative control, the other side of the same Op. The Edict's sacrifice reads the identical bare picks ref, but its `choice` names `player: \"opponent\"` — the OPPONENT picks, so it is real removal and must keep the edict value. Guards the fix against over-reaching: an attribution that answered \"controller\" for anything but the literal chooser would sign this (and Innocent Blood's `$each`, and Liliana of the Veil's announced target player) as the caster's own cost and stop the bot ever casting an edict.",
    },
    {
        // DECK KEY LINE (issue #2716, PRD #2693).
        //
        // Landstill wins with Decree of Justice, and never by casting it: the
        // list holds no way to reach {X}{X}{2}{W}{W} for a relevant X, so the
        // card is a CYCLED one — {2}{W}, discard it, draw, and the cycled
        // trigger (CR 702.29c) offers "you may pay {X}. If you do, create X
        // 1/1 white Soldier creature tokens" (CR 107.3f). The list reached
        // 28/28 `ready` through engine slices (#1701's `payVariableMana` last
        // of all) and not one of them asserted the deck's payoff is one the
        // Bot takes.
        //
        // The ROOT half of that line — "cycles it rather than passing" — is
        // deliberately NOT an entry: it was written, measured, and the bot
        // passes on 3 of 5 seeds, which is not a blunder to pin. An activated
        // ability may be activated at any priority (CR 117.1b), so the cycling
        // window survives every later one in the same turn and a `pass` root
        // forfeits nothing; a `must` encoding the opposite play would red the
        // moment the search learned to hold the card for the opponent's end
        // step, which is the RIGHT play.
        //
        // What IS unambiguous is this position: the cycled trigger is
        // RESOLVING and its `payVariableMana` holds the head choice, so the
        // bot's move IS the nomination. Reached through the real engine —
        // `setup` cycles the card from hand through the same
        // `activateAbilityOnState` the mutation calls (the `zone: "hand"`
        // branch this entry is the reason for) and resolves the trigger the
        // discard put on the stack; nothing here is hand-built (ADR 0070 §4).
        //
        // The claim is REACHABILITY at the CEILING, and the board is
        // deliberately bare: three attackers and a lethal life total were
        // written first and MEASURED to change nothing (the bot nominates the
        // same amount with an empty board at 20 life), so the narrative was
        // cut rather than kept as decoration. What actually drives the answer
        // is the shape `numberPickCandidates` is written for — a count-scaled
        // consequence is monotone, so the MAX is the only interesting answer —
        // plus CR 500.5: the pool empties at the end of the step, so mana not
        // spent here is mana lost. Nominating anything below the ceiling
        // leaves a free 1/1 on the table, and nominating 0 is the floor the
        // brain's minimal-legal fallback answers with when no candidate
        // generator claims the kind.
        //
        // PRE-FLOATED mana, and the entry is honest about what that costs it.
        // Two independent reasons, one of them a real hole:
        //   - the step commits costs, it does not decide them: a cycling cost
        //     paid by TAPPING lands parks at `pendingActivation` and the step
        //     throws, exactly as the battlefield branch throws for a deferred
        //     cost;
        //   - the nomination's ceiling is `spendableManaTotal` — the POOL —
        //     and the search has no move for the CR 608.2g window the live
        //     engine opens through `isManaPaymentChoiceWindow`. Measured: with
        //     three untapped Plains and an empty pool `enumerateMoves` offers
        //     `number-choice:0` and nothing else, so in every position a real
        //     game reaches (CR 500.5 again) the Soldiers are unreachable. That
        //     is issue #3569, and it owes the empty-pool twin of this entry.
        // So what ships here is the VALUATION half of the line: given the
        // mana, the bot spends all of it on bodies.
        label: "landstill key line: pays {X} on the cycled Decree for Soldiers",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an instant in hand that needs the same mana on the opponent's turn",
            },
        },
        spec: {
            cards: [{ name: "Decree of Justice", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
            // Six: {2}{W} commits to the cycling, and the {W}{W}{W} left is
            // the nomination's whole live range (measured: the choice offers
            // 0, 1, 2, 3).
            manaPool: { me: { W: 6 } },
        },
        setup: [
            { kind: "activate", card: "Decree of Justice", zone: "hand" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            // A `predicate` because `MoveMatcher` has no numeric field: a bare
            // `{ kind: "number-choice" }` would match the FLOOR and assert
            // nothing. The threshold sits at the ceiling for the same reason
            // the Errant Minion entry's does — a threshold below it is a
            // claim the position cannot make sharp.
            predicate: (move) =>
                move !== null &&
                move.kind === "number-choice" &&
                move.amount >= 3,
            describe: "nominates the whole spendable pool, three Soldiers",
        },
        note: 'Issue #2716 — the Landstill list\'s only win condition (CR 107.3f / 702.29c), the valuation half. Proven red by breaking the CARD: `count: { ref: "$paid" }` → a literal 0 makes the payment buy nothing and the bot stops paying for it.',
    },
    {
        // DECK KEY LINE, EMPTY-POOL TWIN (issue #3569, PRD #2693).
        //
        // The entry above is the same Landstill line with the mana already
        // floating, and it says in its own note what that costs it: the
        // nomination's ceiling was `spendableManaTotal` — the POOL — and the
        // search had no move for the CR 608.2g window the live engine opens
        // through `isManaPaymentChoiceWindow`. Measured at `a10dde972` with
        // three untapped lands and an empty pool, `enumerateMoves` offered
        // `number-choice:0` and nothing else.
        //
        // This is the position a real game is ALWAYS in. CR 500.5 empties the
        // pool at the end of every step and phase, so by the time the cycled
        // trigger resolves the only mana the seat has is still in the ground.
        // Both entries stay: the one above is the VALUATION claim (given the
        // mana, the bot spends it on bodies) and this one is the REACHABILITY
        // claim (the mana is gettable at all), and either can red without the
        // other.
        //
        // The pool holds EXACTLY the cycling cost and not a mana more. That
        // is not decoration: the `activate` setup step commits costs, it does
        // not decide them, so a cycling cost paid by tapping lands parks at
        // `pendingActivation` and the step throws — the {2}{W} has to float,
        // and anything left over would fund the nomination from the pool and
        // silently restore the entry above.
        label: "landstill key line: taps for {X} on the cycled Decree (empty pool)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an instant in hand that needs the same mana on the opponent's turn",
            },
        },
        spec: {
            cards: [{ name: "Decree of Justice", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            // The nomination's whole range comes from HERE — three untapped
            // basics, which CR 608.2g lets the payer tap while the question
            // is the head choice.
            landCount: 3,
            libraryCount: 20,
            manaPool: { me: { W: 3 } },
        },
        setup: [
            { kind: "activate", card: "Decree of Justice", zone: "hand" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            // A `predicate` for the same two reasons the twin above carries
            // one: `MoveMatcher` has no numeric field, and the claim is a
            // THRESHOLD. The threshold here is the WEAKEST one that means
            // anything — "more than the decline" — because what this entry
            // pins is that the window is walkable at all; the ceiling claim
            // is the twin's.
            predicate: (move) =>
                move !== null &&
                move.kind === "number-choice" &&
                move.amount > 0 &&
                (move.tapPlan?.length ?? 0) > 0,
            describe:
                "nominates more than nothing, funded by tapping its own lands",
        },
        note: "Issue #3569 — CR 608.2g reachability for a paying numeric nomination. Proven red by reverting the generator's widened ceiling (`manaWindowPayerView` → the bare `payer` in `numberPickCandidates`, `gre/ai/choiceCandidates.ts`): the range collapses to the empty pool and the only move is `number-choice:0`, on every seed.",
    },
    {
        // DECK KEY LINE (issue #2715, PRD #2693).
        //
        // Parallax Replenish's whole deck is this one card: Attunement and
        // Frantic Search bin enchantments, Replenish ({3}{W}) returns ALL of
        // them at once (CR 608.2f — one `forEach` over the graveyard, whose
        // members return `simultaneous`ly), and Opalescence turns what came
        // back into a board.
        // The list reached 21/21 `ready` through three ENGINE slices (#3204
        // Attunement's `returnThisToHand` cost leg, #3205 Intuition's revealed
        // hidden-zone pick, #3206 Decree of Silence's `$event` cast ref) and
        // not one of them touched a bot path, so nothing anywhere asserted the
        // deck's payoff turn is a turn the Bot actually takes.
        //
        // The claim is REACHABILITY, not preference: three permanents for four
        // mana against the alternative of passing is not a matter of opinion.
        // What it guards is the WHOLE PATH, end to end, on the deck's own
        // board — the cast is enumerated, it survives dominance pruning, and
        // the search prefers it to `pass`. Not the Op's valuation, which is
        // pinned already (`opValuers.bot.test.ts` fixes `moveZone` →
        // battlefield at `REANIMATE_VALUE` with the `recursion` tag, and
        // `OP_BENEFICENCE.moveZone` is deliberately and permanently
        // `"neutral"`); accordingly this entry is proven red by breaking the
        // CARD — Replenish's `forEach` reading `set: "exile"` instead of
        // `"graveyard"` returns nothing, and the bot passes.
        //
        // Its NEGATIVE CONTROL is not a second registry entry but a dominance
        // pair, `isDominatedNoOpMove — Replenish into an enchantment-less
        // graveyard` (`ai/__tests__/dominance.bot.test.ts`), because that is
        // where the futile cast is actually refused. As a blade entry it could
        // not be driven red, and not for want of budget: at 1000 iterations x
        // 10 seeds with `isDominatedNoOpMove` disabled OUTRIGHT the bot still
        // passes on all ten seeds — the search declines the enchantment-less
        // cast on its own, the prune only saves it the visits. (Also measured
        // green at 200 x 5 under `REANIMATE_VALUE` x100, under
        // `manaWeight`/`flexWeight` zeroed, and under a root tie-break that
        // prefers an outcome-equal cast to `pass`.) A `must` entry nothing can
        // red is not evidence; the dominance pair reds on the first break.
        label: "replenish: casts the mass return with three enchantments in the graveyard",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no enchantment in the Bot's graveyard",
            },
        },
        spec: {
            cards: [
                { name: "Plains", owner: "me", zone: "battlefield", count: 4 },
                { name: "Replenish", owner: "me", zone: "hand" },
                { name: "Opalescence", owner: "me", zone: "graveyard" },
                { name: "Parallax Wave", owner: "me", zone: "graveyard" },
                { name: "Seal of Cleansing", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Replenish" }] },
        note: "Issue #2715 — the assembly step of the Parallax Replenish list. Exactly four Plains, so the {3}{W} is payable and nothing else is; the only two lines on the board are this cast and a pass.",
    },
    {
        // Issue #4070 — Bot Gap `never-chosen › Enchantment › destroy`. Seal of
        // Doom ("Sacrifice this enchantment: Destroy target nonblack
        // creature") is a removal spell that waits on the battlefield, and the
        // Bot never cast it: at any budget from 48 to 400 iterations `pass`
        // was chosen, on every seed, at both seats.
        //
        // The claim is a TIE-BREAK, not a valuation. With the mana open and
        // nothing else to do, casting the Seal now and casting it after combat
        // reach the same position (the `pass` edge's own rollouts cast it
        // later), so the two are outcome-equal and the material tie-break went
        // to `pass`. A sorcery-speed, untargeted artifact or enchantment has no
        // option value to holding (`free-development`, ADR 0020 §1 — the same
        // rationale as a land drop or a mana dork), so deferring it is never
        // right. Exactly five Swamps: the {2}{B} is payable and nothing else
        // competes for the mana. Both sides field a body of each kind — the
        // shape of the bot-play sweep's generated position — because that is
        // what makes the tie: against a lone opposing creature the cast is
        // strictly better on reward and the rule is never consulted (measured:
        // the entry passes with the rule off there, so it would prove nothing).
        //
        // NOT a reliable `no-rule:free-development` discriminator (issue
        // #4785 review) — weight drift alone (no code change) already moved
        // this position off the tie `free-development` exists to break, and
        // separately `resolved-payoff` (issue #3388) now also independently
        // reaches this shape (`isSelfConfinedVanillaPermanentCast`), so
        // disabling `free-development` alone no longer isolates it. Its
        // negative controls are unit tests, not registry entries — a
        // creature, a Flash permanent, a targeted Aura and a hand that holds a
        // castable instant must each be left to the search, and none of them
        // has a position whose right answer is unambiguous (`selectRootMove —
        // sorcery-speed permanent tie-break`, `gre/__tests__/search.bot.test.ts`).
        label: "sorcery-speed permanent: deploys a Seal with the mana open and nothing else to do",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an instant in hand that needs the same mana on the opponent's turn",
            },
        },
        spec: {
            cards: [
                { name: "Swamp", owner: "me", zone: "battlefield", count: 5 },
                { name: "Seal of Doom", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Ornithopter", owner: "me", zone: "battlefield" },
                { name: "Castle", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Ornithopter", owner: "opp", zone: "battlefield" },
                { name: "Castle", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Seal of Doom" }] },
        note: "Issue #4070 — free-development covers an untargeted sorcery-speed non-creature permanent; `resolved-payoff` (issue #4785) independently covers the same shape now, so a `no-rule:free-development` run no longer isolates this rule (see comment above).",
    },
    {
        // DISCRIMINATING PAIR, half 1 (issue #3398, PRD #3397). The position
        // issue #3322 reported and `docs/research/greedy-vs-search.md`
        // reproduced: Stone Rain in hand, exactly its {2}{R} in untapped
        // Mountains, nothing else to do, and three Forests across the table.
        //
        // Under the fixed `DESTROY_VALUE = 160` the spell was worth a 2/2 in
        // hand whatever it faced, so announcing it cost 205 margin points
        // against a 17-point land: greedy and a 400-iteration search both
        // passed, on every seed. Priced by what it can actually take — one
        // `latent.boardRemoval` unit times the Forest's realised loss over the
        // representative victim's — the spell is finally worth less in hand
        // than the land is on the board, and casting it is the gain it always
        // was.
        label: "board-aware removal: casts Stone Rain on a land when there is nothing better to do",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a castable creature in hand",
            },
        },
        spec: {
            cards: [
                { name: "Stone Rain", owner: "me", zone: "hand" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Stone Rain" }] },
        note: "Issue #3398 / #3322. Half 1 of the discriminating pair — pinning `victimUnits` back to the fixed representative victim (the pre-#3398 `DESTROY_VALUE`) makes the spell cost more to announce than the land is worth, and this goes red.",
    },
    {
        // DISCRIMINATING PAIR, half 2 (issue #3398). The SAME board and the
        // same three Mountains, plus a creature on curve in hand. The fix must
        // not degrade into "always cast removal": three mana buys exactly one
        // of the two spells, and a 3/2 body is worth far more than one of the
        // opponent's three lands.
        //
        // Written as a `forbidden`, not a `moves`: which non-Stone-Rain line
        // is best (deploy now, or hold the Barbarians for a better window) is
        // a preference this entry has no business pinning — the blunder is
        // what is unambiguous.
        label: "board-aware removal: deploys the creature instead of Stone Rain when both are castable",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no castable creature in hand",
            },
        },
        spec: {
            cards: [
                { name: "Stone Rain", owner: "me", zone: "hand" },
                { name: "Balduvian Barbarians", owner: "me", zone: "hand" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Stone Rain" }] },
        note: "Issue #3398. Half 2 of the discriminating pair — proves the fix is board-awareness, not a blanket preference for removal.",
    },
    {
        // AS-ENTERS CREATURE TYPE (CR 614.12a / 205.3m, issue #2710). The
        // Plague is CAST and RESOLVED in setup, so the root decision here IS
        // the as-enters `option-pick` (CR 614.12a — the choice is made before
        // the permanent enters), exactly as the fetchland charter entry's root
        // decision is the live `search-library` choice.
        //
        // What it guards is not a preference but the WIDTH of the option list:
        // CR 205.3m's table is ~280 entries, two orders of magnitude past
        // `CHOICE_TOP_K`. With no structural hint every type scored the flat
        // NEUTRAL_PRIOR, the stable top-K kept the first eight ALPHABETICALLY,
        // and the bot named Advisor on every board in the game — a choice that
        // is enumerated, legal, and completely inert. Nothing else goes red
        // when that seam breaks.
        //
        // DISCRIMINATING BY CONSTRUCTION, so it cannot be passed by a prior
        // that merely prefers "a type on the board": my own two Eager Cadets
        // are Human Soldiers, so Human and Soldier are on the board too and
        // naming either kills MY creatures and none of theirs. Only Goblin —
        // three 1/1s, all of which the -1/-1 sweeps via CR 704.5f — is the
        // answer, and the search has to be the thing that decides that: the
        // prior itself is unsigned (it ranks presence, never side).
        label: "as-enters creature type: names the opponent's tribe, not its own and not the alphabet",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "Humans on the opponent's battlefield instead of Goblins",
            },
        },
        spec: {
            cards: [
                { name: "Engineered Plague", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Eager Cadet", owner: "me", zone: "battlefield" },
                { name: "Eager Cadet", owner: "me", zone: "battlefield" },
                {
                    name: "Mons's Goblin Raiders",
                    owner: "opp",
                    zone: "battlefield",
                },
                {
                    name: "Mons's Goblin Raiders",
                    owner: "opp",
                    zone: "battlefield",
                },
                {
                    name: "Mons's Goblin Raiders",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            libraryCount: 20,
        },
        setup: [
            { kind: "cast", card: "Engineered Plague" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        // ADR 0070 §3 — K>=3 seeds: the pick must not be rollout noise.
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", option: "Goblin" }],
        },
        note: "Issue #2710. CR 614.12a as-enters choice reachability AND quality: the option list is CR 205.3m's whole creature-type table, so without `PendingChoice.options[].subtype` + `subtypeModePrior` (gre/ai/choicePriors.ts) the top-K truncation is alphabetical and the answer is always Advisor. Human/Soldier are deliberately present on the bot's OWN board so a presence-only prior with a wrong sign fails here too.",
    },
    {
        label: "colour denial: destroys the only source of a colour the opponent is visibly using",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "Savannah Lions in place of the Grizzly Bears",
            },
        },
        spec: {
            cards: [
                { name: "Stone Rain", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "battlefield" },
                { name: "Plains", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        // ADR 0070 §3 — K>=3 seeds: the pick must not be rollout noise.
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                { kind: "cast-spell", card: "Stone Rain", target: "Forest" },
            ],
        },
        note: "Issue #3532, position A of the colour-coverage pair. The two legal targets are MATERIALLY IDENTICAL — both basic lands, so `mana`, `permanents` and the `boardRemoval` latent the held Stone Rain is priced at move by exactly the same amount whichever dies. The only axis that separates them is `colorCoverage`: the Grizzly Bears is standing evidence that this opponent plays {G} (`ai/observedColors.ts`), and it SURVIVES the land, so killing the Forest leaves a demanded colour with no source (coverage 1 → 1/4). The Plains is its own only evidence for {W}: kill it and the demand leaves with the supply, coverage stays 1, and the card bought nothing. Before the term, `evaluate` returned the same number for both branches and the pick was rollout noise. Position B below is the SAME board with the evidence moved to the other colour, and demands the other land.",
    },
    {
        label: "colour denial: does not spend the card on a colour nothing but the land itself evidences",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "Grizzly Bears in place of the Savannah Lions",
            },
        },
        spec: {
            cards: [
                { name: "Stone Rain", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Savannah Lions", owner: "opp", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "battlefield" },
                { name: "Plains", owner: "opp", zone: "battlefield" },
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
                { kind: "cast-spell", card: "Stone Rain", target: "Forest" },
            ],
        },
        note: "Issue #3532, position B — the discriminating twin of position A, and the reason the preference is about EVIDENCE rather than about colours existing. Same card, same two materially identical basic-land targets, and the creature swapped for one of the OTHER colour (Savannah Lions is {W} where the Bears are {1}{G}, so its mana value and toughness move too — that shifts the opponent's `creatures` and `manaDevelopment` between the two SCENARIOS, never between the two targets inside either one, which is what the discrimination rests on). Now {W} is the colour the opponent is visibly using, {G} is evidenced by nothing but the Forest itself, and the expectation flips: coverage goes 1 → 1/4 on the Plains and 1 → 1 on the Forest, so B is driven POSITIVELY toward the other land rather than passing by abstention. What the pair rules out is a term that reads a colour's PRESENCE instead of its EVIDENCE — and, because the two halves differ only in which colour carries the creature, that position A did not pass through a target-ordering or positional artifact of the enumerator.",
    },
    {
        label: "recoverable sweep: casts Armageddon when the Bot keeps its mana in rocks and the opponent has only lands",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the mana rocks on the opponent's side and only lands on the Bot's",
            },
        },
        spec: {
            cards: [
                { name: "Armageddon", owner: "me", zone: "hand" },
                { name: "Plains", owner: "me", zone: "battlefield", count: 2 },
                { name: "Sol Ring", owner: "me", zone: "battlefield" },
                { name: "Mind Stone", owner: "me", zone: "battlefield" },
                { name: "Fellwar Stone", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 6 },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Armageddon" }] },
        note: "Issue #4880 (replacing issue #4773's knife-edge position A, issue #4874), position A of the mana-rock pair. The sweep takes six Forests and two Plains, and the Bot keeps four mana of rocks against none: a human casts it without hedging. Armageddon's swing is RECOVERABLE — the opponent replaces a land with every land drop (CR 305.2) — so the realised swing decays from the turn it resolves, while the card held in hand used to be priced at the whole swing at every leaf: holding weakly dominated and the Bot never cast it. The hand price now credits only `recoverableSweepFraction` of the recoverable part (`LatentLens.sweepUnits`). POSTCOMBAT_MAIN because this is the turn's last window: precombat, `pass` contains the same cast after combat, and deferral is genuinely equivalent. The opponent is BLIND (the default build): with a decklist-informed opponent the pick is dominated by the Mind Stone activation line whatever the hand price, and discriminates nothing. Position B is the mirror and must hold.",
    },
    {
        label: "recoverable sweep: holds Armageddon when the opponent keeps its mana in rocks and the Bot has only lands",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the mana rocks on the Bot's side and only lands on the opponent's",
            },
        },
        spec: {
            cards: [
                { name: "Armageddon", owner: "me", zone: "hand" },
                { name: "Plains", owner: "me", zone: "battlefield", count: 6 },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 2 },
                { name: "Sol Ring", owner: "opp", zone: "battlefield" },
                { name: "Mind Stone", owner: "opp", zone: "battlefield" },
                { name: "Fellwar Stone", owner: "opp", zone: "battlefield" },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Armageddon" }] },
        note: "Issue #4880, position B of the mana-rock pair: the mirror of A, with Armageddon castable (six Plains). The sweep takes six of the Bot's lands and two of the opponent's, who keeps four mana of rocks: its net worth is below zero and the Bot holds by mean reward, not by a material tie-break.",
    },
    {
        label: "each-player one-shot: casts Wheel of Fortune holding nothing else against a seven-card hand",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the empty hand on the Bot's side and seven cards on the opponent's",
            },
        },
        spec: {
            cards: [
                { name: "Wheel of Fortune", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 3 },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "hand",
                    count: 7,
                },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Wheel of Fortune" }] },
        note: "Issue #5560, position A of the Wheel pair. The Bot's hand is the Wheel alone, the opponent's seven cards: casting it draws the Bot seven and only swaps the opponent's, so a human casts it without hedging. Issue #5162 priced the held Wheel by its Differential Reading on this board (`LatentLens.eachPlayerDifferential`) — and that price IS what the cast realises, so casting tied holding at one ply and the Bot passed on every seed. A refilled hand is played out over turns, so the swing decays once it resolves while its price in hand, read off each leaf, never does: the hand now credits only `heldDifferentialFraction` of it, the `recoverableSweepFraction` pattern (issue #4880). POSTCOMBAT_MAIN because this is the turn's last window: precombat, `pass` contains the same cast after combat. Position B is the mirror and must hold.",
    },
    {
        label: "each-player one-shot: holds Wheel of Fortune with six other cards against a one-card hand",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "six cards on the Bot's side and one on the opponent's",
            },
        },
        spec: {
            cards: [
                { name: "Wheel of Fortune", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "hand",
                    count: 6,
                },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 3 },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "hand",
                    count: 1,
                },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Wheel of Fortune" }],
        },
        note: "Issue #5560, position B of the Wheel pair: the mirror of A. Casting discards the Bot's six cards to refill the opponent's one: the Differential is below zero and the held Wheel is floored at nothing (`latentValue` keeps the zero floor for a measured one-shot: an option held is never a liability, and the cast realises the loss), so the Bot holds by mean reward.",
    },
    {
        label: "symmetric sweep: holds Armageddon when the Bot holds the land surplus and the opponent the board",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the land surplus on the opponent's side and the board on the Bot's",
            },
        },
        spec: {
            cards: [
                { name: "Armageddon", owner: "me", zone: "hand" },
                { name: "Plains", owner: "me", zone: "battlefield", count: 11 },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 4 },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Armageddon" }] },
        note: "Issue #4773, position B of the symmetric-sweep pair: the mirror of A. The sweep takes more of the Bot's lands than the opponent's, so its net worth is below zero and the card in hand is floored at nothing — casting it only buys the Bot's own mana base a trip to the graveyard while the opponent's creatures keep attacking.",
    },
    {
        label: "keep-N edict: casts Balance at two lands and no creatures against five lands and two creatures",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the land and creature surplus on the opponent's side",
            },
        },
        spec: {
            cards: [
                { name: "Balance", owner: "me", zone: "hand" },
                { name: "Plains", owner: "me", zone: "battlefield", count: 2 },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 5 },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Balance" }] },
        note: "Issue #5559, position A of the keep-N edict pair. Balance takes three Forests and both Bears and nothing of the Bot's: a human casts it without hedging. Until its `aiEffects` shadow, Balance was a `resolveSteps` card with no script, priced in hand at the `base + MV` Latent Floor on every board, so the reading could not tell this board from its mirror. Each step now reads as a `$each` edict whose count is the members above the fewest any player has (a computed `choice.count`), and the Differential prices each side off the board (`EachPlayerSide.groundCount`). POSTCOMBAT_MAIN because this is the turn's last window: precombat, `pass` contains the same cast after combat. Position B is the mirror and must hold.",
    },
    {
        label: "keep-N edict: holds Balance at five lands and two creatures against two lands and no creatures",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the land and creature surplus on the Bot's side",
            },
        },
        spec: {
            cards: [
                { name: "Balance", owner: "me", zone: "hand" },
                { name: "Plains", owner: "me", zone: "battlefield", count: 5 },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    count: 2,
                },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 2 },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Balance" }] },
        note: "Issue #5559, position B of the keep-N edict pair: the mirror of A. Balance would take three of the Bot's Plains and both its Bears and nothing of the opponent's, so the Differential reads it below zero and the Bot holds.",
    },
    {
        label: "damage sweep: casts Pyroclasm when the opponent holds the bodies it kills and the Bot a survivor",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the bodies Pyroclasm kills on the Bot's side and the survivor on the opponent's",
            },
        },
        spec: {
            cards: [
                { name: "Pyroclasm", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 4,
                },
                { name: "Craw Wurm", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 4 },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Llanowar Elves", owner: "opp", zone: "battlefield" },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Pyroclasm" }] },
        note: "Issue #4781, position A of the damage-sweep pair. A `forEach` that deals damage to `$each` sat in hand at one representative victim whatever the board held. The hand term now prices it at the NET realised loss of the members the damage kills (CR 704.5g: toughness met by the damage, damage already marked included), the opponent's minus the Bot's own: here the three Bears and the Elves die and the Craw Wurm survives, so the sweep is all surplus. Position B is the mirror and must hold.",
    },
    {
        label: "damage sweep: holds Pyroclasm when the Bot holds the bodies it kills and the opponent a survivor",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the bodies Pyroclasm kills on the opponent's side and the survivor on the Bot's",
            },
        },
        spec: {
            cards: [
                { name: "Pyroclasm", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 4,
                },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Llanowar Elves", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 4 },
                { name: "Craw Wurm", owner: "opp", zone: "battlefield" },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Pyroclasm" }] },
        note: "Issue #4781, position B of the damage-sweep pair: the mirror of A. Every body the damage kills is the Bot's and the opponent's Craw Wurm survives it, so the net worth is below zero and the card in hand is floored at nothing — casting it only clears the Bot's own board.",
    },
    {
        label: "bounce sweep: casts Hibernation when the opponent's green board outweighs its mana",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the green surplus on the Bot's side",
            },
        },
        spec: {
            cards: [
                { name: "Hibernation", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield", count: 4 },
                { name: "Serra Angel", owner: "me", zone: "battlefield" },
                {
                    name: "Savannah Lions",
                    owner: "me",
                    zone: "battlefield",
                    count: 2,
                },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 2 },
                {
                    name: "Craw Wurm",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Hibernation" }] },
        note: "Issue #4781, position A of the bounce-sweep pair, re-cut by issue #4878. A `forEach` that returns `$each` to its owner's hand sat in hand at one representative victim's tempo whatever the board held; the hand term now prices it at the NET units of what it returns (CR 105.2: an object is the colour of its mana symbols, so the colourless Forests and the Bot's white creatures are no members). The sweep returns both Craw Wurms to a player with two Forests, who cannot recast either for four land drops, and leaves the Bot's three attackers facing an empty board. Hibernation is an instant, so casting in the opponent's upkeep is equivalent (the opponent has no mana to answer it and nothing left to add to the board before its main phase): the entry pins that the Bot does not leave the sweep in hand, and the search reaches the cast now. The first cut (seven green creatures against one Serra Angel) sat at a margin near −875, past `materialFull`: both branches clipped to the `terminalBand` floor, every run fell to `material-tiebreak`, and 3 of 10 wide seeds failed (issue #4878). This board keeps both branches inside the open band, so the cast wins by mean reward on every wide seed. What the pair checks is the RESOLVED swing, not the colour filter of the hand price: with that filter ignored (`sweepPermanentFilter` dropping `colors`) both positions stay green, because the search resolves the real sweep either way. Position B is the mirror and must hold.",
    },
    {
        label: "bounce sweep: holds Hibernation when the Bot holds the green surplus",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the green board on the opponent's side",
            },
        },
        spec: {
            cards: [
                { name: "Hibernation", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield", count: 4 },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Craw Wurm", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "opp", zone: "battlefield", count: 2 },
                { name: "Serra Angel", owner: "opp", zone: "battlefield" },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Hibernation" }] },
        note: "Issue #4781, position B of the bounce-sweep pair: the mirror of A. Every green permanent is the Bot's, so the sweep returns only its own board and its net worth is below zero.",
    },

    // ------------------------------------------------------------------
    // The DECKLIST-INFORMED half of the colour-denial pair (issue #3533).
    //
    // The #3532 pair above reads the colour demand off the BOARD, so it needs
    // a creature standing as evidence. This pair removes the creature
    // entirely: both of the opponent's lands are their own only board
    // evidence, so destroying either one takes the demand away with the
    // supply and coverage stays 1 — the two targets are EXACTLY tied on every
    // term, and a blind search picks between them by rollout noise. The only
    // thing that separates them is the decklist an `expert` search is handed
    // (`DIFFICULTY_KNOWS_OPPONENT`, `gre/difficulty.ts`), which says which
    // colour that deck actually spends its cards on.
    //
    // Scathe Zombies and Pearled Unicorn are exact functional twins — vanilla
    // 2/2 for {2}{B} and {2}{W} — so the two halves differ in NOTHING but the
    // colour, not in mana value, body, or castability off two lands (neither
    // is castable: the opponent has two lands and no third). Ruling out the
    // "it just kills the land that stops a spell" reading is the whole reason
    // the twins are matched this precisely.
    // ------------------------------------------------------------------
    {
        label: "informed colour denial: the decklist, not the board, picks which land dies",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the opponent's decklist of {2}{W} creatures instead of {2}{B}",
            },
        },
        spec: {
            cards: [
                {
                    name: "Stone Rain",
                    owner: "me",
                    zone: "hand",
                    count: 2,
                },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                // COLOURLESS on purpose (CR 105.2a): the opponent needs a
                // clock — with nothing happening on either side, holding the
                // card outranks every denial and the position stops being
                // about colour at all — but a coloured body would put board
                // evidence back on one of the two colours and reopen exactly
                // the discrimination this pair exists to close.
                {
                    name: "Obsianus Golem",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Plains", owner: "opp", zone: "battlefield" },
                { name: "Swamp", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        deckKnowledge: [
            { seat: "opp", cards: Array(20).fill("Scathe Zombies") },
        ],
        budget: { iterations: 400 },
        // ADR 0070 §3 — K>=3 seeds: the pick must not be rollout noise, which
        // on this board is precisely what it WAS before the decklist arrived.
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        expect: {
            moves: [
                { kind: "cast-spell", card: "Stone Rain", target: "Swamp" },
            ],
        },
        note: "Issue #3533, position A. The deck is twenty {2}{B} creatures, so {B} carries twenty units of decklist evidence against {W}'s zero (`ai/observedColors.ts`); the board contributes one unit per untapped source to each, symmetrically. Killing the Swamp drops the opponent's colour coverage 1 → 1/21, killing the Plains leaves it at 1 (the {W} demand was the Plains itself and leaves with it). On the BOARD alone the two targets are identical to the last decimal — this entry is the denial the observed board could not justify, taken because the decklist shows the colour matters. BUDGET-PINNED, DEMOTED TO `stretch` BY ISSUE #3593. The entry holds at 400 iterations only because the candidate list held the same Stone Rain twice and three interchangeable Mountains as targets: eleven root children for four real options, so no candidate outgrew `pass` on visits and the pick fell to `selectRootMove`'s tie-breaks. Measured on the engine AS IT WAS, with no collapse anywhere and this entry untouched: 400 iterations → Stone Rain on the Swamp, 800 / 1600 / 3200 → `pass`, on all five of the seeds it declares. Doubling the budget does what the collapse does. The preference the entry states is therefore one the evaluation does not hold at any real depth — a missing term for informed colour denial, which is a Verdict for the fit to answer (ADR 0124 §5), not a `must` the bot passes by being unable to see. The entry stays in the corpus and keeps feeding the fit; what it stops doing is certifying a preference on dilution.",
    },
    {
        label: "informed colour denial: the same board demands the OTHER land on the mirrored decklist",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the opponent's decklist of {2}{B} creatures instead of {2}{W}",
            },
        },
        spec: {
            cards: [
                {
                    name: "Stone Rain",
                    owner: "me",
                    zone: "hand",
                    count: 2,
                },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                // COLOURLESS on purpose (CR 105.2a): the opponent needs a
                // clock — with nothing happening on either side, holding the
                // card outranks every denial and the position stops being
                // about colour at all — but a coloured body would put board
                // evidence back on one of the two colours and reopen exactly
                // the discrimination this pair exists to close.
                {
                    name: "Obsianus Golem",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Plains", owner: "opp", zone: "battlefield" },
                { name: "Swamp", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        deckKnowledge: [
            { seat: "opp", cards: Array(20).fill("Pearled Unicorn") },
        ],
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        expect: {
            moves: [
                { kind: "cast-spell", card: "Stone Rain", target: "Plains" },
            ],
        },
        note: "Issue #3533, position B — the discriminating twin of position A. Byte-identical board, byte-identical decklist SIZE, and the only difference is that the twenty creatures are {2}{W} Pearled Unicorns instead of {2}{B} Scathe Zombies (same 2/2 vanilla body, same mana value, equally uncastable off two lands). The expectation flips to the Plains. What the pair rules out is a decklist read that has degenerated into a fixed colour preference, or into 'kill whichever land the enumerator offers first' — neither survives a board that is unchanged while the answer moves. BUDGET-PINNED, DEMOTED TO `stretch` BY ISSUE #3593. The entry holds at 400 iterations only because the candidate list held the same Stone Rain twice and three interchangeable Mountains as targets: eleven root children for four real options, so no candidate outgrew `pass` on visits and the pick fell to `selectRootMove`'s tie-breaks. Measured on the engine AS IT WAS, with no collapse anywhere and this entry untouched: 400 iterations → Stone Rain on the PLAINS — this position's own answer, not its twin's — and 800 / 1600 / 3200 → `pass`, on all five of the seeds it declares. Doubling the budget does what the collapse does. The preference the entry states is therefore one the evaluation does not hold at any real depth — a missing term for informed colour denial, which is a Verdict for the fit to answer (ADR 0124 §5), not a `must` the bot passes by being unable to see. The entry stays in the corpus and keeps feeding the fit; what it stops doing is certifying a preference on dilution.",
    },
    {
        // INTERCHANGEABLE-CANDIDATE COLLAPSE, the option it must NOT eat
        // (CR 305.1 / 601.2, issue #3593). Turn one, no lands out, and a hand
        // of three land drops: two Forests — which the collapse merges into
        // ONE candidate, because nothing in the engine can tell them apart —
        // and an Island, which is the only source of the {U} that casts the
        // Merfolk of the Pearl Trident sitting beside them.
        //
        // This is the discriminating half of the collapse. The way it goes
        // wrong is never "it merged too little": it is merging two candidates
        // that DIFFER, which costs the bot the better line with no suite going
        // red. The Forests are listed FIRST so one of them holds the lowest
        // instance id and would be the representative of an over-eager merge,
        // and the answer is the Island. Reachability is not the claim — all
        // three drops were always enumerated — keeping the Island its own move
        // is.
        label: "interchangeable collapse: two Forests are one option, the Island is not",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Forest", owner: "me", zone: "hand" },
                { name: "Forest", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "hand" },
                {
                    name: "Merfolk of the Pearl Trident",
                    owner: "me",
                    zone: "hand",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 1,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 300 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        // A `predicate`, not a `moves` matcher, for the reason the
        // depletion-land entry above records: `expect.moves` is what
        // `verdictsFromRegistry` turns into a fitted VERDICT (ADR 0124 §5), and
        // a new verdict obliges a refit — which this corpus refuses to bless
        // ("the fitted vector orders FEWER verdicts than the committed one").
        // The claim here is STRUCTURAL anyway: that the Island survives the
        // collapse as a candidate of its own. The entry still blocks at `must`;
        // what it does not do is vote on the weights.
        expect: {
            predicate: (move, state) => {
                if (move === null || move.kind !== "play-land") return false;
                const card = state.players
                    .flatMap((p) => p.hand)
                    .find((c) => c.id === move.cardInstanceId);
                return (
                    card !== undefined &&
                    (card.card as { id?: string }).id ===
                        getCardByName("Island").id
                );
            },
            describe: "plays the Island, not either Forest",
        },
        note: "Issue #3593. The guard on the interchangeability collapse: two copies of one card are ONE candidate, a different card is not, and the collapsed-away copies must not take the distinguishable drop with them. The two Forests precede the Island so the representative of an over-eager merge would be a Forest.",
    },
    {
        // OPTIONAL LOOP, shape 1 of 2 (issue #3590): an activated ability whose
        // resolution returns what it spent. Under Opalescence a Parallax Wave is
        // a creature, so it can exile ITSELF: its leaves trigger hands back
        // everything it held and Fading re-enters it with five fresh counters.
        // The Bot here has already been round once — exiled the Psychatog,
        // refilled by exiling the Wave (which returned the Psychatog), exiled
        // the Psychatog again — and stands in the very position it stood in a
        // lap ago. Refilling again only restarts the lap; CR 104.4b makes an
        // optional loop no draw and CR 732.5 obliges nobody to end it, so the
        // Bot must. The Tier 1 smoke's `parallax-replenish vs psychatog` spent
        // 1400 plies of one turn in exactly this cycle.
        //
        // Discriminating: without the decision history the Bot re-exiles the
        // Wave on seed 0xb1ade (and on half of eight seeds).
        label: "optional loop: does not refill Parallax Wave again from a position it already occupied",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Opalescence", owner: "me", zone: "battlefield" },
                {
                    name: "Parallax Wave",
                    owner: "me",
                    zone: "battlefield",
                    counters: { fade: 5 },
                },
                {
                    name: "Plains",
                    owner: "me",
                    zone: "battlefield",
                    count: 4,
                },
                { name: "Psychatog", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        // Lap one: the built Wave and Psychatog become new objects on it, so
        // the position a lap later is the first one that can repeat.
        setup: [
            { kind: "activate", card: "Parallax Wave", target: "Psychatog" },
            { kind: "pass" },
            {
                kind: "activate",
                card: "Parallax Wave",
                target: "Parallax Wave",
            },
            { kind: "pass" },
            { kind: "pass" },
            { kind: "pass" },
            { kind: "activate", card: "Parallax Wave", target: "Psychatog" },
            { kind: "pass" },
        ],
        revisit: [
            {
                kind: "activate",
                card: "Parallax Wave",
                target: "Parallax Wave",
            },
            { kind: "pass" },
            { kind: "pass" },
            { kind: "pass" },
            { kind: "activate", card: "Parallax Wave", target: "Psychatog" },
            { kind: "pass" },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [
                {
                    kind: "activate-ability",
                    card: "Parallax Wave",
                    target: "Parallax Wave",
                },
            ],
        },
        note: "Issue #3590 — the position-repetition memory (`gre/ai/repetition.ts`) through the real search. Paired with the Aluren entry below, a structurally different loop (a free cast plus a mandatory self-bounce), so the fix is proven not to be card-shaped. Also relies on CR 122.2's `noteCounters` fix: before it the returning Wave kept its leftover counters plus five, so no lap ever repeated.",
    },
    {
        // OPTIONAL LOOP, shape 2 of 2 (issue #3590): a SPELL and a trigger, no
        // activated ability at all. Aluren makes Cavern Harpy free, and its
        // mandatory enters trigger must return a blue or black creature — the
        // Harpy is the only one, so the cast ends exactly where it began, with
        // one more spell on the storm count and nothing else. The Bot has been
        // round once already.
        //
        // Discriminating: without the decision history the Bot recasts the
        // Harpy on seed 2 (two of eight seeds).
        label: "optional loop: does not recast a self-bouncing creature under Aluren from a position it already occupied",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Aluren", owner: "me", zone: "battlefield" },
                { name: "Cavern Harpy", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            landCount: 0,
            libraryCount: 20,
        },
        // Lap one: the cast reveals the Harpy and stamps who cast it, so lap
        // two is the first that returns to an occupied position.
        setup: [
            { kind: "cast", card: "Cavern Harpy" },
            { kind: "resolve-top" },
            { kind: "resolve-top" },
            { kind: "choose", cards: ["Cavern Harpy"] },
        ],
        revisit: [
            { kind: "cast", card: "Cavern Harpy" },
            { kind: "resolve-top" },
            { kind: "resolve-top" },
            { kind: "choose", cards: ["Cavern Harpy"] },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Cavern Harpy" }],
        },
        note: "Issue #3590 — second, structurally different optional loop for the position-repetition memory: cast + enters trigger + choice, where the Parallax Wave entry is an activated ability + leaves trigger. Nothing in `repetition.ts` or the root deny-set names either card.",
    },
    {
        // CR 603.7a (issue #3383) — the value model's reader for a card's own
        // `delayedTriggers[]` templates. Mishra's Bauble and Tormod's Crypt are
        // both {0} artifacts the reader could see nothing in: the Bauble's
        // activated ability is a `resolve()` and its whole payoff — "draw a
        // card at the beginning of the next turn's upkeep" — lives in a
        // delayed-trigger TEMPLATE the value model did not walk at all. Both
        // therefore priced at the same `base + MV` floor and the tutor's pick
        // fell to candidate ordering.
        //
        // The land drop is already spent and six lands are in play, so the
        // synthetic deck's basics are neither castable development nor a
        // meaningful find (the fetch curve saturates at five) — the decision is
        // exactly "which of the two artifacts is worth more".
        //
        // Discriminating: with the template reader disabled the bot fetches a
        // Plains on all five seeds; the Bauble's draw is worth zero to it.
        label: "delayed trigger: tutors the card whose whole value is a delayed draw",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no land on the Bot's battlefield",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 6 }, () => ({
                    name: "Swamp",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                })),
                { name: "Demonic Tutor", owner: "me", zone: "hand" },
                { name: "Mishra's Bauble", owner: "me", zone: "library" },
                { name: "Tormod's Crypt", owner: "me", zone: "library" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            // Issue #3446 — the land drop is GONE, so fetching a basic buys no
            // development this turn and the artifacts are compared on worth.
            landsPlayed: { me: 1 },
        },
        setup: [
            { kind: "cast", card: "Demonic Tutor" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        // A PREDICATE rather than `moves`, for the reason the depletion-land
        // entry above gives and one of its own: a registry `moves`/`forbidden`
        // entry is a new VERDICT and obliges a refit (`weightFit.bot.test.ts`),
        // and the refit this one obliges is a measured REGRESSION —
        // `bun run fit:weights` prints DO NOT PASTE, because the fitted vector
        // orders FEWER verdicts than the committed one on the same corpus. A
        // predicate yields no verdict at all (`pasteInstruction`,
        // `verdicts/report.ts`), so the entry still BLOCKS at `must`; what it
        // does not do is vote on the weights. Same assertion either way: the
        // chosen move is the search-library submission naming the Bauble.
        expect: {
            predicate: (move, state) =>
                move !== null &&
                move.kind === "resolution-choice" &&
                move.cardInstanceIds?.length === 1 &&
                instanceIdsForName(state, "Mishra's Bauble").has(
                    move.cardInstanceIds[0]
                ),
            describe:
                "fetches Mishra's Bauble, not the blank {0} artifact or a basic",
        },
        note: "Issue #3383 — the bot's value model never walked `cardDef.delayedTriggers[]`, so a real `effects[]` on a template was worth exactly zero and Mishra's Bauble priced as if its delayed draw did not exist. The root decision is the live search-library choice (CR 701.23), reached by really casting and resolving Demonic Tutor. Proof-of-failure: making `delayedTriggerTemplateOpValue` (`gre/ai/cardScriptValue.ts`) return `undefined` reds this at every seed (the bot fetches a Plains).",
    },
    {
        // SPLICE ONTO ARCANE reachability (CR 702.47, issue #2394). The bot's
        // main phase, five untapped Mountains, and a hand of exactly three
        // cards: Lava Spike ({R}, Arcane), Through the Breach ({4}{R}, Arcane,
        // "Splice onto Arcane {2}{R}{R}") and Scaled Wurm — a 7/6 for {7}{G}
        // it cannot cast this decade.
        //
        // Two lines cost the same five mana and put the same hasty 7/6 in play:
        //
        //   • CAST Through the Breach — the Breach goes to the graveyard.
        //   • CAST Lava Spike, REVEALING the Breach to splice — the Spike goes
        //     to the graveyard, the opponent takes 3 more, and CR 702.47c
        //     leaves the revealed Breach IN HAND.
        //
        // So the splice line strictly dominates on both axes at identical
        // cost, which is exactly why the mechanic is worth having. It is
        // therefore a REACHABILITY claim first: the cost entries are
        // SYNTHESIZED from the caster's hand (`spliceAugmentedDefinition`,
        // `gre/splice.ts`), so an enumerator reading the printed definition
        // offers no splice Move at all — and nothing else goes red when it
        // breaks. The bot would simply cast Arcane spells unspliced forever,
        // and the second half of every splice card would be dead in the one
        // place no suite looks.
        label: "splice onto Arcane: reveals Through the Breach off Lava Spike rather than casting it",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a creature in hand worth putting in with Through the Breach",
            },
        },
        spec: {
            cards: [
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Lava Spike", owner: "me", zone: "hand" },
                { name: "Through the Breach", owner: "me", zone: "hand" },
                { name: "Scaled Wurm", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
            // CR 119.1 — the opponent at exactly 3 + 7, with nothing on the
            // battlefield to block with. That makes the splice line LETHAL
            // this turn and neither alternative is: 3 from the Spike alone
            // leaves 7, and the hard-cast Breach's 7/6 alone leaves 3. Pinning
            // the life total is what turns a claim the evaluator has to price
            // (is a one-turn 7/6 worth four mana?) into one the win band
            // answers outright.
            life: { me: 20, opp: 10 },
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        // A PREDICATE, not a `moves` matcher, for the reason the depletion-land
        // entry above gives: this is a reachability claim ("the bot can pay a
        // splice cost at all"), and feeding a reachability position to the
        // weight fit moves the vector on a claim that contains no preference.
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "cast-spell" &&
                Object.keys(move.kickerPayments ?? {}).some((id) =>
                    id.startsWith(SPLICE_COST_ID_PREFIX)
                ),
            describe:
                "casts an Arcane spell paying a splice cost, rather than hard-casting the splice card",
        },
        note: "CR 702.47 splice reachability, and the end-to-end cover for the splice seam in `enumerateCastMoves` plus the `splicedCardIds` stamp in BOTH search sandboxes (`applyMove.ts`, `search.ts`) — the deterministic halves are in `spliceBot.bot.test.ts`. Proof-of-failure: dropping the `spliceAugmentedDefinition` call in `moves.ts` (back to the printed definition) reds this at every seed — the bot hard-casts Through the Breach.",
    },
    {
        // FORCED TARGET CHOICE (CR 601.2c, issue #3805). The opponent controls
        // Standard Bearer, a 1/1 Flagbearer: "while an opponent is choosing
        // targets as part of casting a spell they control …, that player must
        // choose at least one Flagbearer on the battlefield if able".
        //
        // The position is chosen so that the requirement COSTS the bot the
        // game it would otherwise win: the opponent is at 3, Lightning Bolt is
        // in hand, one Mountain is untapped — bolting the face is lethal and
        // the search's terminal band dominates everything else, so an
        // enumerator that still offers that target picks it at every seed and
        // every budget. It is not a preference the evaluator could be taught
        // out of; the only thing that removes the move is the LEGALITY
        // narrowing in `enumerateTargetGroupTuples` (`gre/moves.ts`), which
        // reads the same `targetChoiceRequirements.ts` authority the mutation
        // re-derives per pick.
        //
        // That makes it a Bot-REACHABILITY entry in the strict sense: without
        // it the bot enumerates a move `selectTargets` throws on half-way
        // through, and a rejected submission freezes the bot exactly as hard
        // as no submission at all.
        label: "flagbearer: cannot bolt the face for lethal past a Standard Bearer",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                {
                    name: "Standard Bearer",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            life: { opp: 3 },
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        // `forbidden`, not `moves`: the claim is a LEGALITY one — whatever the
        // bot does, it may not be that — and the alternative it is left with
        // (bolt the Flagbearer, or hold the card) carries no preference this
        // entry wants to feed the weight fit.
        expect: {
            forbidden: [
                { kind: "cast-spell", card: "Lightning Bolt", target: "opp" },
            ],
        },
        note: "CR 601.2c forced target choice. Proof-of-failure: dropping the `groupPicksObeyTargetChoice` gate in `enumerateTargetGroupTuples` (`gre/moves.ts`) reds this at every seed — the bot bolts the opponent's face for the win, a move `applyOneTargetSelection` rejects. Issue #3805.",
    },
    {
        label: "categorised search: finds one land of EACH basic type, never two of one",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Gaea's Balance", owner: "me", zone: "hand" },
                // Exactly the five lands the additional cost eats, and the
                // mana for {3}{G} comes from those same five (CR 601.2f —
                // costs are paid together).
                {
                    name: "Forest",
                    owner: "me",
                    zone: "battlefield",
                    count: 5,
                },
                // The find pool: TWO Forests and ONE Plains, so the maximum
                // matching is 2 and the two identically-valued Forests sit
                // adjacent in the value ranking — the exact arrangement that
                // makes the greedy "best set led by this card" prefix propose
                // an illegal pair.
                { name: "Forest", owner: "me", zone: "library", count: 2 },
                { name: "Plains", owner: "me", zone: "library" },
                // Filler both sides, explicit rather than `libraryCount`:
                // the auto-refill seeds basics matching the board's colours,
                // which would let a THIRD basic type in and quietly raise the
                // matching. Craw Wurm answers no category, so the find pool
                // stays exactly the three lands above — and both players have
                // a library to draw from, without which every line ends in a
                // decking win and the whole position evaluates flat.
                { name: "Craw Wurm", owner: "me", zone: "library", count: 15 },
                { name: "Craw Wurm", owner: "opp", zone: "library", count: 20 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 0,
        },
        setup: [
            { kind: "cast", card: "Gaea's Balance", by: "me" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        // A PREDICATE, not a `moves` matcher, and deliberately: what this
        // entry judges is a PROPERTY of the submission — that it is a legal
        // categorised pick and a maximal one — not which card is the better
        // find. `moves`/`forbidden` lower to Verdicts and oblige a weight
        // refit (`weightFit.bot.test.ts`); a legality guard has no business
        // in the evaluation corpus, and the fit over this corpus says as
        // much (`bun run fit:weights` refuses the paste: the fitted vector
        // orders no more verdicts than the committed one).
        expect: {
            predicate: (move, state) => {
                if (!move || move.kind !== "resolution-choice") return false;
                const head = state.pendingChoices?.[0];
                if (!head?.categories) return false;
                const picks = move.cardInstanceIds;
                // CR 608.2b — the offer was clamped to the maximum matching,
                // so a maximal answer is exactly `count.max` cards.
                const owed =
                    typeof head.count === "number"
                        ? head.count
                        : head.count.max;
                return (
                    picks.length === owed &&
                    isCategorizedPickLegal(head.categories, picks)
                );
            },
            describe:
                "answers the categorised search with a LEGAL, maximal set — one land per basic land type, never two of one",
        },
        note: "Issue #3808, the categorised-search seam (CR 701.23a). The root decision is the live `search-library` choice, reached by really casting Gaea's Balance — which also pays the first COUNTED additional sacrifice (five lands) through the search's own cost path. `searchLibraryCandidates` builds each candidate as the best set LED BY one card, a greedy prefix that knows nothing about categories: with two Forests ranked adjacently it proposes both, a submission `applyPendingChoiceSubmit` REJECTS, and a rejected submission inside the tree is a throw rather than a low score. Proof-of-failure: removing the `canAddCategorizedPick` gate from the inner fill loop in `gre/ai/choiceCandidates.ts` reds this at every seed (the chosen set is two Forests, which the predicate refuses as unmatchable).",
    },
    {
        label: "redirection shield: shields ITS OWN side and points the damage at the opponent",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Captain's Maneuver", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Plains", owner: "me", zone: "battlefield", count: 2 },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Craw Wurm", owner: "opp", zone: "battlefield" },
                // A library each side, so no line ends in a decking win and
                // the position does not evaluate flat.
                { name: "Craw Wurm", owner: "me", zone: "library", count: 15 },
                { name: "Craw Wurm", owner: "opp", zone: "library", count: 20 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 0,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        // A PREDICATE, not `moves`: the claim is about the ORIENTATION of two
        // announced slots, and `MoveMatcher.target` matches when ANY target
        // resolves to a name — so the blunder and the good play carry the
        // identical matcher. It is also why this entry does not lower to a
        // Verdict and obliges no weight refit: nothing here prefers one BOARD
        // over another, it rejects an announcement that points a gift at the
        // opponent and a hit at itself.
        expect: {
            predicate: (move, state) => {
                if (!move || move.kind !== "cast-spell") return false;
                const me = state.players[0]!.id;
                const sideOf = (t: { type: string; id: string }): string =>
                    t.type === "player"
                        ? t.id === me
                            ? "me"
                            : "opp"
                        : state.players.find((p) =>
                                p.battlefield.some((c) => c.id === t.id)
                            )?.id === me
                          ? "me"
                          : "opp";
                const [from, to] = move.targets ?? [];
                if (!from || !to) return false;
                // CR 614.9 — slot 0 is the SHIELDED recipient and slot 1 the
                // destination. Shielding the opponent and aiming the damage at
                // yourself is the same spell run backwards.
                return sideOf(from) === "me" && sideOf(to) === "opp";
            },
            describe:
                "casts Captain's Maneuver shielding its OWN side (slot 0) and pointing the redirect at the opponent (slot 1)",
        },
        note: 'CR 614.9 recipient-keyed redirection (issue #3810). A redirect conserves the stake, so its per-OP beneficence sign is genuinely `"neutral"` and its two announced slots carry OPPOSITE signs — carried per FIELD by `SPLIT_SIGN_OPS` (`gre/ai/beneficence.ts`), which `misdirectedTargetCount` reads to rank sibling target tuples. Proof-of-failure: dropping the `redirectDamage` row from `SPLIT_SIGN_OPS` reds this at EVERY seed — the bot shields the opponent and redirects the damage onto its own face, the Wild Growth gift in a new costume.',
    },
    {
        // SOURCE-SCOPED SHIELD orientation (CR 615.1a, issue #5815). The
        // active player swings a lone Hill Giant, the bot declares no block
        // and holds Falling Timber with its {2}{G} open in the priority round
        // after blocks — the last window before combat damage. "Prevent all
        // combat damage target creature would deal this turn" names the
        // creature whose damage is ERASED, so the only sane target is the
        // attacker; aimed at the bot's own idle Mons's Goblin Raiders it does
        // nothing at all.
        label: "source shield: never aims Falling Timber at its own creature",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Falling Timber", owner: "opp", zone: "hand" },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 3 },
                // A creature that COULD block, so the engine opens the block
                // window, and the misdirected target the entry forbids.
                {
                    name: "Mons's Goblin Raiders",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        setup: [
            { kind: "declare-attackers" },
            { kind: "declare-blockers" },
            { kind: "pass", seat: "me" },
        ],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        // A PREDICATE, like the redirection entry above: the claim is the
        // ORIENTATION of the announced slot, not a preference between boards,
        // so it lowers to no Verdict. Casting at the attacker and passing are
        // both admitted.
        expect: {
            predicate: (move, state) => {
                if (!move || move.kind !== "cast-spell") return true;
                const bot = seatPlayerId(state, "opp");
                const own = state.players.find((p) => p.id === bot)!;
                return !(move.targets ?? []).some((t) =>
                    own.battlefield.some((c) => c.id === t.id)
                );
            },
            describe:
                "never casts Falling Timber at a creature of its own (pass or the attacker)",
        },
        note: 'CR 615.1a source-scoped prevention (issue #5815). `preventDamage` `"all-from-source"` names the SOURCE whose damage is erased, so `opBeneficence` signs its slot `"harmful"`; every other mode names the recipient it shields and stays `"beneficial"`. Proof-of-failure: with the flat `preventDamage: "beneficial"` row restored in `OP_BENEFICENCE` (and the parametrized case removed), the bot casts Falling Timber at its OWN Mons\'s Goblin Raiders on 3 of these 5 seeds — `misdirectedTargetCount` ranked the attacker as the misdirected sibling.',
    },
    {
        // Bot reachability for a "target attacking creature" damage shield
        // (issue #5815, Bot Gap `never-chosen › Instant target:Creature ›
        // draw+preventDamage`). Same combat as the entry above, the bot at 3
        // life against a 3/3: Restrain on the attacker is the ONLY move that
        // does not lose the game (CR 510.1b / 704.5a).
        label: "source shield: Restrain the lethal attacker after blocks",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Restrain", owner: "opp", zone: "hand" },
                { name: "Plains", owner: "opp", zone: "battlefield", count: 3 },
                {
                    name: "Mons's Goblin Raiders",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
            life: { opp: 3 },
        },
        setup: [
            { kind: "declare-attackers" },
            { kind: "declare-blockers" },
            { kind: "pass", seat: "me" },
        ],
        bot: "opp",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        // A PREDICATE for the same reason as above: the claim is that the
        // cast is reachable and aimed at the attacker, not a board preference.
        expect: {
            predicate: (move, state) => {
                if (!move || move.kind !== "cast-spell") return false;
                const restrain = instanceIdsForName(state, "Restrain");
                const attacker = instanceIdsForName(state, "Hill Giant");
                return (
                    restrain.has(move.cardInstanceId) &&
                    (move.targets ?? []).some((t) => attacker.has(t.id))
                );
            },
            describe: "casts Restrain at the attacking Hill Giant",
        },
        note: "Bot reachability for Restrain (issue #5815). The Bot-play sweep posed it as a boon on the holder's OWN blocked attacker — the shape `targetPose` gives a slot signed `beneficial` — where preventing its damage only loses the combat, so the Bot rightly passed and the card read `never-chosen`. With the slot signed `harmful` the sweep poses the opponent's attack instead. This entry pins the cast in the real window: the last priority round before combat damage.",
    },
    {
        // SACRIFICE-OUTLET reachability (CR 701.21a, issue #4261). The bot's
        // postcombat main (below), a Grizzly Bears on each side, Nantuko Husk
        // in hand and five untapped Swamps for its {2}{B}: a 2/2 body that can
        // turn any creature into +2/+2 until end of turn. Casting it is
        // strictly better than holding it.
        //
        // Before the fix the cast edge read WORSE than `pass` on every seed:
        // the tree opened a "sacrifice a creature" child at each node after
        // the cast, and the rollouts drew it at random, so each rollout that
        // held the outlet stripped its own board. A twin whose ability cost
        // mana instead of a creature was cast. Fixed by class, not by card:
        // `isDeferrableTransientSacrifice` and `isTransientSacrificeConversion`
        // (`search.ts`).
        //
        // POSTCOMBAT, not the sweep's precombat main (issue #4877, the shape
        // of issue #4777). There `pass` is not "don't cast": the rollout casts
        // the Husk in the postcombat main, both edges reach the same leaf, and
        // the root pick was rollout noise (`pass` on 3 of seeds 0..9, every
        // pick `material-tiebreak`, the two edges within 0.003 reward). Here
        // `pass` forgoes the deploy for the turn: 10/10 cast on seeds 0..9 at
        // this budget and at 200, under the committed weights and both ±1%
        // jitter vectors. What the sweep (`botReach.bot.test.ts`) covers is
        // its own verdict, "ever played?" in either main phase; "cast
        // precombat?" is guarded by nothing, deliberately.
        label: "Sacrifice outlet with a transient payoff: casts the creature",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an instant in hand that needs the same mana on the opponent's turn",
            },
        },
        spec: {
            cards: [
                { name: "Nantuko Husk", owner: "me", zone: "hand" },
                ...Array.from({ length: 5 }, () => ({
                    name: "Swamp",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                })),
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Ornithopter", owner: "me", zone: "battlefield" },
                { name: "Castle", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Ornithopter", owner: "opp", zone: "battlefield" },
                { name: "Castle", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "graveyard" },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        // The Bot-play sweep's board, budget and seeds (`botReachSpec`,
        // `BOT_REACH_BUDGET`): a REACHABILITY claim, the verdict
        // `oracle:compile` measures.
        budget: { iterations: 48 },
        seeds: [0xb07, 0x5eed],
        tier: "must",
        // A PREDICATE for the reason the Kicker {X} entry gives: a
        // reachability claim, kept out of the weight fit.
        expect: {
            predicate: (move, state) =>
                move !== null &&
                move.kind === "cast-spell" &&
                instanceIdsForName(state, "Nantuko Husk").has(
                    move.cardInstanceId
                ),
            describe: "casts Nantuko Husk",
        },
        note: "Bot Gap `never-chosen › Creature › pump` (7 cards). Issue #4261.",
    },
    {
        // The other half of the pair (CR 701.21a, issue #4261): Nantuko Husk
        // already on the battlefield in its controller's precombat main, with
        // a spare Grizzly Bears to feed it. +2/+2 until end of turn with no
        // combat in sight is a creature thrown away for nothing, and the
        // activation is still available in a window where the payoff matters.
        label: "Sacrifice outlet with a transient payoff: no sacrifice in the main phase",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "step",
                detail: "the declare blockers step, with Nantuko Husk attacking unblocked",
            },
        },
        spec: {
            cards: [
                { name: "Nantuko Husk", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        // A PREDICATE, like its pair: kept out of the weight fit.
        expect: {
            predicate: (move) =>
                move !== null && move.kind !== "activate-ability",
            describe: "does not sacrifice a creature to Nantuko Husk",
        },
        note: "Discriminating pair of the outlet-cast entry above. Issue #4261.",
    },
    {
        // SELF-GROWING OUTLET reachability (CR 701.21a, issue #4271). The
        // sweep's own position for a creature whose only ability is "Sacrifice
        // a creature: put a +1/+1 counter on this creature": Scarland Thrinax
        // in hand, {B}{R}{G} available, a spare body on each side.
        //
        // Before the fix the cast edge read WORSE than `pass` at a 200-iteration
        // budget on every seed. The outlet's payoff is LASTING, so #4261's
        // transient prune did not reach it: below the root the rollout drew
        // "sacrifice a creature" at random and the tree opened it at the node
        // after the cast (two victims against one `pass`), each strictly worse
        // than passing, and their subtrees dragged the cast edge's mean margin
        // below `pass`'s for a creature the static leaf ranks higher. The same
        // body without the ability was cast. Fixed by class, not by card:
        // `isSourceConfinedSacrificeConversion` (`search.ts`).
        label: "Self-growing sacrifice outlet: casts the creature",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an instant in hand that needs the same mana on the opponent's turn",
            },
        },
        spec: {
            cards: [
                { name: "Scarland Thrinax", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Ornithopter", owner: "me", zone: "battlefield" },
                { name: "Castle", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Ornithopter", owner: "opp", zone: "battlefield" },
                { name: "Castle", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "graveyard" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        // The Bot-play sweep's own position, at four times its budget (its
        // verdict needs ONE seed to cast; at 48 iterations one of its two
        // seeds still passes, at 200 all of them cast, and the entry states
        // the stronger claim). A REACHABILITY claim, so a PREDICATE, kept out
        // of the weight fit for the reason the Nantuko Husk entry gives.
        budget: { iterations: 200 },
        seeds: [0xb07, 0x5eed, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                move !== null &&
                move.kind === "cast-spell" &&
                instanceIdsForName(state, "Scarland Thrinax").has(
                    move.cardInstanceId
                ),
            describe: "casts Scarland Thrinax",
        },
        note: "Bot Gap `never-chosen › Creature › counters` (4 cards). Issue #4271. Issue #5629: the greedy rollout policy skips the same pruned sacrifices as the random draw, so the cast wins by margin, not by seed noise.",
    },
    {
        // The other half of the pair (CR 701.21a, issue #4271): the outlet
        // already on the battlefield in its controller's precombat main with a
        // spare Grizzly Bears to feed it. A +1/+1 counter bought with a whole
        // creature moves worth around the board and creates none.
        label: "Self-growing sacrifice outlet: no sacrifice in the main phase",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "stack",
                detail: "a removal spell on the stack targeting the creature to sacrifice",
            },
        },
        spec: {
            cards: [
                { name: "Scarland Thrinax", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        // A PREDICATE, like its pair: kept out of the weight fit.
        expect: {
            predicate: (move) =>
                move !== null && move.kind !== "activate-ability",
            describe: "does not sacrifice a creature to Scarland Thrinax",
        },
        note: "Discriminating pair of the outlet-cast entry above. Issue #4271.",
    },
    {
        // SACRIFICE-FOR-REMOVAL reachability (CR 701.21a, issue #4272). The
        // sweep's own board, moved to the postcombat main (below), for a
        // creature whose only ability is "Sacrifice
        // this creature: it deals 1 damage to target creature": Frostling in
        // hand, three Mountains, a spare body on each side.
        //
        // Before the fix the cast edge read WORSE than `pass` at the sweep's
        // budget. Below the cast the rollout drew "sacrifice Frostling, aim at
        // a creature" at random and the tree opened it at the node after the
        // cast — a permanent traded for a permanent, no card, mana, life or
        // player damage created — and those subtrees dragged the cast edge's
        // mean margin under `pass`'s for a creature the static leaf ranks
        // higher. Fixed by class, not by card: `isRemovalExchangeSacrifice`
        // (`search.ts`).
        //
        // POSTCOMBAT, not the sweep's precombat main (issue #4877, the shape
        // of issue #4777): there the rollout casts Frostling in the postcombat
        // main after `pass`, the two edges reach the same leaf (within 0.001
        // reward), and the pick was rollout noise. Here `pass` forgoes the
        // deploy for the turn: 10/10 cast on seeds 0..9 under the committed
        // weights and both ±1% jitter vectors. The sweep
        // (`botReach.bot.test.ts`) still asks "ever played?" in either main
        // phase; "cast precombat?" is guarded by nothing, deliberately.
        label: "Sacrifice-for-removal outlet: casts the creature",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an instant in hand that needs the same mana on the opponent's turn",
            },
        },
        spec: {
            cards: [
                { name: "Frostling", owner: "me", zone: "hand" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Ornithopter", owner: "me", zone: "battlefield" },
                { name: "Castle", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Ornithopter", owner: "opp", zone: "battlefield" },
                { name: "Castle", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "graveyard" },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        // The Bot-play sweep's board at four times its budget — a
        // REACHABILITY claim, so a PREDICATE, kept out of the weight fit for
        // the reason the Nantuko Husk entry gives.
        budget: { iterations: 200 },
        // 0x5eed restored (issue #4877): issue #4761's refit had re-seeded it
        // to 4 as a noise pin, which the postcombat board no longer is.
        seeds: [0xb07, 0x5eed, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                move !== null &&
                move.kind === "cast-spell" &&
                instanceIdsForName(state, "Frostling").has(move.cardInstanceId),
            describe: "casts Frostling",
        },
        note: "Bot Gap `never-chosen › Creature › dealDamage` (3 cards). Issue #4272.",
    },
    {
        // The other half of the pair (CR 701.21a, issue #4272): the outlet
        // already on the battlefield in its controller's precombat main
        // against a Grizzly Bears it cannot kill. One damage bought with the
        // whole creature trades a body for nothing.
        label: "Sacrifice-for-removal outlet: no sacrifice in the main phase",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an opposing 1-toughness creature worth killing",
            },
        },
        spec: {
            cards: [
                { name: "Frostling", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        // A PREDICATE, like its pair: kept out of the weight fit.
        expect: {
            predicate: (move) =>
                move !== null && move.kind !== "activate-ability",
            describe: "does not sacrifice Frostling for one damage",
        },
        // A root-behaviour pin, not a proof the prune is narrow: the prune never
        // reaches the root, so this reads the same with or without it. Its
        // seat and scope are pinned in `removalExchange.bot.test.ts`.
        note: "Root pin beside the outlet-cast entry above. Issue #4272.",
    },
    {
        // SACRIFICE-FOR-DISCARD reachability (CR 701.21a, CR 701.9a, issue
        // #4276). The sweep's own board, moved to the postcombat main (below),
        // for a creature whose only ability is
        // "Sacrifice a creature: Target player discards two cards": Sadistic
        // Hypnotist in hand, five Swamps, a spare body on each side.
        //
        // Before the fix the cast edge read WORSE than `pass` at the sweep's
        // budget: below the cast the rollout drew "sacrifice a creature, aim at
        // the opponent" at random and the tree opened it at the node after the
        // cast, and those subtrees dragged the cast edge's mean margin under
        // `pass`'s. Fixed by class, not by card: `isDiscardExchangeSacrifice`
        // (`search.ts`).
        //
        // POSTCOMBAT, not the sweep's precombat main (issue #5016, the shape
        // of issue #4777 and issue #4877): there the rollout casts the
        // Hypnotist in the postcombat main after `pass`, so a refit moved the
        // near-tie enough to lose 1 of 10 wide seeds on every vector. Here
        // `pass` forgoes the deploy for the turn. The sweep
        // (`botReach.bot.test.ts`) still asks "ever played?" in either main
        // phase; "cast precombat?" is guarded by nothing, deliberately.
        label: "Sacrifice-for-discard outlet: casts the creature",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an instant in hand that needs the same mana on the opponent's turn",
            },
        },
        spec: {
            cards: [
                { name: "Sadistic Hypnotist", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Ornithopter", owner: "me", zone: "battlefield" },
                { name: "Castle", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Ornithopter", owner: "opp", zone: "battlefield" },
                { name: "Castle", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "graveyard" },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        // The Bot-play sweep's own position at four times its budget — a
        // REACHABILITY claim, so a PREDICATE, kept out of the weight fit for
        // the reason the Nantuko Husk entry gives.
        budget: { iterations: 200 },
        seeds: [0xb07, 0x5eed, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                move !== null &&
                move.kind === "cast-spell" &&
                instanceIdsForName(state, "Sadistic Hypnotist").has(
                    move.cardInstanceId
                ),
            describe: "casts Sadistic Hypnotist",
        },
        note: "Bot Gap `never-chosen › Creature › choice+discard` (2 cards). Issue #4276. Seed 0xb07 restored by issue #5016: at the precombat main it and seed 17 picked `pass` after issue #4764's refit (rollout noise, issue #4785), so the entry ran seed 4 instead; at the postcombat main the cast wins on all of 0xb07, 0x5eed and 1..18.",
    },
    {
        // SACRIFICE-FOR-RANDOM-DISCARD reachability (CR 701.21a, CR 701.9b,
        // issue #4285). The sweep's own position for a creature whose only
        // ability is "{B}, Sacrifice this creature: Target opponent discards a
        // card at random": Urborg Mindsucker in hand, five Swamps, a spare body
        // on each side.
        //
        // The same drag as the entry above, through the `discardAtRandom` Op
        // instead of the target's own pick: the cast edge read WORSE than
        // `pass` because the rollout and the tree opened the sacrifice below
        // the cast. Fixed by class, not by card: `abilityIsDiscardExchange`
        // (`discardExchange.ts`) reads either discarding Op.
        label: "Sacrifice-for-random-discard outlet: casts the creature",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an instant in hand that needs the same mana on the opponent's turn",
            },
        },
        spec: {
            cards: [
                { name: "Urborg Mindsucker", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Ornithopter", owner: "me", zone: "battlefield" },
                { name: "Castle", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Ornithopter", owner: "opp", zone: "battlefield" },
                { name: "Castle", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "graveyard" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        // A REACHABILITY claim at eight times the sweep's budget, so a
        // PREDICATE, kept out of the weight fit like its discard sibling.
        // 400 since issue #5151's refit: at 200, seed 2 picked `pass` under
        // the refitted vector (19/20 over twenty seeds; 20/20 under the
        // previous one) — rollout noise at the budget edge, the drift its
        // sibling's note records for issue #4764; at 400 the cast wins 20/20
        // under both vectors.
        budget: { iterations: 400 },
        seeds: [0xb07, 0x5eed, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                move !== null &&
                move.kind === "cast-spell" &&
                instanceIdsForName(state, "Urborg Mindsucker").has(
                    move.cardInstanceId
                ),
            describe: "casts Urborg Mindsucker",
        },
        note: "Bot Gap `never-chosen › Creature › discardAtRandom` (1 card). Issue #4285. Budget 200 → 400 at issue #5151's refit: seed 2 chose `pass` at 200 under the refitted vector (19/20 over twenty seeds, 20/20 under the previous vector); 20/20 under both at 400.",
    },
    {
        // SACRIFICE-FOR-DRAIN reachability (CR 701.21a, CR 119.3, issue #4277).
        // The sweep's own board, moved to the postcombat main (below), for a
        // creature whose only ability is
        // "Sacrifice this creature: Target player loses 1 life and you gain 1
        // life": Death Cultist in hand, five Swamps, a spare body on each side.
        //
        // Before the fix the cast edge read WORSE than `pass` at the sweep's
        // budget: below the cast the rollout drew "sacrifice, aim the drain at
        // the opponent" at random and the tree opened it at the node after the
        // cast, and those subtrees dragged the cast edge's mean margin under
        // `pass`'s. Fixed by class, not by card: `isDrainExchangeSacrifice`
        // (`search.ts`).
        //
        // POSTCOMBAT, not the sweep's precombat main (issue #4777). There
        // `pass` is not "don't cast": the rollout casts a one-mana creature in
        // the postcombat main, both edges reach the same leaf, and the root
        // pick was rollout noise (`pass` on seeds 8, 10, 11, 13 of 1..18) — no
        // weight can separate two identical leaves, and holding a creature
        // with no combat role for the second main is sound play. Here `pass`
        // forgoes the deploy for the turn, and the cast wins on the search's mean
        // reward at every seed of 0x5eed, 0xb07 and 1..18.
        // The precombat pick stays covered by the sweep itself
        // (`botReach.bot.test.ts`), which asks "ever played?", not "cast now?".
        label: "Sacrifice-for-drain outlet: casts the creature",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an instant in hand that needs the same mana on the opponent's turn",
            },
        },
        spec: {
            cards: [
                { name: "Death Cultist", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Ornithopter", owner: "me", zone: "battlefield" },
                { name: "Castle", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Ornithopter", owner: "opp", zone: "battlefield" },
                { name: "Castle", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "graveyard" },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        // The Bot-play sweep's board at four times its budget — a
        // REACHABILITY claim, so a PREDICATE, kept out of the weight fit for
        // the reason the Nantuko Husk entry gives.
        budget: { iterations: 200 },
        seeds: [0xb07, 0x5eed, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                move !== null &&
                move.kind === "cast-spell" &&
                instanceIdsForName(state, "Death Cultist").has(
                    move.cardInstanceId
                ),
            describe: "casts Death Cultist",
        },
        note: "Bot Gap `never-chosen › Creature › gainLife+loseLife` (2 cards). Issue #4277.",
    },
    {
        // SACRIFICE-FOR-DRAW reachability (CR 701.21a, CR 121.1, issue #4279).
        // The sweep's own board, moved to the postcombat main (below), for a
        // creature whose only ability is "{2},
        // Sacrifice this creature: Target player draws a card": Limestone Golem
        // in hand, eight Plains (its cost plus the outlet's {2}), a spare body on
        // each side.
        //
        // Before the fix the cast edge read WORSE than `pass` at the sweep's
        // budget: below the cast the rollout drew "sacrifice, aim the draw" at
        // random and the tree opened it at the node after the cast, and those
        // subtrees dragged the cast edge's mean margin under `pass`'s. Fixed by
        // class, not by card: `isDrawExchangeSacrifice` (`search.ts`).
        //
        // POSTCOMBAT, not the sweep's precombat main (issue #5016, the shape
        // of issue #4777 and issue #4877): there the rollout casts the Golem
        // in the postcombat main after `pass`, so a refit moved the near-tie
        // enough to lose 2 of 10 wide seeds under jitter+. Here `pass`
        // forgoes the deploy for the turn. The sweep (`botReach.bot.test.ts`)
        // still asks "ever played?" in either main phase; "cast precombat?"
        // is guarded by nothing, deliberately.
        label: "Sacrifice-for-draw outlet: casts the creature",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an instant in hand that needs the same mana on the opponent's turn",
            },
        },
        spec: {
            cards: [
                { name: "Limestone Golem", owner: "me", zone: "hand" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Ornithopter", owner: "me", zone: "battlefield" },
                { name: "Castle", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Ornithopter", owner: "opp", zone: "battlefield" },
                { name: "Castle", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "graveyard" },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        // The Bot-play sweep's own position at four times its budget — a
        // REACHABILITY claim, so a PREDICATE, kept out of the weight fit for
        // the reason the Nantuko Husk entry gives.
        budget: { iterations: 200 },
        seeds: [0xb07, 0x5eed, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                move !== null &&
                move.kind === "cast-spell" &&
                instanceIdsForName(state, "Limestone Golem").has(
                    move.cardInstanceId
                ),
            describe: "casts Limestone Golem",
        },
        note: "Bot Gap `never-chosen › Artifact › draw` (1 card). Issue #4279.",
    },
    {
        // FLASH AMBUSH reachability (CR 702.8a, CR 508.1, CR 509.1, issue #4280).
        // The sweep's fourth window for a creature with flash: the opponent's
        // Grizzly Bears attacks, the holder has priority in the declare-attackers
        // step with Benalish Knight (flash, first strike) in hand and the mana
        // for it. Cast now, the creature blocks and its first strike kills the
        // attacker unharmed — where in a main phase holding and casting the same
        // flash creature are one play a turn apart, a tie that rollout noise
        // settles for `pass`.
        label: "Flash creature: casts it to block an attacker",
        classification: {
            kind: "conditional",
            discriminant: { kind: "card", detail: "no attacking creature" },
        },
        spec: {
            cards: [
                { name: "Benalish Knight", owner: "me", zone: "hand" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Ornithopter", owner: "me", zone: "battlefield" },
                { name: "Castle", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Ornithopter", owner: "opp", zone: "battlefield" },
                { name: "Castle", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "graveyard" },
            ],
            phase: "DECLARE_ATTACKERS",
            activePlayer: "opp",
            priority: "me",
            combat: { attackers: ["Grizzly Bears"], confirmed: true },
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        // The Bot-play sweep's own position at four times its budget — a
        // REACHABILITY claim, so a PREDICATE, kept out of the weight fit for
        // the reason the Nantuko Husk entry gives.
        budget: { iterations: 200 },
        seeds: [0xb07, 0x5eed, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                move !== null &&
                move.kind === "cast-spell" &&
                instanceIdsForName(state, "Benalish Knight").has(
                    move.cardInstanceId
                ),
            describe: "casts Benalish Knight",
        },
        note: "Bot Gap `never-chosen › Creature [first strike,flash] › (no Ops)` (1 card). Issue #4280.",
    },
    {
        // DISCARD-SPELL reachability (CR 701.9a, CR 118.8, issue #4278). The
        // sweep's position for a sorcery whose additional cost is a creature
        // and whose effect is "target opponent discards two cards": Tendrils
        // of Despair in hand, a spare 1/1 to sacrifice, a body on each side,
        // and an opponent whose deck holds spells — with five Swamps where the
        // sweep seeds three. At three, one seed of five passes at this budget
        // (the sweep reads `played` from its own seed); two spare lands make
        // the cast stable across all five.
        //
        // Before the fix the position dealt the opponent lands (the search
        // re-deals a hidden hand from the unseen pool, so a spell placed in the
        // hand itself is priced as the pool), so two discards (about 110) never
        // paid for the creature the cost gives up (about 156) and the cast read
        // 65 points under `pass`. The pose now stocks the opponent's library
        // with spells and hands the holder a spare 1/1 (`discardsFromTarget`,
        // `sacrificesCreature`, `botReach.ts`) — a position change, not a
        // search change: the Bot's preference is unchanged.
        //
        // Issue #4917 — the stock was half of the pool, not all of it:
        // `libraryCount: 20` ADDS twenty filler basics beside the Angels, so
        // the re-dealt hand held two lands in about half the worlds, the
        // opponent sheds its least valuable cards (CR 701.9b,
        // `forcedChoiceAnswer`), and two discarded lands (16) never pay for
        // the 1/1 (156). The cast read as a win only because the search
        // stopped at the discard and scored the line before the opponent's
        // turn. No filler now: the opponent's library is the Angels, the
        // Bot's own is Swamps.
        label: "Discard sorcery with a sacrifice cost: casts it into a full hand",
        classification: {
            kind: "conditional",
            discriminant: { kind: "card", detail: "an empty opponent hand" },
        },
        spec: {
            cards: [
                { name: "Tendrils of Despair", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Ornithopter", owner: "me", zone: "battlefield" },
                { name: "Castle", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Ornithopter", owner: "opp", zone: "battlefield" },
                { name: "Castle", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "graveyard" },
                {
                    name: "Serra Angel",
                    owner: "opp",
                    zone: "library",
                    position: 1,
                    count: 20,
                },
                // Real cards where the sweep seeds `hiddenHand: { opp: 3 }`:
                // a blade position must load into a live game (issue #1432),
                // and the search re-deals the opponent's hand from the unseen
                // pool either way.
                { name: "Serra Angel", owner: "opp", zone: "hand", count: 3 },
                {
                    name: "Mons's Goblin Raiders",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Swamp", owner: "me", zone: "library", count: 20 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 0,
        },
        bot: "me",
        // A REACHABILITY claim at four times the sweep's budget, so a
        // PREDICATE, kept out of the weight fit like the entries above.
        budget: { iterations: 200 },
        // Re-seeded 0xb07 → 5 on issue #4761's promotion refit: a noise pin
        // (16/20 seeds cast on the refit vector, 17/20 on the one before),
        // not a valuation change — follow-up issue #4804. Re-seeded 5 → 6 on
        // issue #4880's refit (15/20 seeds cast; 4, 5, 8, 17 and 19 `pass`):
        // the same noise pin, listed in the robustness baseline under issue
        // #4917, which owns the discard stall behind it.
        seeds: [6, 0x5eed, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                move !== null &&
                move.kind === "cast-spell" &&
                instanceIdsForName(state, "Tendrils of Despair").has(
                    move.cardInstanceId
                ),
            describe: "casts Tendrils of Despair",
        },
        note: "Bot Gap `never-chosen › Sorcery target:player › choice+discard` (2 cards). Issue #4278.",
    },
    {
        // SACRIFICE-FOR-DENIAL reachability (CR 701.21a, CR 305.1, issue
        // #5431). The sweep's own position for a creature whose only ability
        // is "Sacrifice this creature: Target player can't play lands this
        // turn": Pardic Miner in hand, five Mountains, a spare body on each
        // side.
        //
        // Before the fix the cast edge read WORSE than `pass` at 800
        // iterations on every seed while the same body without the ability
        // was cast: below the cast the rollout drew "sacrifice, aim the denial
        // at the opponent" at random and the tree opened it at the node after
        // the cast, and those subtrees dragged the cast edge's mean margin
        // under `pass`'s. Fixed by class, not by card:
        // `isDenialExchangeSacrifice` (`search.ts`).
        label: "Sacrifice-for-denial outlet: casts the creature",
        spec: {
            cards: [
                { name: "Pardic Miner", owner: "me", zone: "hand" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Ornithopter", owner: "me", zone: "battlefield" },
                { name: "Castle", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Ornithopter", owner: "opp", zone: "battlefield" },
                { name: "Castle", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "graveyard" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        // The Bot-play sweep's own position at eight times its budget — a
        // REACHABILITY claim, so a PREDICATE, kept out of the weight fit for
        // the reason the Nantuko Husk entry gives.
        budget: { iterations: 400 },
        seeds: [0xb07, 0x5eed, 1, 2, 3],
        tier: "must",
        classification: { kind: "absolute" },
        expect: {
            predicate: (move, state) =>
                move !== null &&
                move.kind === "cast-spell" &&
                instanceIdsForName(state, "Pardic Miner").has(
                    move.cardInstanceId
                ),
            describe: "casts Pardic Miner",
        },
        note: "Bot Gap `never-chosen › Creature › restrictLandPlay` (1 card). Issue #5431.",
    },
    {
        // A BOON is not self-harm (issue #4273). Unnatural Speed grants haste
        // until end of turn to the creature it targets: the bot's main phase,
        // two Mountains, a summoning-sick Grizzly Bears beside a ready one, and
        // the opponent at 3 behind a single Grizzly Bears. Pass leaves one
        // attacker for one blocker; the hasty spare makes it three swings for
        // one blocker, which is lethal.
        //
        // What it guards is the `self-harm-removal` hold. The rule keys on the
        // settled MATERIAL margin dropping after a cast aimed only at the
        // bot's own permanents, and a keyword until end of turn is not on the
        // board that margin sums: the drop is just the card and the mana. The
        // search ranked the cast first and the hold handed the pick to `pass`
        // (`trace.mechanism === "self-harm-removal"`), so no card of this shape
        // was ever cast. `boonsEveryTarget` exempts a cast whose every
        // announced slot the script signs beneficial.
        label: "boon on own creature: casts the haste grant instead of holding the card",
        classification: {
            kind: "conditional",
            discriminant: { kind: "step", detail: "the postcombat main phase" },
        },
        spec: {
            cards: [
                { name: "Unnatural Speed", owner: "me", zone: "hand" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: true,
                },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
            life: { opp: 3 },
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move, state) => {
                if (move === null || move.kind !== "cast-spell") return false;
                const me = state.players.find((p) => p.id === "p1");
                const target = move.targets?.[0];
                // Either of its own bodies: WHICH one is rollout noise the hold
                // is not about; that it is cast at all is.
                return (
                    target !== undefined &&
                    (me?.battlefield.some((c) => c.id === target.id) ?? false)
                );
            },
            describe: "casts Unnatural Speed on one of its own Grizzly Bears",
        },
        note: "Issue #4273. Pins the class 'a boon on the bot's own permanent is not self-harm' at the root hold. The predicate does not name the sick body: the target choice among the bot's own Bears is a separate, rollout-noise preference this entry does not claim. The cast and `pass` are outcome-equal here, so the pick is the pre-attack arm of `last-window-fire` (issue #4768): a haste grant on a summoning-sick body has its last useful window before attackers are declared (CR 508.1a), not at the opponent's end step.",
    },
    // Issue #4758 (PRD #4754) — an ETB Ability is spent on entering: latent
    // (hand, library, graveyard, playable exile), never realized. Two
    // discriminating halves on a creature whose ETB can find NOTHING and whose
    // body then survives as a vanilla, plus the Flametongue Kavu positions the
    // issue names, which the mandatory target keeps honest on its own.
    {
        label: "ETB Ability spent: holds Skyclave Apparition while its ETB has nothing to exile",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an opposing Hill Giant to exile",
            },
        },
        spec: {
            cards: [{ name: "Skyclave Apparition", owner: "me", zone: "hand" }],
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
            forbidden: [{ kind: "cast-spell", card: "Skyclave Apparition" }],
        },
        note: 'Issue #4758 — the discriminating half. Skyclave Apparition\'s ETB ("exile up to one target nonland, nontoken permanent you don\'t control with mana value 4 or less") is an ETB Ability: spent on entering, latent in hand, never realized on the battlefield. With nothing to exile the trigger goes on the stack targetless (CR 601.2c "up to") and does nothing, so casting it trades the potential for a vanilla 2/2. Measured at authoring time on all five seeds: `cast-spell` before the change (the realized reading still counted the spent ETB), `pass` after. Proof of failure: putting the ETB back on the realized face, or discounting the latent ETB like a standing ability (0.5), turns this entry red.',
    },
    {
        label: "ETB Ability realized: casts Skyclave Apparition into a permanent worth exiling",
        pairOf: {
            anchor: "ETB Ability spent: holds Skyclave Apparition while its ETB has nothing to exile",
            discriminant: {
                kind: "card",
                detail: "an opposing Hill Giant to exile",
            },
        },
        spec: {
            cards: [
                { name: "Skyclave Apparition", owner: "me", zone: "hand" },
                {
                    name: "Hill Giant",
                    owner: "opp",
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
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Skyclave Apparition" }],
        },
        note: "Issue #4758 — the passivity guard for the entry above: with an opposing Hill Giant to exile, casting realizes more than the potential it spends, so the Bot casts. Green before and after the change; what keeps it green after is the policy probe settling the ETB's own target announcement (CR 603.3d) — without it the probe scores the cast as a bare body.",
    },
    {
        label: "ETB Ability spent: holds Flametongue Kavu when its ETB can only hit its own side",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an opposing creature to take the 4 damage",
            },
        },
        spec: {
            cards: [
                { name: "Flametongue Kavu", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
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
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Flametongue Kavu" }],
        },
        note: 'Issue #4758 — a POSITION GUARD, not a discriminating entry. Flametongue Kavu\'s "deals 4 damage to target creature" is mandatory (CR 603.3d: a trigger is removed only when NO legal target can be chosen), so with no opposing creature it must hit its own Grizzly Bears or itself. The search already held here before the change (measured: `pass` on all five seeds); the entry keeps the spent-ETB accounting from teaching the Bot to throw a creature away. The discriminating hold is the Skyclave Apparition entry.',
    },
    {
        label: "ETB Ability realized: casts Flametongue Kavu into an opposing creature worth killing",
        pairOf: {
            anchor: "ETB Ability spent: holds Flametongue Kavu when its ETB can only hit its own side",
            discriminant: {
                kind: "card",
                detail: "an opposing creature to take the 4 damage",
            },
        },
        spec: {
            cards: [
                { name: "Flametongue Kavu", owner: "me", zone: "hand" },
                {
                    name: "Serra Angel",
                    owner: "opp",
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
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Flametongue Kavu" }],
        },
        note: "Issue #4758 — the passivity guard for Flametongue Kavu: a Serra Angel to kill is worth more than the potential spent, so the Bot casts. Green before and after the change.",
    },
    // Issue #4895 — blade coverage for the cards the issue #4758 review named.
    {
        label: "opponent's choice: casts Ravenous Rats into a two-card hand",
        classification: {
            kind: "conditional",
            discriminant: { kind: "card", detail: "an empty opponent hand" },
        },
        spec: {
            cards: [
                { name: "Ravenous Rats", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "opp", zone: "hand" },
                { name: "Hill Giant", owner: "opp", zone: "hand" },
                // Issue #4981 — the search re-deals the opponent's hand from
                // the unseen pool (the Mind Rot entry below, issue #4917):
                // with twenty filler basics the discard read as a land. The
                // opponent's library is the same two creatures, the Bot's own
                // is Swamps.
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "library",
                    count: 10,
                },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "library",
                    count: 10,
                },
                { name: "Swamp", owner: "me", zone: "library", count: 20 },
            ],
            // The LAST main phase of the turn (issue #4981, the shape of
            // issue #4877 and issue #4882). In the precombat main `pass`
            // reaches the postcombat one with the same cast still open, and
            // with no creature on either side the two are the same play: the
            // edges sat 0.004-0.017 reward apart on seeds 0..9, every pick
            // `material-tiebreak`, and a ±1% weight jitter or a refit flipped
            // a seed. Here `pass` hands the opponent a turn with both cards.
            phase: "POSTCOMBAT_MAIN",
            turn: 7,
            // Six lands a side: the opponent can cast both cards next turn
            // (measured: the cast leads `pass` by 0.013-0.020 reward at four
            // lands, 0.032-0.036 at six).
            landCount: 6,
            libraryCount: 0,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Ravenous Rats" }] },
        note: "Issue #4895 (issue #4758 review), re-cut by issue #4981. Its ETB Ability makes the opponent discard (their pick, CR 701.9b), answered in the probe, the tree walk and the rollout since issue #4896 and issue #4917. Measured on seeds 0..9 at 400: cast 10/10, 0.032-0.036 reward ahead of `pass`; every pick `mean-reward` because `pass` falls out of the visit band (226-229 visits against 171-174, `visitTol` 0.15), the lead itself being under `outcomeEps`; cast 10/10 at 200 and 800 too, the lead narrowing with budget (0.056-0.070, 0.017-0.019). The same board with an empty opposing hand picks `pass` on 10/10 — the discard is what the cast is for. Seeds back to 0..4: the 3 → 5 swap of issue #4934 hid the precombat tie.",
    },
    {
        label: "opponent's choice: casts Chainer's Edict at the opponent's only creature",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no creature on the opponent's battlefield",
            },
        },
        spec: {
            cards: [
                { name: "Chainer's Edict", owner: "me", zone: "hand" },
                {
                    name: "Serra Angel",
                    owner: "opp",
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
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Chainer's Edict" }] },
        note: "Issue #4895 (issue #4758 review). The opponent's sacrifice choice leaves the 1-ply probe at the spell's cost (−383 cast vs −239 pass, issue #4896); the tree search still finds the cast on 5/5 seeds. A guard that the fix of issue #4896 keeps it.",
    },
    {
        label: "opponent's choice: casts Mind Rot into a two-card hand",
        classification: {
            kind: "conditional",
            discriminant: { kind: "card", detail: "an empty opponent hand" },
        },
        spec: {
            cards: [
                { name: "Mind Rot", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "opp", zone: "hand" },
                { name: "Hill Giant", owner: "opp", zone: "hand" },
                // Issue #4917 — the search re-deals the opponent's hand from
                // the unseen pool, so the two creatures above are priced as
                // the pool: with `libraryCount: 20` that was twenty filler
                // basics, and Mind Rot read as two lands discarded (16) for a
                // card in hand (40). No filler now — the opponent's library is
                // the same creatures, the Bot's own is Swamps — so "two cards
                // for one" is the position the Bot actually deduces.
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "library",
                    count: 10,
                },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "library",
                    count: 10,
                },
                { name: "Swamp", owner: "me", zone: "library", count: 20 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 0,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Mind Rot" }] },
        note: "Issue #4895 (issue #4758 review), promoted by issue #4917: two cards for one, the obvious play. Issue #4896 settled the opponent's discard in the 1-ply probe; issue #4917 answers it in the tree walk and the rollout too (`advanceToDecision` over `forcedChoiceAnswer`), so no leaf is scored mid-resolution, and stocks the opponent's library so the re-dealt hand holds spells.",
    },
    {
        label: "opponent's choice: Mind Rot strips a lone Sacred Ground",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a lone opponent hand card the Bot's valuation prices above the cost of Mind Rot",
            },
        },
        spec: {
            cards: [
                { name: "Mind Rot", owner: "me", zone: "hand" },
                { name: "Sacred Ground", owner: "opp", zone: "hand" },
                // The unseen pool the search re-deals the opponent's hand from
                // (the Mind Rot entry above, issue #4917): the same card.
                {
                    name: "Sacred Ground",
                    owner: "opp",
                    zone: "library",
                    count: 10,
                },
                { name: "Swamp", owner: "me", zone: "library", count: 20 },
            ],
            phase: "POSTCOMBAT_MAIN",
            turn: 7,
            landCount: 6,
            libraryCount: 0,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Mind Rot" }] },
        note: "Issue #4143 — the shadow-valuation twin of the Mind Rot entry above. One opponent card in hand, so Mind Rot trades a card for a card, and the cast is worth it only when the card it strips is worth more than Mind Rot's own. Sacred Ground's leaves-the-battlefield trigger is a hand-written `resolve()`: with no `aiEffects` shadow it priced at the blind `base + MV` floor (28) and the Bot passed on all five seeds; the shadow (a `moveZone` back to the battlefield, one recursion unit) lifts the card to 70 and the Bot casts. Proof-of-failure: dropping the `aiEffects` line from `sacredGround` (sth/white) reds this entry on every seed.",
    },
    {
        label: "self-sacrificing ETB: casts Phlage from hand for lethal",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Phlage, Titan of Fire's Fury",
                    owner: "me",
                    zone: "hand",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
            life: { opp: 3 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                { kind: "cast-spell", card: "Phlage, Titan of Fire's Fury" },
            ],
        },
        note: "Issue #4895 (issue #4758 review). Hard-cast from hand, Phlage is sacrificed (it did not escape) but its ETB deals 3 to any target: lethal. Measured cast on 5/5 seeds.",
    },
    {
        label: "self-sacrificing ETB: hard-casts Phlage with no lethal and no creature",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Phlage, Titan of Fire's Fury",
                    owner: "me",
                    zone: "hand",
                },
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
            moves: [
                { kind: "cast-spell", card: "Phlage, Titan of Fire's Fury" },
            ],
        },
        note: "Issue #5014 (issue #4882 review). Opponent at 20, no creature on either side: hard-cast Phlage deals 3, gains 3 and goes to the graveyard with escape (CR 702.138) — strictly better than holding, the Uro shape. The hand value read the ETB script context-free (3 damage at the latent victim's price) while on an empty board the damage goes face; a self-sacrificing creature's ETB is now grounded on the board lens, like a spell's.",
    },
    {
        label: "escape: casts Phlage from the graveyard",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an instant in hand that needs the same mana on the opponent's turn",
            },
        },
        spec: {
            cards: [
                {
                    name: "Phlage, Titan of Fire's Fury",
                    owner: "me",
                    zone: "graveyard",
                },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Plateau", owner: "me", zone: "battlefield" },
                { name: "Plateau", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                { kind: "cast-spell", card: "Phlage, Titan of Fire's Fury" },
            ],
        },
        note: "Issue #4895 (issue #4758 review). Escape (CR 702.138): {R}{R}{W}{W} and five other graveyard cards exiled; escaped, Phlage keeps its body. Measured cast on 5/5 seeds. The graveyard VALUATION of the same card is issue #4897.",
    },
    {
        label: "self-sacrificing ETB: hard-casts Uro for its enter trigger",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Uro, Titan of Nature's Wrath",
                    owner: "me",
                    zone: "hand",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
            landsPlayed: { me: 1 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Uro, Titan of Nature's Wrath",
                },
            ],
        },
        note: "Issue #4895 (issue #4758 review), fixed by issue #4898: hard-cast Uro gains 3 life and draws, then goes to the graveyard with escape — strictly better than holding. The cast read BELOW holding (policy 91.6 against 102.7) because `manaDevelopment` dropped the escape-ready card from the curve (-40.7) once it left the hand; a printed-escape graveyard card now keeps its curve top. The search already chose the cast on 5/5 seeds; the Eval Pair (etbAbility.bot.test.ts) carries the ordering.",
    },
    {
        label: "alternate win: casts Thassa's Oracle when its trigger wins on the spot",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Thassa's Oracle", owner: "me", zone: "hand" },
                ...Array.from({ length: 5 }, () => ({
                    name: "Island",
                    owner: "opp" as const,
                    zone: "library" as const,
                })),
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 1,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Thassa's Oracle",
                },
            ],
        },
        note: "Issue #4895 (issue #4758 review), fixed by issue #4899: devotion to blue (2, Thassa's own {U}{U}) is at least the one card in library, so the ETB wins on the spot (CR 104.2b). The win check is the Op AFTER the trigger's look-and-distribute keep (CR 401.4), and `look-distribute` had no candidate generator, so neither the 1-ply probe nor the tree got past the keep — the search passed on 5/5 seeds. The opponent's library is five cards deep so passing does not win by decking within the horizon: with both libraries at one card, passing ALSO read as a won game and the material tie-break preferred the later win with Thassa still in hand. With the generator 5/5 cast on `mean-reward`; without it 1/5.",
    },
    {
        label: "ETB bounce: casts Man-o'-War on an opposing Craw Wurm",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no opposing creature on the battlefield",
            },
        },
        spec: {
            cards: [
                { name: "Man-o'-War", owner: "me", zone: "hand" },
                {
                    name: "Craw Wurm",
                    owner: "opp",
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
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Man-o'-War" }] },
        note: "Issue #4895 (issue #4758 review). A 2/3 that returns a 6-mana 6/4 to hand. Measured cast on 5/5 seeds.",
    },
    {
        label: "type-blind potential: casts Monk Realist into an opposing Glorious Anthem",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no opposing enchantment or artifact on the battlefield",
            },
        },
        spec: {
            cards: [
                { name: "Monk Realist", owner: "me", zone: "hand" },
                { name: "Glorious Anthem", owner: "opp", zone: "battlefield" },
                {
                    name: "Grizzly Bears",
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
        expect: { moves: [{ kind: "cast-spell", card: "Monk Realist" }] },
        note: "Issue #4895 (issue #4758 review), fixed by issue #4903: the Anthem pumps two opposing creatures; destroying it is the obvious play. The ETB's potential in hand was priced at a creature-sized Representative Victim (a 2/2) whatever its target type, above any enchantment it can hit, so the search passed on 5/5 seeds (material tie-break). With the victim typed — a representative enchantment, ~0.19 of a unit — 5/5 cast.",
    },
    {
        label: "granted flashback: casts Stingcaster Mage to flash back Lightning Bolt for lethal",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Stingcaster Mage", owner: "me", zone: "hand" },
                { name: "Lightning Bolt", owner: "me", zone: "graveyard" },
                // Issue #5083 — the opponent's lethal attacker. Without it a
                // pass lost nothing: the next turn's main phase held the same
                // cast for the same win, so the edges tied and the pick was
                // `material-tiebreak` by rollout order.
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            // The last main phase: Stingcaster Mage is a creature without
            // flash, castable in either main phase, so a precombat pass
            // reached the postcombat main with the same cast open (issue
            // #4981's shape).
            phase: "POSTCOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
            life: { me: 3, opp: 3 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Stingcaster Mage" }] },
        note: "Issue #4895 (issue #4758 review). The ETB grants the graveyard Bolt flashback (CR 702.34a); the Bolt is lethal. Re-cut on issue #5083 onto a position decided by mean reward: the last main phase, with the opponent's Hill Giant lethal on its own turn, so passing loses and only the cast wins. The hold-with-an-empty-graveyard half of the Snapcaster family is issue #4217.",
    },
    {
        label: "pay-to-keep ETB: holds Mold Demon with one Swamp",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "two more Swamps on the Bot's battlefield",
            },
        },
        spec: {
            cards: [
                { name: "Mold Demon", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Caves of Koilos", owner: "me", zone: "battlefield" },
                { name: "Caves of Koilos", owner: "me", zone: "battlefield" },
                { name: "Caves of Koilos", owner: "me", zone: "battlefield" },
                { name: "Caves of Koilos", owner: "me", zone: "battlefield" },
                { name: "Caves of Koilos", owner: "me", zone: "battlefield" },
                { name: "Caves of Koilos", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { forbidden: [{ kind: "cast-spell", card: "Mold Demon" }] },
        note: 'Issue #4895 (issue #4758 review). "Sacrifice it unless you sacrifice two Swamps": with one Swamp it cannot be kept, so casting throws the card away. Measured pass on 5/5 seeds. Its hand valuation still keeps the body (issue #4902).',
    },
    {
        label: "casts Solitude to exile a lethal attacker",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Solitude", owner: "me", zone: "hand" },
                { name: "Savannah Lions", owner: "me", zone: "hand" },
                {
                    name: "Serra Angel",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 5,
            libraryCount: 20,
            life: { me: 4 },
            activePlayer: "opp",
            priority: "me",
            combat: { attackers: ["Serra Angel"], confirmed: true },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "cast-spell", card: "Solitude" }] },
        note: "Issue #4895 (issue #4758 review). Serra Angel attacks for lethal; Solitude (flash) exiles it. Measured cast on 5/5 seeds. The in-flight valuation of its evoke sacrifice is issue #4901.",
    },
    {
        label: "evoke with no mana: evokes Solitude to exile a lethal attacker",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Solitude", owner: "me", zone: "hand" },
                { name: "Savannah Lions", owner: "me", zone: "hand" },
                {
                    name: "Serra Angel",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
            life: { me: 4 },
            activePlayer: "opp",
            priority: "me",
            combat: { attackers: ["Serra Angel"], confirmed: true },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Solitude" }],
        },
        note: "Issue #4895 (issue #4758 review), promoted by issue #4900: the pitch evoke (exile a white card) needs no mana, and it is the only way to survive. `enumerateMoves` used to reach a cast only through the PRINTED cost, so with zero lands it offered only `pass` and the Bot died; the card's own alternative costs are now re-entered through the same cast builder (`searchPayableOwnAlternativeCosts`).",
    },
    {
        label: "Fireblast with no mana open: sacrifices two Mountains for lethal",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "life",
                detail: "the opponent at more than 4 life",
            },
        },
        spec: {
            cards: [
                { name: "Fireblast", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
            life: { opp: 4 },
            activePlayer: "me",
            priority: "me",
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "cast-spell" &&
                move.alternativeCostId === "sacrifice-two-mountains",
            describe: "casts Fireblast by sacrificing two Mountains",
        },
        note: "Issue #4935 (issue #4900 review), a REACHABILITY entry — `predicate`, so it lowers to no Verdict and owes no weight refit: Fireblast's alternative cost is a PERMANENT leg (sacrifice two Mountains), which `searchPayableOwnAlternativeCosts` used to refuse, so with both Mountains tapped the Bot offered only `pass` and left four lethal damage in hand. `MoveMatcher` has no field for `alternativeCostId`, hence the predicate shape (as for overload / dash). The victims now ride on the Move (`castCostPicks.sacrificeIds`) and the search charges them (`applyAlternativeCostPermanentLegForSearch`).",
    },
    {
        label: "Fireblast with no mana open: keeps both Mountains with the opponent at 20",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "life",
                detail: "the opponent at 4 life or less",
            },
        },
        spec: {
            cards: [
                { name: "Fireblast", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
            life: { opp: 20 },
            activePlayer: "me",
            priority: "me",
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move) =>
                !(
                    move !== null &&
                    move.kind === "cast-spell" &&
                    move.alternativeCostId === "sacrifice-two-mountains"
                ),
            describe: "does not sacrifice two Mountains for four damage",
        },
        note: "Issue #5445, the other half of the lethal entry above: the whole mana base for four damage at 20 life. The leaf already priced it (`pass` 178.4 against 43 for the cast: hand 103.6 + lands 63.9 against the opponent's 32 life), yet the Bot cast on all five seeds through the material tie-break — the `pass` edge's subtree re-offered the same cast at every later decision (including the self-targeted one) and the flat reward band let UCB keep opening them, so `pass`'s mean margin (-13.7) read below the cast's (+26.0). `isManaBaseSacrificeCast` now keeps the cast out of the rollout and of the tree below the root; the root still weighs it, which is what the lethal half above pins. `predicate` for the same reason as the lethal entry (`MoveMatcher` has no `alternativeCostId` field), so the two are a pair in substance but cannot be declared one: `pairOf` needs both halves to lower to a Verdict.",
    },
    {
        label: "hybrid evoke: evokes Wistfulness on two Forests to exile an opposing artifact",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "no opposing artifact or enchantment on the battlefield",
            },
        },
        spec: {
            cards: [
                { name: "Wistfulness", owner: "me", zone: "hand" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Sol Ring", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "stretch",
        expect: { moves: [{ kind: "cast-spell", card: "Wistfulness" }] },
        note: 'Issue #4934: the evoke cost `{G/U}{G/U}` is two HYBRID pips. `planManaPayment` ignored the `"G/U"` key (an empty plan) and `searchPayableOwnAlternativeCosts` failed closed on a hybrid leg, so the Bot could not evoke the ECL trio at all; the printed `{3}{G/U}{G/U}` cast was offered on three Forests with the hybrid pips unpaid. Two Forests pay the evoke (`{G}{G}` spent, so the ETB exiles Sol Ring). STRETCH, measured: the move is now ENUMERATED with a two-land tap plan (pinned by `own-alternative-cost-cast.bot.test.ts`), but the search passes on 5/5 seeds — whether trading the card for the exile is worth it is a valuation question, not this issue\'s.',
    },
    // Issue #4217 (founding case of PRD #4754) — Snapcaster Mage. A
    // DISCRIMINATING PAIR on one board: the only difference is whether the
    // graveyard holds a sorcery worth flashing back. Then the reported position
    // itself, rebuilt from the bug report's game state.
    {
        label: "Snapcaster Mage: holds it in its own main phase with an empty graveyard",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "Flame Slash in the graveyard and an opposing Serra Angel to kill",
            },
        },
        spec: {
            cards: [
                { name: "Snapcaster Mage", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                {
                    name: "Serra Angel",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Snapcaster Mage" }],
        },
        note: "Issue #4217 — the hold half. Snapcaster Mage's ETB has nothing to grant flashback to, so casting it in its own main phase spends its ETB Ability (issue #4758) for a vanilla 2/1 and gives up Flash's later window. Measured `pass` on ten seeds before and after this change; the half that discriminates is the Flame Slash entry below.",
    },
    {
        label: "Snapcaster Mage: casts it to flash back a sorcery that kills a Serra Angel",
        pairOf: {
            anchor: "Snapcaster Mage: holds it in its own main phase with an empty graveyard",
            discriminant: {
                kind: "card",
                detail: "Flame Slash in the graveyard and an opposing Serra Angel to kill",
            },
        },
        spec: {
            cards: [
                { name: "Snapcaster Mage", owner: "me", zone: "hand" },
                { name: "Flame Slash", owner: "me", zone: "graveyard" },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Island", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                {
                    name: "Serra Angel",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "cast-spell", card: "Snapcaster Mage" }],
        },
        note: "Issue #4217 — the cast half. Flame Slash is a sorcery: flashback changes only the zone and the cost (CR 702.34a) and a noninstant spell still needs a main phase with an empty stack (CR 117.1a), so the ETB's payoff exists only in this main phase. The search already preferred the cast; `last-window-deferral` held it on every seed, reading the Mage as a flash body that could wait for the opponent's end step. What keeps it green is `waitsUnchanged`'s sorcery-cast reading — a resolution that opens a cast only this sorcery window allows does not reach the same board later. Proof of failure: dropping that reading turns this entry red (`pass` on four of the five seeds).",
    },
    {
        label: "Snapcaster Mage (issue #4217 reported position): holds it on turn 4 with an empty graveyard",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an instant or sorcery worth flashing back in the graveyard",
            },
        },
        spec: {
            // Rebuilt from the bug report's state (one turn later, the Mage on
            // the battlefield): the Bot's Island + Plains untapped and the land
            // drop spent, its hand as reported, the opponent's earthbent Hedge
            // Maze and Badgermole Cub.
            cards: [
                { name: "Island", owner: "me" },
                { name: "Plains", owner: "me", summoningSick: true },
                { name: "Snapcaster Mage", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "hand" },
                { name: "Psychic Frog", owner: "me", zone: "hand" },
                { name: "Show and Tell", owner: "me", zone: "hand" },
                { name: "Brazen Borrower", owner: "me", zone: "hand" },
                { name: "Subtlety", owner: "me", zone: "hand" },
                { name: "Remand", owner: "me", zone: "hand" },
                {
                    name: "Hedge Maze",
                    owner: "opp",
                    counters: { "+1/+1": 1 },
                    animated: {
                        power: 0,
                        toughness: 0,
                        grantedAbilities: ["haste"],
                    },
                },
                { name: "Island", owner: "opp" },
                { name: "Badgermole Cub", owner: "opp" },
                { name: "Verdant Catacombs", owner: "opp", zone: "graveyard" },
                // The opponent's five hidden cards. The live Bot sees them as
                // identity-free placeholders (`state-adapter.ts`), but a blade
                // position must load into a live game (issue #1432), so no
                // `hiddenHand`; and the report's real cards would hand the
                // search identities it never saw (its Sink into Stupor gains a
                // target the moment the Mage enters). Basic lands stand in as
                // slots whose value no board changes.
                { name: "Forest", owner: "opp", zone: "hand", count: 5 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            life: { me: 20, opp: 19 },
            activePlayer: "me",
            priority: "me",
            landsPlayed: { me: 1 },
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 1000 },
        // Seeds 5, 9 and 14 cast the Mage under the flat cast-permission
        // price (3/20 at 500 iterations); 0/20 after. Issue #4931's refit
        // moved the margin back inside the rollout noise at 500 (seed 9 cast,
        // 1/20; 0/20 under the previous weights): at 1000 iterations 0/20.
        seeds: [0xb1ade, 5, 9, 14],
        tier: "must",
        expect: {
            forbidden: [{ kind: "cast-spell", card: "Snapcaster Mage" }],
        },
        note: "Issue #4217 — the founding position (user on `hard`). A one-card cast permission was priced at the flat `GRANT_CAST_VALUE` (20), so Snapcaster Mage in hand read below its body on the battlefield and the leaf evaluation scored the cast above holding; priced at the fitted `latent.cardAdvantage` unit, holding leads. The search's own cast-over-pass margin then falls inside `OUTCOME_EPS` (0.05) and `last-window-deferral` keeps the Mage for a later window — so a refit that widens that margin past the band reds this entry by drift, not by regression; the leaf ordering itself is pinned by the Eval Pair in `etbAbility.bot.test.ts`. Measured at 500 iterations over 20 seeds: 3 casts before, 0 after (at 400: 15/20 before, 10/20 after — rollout noise the budget here clears). Issue #4931's refit (a cast sorcery keeps its mana value on the curve) put 1/20 casts back at 500 — the drift this note predicts — so the budget is 1000 (0/20), not a seed dropped.",
    },
    {
        // STANDING ABILITY OF A NON-CREATURE PERMANENT (issue #5145) — the
        // opponent's two artifacts are the same mana value, and one is
        // Nevinyrral's Disk (a board wipe on a stick), the other a Weakstone.
        // A Shatter in hand is plainly better spent on the Disk.
        //
        // WHY IT WAS WRONG. `latentValue` read a non-creature's SPELL script
        // and dropped its activated/triggered ability scripts, so both
        // artifacts stood at the same blind `base + MV` floor — and the
        // removal lens (`permanentRealisedValue`) priced destroying either at
        // the same number. The pick was the Weakstone on every seed.
        //
        // WHY THIS PAIR AND NOT THE #4141 SLICE. When this entry landed,
        // Black Vise, Ivory Tower, Stasis and the rest of that slice read
        // BELOW their `base + MV` floor (a context-free value of a symmetric
        // tax or lock is small or negative; an upkeep trigger was priced as
        // firing once), and for such a script the floor is uplift-only — so
        // the ability reading never moved them. The Disk was the first
        // artifact whose ability script outran the floor. The recurrence
        // multiplier (issue #5151) since lifted Black Vise above it: the next
        // entry is the slice's own.
        label: "removal: Shatter takes the artifact whose ability script outranks its floor (issue #5145)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Mountain",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Shatter", owner: "me", zone: "hand" },
                { name: "Weakstone", owner: "opp", zone: "battlefield" },
                {
                    name: "Nevinyrral's Disk",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Shatter",
                    target: "Nevinyrral's Disk",
                },
            ],
        },
        note: "Issue #5145. Measured at 400 iterations over 20 seeds with the two artifacts in either listing order: Weakstone 20/20 before the change, the Disk 20/20 after. Proof of failure: removing the standing-ability reading from the non-creature branch of `latentValue` (`cardValue.ts`) turns this entry red on every seed.",
    },
    {
        // RECURRING STANDING TRIGGER (issue #5151) — the opponent's two
        // artifacts are both MV 1: Black Vise (up to 4 damage EVERY upkeep,
        // for as long as it stays) and Bear Trap (its one ability sacrifices
        // the Trap as its cost, which the standing reading excludes — issue
        // #5145 — so it sits at the `base + MV` floor). A Disenchant in hand
        // is plainly better spent on the Vise.
        //
        // WHY IT WAS WRONG. The standing reading (issue #5145) priced an
        // upkeep trigger as if it fired ONCE: Black Vise's shadow script read
        // 12.7 against a floor of 18, so the floor won and both artifacts
        // stood at the same 18 — the removal lens (`permanentRealisedValue`)
        // priced destroying either identically, and the pick fell to rollout
        // noise. This is the #4141 slice's discriminating pair that issue
        // #5145 could not carry: with `latent.recurrence` the Vise's stream is
        // worth its expected firings and outruns the floor.
        label: "removal: Disenchant takes the artifact whose per-turn trigger outranks its floor (issue #5151)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                // The floor artifact is listed FIRST on purpose: in the tie
                // this entry guards against, listing order is part of what
                // decides the pick, and this is the order the tie lost on
                // most (6/20 Vise against 10/20 with the Vise first).
                { name: "Bear Trap", owner: "opp", zone: "battlefield" },
                { name: "Black Vise", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Black Vise",
                },
            ],
        },
        note: "Issue #5151. Measured at 400 iterations over 20 seeds: with `latent.recurrence` forced to 1 (the pre-#5151 reading) the Vise is taken 6/20 in this listing order (10/20 with the Vise listed first; the rest Bear Trap or a pass — the tie), 20/20 in either order with the multiplier. Proof of failure: dropping Black Vise's `aiEffects` shadow (`lea/colorless.cards.ts`) puts it back at the floor and turns this entry red — the criterion issue #4141 waived, discharged here. Re-proved after ADR 0151's slices (issue #5165; `fit:weights` left the committed vector unchanged, no weight edit): the Vise 20/20 over 20 seeds; with the shadow dropped, Bear Trap 10, the Vise 7, a pass 3 — red on the declared seeds.",
    },
    {
        // RESTRICTION PRICING (CR 508.1c, issue #5154). The bot holds
        // Disenchant with two untapped Plains; the opponent has a Moat and a
        // Rocket Launcher (a 4-MV artifact whose one-turn ping script prices
        // it ABOVE a plain 4-drop) at 20 life; the bot's board is three
        // Grizzly Bears, summoning sick, grounded by the Moat. Disenchant the
        // Moat and six power attacks every turn from the next one on;
        // Disenchant the Launcher and the Bears never attack.
        //
        // What it guards is the SOURCE reading of a restriction: the Moat is
        // worth what it takes from the bot's creatures, so the removal lens
        // (`permanentRealisedValue`) ranks it above an artifact of the same
        // mana value with a script. The Bears are summoning sick ON PURPOSE:
        // with lethal in reach this turn the search finds the Moat through
        // the attack it frees with no pricing at all (measured 20/20 either
        // way), and the entry would guard nothing. With the attack beyond the
        // horizon, only the lens separates the two targets.
        label: "restriction pricing: Disenchant takes the Moat grounding three Bears, not the 4-MV artifact with a script (issue #5154)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Moat grounding the bot's otherwise-lethal attackers",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                ...Array.from({ length: 3 }, () => ({
                    name: "Grizzly Bears",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    summoningSick: true,
                })),
                { name: "Moat", owner: "opp", zone: "battlefield" },
                { name: "Rocket Launcher", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Moat",
                },
            ],
        },
        note: "Issue #5154. Guards `restrictionSourceWorth` (`ai/restrictionPricing.ts`): the Moat's standing worth is the attack share it takes from the three Bears, read by `permanentRealisedValue` and the board term alike. Measured at 400 iterations over 20 seeds: the Moat 20/20 with the pricing; with `creatureRestrictionDiscount` and `restrictionSourceWorth` returning 0, the Launcher 20/20 (a plain Mightstone in its place was NOT discriminating — 20/20 Moat either way, the rollouts reach the freed attack; a scriptless Jayemdae Tome tied at 16/20).",
    },
    {
        // Issue #5163 (ADR 0151) — a SYMMETRIC lock read by Differential
        // Reading. The bot holds Disenchant with five Plains against two
        // Mountains, a Winter Orb and a Tawnos's Weaponry (a 2-MV artifact
        // the Op vocabulary reads at its floor). The Orb locks four of the
        // bot's five lands and one of the opponent's two: on THIS board it is
        // the opponent's weapon, and both the leaf and the removal lens
        // (`permanentRealisedValue`) rank it above the artifact of the same
        // mana value only through the mana axis of the restriction pricing
        // (`ai/restrictionPricing.ts`). Without it the Orb is a generic
        // 2-mana artifact and the Weaponry wins.
        label: "symmetric lock: Disenchant takes the Winter Orb that locks more of the bot's lands, not the 2-MV artifact (issue #5163)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Winter Orb on a board where the bot has more lands",
            },
        },
        spec: {
            cards: [
                // The Orb's steady state: two Plains open (the one it
                // untapped and one held back), three held down.
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                ...Array.from({ length: 3 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: true,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                ...Array.from({ length: 2 }, () => ({
                    name: "Mountain",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: true,
                })),
                { name: "Winter Orb", owner: "opp", zone: "battlefield" },
                {
                    name: "Tawnos's Weaponry",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Winter Orb",
                },
            ],
        },
        note: "Issue #5163. Guards the mana axis of the restriction pricing (`ai/restrictionPricing.ts`): the Orb takes the renewals of four of the bot's five lands and one of the opponent's two, counted once on the restricted side's `mana` term and read by the removal lens through `standingLockMargin`. Board in the lock's steady state (lands held down). Measured at 400 iterations over 20 seeds: the Orb 20/20; with the mana axis off (`buildManaLocks` empty), Tawnos's Weaponry 20/20. With only the lens netting off the Orb still wins 20/20 — the search reads the recovered renewals at the leaf.",
    },
    {
        label: "pay-to-untap escape: Disenchant takes the Thelon's Curse that holds the bot's tapped blue creature when the bot has no blue source (issue #5568)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                {
                    name: "Water Elemental",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                },
                { name: "Disenchant", owner: "me", zone: "hand" },
                { name: "Thelon's Curse", owner: "opp", zone: "battlefield" },
                {
                    name: "Tawnos's Weaponry",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                matchesMove(state, move, {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Thelon's Curse",
                }),
            describe: "Disenchant is cast on Thelon's Curse",
        },
        note: "Issue #5568. Guards the escape reading of `ai/restrictionPricing.ts`: with no blue source the {U} buy-out is unpayable, so the Curse holds the 5/4 whole and the removal lens ranks it above the 2-MV artifact. Discriminating pair with the next entry. A `predicate` entry, not `moves`: the escape is a pricing rule, not a weight, so no refit is owed.",
    },
    {
        label: "pay-to-untap escape: Disenchant leaves the Thelon's Curse the bot can pay out of and takes the artifact (issue #5568)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                // A blue source in the mana base: it untaps before the upkeep
                // Thelon's Curse's {U} is paid in.
                {
                    name: "Island",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                },
                {
                    name: "Water Elemental",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                },
                { name: "Disenchant", owner: "me", zone: "hand" },
                { name: "Thelon's Curse", owner: "opp", zone: "battlefield" },
                {
                    name: "Tawnos's Weaponry",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                matchesMove(state, move, {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Tawnos's Weaponry",
                }),
            describe: "Disenchant is cast on Tawnos's Weaponry",
        },
        note: "Issue #5568. The same board with one tapped Island added: the controller pays {U} at upkeep, the Curse holds nothing and reads at its floor, so the 2-MV artifact outranks it. Without the escape reading this board is identical to the previous entry and the Curse is taken.",
    },
    {
        // SYMMETRIC ENGINE (issue #5164, ADR 0151). The bot holds Disenchant
        // with two untapped Plains and seven Grizzly Bears beside it; the
        // opponent holds ONE card and controls a Howling Mine and an
        // Aeolipile (2 MV, its one ability sacrifices it as its cost, which
        // the standing reading excludes — issue #5145 — so it sits at the
        // `base + MV` floor). Every player draws an extra card off the Mine,
        // but the bot's hand is full: its extra card is discarded at cleanup
        // (CR 514.1) or replaces a better one, while the opponent's lands in
        // an empty hand. The Mine is the opponent's engine; Disenchant it.
        //
        // WHY IT WAS WRONG. The Mine's trigger acts on whichever player's
        // draw step it is, and the standing reading valued it ONCE, as "its
        // controller draws a card" times the recurrence — the same extra card
        // on every board. Read from the bot's seat that was a gift both
        // players share; the removal lens priced the Mine at its floor-like
        // context-free number, and nothing said the opponent was the one fed.
        label: "symmetric engine: Disenchant takes the Howling Mine that feeds the opponent's empty hand, not the 2-MV artifact (issue #5164)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Howling Mine whose extra draw only the opponent has room in hand for",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                ...Array.from({ length: 7 }, () => ({
                    name: "Grizzly Bears",
                    owner: "me" as const,
                    zone: "hand" as const,
                })),
                { name: "Grizzly Bears", owner: "opp", zone: "hand" },
                // Both libraries hold spells beside the filler basics, so the
                // extra card a turn is worth having (`drawUnits` reads the
                // library's mean card); the same mix on both sides — what
                // separates the players is the room in hand.
                ...(["me", "opp"] as const).flatMap((owner) =>
                    Array.from({ length: 10 }, () => ({
                        name: "Grizzly Bears",
                        owner,
                        zone: "library" as const,
                    }))
                ),
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Howling Mine", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Howling Mine",
                },
            ],
        },
        note: "Issue #5164. The anchor reading of the Howling Mine positions (two unpaired `conditional` Test Positions — the hands differ by more than one Discriminant, so no `pairOf`): the Mine is worth what each player's extra draw is worth to that player (`EachPlayerSide.drawUnits`, `ai/latentBoard.ts`), the opponent's minus the bot's, read on the board face (`standingEngineLens`, `evaluate.ts`). Measured at 400 iterations over 20 seeds: the Mine 20/20. NOT discriminating on its own — with `eachStepDifferentialValue` returning undefined (the netting skipped) the Mine still 20/20; the mirror entry below is the one that reds.",
    },
    {
        // SYMMETRIC ENGINE, MIRROR (issue #5164, ADR 0151) — the board above
        // with the hands swapped: the bot holds Disenchant alone, the
        // opponent seven cards. Now the opponent's Howling Mine feeds the
        // BOT — its extra card lands in an empty hand, the opponent's is
        // discarded at cleanup (CR 514.1) or replaces a worse one — so
        // destroying it is destroying the bot's own engine.
        //
        // This is the position that discriminates: read once as "its controller
        // draws" (the pre-#5164 reading), the Mine is worth an extra card a
        // turn to the opponent on every board and Disenchant takes it 20/20
        // here exactly as above.
        label: "symmetric engine: Disenchant leaves the Howling Mine that feeds the bot's empty hand (issue #5164)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Howling Mine whose extra draw only the bot has room in hand for",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                ...Array.from({ length: 7 }, () => ({
                    name: "Grizzly Bears",
                    owner: "opp" as const,
                    zone: "hand" as const,
                })),
                ...(["me", "opp"] as const).flatMap((owner) =>
                    Array.from({ length: 10 }, () => ({
                        name: "Grizzly Bears",
                        owner,
                        zone: "library" as const,
                    }))
                ),
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Howling Mine", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            forbidden: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Howling Mine",
                },
            ],
        },
        note: "Issue #5164. The discriminating position (the entry above is the anchor reading). Guards `eachStepDifferentialValue` (`ai/opValuers.ts`) and the measured reading's sign (`latentValue`'s `dslStandingAbilityMeasured`, `cardValue.ts`). Measured at 400 iterations over 20 seeds: the Mine never (pass 12, Aeolipile 8). Before issue #5164 (\"its controller draws\" read context-free): Disenchant on the Mine 20/20. Proof of failure — `eachStepDifferentialValue` returning undefined (the netting skipped): the Mine 7/20.",
    },
    {
        // SYMMETRIC LIFE ENGINE (issue #5574, ADR 0151). The bot holds
        // Disenchant with two untapped Plains beside four Swamps; the opponent
        // controls four Forests, an Aeolipile (2 MV, at its floor — issue
        // #5145) and a Karma. Karma deals each player, on their upkeep, damage
        // equal to the Swamps THAT player controls: 4 a turn to the bot,
        // nothing to the opponent. The opponent's Karma is a burn engine
        // pointed at the bot; Disenchant it.
        label: "symmetric life engine: Disenchant takes the Karma burning the bot's Swamps, not the 2-MV artifact (issue #5574)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Karma whose damage lands only on the bot's Swamps",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                ...Array.from({ length: 4 }, () => ({
                    name: "Swamp",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                })),
                ...Array.from({ length: 4 }, () => ({
                    name: "Forest",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "opp", zone: "hand" },
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Karma", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Karma",
                },
            ],
        },
        note: "Issue #5574. The anchor reading of the Karma positions (two unpaired `conditional` Test Positions — the battlefields differ by more than one Discriminant, so no `pairOf`): each upkeep's damage is grounded on that player's own Swamps (`stepSideLife`, `ai/opValuers.ts`) and priced at `lifeSwing`, the opponent's loss minus the bot's. Measured at 400 iterations over 20 seeds: Karma 20/20. NOT discriminating on its own — before issue #5574, and with `eachStepDifferentialValue` returning undefined, Karma is still 20/20; the mirror entry below is the one that reds.",
    },
    {
        // SYMMETRIC LIFE ENGINE, MIRROR (issue #5574, ADR 0151) — the board
        // above with the Swamps and Forests swapped: now the opponent's Karma
        // deals 4 a turn to the OPPONENT and nothing to the bot, so
        // destroying it is destroying the bot's own clock. Read as "its
        // controller deals damage to the opponent" (the representative walk
        // before issue #5574), Karma is a threat on every board and
        // Disenchant takes it here as above.
        label: "symmetric life engine: Disenchant leaves the Karma burning the opponent's Swamps (issue #5574)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Karma whose damage lands only on the opponent's Swamps",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                ...Array.from({ length: 4 }, () => ({
                    name: "Forest",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                })),
                ...Array.from({ length: 4 }, () => ({
                    name: "Swamp",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "opp", zone: "hand" },
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Karma", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            forbidden: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Karma",
                },
            ],
        },
        note: "Issue #5574. The discriminating position (the entry above is the anchor reading). Guards `eachStepDifferentialValue`'s life pricing (`stepSideLife`, `ai/opValuers.ts`) and the side grounding of a count over `$event.activePlayerId` (`groundCount`, `ai/latentBoard.ts`). Measured at 400 iterations over 20 seeds: Karma never (Aeolipile 20). Before issue #5574: Disenchant on Karma 17/20. Proof of failure — `eachStepDifferentialValue` returning undefined (the netting skipped): Karma 14/20.",
    },
    {
        // EACH-STEP EDICT (issue #5575, ADR 0151) — the opponent's
        // Destructive Flow has the player whose upkeep it is sacrifice a
        // nonbasic land (CR 701.21a: each player its own). The bot's two lands
        // are Tundras, the opponent's three are Plains: the Flow takes a land
        // from the bot every turn and never one from the opponent, so it is
        // the permanent Disenchant should answer, not the Aeolipile.
        label: "each-step edict: Disenchant takes the Destructive Flow that eats only the bot's nonbasic lands, not the 2-MV artifact (issue #5575)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Destructive Flow only the bot has nonbasic lands for",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Tundra",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                ...Array.from({ length: 3 }, () => ({
                    name: "Plains",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Destructive Flow", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Destructive Flow",
                },
            ],
        },
        note: "Issue #5575. The anchor reading of the Destructive Flow pair (two unpaired `conditional` Test Positions — the lands differ on both sides, so no `pairOf`): the Flow is worth what each player's upkeep edict takes from that player (`EachPlayerSide.sacrificeUnits`, `ai/latentBoard.ts`), the opponent's minus the bot's, read on the board face (`standingEngineLens`, `evaluate.ts`). Measured at 400 iterations over 20 seeds: the Flow 20/20. NOT discriminating on its own — before issue #5575 (the edict read once, as removal aimed at the controller's opponent) the Flow is 20/20 here too; the mirror entry below is the one that reds.",
    },
    {
        // EACH-STEP EDICT, MIRROR (issue #5575, ADR 0151) — the board above
        // with the lands swapped: the bot's two lands are Plains, the
        // opponent's three Tundras. Now the opponent's Destructive Flow eats
        // the OPPONENT's mana base and never the bot's, so destroying it
        // gives the opponent its lands back.
        //
        // This is the position that discriminates: read once as an edict on
        // the controller's opponent (the pre-#5575 representative walk), the
        // Flow carries the same positive sign for its controller on every
        // board and Disenchant takes it 20/20 here exactly as above.
        label: "each-step edict: Disenchant leaves the Destructive Flow that eats only the opponent's nonbasic lands (issue #5575)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Destructive Flow only the opponent has nonbasic lands for",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                ...Array.from({ length: 3 }, () => ({
                    name: "Tundra",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Destructive Flow", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            forbidden: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Destructive Flow",
                },
            ],
        },
        note: "Issue #5575. The discriminating position (the entry above is the anchor reading). Guards the edict branch of `eachStepDifferentialValue` (`sideEdictLoss`, `ai/opValuers.ts`) and the widened read-nothing rule (`isEachStepScopedScript`, `cardScriptValue.ts`). Measured at 400 iterations over 20 seeds: the Flow never (Aeolipile 20). Before issue #5575: Disenchant on the Flow 20/20. Proof of failure — the per-side edict loss skipped (`valueOp` on each side's `sacrifice`, the representative edict): the Flow 20/20.",
    },
    {
        // EACH-STEP MANA (issue #5626, ADR 0151) — the opponent's Eladamri's
        // Vineyard has the player whose first main phase it is add {G}{G}.
        // The bot holds a Craw Wurm ({4}{G}{G}) its four lands cannot cast
        // alone; the opponent's hand is empty. The Vineyard ramps only the
        // bot, so Disenchant answers the Aeolipile and leaves the Vineyard
        // standing.
        label: "each-step mana: Disenchant leaves the Eladamri's Vineyard that ramps only the bot into its Craw Wurm (issue #5626)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an Eladamri's Vineyard only the bot's hand can spend",
            },
        },
        spec: {
            cards: [
                {
                    name: "Plains",
                    owner: "me",
                    zone: "battlefield",
                    tapped: false,
                },
                ...Array.from({ length: 3 }, () => ({
                    name: "Forest",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                { name: "Craw Wurm", owner: "me", zone: "hand" },
                ...Array.from({ length: 4 }, () => ({
                    name: "Forest",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                {
                    name: "Eladamri's Vineyard",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Aeolipile",
                },
            ],
        },
        note: "Issue #5626. The anchor reading of the Eladamri's Vineyard pair (two unpaired `conditional` Test Positions — the hands differ on both sides, so no `pairOf`): the Vineyard is worth to each player the extra mana its hand spends beyond its own mana base (`EachPlayerSide.manaUnits`, `ai/latentBoard.ts`), the opponent's minus the bot's, read on the board face (`standingEngineLens`, `evaluate.ts`). Measured at 400 iterations over 20 seeds: the Aeolipile 20/20. NOT discriminating on its own — before issue #5626 (the Vineyard read nothing, ADR 0151 §1) the Aeolipile is 20/20 here too; the mirror entry below is the one that reds.",
    },
    {
        // EACH-STEP MANA, MIRROR (issue #5626, ADR 0151) — the board above
        // with the hands swapped: the bot holds a Grizzly Bears its lands
        // already cast, the opponent the Craw Wurm its four Forests cannot.
        // Now the Vineyard ramps only the opponent, into a 6/4 on its next
        // main phase: Disenchant spent on the Aeolipile leaves it standing.
        //
        // This is the position that discriminates: read as nothing (the
        // pre-#5626 Latent Floor, the same on every board), the Vineyard is
        // no threat and Disenchant takes the Aeolipile.
        label: "each-step mana: Disenchant does not spend itself on the Aeolipile while the Eladamri's Vineyard ramps only the opponent (issue #5626)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an Eladamri's Vineyard only the opponent's hand can spend",
            },
        },
        spec: {
            cards: [
                {
                    name: "Plains",
                    owner: "me",
                    zone: "battlefield",
                    tapped: false,
                },
                ...Array.from({ length: 3 }, () => ({
                    name: "Forest",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
                ...Array.from({ length: 4 }, () => ({
                    name: "Forest",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Craw Wurm", owner: "opp", zone: "hand" },
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                {
                    name: "Eladamri's Vineyard",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            forbidden: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Aeolipile",
                },
            ],
        },
        note: "Issue #5626. The discriminating position (the entry above is the anchor reading). Guards the mana branch of `eachStepDifferentialValue` (`stepSideMana`, `ai/opValuers.ts`) and its side reader (`EachPlayerSide.manaUnits`, `ai/latentBoard.ts`). Measured at 400 iterations over 20 seeds: the Aeolipile never (Disenchant on the Vineyard 10, pass 10). Before issue #5626 (the family read nothing): Disenchant on the Aeolipile 11/20, on seeds 0xb1ade and 2 of this entry's four. Proof of failure — the side reader skipped (`valueOp` on each side's `addMana`, the representative ramp): the Aeolipile on seeds 0xb1ade and 2.",
    },
    {
        // EACH-STEP RANDOM DISCARD (issue #5624, ADR 0151) — the opponent's
        // Bottomless Pit has the player whose upkeep it is discard a card at
        // random (CR 701.9b). The bot holds four cards beside Disenchant, the
        // opponent none: the Pit takes a card from the bot every turn and
        // nothing from the opponent, so it is the permanent Disenchant should
        // answer, not the Aeolipile.
        label: "each-step random discard: Disenchant takes the Bottomless Pit that empties only the bot's hand, not the 2-MV artifact (issue #5624)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Bottomless Pit only the bot has cards in hand for",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "hand",
                    count: 4,
                },
                ...Array.from({ length: 3 }, () => ({
                    name: "Swamp",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Bottomless Pit", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Bottomless Pit",
                },
            ],
        },
        note: "Issue #5624. The anchor reading of the Bottomless Pit pair (two unpaired `conditional` Test Positions — the hands differ on both sides, so no `pairOf`): the Pit is worth what each player's upkeep discard at random takes from that player's hand (`EachPlayerSide.randomDiscardUnits`, `ai/latentBoard.ts`), the opponent's minus the bot's. Measured at 400 iterations over 20 seeds: the Pit 20/20. Proof of failure — the side reader skipped (`stepSideRandomDiscard` reading 0 units): Aeolipile 20/20. Before issue #5624 (the family read nothing, its Latent Floor) the Pit is 20/20 here too; the mirror entry below is the one that reds on that.",
    },
    {
        // EACH-STEP RANDOM DISCARD, MIRROR (issue #5624, ADR 0151) — the
        // board above with the hands swapped: the bot holds only Disenchant,
        // the opponent four cards. The opponent's Bottomless Pit now strips
        // the OPPONENT's hand and never the bot's, so destroying it gives the
        // opponent its cards back.
        //
        // This is the position that discriminates against the pre-#5624
        // reading: unread, the Pit keeps its Latent Floor — a positive worth
        // for its controller on every board — and Disenchant takes it.
        label: "each-step random discard: Disenchant leaves the Bottomless Pit that empties only the opponent's hand (issue #5624)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Bottomless Pit only the opponent has cards in hand for",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                ...Array.from({ length: 3 }, () => ({
                    name: "Swamp",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "hand",
                    count: 4,
                },
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Bottomless Pit", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            forbidden: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Bottomless Pit",
                },
            ],
        },
        note: "Issue #5624. The discriminating position (the entry above is the anchor reading). Guards the discard-at-random branch of `eachStepDifferentialValue` (`isStepSideOp`, `stepSideRandomDiscard`, `ai/opValuers.ts`). Measured at 400 iterations over 20 seeds: the Pit never (Aeolipile 20). Proof of failure — `isStepSideOp` refusing `discardAtRandom` (the pre-#5624 read-nothing): Disenchant on the Pit 14/20.",
    },
    {
        // EACH-STEP DIG (issue #5627, ADR 0151) — the opponent's Oath of
        // Druids has the player whose upkeep it is, if an opponent controls
        // more creatures than it does (CR 603.3d: else no legal target), dig
        // its library for a creature onto the battlefield (CR 603.5: a
        // "may"). The bot controls two Grizzly Bears, the opponent none and
        // four Craw Wurms in its library: the Oath feeds the opponent every
        // upkeep and never the bot, so it is the permanent Disenchant should
        // answer, not the Aeolipile.
        label: "each-step dig: Disenchant takes the Oath of Druids that digs only the opponent's Craw Wurms, not the 2-MV artifact (issue #5627)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an Oath of Druids only the opponent is out-creatured for",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                ...Array.from({ length: 2 }, () => ({
                    name: "Grizzly Bears",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                ...Array.from({ length: 3 }, () => ({
                    name: "Forest",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Oath of Druids", owner: "opp", zone: "battlefield" },
                ...Array.from({ length: 4 }, () => ({
                    name: "Craw Wurm",
                    owner: "opp" as const,
                    zone: "library" as const,
                })),
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Oath of Druids",
                },
            ],
        },
        note: "Issue #5627. The anchor reading of the Oath of Druids pair (two unpaired `conditional` Test Positions — the creatures and libraries differ on both sides, so no `pairOf`): the Oath is worth what each player's upkeep dig puts onto its battlefield, less the milled prefix (`EachPlayerSide.digUnits`, `ai/latentBoard.ts`), on the side an opponent out-creatures (`stepTargetHolds`) and only when that player gains by it (`stepSideMayArm`, `ai/opValuers.ts`), the opponent's minus the bot's, read on the board face (`standingEngineLens`, `evaluate.ts`). Measured at 400 iterations over 20 seeds: the Oath 20/20. NOT discriminating on its own — before issue #5627 (the family read nothing, ADR 0151 §1) the Oath is 20/20 here too; the mirror entry below is the one that reds.",
    },
    {
        // EACH-STEP DIG, MIRROR (issue #5627, ADR 0151) — the board above
        // with the creatures swapped: the opponent controls the two Grizzly
        // Bears, the bot none and the four Craw Wurms in its library. Now the
        // opponent's Oath of Druids digs a Craw Wurm for the BOT every upkeep
        // and never for the opponent, so destroying it takes the bot's engine
        // away.
        //
        // This is the position that discriminates: read as nothing (the
        // pre-#5627 read-nothing rule), the Oath keeps its Latent Floor and
        // Disenchant takes it 20/20 here exactly as above.
        label: "each-step dig: Disenchant leaves the Oath of Druids that digs only the bot's Craw Wurms (issue #5627)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an Oath of Druids only the bot is out-creatured for",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                ...Array.from({ length: 4 }, () => ({
                    name: "Craw Wurm",
                    owner: "me" as const,
                    zone: "library" as const,
                })),
                ...Array.from({ length: 3 }, () => ({
                    name: "Forest",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                ...Array.from({ length: 2 }, () => ({
                    name: "Grizzly Bears",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Oath of Druids", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            forbidden: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Oath of Druids",
                },
            ],
        },
        note: "Issue #5627. The discriminating position (the entry above is the anchor reading). Guards the dig branch of `eachStepDifferentialValue` (`stepSideDig`, `stepSideMayArm`, `ai/opValuers.ts`) and its side reader (`EachPlayerSide.digUnits`, `ai/latentBoard.ts`). Measured at 400 iterations over 20 seeds: the Oath never (Aeolipile 20). Before issue #5627 (the family read nothing): Disenchant on the Oath 20/20. Proof of failure — the family left unread (`isStepSideOp` refusing `revealUntilMatch`): Disenchant on the Oath 20/20.",
    },
    {
        // EACH-STEP RETURN TO HAND (issue #5628, ADR 0151) — the opponent's
        // Sunken Hope has the player whose upkeep it is return a creature it
        // controls to its owner's hand. The bot controls a Grizzly Bears, the
        // opponent no creature: the Hope bounces the bot's body every turn
        // and nothing of the opponent's, so it is the permanent Disenchant
        // should answer, not the Aeolipile.
        label: "each-step return to hand: Disenchant takes the Sunken Hope that bounces only the bot's creature, not the 2-MV artifact (issue #5628)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Sunken Hope only the bot has a creature for",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                ...Array.from({ length: 3 }, () => ({
                    name: "Island",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Sunken Hope", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Sunken Hope",
                },
            ],
        },
        note: "Issue #5628. The anchor reading of the Sunken Hope pair (two unpaired `conditional` Test Positions — the creatures differ on both sides, so no `pairOf`): the Hope is worth what each player's upkeep bounce takes from that player, its cheapest creature net of its worth back in hand (`EachPlayerSide.bounceUnits`, `ai/latentBoard.ts`), the opponent's minus the bot's. Measured at 400 iterations over 20 seeds: the Hope 20/20. Proof of failure — the side reader skipped (`sideBounceLoss` reading 0 units): Aeolipile 20/20. Before issue #5628 (the family read nothing, its Latent Floor) the Hope is 20/20 here too; the mirror entry below is the one that reds on that.",
    },
    {
        // EACH-STEP RETURN TO HAND, MIRROR (issue #5628, ADR 0151) — the
        // board above with the creature swapped: the opponent controls the
        // Grizzly Bears, the bot no creature. The opponent's Sunken Hope now
        // bounces the OPPONENT's body and never the bot's, so destroying it
        // gives the opponent its tempo back.
        //
        // This is the position that discriminates against the pre-#5628
        // reading: unread, the Hope keeps its Latent Floor — a positive worth
        // for its controller on every board — and Disenchant takes it.
        label: "each-step return to hand: Disenchant leaves the Sunken Hope that bounces only the opponent's creature (issue #5628)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Sunken Hope only the opponent has a creature for",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                ...Array.from({ length: 3 }, () => ({
                    name: "Island",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Sunken Hope", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            forbidden: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Sunken Hope",
                },
            ],
        },
        note: "Issue #5628. The discriminating position (the entry above is the anchor reading). Guards the return to hand branch of `eachStepDifferentialValue` (`isStepSideOp`, `bounceChoiceFor`, `sideBounceLoss`, `ai/opValuers.ts`). Measured at 400 iterations over 20 seeds: the Hope never (Aeolipile 15, pass 5). Proof of failure — `isStepSideOp` refusing the bounce's `forEach` (the pre-#5628 read-nothing): Disenchant on the Hope 20/20.",
    },
    {
        // EACH-STEP MILL (issue #5625, ADR 0151) — the opponent's Worry
        // Beads has the player whose upkeep it is mill a card (CR 701.17a).
        // The bot's library holds four cards, the opponent's thirty: every
        // milled card brings the bot one draw nearer decking (CR 104.3c /
        // 704.5b) and costs the opponent nothing, so the Beads is the
        // permanent Disenchant should answer, not the Aeolipile.
        label: "each-step mill: Disenchant takes the Worry Beads milling the bot's four-card library, not the 2-MV artifact (issue #5625)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Worry Beads milling only the bot's short library toward decking",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                ...Array.from({ length: 3 }, () => ({
                    name: "Plains",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Worry Beads", owner: "opp", zone: "battlefield" },
                // The opponent's library is the long one: 4 filler basics + 26.
                ...Array.from({ length: 26 }, () => ({
                    name: "Plains",
                    owner: "opp" as const,
                    zone: "library" as const,
                })),
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 4,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Worry Beads",
                },
            ],
        },
        note: "Issue #5625. One half of the Worry Beads pair (two unpaired `conditional` Test Positions — the libraries differ on both sides, so no `pairOf`): the Beads is worth what each player's upkeep mill costs that player at the leaf evaluator's decking term (`EachPlayerSide.millLoss`, `ai/latentBoard.ts`; `libraryTerm`, `ai/decking.ts`), the opponent's loss minus the bot's. Measured at 400 iterations over 20 seeds: the Beads 20/20. Before issue #5625 (the mill family read nothing, its Latent Floor) the Beads is 20/20 here too — the mirror below reds on that. Proof of failure — the side reader skipped (`stepSideMill` reading 0, a measured zero): Aeolipile 20/20.",
    },
    {
        // EACH-STEP MILL, MIRROR (issue #5625, ADR 0151) — the board above
        // with the libraries swapped: the bot's holds thirty cards, the
        // opponent's four. Now the opponent's Worry Beads mills the
        // OPPONENT toward decking and never costs the bot a card it would
        // draw, so destroying it only spares the opponent.
        label: "each-step mill: Disenchant leaves the Worry Beads milling only the opponent's four-card library (issue #5625)",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "a Worry Beads milling only the opponent's short library toward decking",
            },
        },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Disenchant", owner: "me", zone: "hand" },
                ...Array.from({ length: 3 }, () => ({
                    name: "Plains",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Aeolipile", owner: "opp", zone: "battlefield" },
                { name: "Worry Beads", owner: "opp", zone: "battlefield" },
                // The bot's library is the long one: 4 filler basics + 26.
                ...Array.from({ length: 26 }, () => ({
                    name: "Plains",
                    owner: "me" as const,
                    zone: "library" as const,
                })),
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 4,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            forbidden: [
                {
                    kind: "cast-spell",
                    card: "Disenchant",
                    target: "Worry Beads",
                },
            ],
        },
        note: "Issue #5625. The other half of the Worry Beads pair. Guards the mill branch of `eachStepDifferentialValue` (`stepSideMill`, `isStepSideOp`, `ai/opValuers.ts`). Measured at 400 iterations over 20 seeds: the Beads never (Aeolipile 20). Proof of failure — the family left unread (`isStepSideOp` refusing `mill`, the pre-#5625 Latent Floor): Disenchant on the Beads 20/20.",
    },
    // KEYWORD BONUS ROWS (issue #5345). `expect.predicate`, not `moves`, ON
    // PURPOSE: a `moves` entry is a Verdict and obliges a refit of
    // `DEFAULT_EVAL_WEIGHTS` (`weightFit.bot.test.ts`), which cascades through
    // every snapshot the weights feed. These pin a row of a table the fit does
    // not touch, so they stay Test Positions. Each pair: Terror vs two vanilla
    // 2/2s of one mana value, a layer-6 grant on ONE of them the only
    // difference. Lifelink and menace have no pair: zeroing the lifelink row
    // left both entries 20/20 (rollouts play the real life gain), menace was
    // 17-18/20 with the row.
    {
        label: "keyword bonus (deathtouch): Terror takes the Runeclaw Bear that carries deathtouch, not the identical Grizzly Bears (issue #5345)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Swamp",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Terror", owner: "me", zone: "hand" },
                { name: "Runeclaw Bear", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            continuousEffects: [
                {
                    layer: 6,
                    affected: { opp: ["Runeclaw Bear"] },
                    controller: "opp",
                    payload: { kind: "keyword-grant", keyword: "deathtouch" },
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                matchesMove(state, move, {
                    kind: "cast-spell",
                    card: "Terror",
                    target: "Runeclaw Bear",
                }),
            describe:
                "Terror is cast on the Runeclaw Bear, the one holding deathtouch",
        },
        note: "Issue #5345 (follow-up of #5152). Guards `deathtouch: (p) => 20 + 2 * p` in `creatureBody.ts`'s keyword bonus table; the sibling entry swaps the carrier. Measured at 400 iterations over 20 seeds: Terror takes the carrier in both entries with the row; with no keyword granted the bot passes (0/20), so the grant alone is what makes the removal worth casting. Proof of failure: zeroing the row turns BOTH entries red (0/4).",
    },
    {
        label: "keyword bonus (deathtouch): Terror takes the Grizzly Bears that carries deathtouch, not the identical Runeclaw Bear (issue #5345)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Swamp",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Terror", owner: "me", zone: "hand" },
                { name: "Runeclaw Bear", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            continuousEffects: [
                {
                    layer: 6,
                    affected: { opp: ["Grizzly Bears"] },
                    controller: "opp",
                    payload: { kind: "keyword-grant", keyword: "deathtouch" },
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                matchesMove(state, move, {
                    kind: "cast-spell",
                    card: "Terror",
                    target: "Grizzly Bears",
                }),
            describe:
                "Terror is cast on the Grizzly Bears, the one holding deathtouch",
        },
        note: "Issue #5345 (follow-up of #5152). Guards `deathtouch: (p) => 20 + 2 * p` in `creatureBody.ts`'s keyword bonus table; the sibling entry swaps the carrier. Measured at 400 iterations over 20 seeds: Terror takes the carrier in both entries with the row; with no keyword granted the bot passes (0/20), so the grant alone is what makes the removal worth casting. Proof of failure: zeroing the row turns BOTH entries red (0/4).",
    },
    {
        label: "keyword bonus (protection): Terror takes the Runeclaw Bear that carries protection from red, not the identical Grizzly Bears (issue #5345)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Swamp",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                // Issue #5356 — a red source on the bot's side: protection
                // from red only has worth against a player who shows red.
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    tapped: false,
                },
                { name: "Terror", owner: "me", zone: "hand" },
                { name: "Runeclaw Bear", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            continuousEffects: [
                {
                    layer: 6,
                    affected: { opp: ["Runeclaw Bear"] },
                    controller: "opp",
                    payload: {
                        kind: "keyword-grant",
                        keyword: "protection from red",
                    },
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 1600 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                matchesMove(state, move, {
                    kind: "cast-spell",
                    card: "Terror",
                    target: "Runeclaw Bear",
                }),
            describe:
                "Terror is cast on the Runeclaw Bear, the one holding protection from red",
        },
        note: "Issue #5345 (follow-up of #5152). Guards the `/^protection from /` family row (flat 15) in `creatureBody.ts`'s keyword bonus table; the sibling entry swaps the carrier. Measured at 400 iterations over 20 seeds: Terror takes the carrier in both entries with the row; with no keyword granted the bot passes (0/20), so the grant alone is what makes the removal worth casting. Proof of failure: zeroing the row turns BOTH entries red (0/4). Issue #5356 added the bot's Mountain: the row is now board-aware (`ai/keywordRelevance.ts`) and protection from red is worth nothing against a player showing no red — the negative twin below. Issue #5415: the flat 15 is a near-tie at 400 iterations (carrier won by material-tiebreak, 9/10 under jitter+); 1600 iterations make that tie-break stable (ROBUST 30/30, every pick still `material-tiebreak`: a flat 15 cannot leave the outcome window, so no budget makes it win on mean reward).",
    },
    {
        label: "keyword bonus (protection): Terror takes the Grizzly Bears that carries protection from red, not the identical Runeclaw Bear (issue #5345)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Swamp",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                // Issue #5356 — a red source on the bot's side: protection
                // from red only has worth against a player who shows red.
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    tapped: false,
                },
                { name: "Terror", owner: "me", zone: "hand" },
                { name: "Runeclaw Bear", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            continuousEffects: [
                {
                    layer: 6,
                    affected: { opp: ["Grizzly Bears"] },
                    controller: "opp",
                    payload: {
                        kind: "keyword-grant",
                        keyword: "protection from red",
                    },
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                matchesMove(state, move, {
                    kind: "cast-spell",
                    card: "Terror",
                    target: "Grizzly Bears",
                }),
            describe:
                "Terror is cast on the Grizzly Bears, the one holding protection from red",
        },
        note: "Issue #5345 (follow-up of #5152). Guards the `/^protection from /` family row (flat 15) in `creatureBody.ts`'s keyword bonus table; the sibling entry swaps the carrier. Measured at 400 iterations over 20 seeds: Terror takes the carrier in both entries with the row; with no keyword granted the bot passes (0/20), so the grant alone is what makes the removal worth casting. Proof of failure: zeroing the row turns BOTH entries red (0/4). Issue #5356 added the bot's Mountain: the row is now board-aware (`ai/keywordRelevance.ts`) and protection from red is worth nothing against a player showing no red — the negative twin below.",
    },
    {
        // The board-aware twin of the two entries above (issue #5356): the
        // SAME position without the bot's Mountain. The bot shows only black,
        // so protection from red protects the Runeclaw Bear from nothing it
        // could ever face (CR 702.16a) and the two Bears are the same
        // creature — Terror is not spent on the carrier for its keyword.
        label: "keyword relevance (protection): against a bot showing no red, protection from red does not make the Runeclaw Bear Terror's target (issue #5356)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                ...Array.from({ length: 2 }, () => ({
                    name: "Swamp",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Terror", owner: "me", zone: "hand" },
                { name: "Runeclaw Bear", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            continuousEffects: [
                {
                    layer: 6,
                    affected: { opp: ["Runeclaw Bear"] },
                    controller: "opp",
                    payload: {
                        kind: "keyword-grant",
                        keyword: "protection from red",
                    },
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                !matchesMove(state, move, {
                    kind: "cast-spell",
                    card: "Terror",
                    target: "Runeclaw Bear",
                }),
            describe:
                "Terror is NOT cast on the Runeclaw Bear for a protection from red that protects it from nothing",
        },
        note: "Issue #5356. Guards `inertKeywordDiscount` (`ai/keywordRelevance.ts`), read by `evaluateCreature`. Measured at 400 iterations over 20 seeds: Terror never takes the carrier (20/20 green), while the two Mountain entries above stay 20/20 on the carrier. Proof of failure: with the discount disabled (the flat 15 for every protection) this entry is red on all 20 seeds (Terror on the Runeclaw Bear).",
    },
    {
        // UTILITY LAND STANDING WORTH (issue #5155) — the bot holds a Strip
        // Mine; the opponent's two lands are an Island and a Library of
        // Alexandria, with seven cards in hand (the Library's draw is live).
        // A Strip Mine is plainly better spent on the Library.
        //
        // WHY IT WAS WRONG. A land was excluded from the standing-ability
        // reading (issue #5145) and `permanentRealisedValue` added nothing
        // beside its mana term, so both lands priced at `permanentWeight +
        // manaWeight` and the removal lens could not tell them apart: the
        // pick was the Island, or no activation at all, by rollout noise.
        label: "removal: Strip Mine takes the Library of Alexandria, not the Island (issue #5155)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Strip Mine",
                    owner: "me",
                    zone: "battlefield",
                    tapped: false,
                },
                ...Array.from({ length: 2 }, () => ({
                    name: "Mountain",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    tapped: false,
                })),
                { name: "Island", owner: "opp", zone: "battlefield" },
                {
                    name: "Library of Alexandria",
                    owner: "opp",
                    zone: "battlefield",
                },
                ...Array.from({ length: 7 }, () => ({
                    name: "Island",
                    owner: "opp" as const,
                    zone: "hand" as const,
                })),
            ],
            // Seven REAL cards, not `hiddenHand` placeholders: the Debug panel's
            // blade loader puts every `must` entry into a LIVE game
            // (`debugLoadBladeScenario.test.ts`), which cannot hold a card of
            // unknown identity. Seven Islands value exactly what seven
            // placeholders did (the land floor each) and keep the Library's
            // draw live (its activation condition: exactly seven cards in hand).
            phase: "END_STEP",
            activePlayer: "opp",
            priority: "me",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "activate-ability",
                    card: "Strip Mine",
                    target: "Library of Alexandria",
                },
            ],
        },
        note: "Issue #5155. Guards the land branch of `permanentRealisedValue` (`landStandingAbilityValue`, `evaluate.ts`) and the land admission in `carriesStandingAbilityWorth` (`cardValue.ts`). Measured at 400 iterations over 20 seeds: the Library 20/20 with the change (mechanism `material-tiebreak`); with the `!def.types.includes(\"Land\")` exclusion restored in `carriesStandingAbilityWorth`, the Island 20/20. Placed in the OPPONENT'S END STEP on purpose: in the bot's own main phase the same position is held to `pass` by the frozen `hold-trick` root rule (the activation sits inside `outcomeEps` of passing), on the before and after trees alike — a timing gap, not a valuation one, recorded in `docs/findings/5155-hold-trick-defers-instant-speed-land-destruction.md`.",
    },

    // -----------------------------------------------------------------------
    // ADR 0151 (issue #5161) — the two-way Latent Floor. Urza's Chalice is a
    // Complete Script (a binder plus a declared `gainLife`, no clause the
    // reader cannot see), so its context-free reading is trusted BELOW the
    // `base + MV` floor: 3.8 in hand, against Urza's Bauble's 8 (a cantrip, the
    // better card). Before, the floor lifted it to 18 and the Bot gave up the
    // Bauble to keep it.
    //
    // The comparator must sit between the two readings, which no vanilla
    // creature does (Grizzly Bears reads 116 — the Bot already shed the
    // Chalice first against any creature, so such an entry could not red).
    // And the decision must be SEARCHED: the CR 514.1 cleanup discard is the
    // client policy (`discardOrder`, mana value first), outside the blade's
    // reach. A discard-as-cost activation is the searched equivalent: one
    // Move per card the cost may name. The source taps (`{R}, {T}, Discard a
    // card`), so it activates once — an untapped repeatable outlet (Psychic
    // Frog) reaches the same leaf by discarding both in either order, and the
    // two roots tie. On the opponent's turn nothing in hand is castable. The
    // comparator must not be a mana source: a Mox Pearl kept in hand is cast
    // in the rollouts and the `mana` term swamps the latent gap, so the
    // entry could not red.
    //
    // The pair: the same position with the hand order reversed, so a pick
    // that follows card order or instance identity cannot pass both. An
    // opposite-answer twin would need a card legitimately worse than the
    // Chalice that still reads above it — every candidate pins a wrong play.
    // -----------------------------------------------------------------------
    {
        label: "Complete Script below the floor: discards Urza's Chalice over Urza's Bauble to a discard cost",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Dwarven Armorer",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Urza's Chalice", owner: "me", zone: "hand" },
                { name: "Urza's Bauble", owner: "me", zone: "hand" },
            ],
            phase: "END_STEP",
            activePlayer: "opp",
            priority: "me",
            turn: 4,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                activationDiscardsCard(state, "me", move, "Urza's Chalice"),
            describe:
                "activates Dwarven Armorer naming Urza's Chalice for its discard cost",
        },
        note: "Issue #5161 (ADR 0151). Proof-of-failure: `isCompleteScript` forced to `false` puts Urza's Chalice back at its 18-point floor, above the Bauble's 8, and the entry reds.",
    },
    {
        label: "Complete Script below the floor: discards Urza's Chalice over Urza's Bauble to a discard cost (hand order reversed)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Dwarven Armorer",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Urza's Bauble", owner: "me", zone: "hand" },
                { name: "Urza's Chalice", owner: "me", zone: "hand" },
            ],
            phase: "END_STEP",
            activePlayer: "opp",
            priority: "me",
            turn: 4,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move, state) =>
                activationDiscardsCard(state, "me", move, "Urza's Chalice"),
            describe:
                "activates Dwarven Armorer naming Urza's Chalice for its discard cost",
        },
        note: "Issue #5161, the ordering twin of the entry above: the hand order reversed, so the answer is the valuation's and not the enumeration order's.",
    },
    {
        // CR 609.7a (issue #5601) — "a source of your choice" may be a SPELL
        // on the stack. The opponent's Lightning Bolt reaches the stack through
        // the real cast pipeline, aimed at the bot; the bot answers with its
        // Circle of Protection: Red through the real activation path, and
        // `resolve-top` resolves the Circle's ability, which is what OPENS the
        // live `pick-source` choice. The other red source on the board is a
        // summoning-sick Gray Ogre that can deal the bot no damage this turn,
        // so only the Bolt is worth a shield.
        label: "source of your choice: shields itself from the burn spell on the stack, not an idle red creature",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                {
                    name: "Gray Ogre",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: true,
                },
                {
                    name: "Circle of Protection: Red",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
            // The Circle's {1}, floating: a setup `activate` cannot walk a
            // tap-to-pay decision forward.
            manaPool: { opp: { W: 1 } },
        },
        setup: [
            { kind: "cast", card: "Lightning Bolt", by: "me", target: "opp" },
            {
                kind: "activate",
                card: "Circle of Protection: Red",
                controller: "opp",
            },
            { kind: "resolve-top" },
        ],
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", card: "Lightning Bolt" }],
        },
        note: "Issue #5601. The root decision is the live CR 609.7a source choice, reached by really casting the Bolt and really activating and resolving the Circle: its pool spans the stack (the Bolt) and the battlefield (the Ogre). Proof-of-failure: dropping the stack's spells from `damageSourceChoicePool` (`gre/damageSourceChoice.ts`) leaves the Ogre as the only answer and the entry reds.",
    },
    {
        // CR 609.7a (issue #5601) — the preference twin of the entry above,
        // asked by issue #3731: the threatening source is NOT the first
        // candidate. The opponent attacks with a Gray Ogre; its summoning-sick
        // Mons's Goblin Raiders, listed first on its battlefield, is the first
        // candidate in the pool and the one a minimal-legal answer names. The
        // bot activates its Circle in the defender's window of the declare-
        // attackers step and resolves it: only the search's valuation of the
        // shield picks the Ogre — the one red source about to deal it damage.
        label: "source of your choice: shields itself from the attacking red creature, not the first red one listed",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Mons's Goblin Raiders",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: true,
                },
                {
                    name: "Gray Ogre",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Circle of Protection: Red",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
            // The Circle's {1}, floating: a setup `activate` cannot walk a
            // tap-to-pay decision forward.
            manaPool: { opp: { W: 1 } },
        },
        setup: [
            {
                kind: "declare-attackers",
                cards: ["Gray Ogre"],
                haltForDefenderResponse: true,
            },
            {
                kind: "activate",
                card: "Circle of Protection: Red",
                controller: "opp",
            },
            { kind: "resolve-top" },
        ],
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", card: "Gray Ogre" }],
        },
        note: "Issue #5601, the preference twin of the entry above (issue #3731: a threatening source over the first candidate). The Raiders are the first candidate and the minimal-legal answer; the attacking Ogre is the threat. Proof-of-failure: `pickSourceCandidates` (`gre/ai/choiceCandidates.ts`) offering only its first candidate leaves the Raiders as the answer and the entry reds.",
    },
    {
        // COMBAT-DAMAGE SPLIT (CR 510.1c, issue #5662). The Bot's 3/3 is
        // double-blocked by a 1/1 and a 2/1: 1 + 1 is lethal for both, so the
        // split kills both. The engine's seed puts all 3 on the first blocker
        // and kills one — the split the Bot confirmed unedited before #5662.
        //
        // The split is not a Move (the driver submits it through
        // `setDamageAssignment` before `confirmDamage`), so the predicate
        // walks the position into the real damage step and reads the split
        // the policy chooses there (`damageSplitProbe.ts`). The root move at
        // this post-block window is a pass — no mana, no cards.
        label: "discriminating pair: damage split kills both a 1/1 and a 2/1 blocking a 3/3",
        // Absolute: a predicate lowers to no Verdict (`registrySource.ts`), so
        // the pair is linked by label in the notes, not by `pairOf`.
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Mons's Goblin Raiders",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Savannah Lions",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        setup: [
            { kind: "declare-attackers" },
            {
                kind: "declare-blockers",
                blocks: [
                    {
                        blocker: "Mons's Goblin Raiders",
                        attacker: "Hill Giant",
                    },
                    { blocker: "Savannah Lions", attacker: "Hill Giant" },
                ],
            },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            predicate: (_move, state) => {
                const split = damageSplitAtDamageStep(state, "me");
                const giant = split?.["Hill Giant"];
                return (
                    giant !== undefined &&
                    giant["Mons's Goblin Raiders"] === 1 &&
                    giant["Savannah Lions"] === 2
                );
            },
            describe:
                "splits Hill Giant's 3 damage 1 to Mons's Goblin Raiders, 2 to Savannah Lions (both die)",
        },
        note: 'Issue #5662. The anchor of a discriminating pair with "discriminating pair: damage split kills the 3/3 of a 1/1 and a 3/3 blocking a 3/3": same attacker, the 2/1 swapped for a 3/3 so only one blocker can die. Proof-of-failure: `chooseDamageSplit` (`gre/ai/damageSplit.ts`) returning the engine\'s seed puts 3 on the Raiders and the entry reds.',
    },
    {
        // The discriminating half of the entry above (issue #5662): the 2/1
        // becomes a 3/3, so 3 damage kills at most one blocker (lethal 3 + 1).
        // The policy kills the one it values more — the 3/3 Bog Wraith — and
        // it is declared SECOND, so the engine's seed (first live blocker) would
        // kill the 1/1 instead: the entry discriminates the value pick from
        // declaration order.
        label: "discriminating pair: damage split kills the 3/3 of a 1/1 and a 3/3 blocking a 3/3",
        // Absolute: a predicate lowers to no Verdict (`registrySource.ts`), so
        // the pair is linked by label in the notes, not by `pairOf`.
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Mons's Goblin Raiders",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Bog Wraith",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        setup: [
            { kind: "declare-attackers" },
            {
                kind: "declare-blockers",
                blocks: [
                    {
                        blocker: "Mons's Goblin Raiders",
                        attacker: "Hill Giant",
                    },
                    { blocker: "Bog Wraith", attacker: "Hill Giant" },
                ],
            },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            predicate: (_move, state) => {
                const giant = damageSplitAtDamageStep(state, "me")?.[
                    "Hill Giant"
                ];
                return (
                    giant !== undefined &&
                    giant["Bog Wraith"] === 3 &&
                    giant["Mons's Goblin Raiders"] === undefined
                );
            },
            describe:
                "puts all 3 of Hill Giant's damage on Bog Wraith (the 3/3), none on Mons's Goblin Raiders",
        },
        note: 'Issue #5662, the discriminating half of "discriminating pair: damage split kills both a 1/1 and a 2/1 blocking a 3/3". Proof-of-failure: a kill-set search that prefers the cheapest kill (or the seed\'s first live blocker) puts the 3 on the Raiders and the entry reds.',
    },
    {
        label: "regeneration shield: holds Regenerate against an Aura that destroys nothing",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "stack",
                detail: "a destroy spell on the stack aimed at the regenerator",
            },
        },
        spec: {
            cards: [
                {
                    name: "Charging Troll",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Sleeping Potion", owner: "me", zone: "hand" },
                { name: "Vindicate", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 8,
            libraryCount: 20,
        },
        // The spell reaches the stack through the REAL cast pipeline (ADR 0070
        // §4); the caster's window auto-passes, putting the regenerator's
        // controller on the clock — so the bot plays `opp`.
        setup: [
            {
                kind: "cast",
                card: "Sleeping Potion",
                by: "me",
                target: "Charging Troll",
            },
        ],
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Charging Troll" }],
        },
        note: "Issue #5493, position A. Sleeping Potion taps and locks the Troll but never destroys it, and a regeneration shield only replaces destruction (CR 701.19a) and ends with the turn (CR 514.2) — the activation buys nothing, and the bot keeps priority before any later threat resolves (CR 117.3b). `isFutileThisTurnMove` (`gre/ai/futileShield.ts`) prunes it. Proof-of-failure: with the prune disabled the bot activates the Troll on seeds 1 and 2 of five — the `pass` tie the issue describes.",
    },
    {
        label: "regeneration shield: holds Regenerate against the Aura's own tap trigger",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "stack",
                detail: "a destroy spell on the stack aimed at the regenerator",
            },
        },
        spec: {
            cards: [
                {
                    name: "Charging Troll",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Sleeping Potion", owner: "me", zone: "hand" },
                { name: "Vindicate", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 8,
            libraryCount: 20,
        },
        // The spell reaches the stack through the REAL cast pipeline (ADR 0070
        // §4); the caster's window auto-passes, putting the regenerator's
        // controller on the clock — so the bot plays `opp`.
        setup: [
            {
                kind: "cast",
                card: "Sleeping Potion",
                by: "me",
                target: "Charging Troll",
            },
            // The Aura resolves and its enters trigger ("tap enchanted
            // creature") goes on the stack; the caster passes, so the
            // regenerator's controller holds priority in that window.
            { kind: "resolve-top" },
            { kind: "pass", seat: "me" },
        ],
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            forbidden: [{ kind: "activate-ability", card: "Charging Troll" }],
        },
        note: "Issue #5493, the window after position A (found in review): Sleeping Potion has resolved and its enters trigger only TAPS the Troll, so the shield still has nothing to replace (CR 701.19a). The trigger is a `resolve()` closure read through its `aiEffects` shadow script; a stack object whose whole script only taps, draws or gains life is not a destruction threat. Proof-of-failure: counting every ability on the stack as a threat (the pre-review predicate) keeps the activation, and the bot activates the Troll on seed 3 of five.",
    },
    {
        label: "regeneration shield: regenerates against a destroy spell on the stack",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "stack",
                detail: "an Aura on the stack that destroys nothing",
            },
        },
        spec: {
            cards: [
                {
                    name: "Charging Troll",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Sleeping Potion", owner: "me", zone: "hand" },
                { name: "Vindicate", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 8,
            libraryCount: 20,
        },
        // The spell reaches the stack through the REAL cast pipeline (ADR 0070
        // §4); the caster's window auto-passes, putting the regenerator's
        // controller on the clock — so the bot plays `opp`.
        setup: [
            {
                kind: "cast",
                card: "Vindicate",
                by: "me",
                target: "Charging Troll",
            },
        ],
        bot: "opp",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "activate-ability", card: "Charging Troll" }],
        },
        note: "Issue #5493, position B — the discriminating twin of the entry above: the same board with Vindicate (destroy target permanent, regenerable) aimed at the Troll. The shield is the only answer that keeps the creature (CR 701.19a), so the prune must leave it standing and the search must take it.",
    },
    {
        label: "prevention shield: casts Warning on the opponent's attacker that kills its blocker",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "the holder's creature does not block the attacker",
            },
        },
        spec: {
            cards: [
                { name: "Warning", owner: "me", zone: "hand" },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_BLOCKERS",
            activePlayer: "opp",
            priority: "me",
            combat: {
                attackers: ["Hill Giant"],
                confirmed: true,
                blockers: [{ blocker: "Grizzly Bears", blocking: [0] }],
                blockersConfirmed: true,
            },
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [
                { kind: "cast-spell", card: "Warning", target: "Hill Giant" },
            ],
        },
        note: "Issue #5816, Bot Gap `never-chosen › Instant target:Creature › preventDamage`. CR 615.1a + CR 510.1: the opponent's 3/3 is blocked by the holder's 2/2, so preventing the attacker's combat damage saves the blocker. The Bot-play sweep's `BLOCKED_ATTACK` window poses this board; before blocks the Bot rightly holds the shield.",
    },
    {
        // ISSUE #5496 — the Bot pointed its own kicked Thunderscape
        // Battlemage's "target player discards two cards" at ITSELF. A
        // trigger's targets are answered by a standalone `submit-target`
        // (CR 603.3d), which the announcement-variant ranking did not reach:
        // the self- and opponent-aimed answers tied inside `OUTCOME_EPS` and
        // the pick fell to rollout noise.
        label: "raised target: a kicked discard trigger hits the opponent, not the Bot (#5496)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Thunderscape Battlemage", owner: "me", zone: "hand" },
                // Two cards with no graveyard value: the self-discard the QA
                // game showed is cheap enough to sit within outcome noise.
                { name: "Plains", owner: "me", zone: "hand", count: 2 },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Swamp", owner: "me", zone: "battlefield", count: 2 },
                { name: "Hill Giant", owner: "opp", zone: "hand" },
                { name: "Lightning Bolt", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
        // The real cast pipeline, {1}{B}-kicked, then its resolution: the
        // creature enters and its per-Kicker ETB raises the target selection.
        setup: [
            {
                kind: "cast",
                card: "Thunderscape Battlemage",
                kickers: ["kicker-b"],
            },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4, 5, 6, 7],
        tier: "must",
        // A `predicate`, not `moves`, for the reason the depletion-land entry
        // records: a `moves` entry is a fitted VERDICT, and the refit these
        // oblige is refused (`bun run fit:weights` prints DO NOT PASTE — the
        // evaluator has no hand-size term, issue #5496's out-of-scope). The
        // ranking that answers it is the announcement-variant tie-break.
        expect: {
            predicate: (move, state) => submitsSoleTarget(move, state, "opp"),
            describe: "a `submit-target` naming the opponent alone",
        },
        note: "Issue #5496. CR 603.3d — the trigger's controller chooses its targets as it is put on the stack; `discard` is signed harmful to its player, so the Bot aimed at itself is a misdirected slot (`misdirectedTargetCount`, now reading a trigger's script through `raisedTriggerSlotSigner`). Proof-of-failure: with the `submit-target` branch of `slotSignerFor` removed, the Bot discards its own hand on 5 of these 8 seeds.",
    },
    {
        // ISSUE #5496 — the Bot pointed its own kicked Thunderscape
        // Battlemage's "target player discards two cards" at ITSELF. A
        // trigger's targets are answered by a standalone `submit-target`
        // (CR 603.3d), which the announcement-variant ranking did not reach:
        // the self- and opponent-aimed answers tied inside `OUTCOME_EPS` and
        // the pick fell to rollout noise.
        label: "raised target: a kicked discard trigger hits an EMPTY-handed opponent over the Bot (#5496)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Thunderscape Battlemage", owner: "me", zone: "hand" },
                // Two cards with no graveyard value: the self-discard the QA
                // game showed is cheap enough to sit within outcome noise.
                { name: "Plains", owner: "me", zone: "hand", count: 2 },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Swamp", owner: "me", zone: "battlefield", count: 2 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
        // The real cast pipeline, {1}{B}-kicked, then its resolution: the
        // creature enters and its per-Kicker ETB raises the target selection.
        setup: [
            {
                kind: "cast",
                card: "Thunderscape Battlemage",
                kickers: ["kicker-b"],
            },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4, 5, 6, 7],
        tier: "must",
        // A `predicate`, not `moves`, for the reason the depletion-land entry
        // records: a `moves` entry is a fitted VERDICT, and the refit these
        // oblige is refused (`bun run fit:weights` prints DO NOT PASTE — the
        // evaluator has no hand-size term, issue #5496's out-of-scope). The
        // ranking that answers it is the announcement-variant tie-break.
        expect: {
            predicate: (move, state) => submitsSoleTarget(move, state, "opp"),
            describe: "a `submit-target` naming the opponent alone",
        },
        note: "Issue #5496. CR 603.3d — the trigger's controller chooses its targets as it is put on the stack; `discard` is signed harmful to its player, so the Bot aimed at itself is a misdirected slot (`misdirectedTargetCount`, now reading a trigger's script through `raisedTriggerSlotSigner`). The whiff edge case: an opponent with no cards still beats self-harm. Proof-of-failure: with the `submit-target` branch of `slotSignerFor` removed, the Bot discards its own hand on EVERY seed.",
    },
    {
        // ISSUE #5496, the class witness: a different Op (`loseLife`) through a
        // different trigger event (an upkeep scan, CR 503.1a) — the rule reads
        // the trigger's Effect Script, never the discard.
        label: "raised target: an upkeep life-loss trigger hits the opponent, not the Bot (#5496)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Smoldering Tar", owner: "me", zone: "battlefield" },
                { name: "Hill Giant", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 2,
            libraryCount: 20,
        },
        setup: [{ kind: "phase-trigger", phase: "UPKEEP" }],
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2, 3, 4, 5, 6, 7],
        tier: "must",
        // A `predicate`, not `moves`, for the reason the depletion-land entry
        // records: a `moves` entry is a fitted VERDICT, and the refit these
        // oblige is refused (`bun run fit:weights` prints DO NOT PASTE — the
        // evaluator has no hand-size term, issue #5496's out-of-scope). The
        // ranking that answers it is the announcement-variant tie-break.
        expect: {
            predicate: (move, state) => submitsSoleTarget(move, state, "opp"),
            describe: "a `submit-target` naming the opponent alone",
        },
        note: "Issue #5496. CR 603.3d — `loseLife` is signed harmful to its player. Life loss is margin-visible, so `resolvedMarginDelta` alone already ranks it once `submit-target` reaches the announcement-variant tie-break; the guard here is the SEARCH half. Proof-of-failure: with `submit-target` dropped from that tie-break's move-kind gate (`selectRootMove`), the Bot pings its own face on seed 2. The two Battlemage entries red under either half.",
    },
    {
        // Issue #5951 — the search prices a multi-block's damage split. Craw
        // Wurm (6/4) swings into two Hill Giants (3/3) with nothing else on
        // either side. Every reply the defender has is good for the attacker:
        // no block takes 6, one Giant blocking dies to 6 and deals 3 (< 4),
        // and the double block kills the Wurm only by losing BOTH Giants —
        // CR 510.1c lets the Wurm divide its 6 as 3 + 3. Until the search dealt
        // that split it dealt a multi-blocked attacker's damage as NOTHING, so
        // the double block read as a free kill of the Wurm and the swing as a
        // blunder.
        label: "multi-block split: swings a 6/4 into two 3/3s that can only trade both for it",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                    count: 2,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            moves: [{ kind: "declare-attackers", card: "Craw Wurm" }],
        },
        note: "Issue #5951. Proof-of-failure: `searchCombatDamageAssignments` (`gre/ai/damageSplit.ts`) returning `buildAutoDamageAssignments` alone — the multi-blocked Wurm deals nothing — and the Bot holds the Wurm back.",
    },
    {
        // Issue #6334 (audit of issue #4927, theme cast × blink). An exile
        // whose card a delayed trigger returns at the next end step is a
        // TEMPORARY removal: Flickerwisp on the opposing Hill Giant gets it
        // back at the end step, Flickerwisp on the bot's own Flametongue Kavu
        // gets the Kavu back with a fresh enters trigger that kills the Giant.
        label: "audit: cast-blink: Flickerwisp flickers its own Flametongue Kavu for the permanent kill",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "the bot's other creature carries a removal ETB (Flametongue Kavu vs Grizzly Bears)",
            },
        },
        spec: {
            cards: [
                { name: "Flickerwisp", owner: "me", zone: "hand" },
                {
                    name: "Flametongue Kavu",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Plains", owner: "me", zone: "battlefield", count: 3 },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Mountain",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        setup: [
            { kind: "cast", card: "Flickerwisp", by: "me" },
            { kind: "pass", seat: "opp" },
        ],
        bot: "me",
        audit: { theme: "cast × blink" },
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            moves: [{ kind: "submit-target", target: "Flametongue Kavu" }],
        },
        note: "Issue #6334. Three seams, each measured red alone at 400 iterations over seeds 0xb1ade, 1, 2, 3, 4 (Hill Giant on every seed): (1) Evaluation leaf — an exiled card a scheduled delayed trigger returns to the battlefield is credited back to the player it returns under, body plus ETB Abilities against this board (`pendingReturnsWorth`, `ai/pendingReturn.ts`); (2) `OP_BENEFICENCE` axis — an `exile` the same script's delayed trigger returns signs nothing, so the self-flicker draws no misdirection penalty (`beneficence.ts`); (3) the tree's trigger-target node stops exploring answers another answer strictly dominates once resolved (`ai/targetDominance.ts`), which otherwise backed up the returned Kavu shooting itself into the flicker's mean. Before the fix: Hill Giant 5/5 at 400 (the audit measured 3/3 at 400, 1200 and 4000). Two causes the audit missed: the reward band clips past `materialFull` here, so every Kavu target tied in the rollout and below the root, and the delayed return sits beyond the one-resolution probe.",
    },
    {
        label: "audit: cast-blink: Flickerwisp exiles the opposing body when its own creature is vanilla",
        pairOf: {
            anchor: "audit: cast-blink: Flickerwisp flickers its own Flametongue Kavu for the permanent kill",
            discriminant: {
                kind: "card",
                detail: "the bot's other creature carries a removal ETB (Flametongue Kavu vs Grizzly Bears)",
            },
        },
        spec: {
            cards: [
                { name: "Flickerwisp", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Plains", owner: "me", zone: "battlefield", count: 3 },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Mountain",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        },
        setup: [
            { kind: "cast", card: "Flickerwisp", by: "me" },
            { kind: "pass", seat: "opp" },
        ],
        bot: "me",
        audit: { theme: "cast × blink" },
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            moves: [{ kind: "submit-target", target: "Hill Giant" }],
        },
        note: "Issue #6334 — the mirror half: with no enters trigger on the bot's own creature, flickering it gains nothing and the opposing body's one-turn exile is the better answer. Green before the fix (Hill Giant 5/5 at 400) and after it (Hill Giant 5/5): the pending-return credit gives the Giant back to its owner at its full worth, so the exile is priced as the tempo it is, not as a kill.",
    },
    {
        // CR 614.12a / 607.2b — Sutured Ghoul's "As this creature enters, exile
        // any number of creature cards from your graveyard" parks the
        // permanent until the exile is answered. The graveyard holds the two
        // Bears that size it (a 4/4 trampler); the opponent has a lone Hill
        // Giant, so the body is worth the seven mana.
        label: "choose-graveyard-card: casts Sutured Ghoul over a graveyard of creatures",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Sutured Ghoul", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield", count: 7 },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "graveyard",
                    count: 2,
                },
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        // A `predicate`, not `moves`: a registry `moves` entry is a fitted
        // VERDICT and obliges a refit (`weightFit.bot.test.ts`); the entry
        // still blocks at `must` without voting on the weights.
        expect: {
            predicate: (move, state) =>
                move?.kind === "cast-spell" &&
                instanceIdsForName(state, "Sutured Ghoul").has(
                    move.cardInstanceId
                ),
            describe: "casts Sutured Ghoul",
        },
        note: "Issue #6671. `choose-graveyard-card` had no candidate generator, so a probe of the cast stopped at the suspended as-enters prompt and scored seven mana spent for a body still parked in `stagedEntries`: the Bot-play sweep read the card `never-chosen`. Proof-of-failure: unregistering `choose-graveyard-card` from `CHOICE_CANDIDATE_GENERATORS` reds this entry.",
    },
    {
        // The answer itself: the node is reached by really casting the Ghoul
        // and resolving it, and the pile is the whole card.
        label: "choose-graveyard-card: Sutured Ghoul exiles both creature cards from its graveyard",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Sutured Ghoul", owner: "me", zone: "hand" },
                { name: "Swamp", owner: "me", zone: "battlefield", count: 7 },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "graveyard",
                    count: 2,
                },
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        },
        setup: [
            { kind: "cast", card: "Sutured Ghoul", by: "me" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: {
            predicate: (move) =>
                move?.kind === "resolution-choice" &&
                move.cardInstanceIds.length === 2,
            describe: "exiles both Grizzly Bears, never declines",
        },
        note: "Issue #6671. The size of the exiled pile is the Ghoul's power and toughness, so declining leaves a 0/0 that dies to state-based actions (CR 704.5f). Proof-of-failure: the same unregistering reds this entry.",
    },
    {
        // TEXT-DEFINED TARGET COUNT reachability (CR 601.2c / 107.3). Reap:
        // "Return up to X target cards from your graveyard to your hand, where
        // X is the number of black permanents target opponent controls as you
        // cast this spell." The opponent controls two black permanents and the
        // bot's graveyard holds three cards, so the bound (2) is the limit: the cast must be
        // offered with the opponent announced first and up to two cards, and
        // never with a third.
        //
        // FAIRNESS BY CONSTRUCTION (ADR 0070 §1): a legal-set assertion, not a
        // preference — whether to cast Reap now is a matter of opinion, whether
        // the enumerator can express its announcement is not.
        label: "text-defined target count: Reap is offered with the opponent first and at most X graveyard cards (CR 601.2c)",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Reap", owner: "me", zone: "hand" },
                { name: "Forest", owner: "me", zone: "battlefield", count: 2 },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "graveyard",
                    count: 3,
                },
                {
                    name: "Black Knight",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            predicate: boundedGraveyardCastIsOffered,
            describe:
                "Reap is enumerated with the opponent announced first and exactly the bound's worth of graveyard cards at most",
        },
        note: "Issue #5703. Reap is the first card whose target count is a quantity read at announcement (`TargetCountQuantity`, issue #6526); `enumerateMoves` enumerates the graveyard group once per prefix of the earlier picks. A reachability guard on the legal set — the choice itself is a preference no entry here asserts.",
    },
    {
        // LAND-MANA SUBSTITUTION reachability (CR 106.7 / 614). The bot's main
        // phase, Infernal Darkness on its side, two Forests and a Black Knight
        // ({B}{B}) in hand. Every land taps for {B} instead of its type, so the
        // Forests pay the Knight; read off the unreplaced option list they are
        // two {G} sources, the black pips are uncovered, and the cast is never
        // enumerated — the bot holds the Knight forever with every suite green.
        //
        // A reachability claim, kept a `predicate` out of the weight fit for the
        // reason the depletion-land entry above gives.
        label: "land-mana substitution: casts a {B}{B} creature off two Forests under Infernal Darkness",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Infernal Darkness", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield", count: 2 },
                { name: "Black Knight", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "cast-spell" &&
                move.tapPlan?.length === 2,
            describe: "casts Black Knight, paying {B}{B} with the two Forests",
        },
        note: "CR 106.7 / 614: the planner and the castability census read the mana a tap would add (`getManaTapOptionsDetailed` under `replaceLandManaType`). Issue #3744.",
    },
    {
        // CR 400.11b (issue #6523) — the Wish pick. The pick is optional
        // ("you may", `count.min` 0), and a minimal-legal answer to an
        // optional pick is the empty one: before the
        // `choose-outside-game-card` generator and resolver, the bot paid
        // for Burning Wish and fetched nothing. The sideboard also holds a
        // creature the filter refuses, so the only legal card is the sorcery.
        label: "wish: brings the sorcery in from outside the game rather than declining",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Burning Wish", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 2,
                },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                {
                    name: "Mountain",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            outsideGame: [{ name: "Mind Twist" }, { name: "Craw Wurm" }],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        setup: [
            { kind: "cast", card: "Burning Wish", by: "me" },
            { kind: "resolve-top" },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            moves: [{ kind: "resolution-choice", card: "Mind Twist" }],
        },
        note: "Issue #6523 — the root decision is the live `choose-outside-game-card` pick (CR 400.11b), reached by really casting and resolving Burning Wish. Declining leaves the bot a card down for the two mana it already spent.",
    },
    {
        // FUTILE KICKER (issue #6904) — a discriminating pair. Thornscape
        // Battlemage's {W} Kicker is read only by "destroy target artifact";
        // with no artifact on the board that trigger is removed from the stack
        // (CR 603.3d), so paying {W} is the unkicked cast one land poorer. The
        // pair differs only in the opposing Sol Ring.
        label: "futile Kicker: casts Thornscape Battlemage without the {W} Kicker when no artifact stands",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an artifact for the {W} Kicker trigger to destroy",
            },
        },
        spec: {
            cards: [
                { name: "Thornscape Battlemage", owner: "me", zone: "hand" },
                {
                    name: "Forest",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Plains", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "cast-spell" &&
                (move.kickerPayments?.["kicker-w"] ?? 0) === 0,
            describe:
                "casts Thornscape Battlemage without paying the {W} Kicker",
        },
        note: "Issue #6904 — Bot-only prune `withoutFutileKickerVariants` (`gre/ai/futileKicker.ts`), the sibling of the evoke prune (issue #4900). Pair with the next entry. MEASURED HONESTLY: at this budget the existing root mechanisms already pick the unkicked cast, so this entry is green with or without the prune — it pins the outcome, the discriminating proof is `futileKicker.bot.test.ts` (red with the filter disabled).",
    },
    {
        label: "futile Kicker: casts Thornscape Battlemage {W}-kicked to destroy an opposing artifact",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "card",
                detail: "an artifact for the {W} Kicker trigger to destroy",
            },
        },
        spec: {
            cards: [
                { name: "Thornscape Battlemage", owner: "me", zone: "hand" },
                {
                    name: "Forest",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Sol Ring", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        expect: {
            predicate: (move) =>
                move !== null &&
                move.kind === "cast-spell" &&
                (move.kickerPayments?.["kicker-w"] ?? 0) > 0,
            describe: "casts Thornscape Battlemage paying the {W} Kicker",
        },
        note: "Issue #6904 — the other half of the pair: with an artifact the {W}-kicked variants are offered again, and the Bot takes the Sol Ring.",
    },
    {
        label: "this-turn tap activations: leaves Samite Pilgrim and Dega Disciple untapped in a quiet main phase",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "no combat and an empty stack, so nothing can consume a this-turn shield or P/T change",
            },
        },
        spec: {
            cards: [
                {
                    name: "Samite Pilgrim",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Dega Disciple",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Craw Wurm",
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
        budget: { iterations: 40 },
        seeds: [0xb1ade, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        tier: "must",
        expect: {
            forbidden: [
                { kind: "activate-ability", card: "Samite Pilgrim" },
                { kind: "activate-ability", card: "Dega Disciple" },
            ],
        },
        note: "Issue #6905, position A. A prevent-the-next-N shield (CR 615.1a) and an until-end-of-turn P/T change (CR 611.2) buy nothing when no combat or stack object can reach the creature before the Bot next holds priority; the tap would only cost the source its attack or block. `isFutileThisTurnMove` (`gre/ai/futileShield.ts`) prunes them and `isMisdirectedThisTurnMove` removes the wrongly-signed targets. Red without the prune at 40 iterations; the entries below are its positive controls.",
    },
    {
        label: "this-turn tap activations: Samite Pilgrim shields its own blocker, never the attacker",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "the Bot's blocker faces lethal combat damage",
            },
        },
        spec: {
            cards: [
                {
                    name: "Samite Pilgrim",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Plains", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_BLOCKERS",
            activePlayer: "opp",
            priority: "me",
            combat: {
                attackers: ["Hill Giant"],
                confirmed: true,
                blockers: [{ blocker: "Grizzly Bears", blocking: [0] }],
                blockersConfirmed: true,
            },
            turn: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 40 },
        seeds: [0xb1ade, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "activate-ability",
                    card: "Samite Pilgrim",
                    target: "Grizzly Bears",
                },
            ],
        },
        note: "Issue #6905, position B — the discriminating twin of position A: the same Pilgrim, now with its blocker facing 3 damage a shield of 3 absorbs (Domain counts Plains, Mountain, Swamp). The prune must leave the own-creature target standing and the sign check must drop the attacker as a target.",
    },
    {
        label: "this-turn tap activations: Dega Disciple pumps its own blocked attacker to kill the blocker",
        classification: {
            kind: "conditional",
            discriminant: {
                kind: "other",
                detail: "+2/+0 turns the Bot's blocked attacker into a kill",
            },
        },
        spec: {
            cards: [
                {
                    name: "Dega Disciple",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Craw Wurm",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_BLOCKERS",
            activePlayer: "me",
            priority: "me",
            combat: {
                attackers: ["Hill Giant"],
                confirmed: true,
                blockers: [{ blocker: "Craw Wurm", blocking: [0] }],
                blockersConfirmed: true,
            },
            turn: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 40 },
        seeds: [0xb1ade, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        tier: "must",
        expect: {
            moves: [
                {
                    kind: "activate-ability",
                    card: "Dega Disciple",
                    target: "Hill Giant",
                },
            ],
        },
        note: "Issue #6905, position C. The 3/3 cannot kill the 6/4 Craw Wurm, +2/+0 makes it (CR 510.1); the pump on the Bot's own attacker is the only correctly-signed target, and -2/-0 only ever points at an opposing creature.",
    },
];
