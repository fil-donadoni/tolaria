// Colour-aware mana availability (issue #3531, PRD #3526).
//
// The ONE reader the bot asks "can THESE sources pay THIS cost right now".
// Before it, every such question in the leaf heuristic and the search was
// `manaValue(cost) <= availableManaFor(player)` — a scalar comparison that
// cannot see colour, so a Lightning Bolt held with three Islands counted as a
// live combat trick and a base of five Mountains counted as covering a hand
// that wants {B}{B}.
//
// The question is asked of a SET OF SOURCES, never of a player: that is what
// lets the same primitive answer "what can I pay with right now" (untapped
// sources + pool), "what is my mana BASE for" (every source I control, tap
// state ignored) and — the next slice of PRD #3526 — the same question about
// the sources an OPPONENT visibly controls. Own seat only here: nothing in
// this module reads a hidden zone.
//
// Built over `getManaTapOptionsDetailed` (CR 605.1a / 305.6) and the shared
// greedy `coverColoredAndHybridPips` (`payWith.ts`) the real castability gate
// (`coloredCostLeftover`, `rules.ts`) uses, so the bot's model and the gate
// cannot drift: `coloredCostLeftover` calls `boardManaUnits` below for its own
// battlefield census, and `getProducibleManaUnits` MOVED here from `rules.ts`
// rather than being copied.
//
// WHAT IT DELIBERATELY DOES NOT MODEL. Each of these needs the CARD being cast
// and the board's cost modifiers, which `coloredCostLeftover` has in hand and a
// leaf heuristic scoring an ISMCTS node does not. They do NOT all fail the same
// way, and saying otherwise would be the kind of blanket soundness claim that
// hides the ones that bite:
//
//   * UNDER-approximating (the reader says "can't pay" where the gate would say
//     it can — safe for a term that pays a bonus): the cast-scoped resources
//     (`convoke` / `delve` / `improvise`, CR 601.2g), the CR 609.4b "spend as
//     though it were mana of any colour" substitutions, restricted mana whose
//     restriction permits the spell (CR 106.6), and a CR 601.2f cost REDUCTION.
//   * OVER-approximating (the reader says "can pay" where the gate would not —
//     the direction that credits an option the seat does not hold): a CR 601.2f
//     cost INCREASE (Thalia, Sphere of Resistance), since `getInstanceManaCost`
//     is the PRINTED cost and the gate prices the post-modifier one; and
//     `cantSpendManaToCast` (CR 601.2f, Hogaak), which zeroes every mana source
//     at the gate and nothing here. Both are inherited unchanged from the
//     `manaValue` proxy this reader replaces — it read the same printed cost
//     and knew nothing of either — so neither is a regression, and neither is
//     fixed here. tracked-by: #3531
//
// PURE. No async, no state mutation.

import type { CardInstanceState, GameState, PlayerState } from "./state";
import { normalizeManaCost, unrestrictedFloatingMana } from "./state";
import type { Color, ManaCost } from "../cards/types";
import { normalizedHybridPips } from "./manaColors";
import {
    MANA_COLORS,
    getManaTapOptionsDetailed,
    isTapLockedBySummoningSickness,
    manaGateBattlefields,
    pureGenericManaSubCost,
} from "./constants";
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
import { manaConverterColors } from "./manaConverters";
import { tapManaBonusUnits } from "./tapManaBonus";
import { coverColoredAndHybridPips } from "./payWith";

/** One entry per INDIVIDUAL mana a set of sources could produce, each entry the
 *  set of colours that mana could be. The currency every question below is
 *  asked in. */
export type ManaUnits = ReadonlyArray<ReadonlySet<Color>>;

/** A both-players battlefield view, as `getManaTapOptionsDetailed` wants it. */
type BattlefieldsView = ReadonlyArray<{
    playerId: string;
    battlefield: readonly CardInstanceState[];
}>;

/** Returns one entry per INDIVIDUAL mana a permanent could produce from a
 *  single tap, each entry being the set of colors that mana could be. A source
 *  that taps for multiple mana (Sol Ring → {C}{C}) yields multiple entries, so
 *  affordability counts the real quantity, not one-per-source.
 *
 *  A tap is a single shared cost, so only ONE mana ability can be used per
 *  activation (CR 605.1a) — but when a permanent declares MULTIPLE tap
 *  abilities (Starting Town: "{T}: Add {C}" and "{T}, Pay 1 life: Add one mana
 *  of any color", issue #1695) they are ALTERNATIVES for that same tap, not
 *  competitors where only the "best" one counts.
 *
 *  Single-authority form (issue #1695 finding 1, review-blocking): the unit
 *  list is derived from `getManaTapOptionsDetailed(…, { requireTap: true })`
 *  — the SAME list `getProducibleManaOptions` (the real auto-tap payment
 *  planner) and the tap mutations read — instead of re-deriving a parallel
 *  ability filter here. A prior version of this fix unioned every
 *  `activatedAbilities` entry with `!ability.cost.tap` as the only exclusion,
 *  which missed that `getManaTapOptionsDetailed` ALSO drops every
 *  sacrifice-cost option whenever a non-sacrifice tap option exists on the
 *  same source (`combined = nonSacrifice.length > 0 ? nonSacrifice :
 *  sacrifice` — "prefer non-destructive options; fall back to sacrifice only
 *  when there is no other way to tap this source for mana", constants.ts).
 *  Archaeological Dig ("{T}: Add {C}" / "{T}, Sacrifice: Add one mana of any
 *  color") is the case: only {C} is ever payable, but the old per-ability
 *  union offered the gate all five colors — a false-positive Cast button the
 *  payment step then refused. Routing through the shared helper makes the
 *  gate and the payment planner agree by construction; a life-cost ability
 *  (Starting Town) is NOT bucketed as a sacrifice option (only `cost
 *  .sacrifice` is), so the already-verified "errs toward affordable" bias for
 *  life costs is unchanged.
 *
 *  Every entry in the shared list (`ManaTapOption`) is one whole tap
 *  alternative — one ability's output, or one basic-land-subtype's intrinsic
 *  `{T}: Add C` (CR 305.6, folded in by `getManaTapOptionsDetailed` itself) —
 *  and only ONE alternative is ever used per tap. Each alternative is expanded
 *  into its own ordered per-mana colour-set list (one entry per unit of mana
 *  it produces), then every alternative is unioned position-by-position: the
 *  unit COUNT is the largest quantity any single alternative can produce
 *  (matches the existing "real quantity, not one-per-source" rule — only one
 *  alternative fires per tap, so quantity can't be summed across them), and
 *  each position's COLOR SET is the union of every alternative's colour at
 *  that position. An alternative shorter than the max simply has nothing to
 *  contribute past its own length, so it never inflates the quantity another
 *  alternative alone wouldn't already claim. This keeps the result
 *  declaration-order-independent (issue #1695 AC) and preserves the Sol
 *  Ring-style two-mana case (only one ability, no regression). A choice
 *  ability (dual land / Talisman) contributes one option per choice, so its
 *  colours land in the union exactly like the old "one unit, colors = union
 *  of choices" special case did.
 *
 *  NOTE — `manaRestriction` is NOT consulted here, same as before this
 *  rewrite: this list only tracks which raw colours a source could ever
 *  produce, not whether the resulting mana is legally spendable on a given
 *  spell. Restricted mana is honoured only once it reaches the pool, at
 *  `coloredCostLeftover` below (CR 106.6). Delighted Halfling (issue #1559)
 *  IS now exactly the previously-hypothetical shape: an UNRESTRICTED `{C}`
 *  tap ability combined with a SEPARATE, RESTRICTED-any-colour tap ability
 *  ("Spend this mana only to cast a legendary spell..."). The leak is real
 *  and live: this gate unions both abilities' colours with no restriction
 *  awareness, so the castability check (whatever consumes
 *  `getProducibleManaUnits`, e.g. offering "Cast" on a spell) treats the
 *  restricted any-colour mana as freely spendable, and will offer "cast" for
 *  a NON-legendary spell the restricted mana can't legally pay for (CR 106.6
 *  is still enforced correctly at actual payment time —
 *  `payManaCostForSpell` / `spendablePoolForSpell` — so no illegal cast can
 *  ever actually commit; this is a castability-AFFORDANCE overcount, not a
 *  legality hole). tracked-by: #1733 */
export function getProducibleManaUnits(
    card: CardInstanceState,
    /** CR 602.5b / 605.1a (issue #1695 re-review, regression fix) — the
     *  controller's id + a REAL, BOTH-PLAYERS `battlefields` view (built by
     *  `coloredCostLeftover` from `opts.state` when a caller has one).
     *  Board-dependent `canActivate` (Mox Opal's Metalcraft, Fanatic of
     *  Rhonas's Ferocious — both scan only the controller's own battlefield,
     *  `hasMetalcraft` in `types.ts` / the Ferocious closure in `mh3/green.ts`)
     *  AND board-dependent `getManaChoices` (Fellwar Stone scans every OTHER
     *  player's battlefield) both need it. Omitting these args (as this
     *  function did before this fix) makes `minimalManaGateView` fall back to
     *  `{ players: [] }`, so `canActivate` is permanently false and the mana
     *  ability is dropped from the gate even though the real board — the one
     *  `convex/game.ts`'s payment planner passes — satisfies it. A view
     *  containing only the controller's OWN entry is NOT a safe substitute:
     *  Fellwar Stone's chooser explicitly skips any entry matching
     *  `controllerId`, so an own-only view makes it see zero opponents and
     *  return `[]` — which the caller treats as "no options" rather than
     *  falling back to the static list, trading the current safe
     *  over-approximation for an under-approximating hidden-cast bug of this
     *  same shape. See `coloredCostLeftover`'s `opts.state` doc for why this
     *  is only ever populated from a full `GameState`, never from `player`
     *  alone. */
    controllerId?: string,
    battlefields?: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>
): Set<Color>[] {
    // requireTap: only a genuine {T} ability counts as an auto-payable "unit"
    // — the SAME `requireTap: true` invariant `getProducibleManaOptions` (the
    // real auto-tap planner) uses. Board view is identical between the two
    // WHEN THE CALLER HAS PASSED A `state` (issue #1751 finding 4, closed
    // fully by issue #1754): this function is fed the FULL, both-players
    // `battlefields` view built from `opts.state` (via `coloredCostLeftover`,
    // only when a caller has one — see that param's own doc), and
    // `getProducibleManaOptions`'s one caller (`planManaPayment`, moves.ts)
    // always builds and passes the same FULL, both-players view from its own
    // (mandatory) `state` param — so a self-referential ability (Mox Opal's
    // Metalcraft, Fanatic of Rhonas's Ferocious) AND an opponent-scanning
    // chooser (Fellwar Stone) are both visible to the two callers identically
    // ON THAT PATH. Issue #1757 closed the last board-blind `coloredCostLeftover`
    // callers that used to pass no `state` at all: `maxAffordableX`'s
    // bot-enumeration call site in moves.ts, every `genericManaShortfall`
    // caller, AND — a fifth holdout the reviewer's escalation surfaced in the
    // same round — the Phyrexian split solver's two remaining state-less call
    // sites (`solvePhyrexianSplit` in `enumerateCastMoves`, moves.ts, and
    // `resolvePhyrexianCastPayment` on the real server cast path, game.ts,
    // finding 1 / finding 2), plus `phyrexianLifePipOptions`'s
    // `projectPublicState` call site (gameProjections.ts, found while
    // verifying this very comment). Every caller now has a `state` in scope
    // and passes it, so this function only falls back to `undefined,
    // undefined` (board-blind) for a caller that genuinely has no `GameState`
    // on hand (there is none today); the "identical" guarantee is no longer
    // scoped to a subset of callers.
    const detailed = getManaTapOptionsDetailed(
        card,
        controllerId,
        battlefields,
        {
            requireTap: true,
        }
    );

    // Issue #2420 review finding 2 — the widened `requireTap` gate now also
    // returns a PURE-GENERIC `cost.mana` option (Farrelite Priest's
    // repeatable "{1}: Add {W}"), which is NET ZERO: activating it spends as
    // much generic mana as it returns, unlike a genuine {T} source. Counting
    // its produced colour as a free +1 unit (the pre-fix behaviour) let
    // `canPotentiallyPayCost` (below) offer "Cast" on a spell that was NOT
    // actually payable — measured on [Farrelite Priest, Plains] casting
    // Island Sanctuary {1}{W}. Net the ability's own funding requirement out
    // of its produced units so this affordance census matches what
    // `planManaPayment` (moves.ts) can ACTUALLY realise (it funds the same
    // sub-cost from an OTHER plain source, `fundGenericFromPlain`) —
    // deliberately still an OVER-approximation elsewhere (this function's own
    // header), never an under-approximation: a net-negative shape
    // (Nomadic Elf's `{X:1,G:1}`) is excluded upstream by
    // `isAutoPayableManaAbilityCost` (constants.ts) and never reaches
    // `detailed` at all, so it needs no clamp here.
    const perOptionUnits: Set<Color>[][] = detailed.map((opt) => {
        const units: Set<Color>[] = [];
        for (const c of MANA_COLORS) {
            const amount = opt.mana[c] ?? 0;
            for (let i = 0; i < amount; i++) units.push(new Set<Color>([c]));
        }
        if (opt.source.kind === "activated") {
            const abilityId = opt.source.abilityId;
            const ability = getEffectiveActivatedAbilities(card).find(
                (r) => r.ability.id === abilityId
            )?.ability;
            // Issue #2420 review round 2 finding 2 — a `tapOtherFilter`
            // ability (Urza, Lord High Artificer's "Tap an untapped
            // artifact you control: Add {U}.") taps a DIFFERENT permanent
            // than `card`, so its produced mana is never CARD's own unit —
            // counting it here double-counted the fodder artifact against
            // that SAME artifact's own row, elsewhere in this same census
            // (measured: [Urza, Mox Sapphire] casting Lord of Atlantis
            // {U}{U} — offered "cast" although `planManaPayment` returns
            // null). This function contributes 0 for a `tapOtherFilter`
            // ability's OWNER; `coloredCostLeftover` (below) models the
            // real capacity instead, by widening each matching untapped
            // FODDER candidate's own row with the ability's produced
            // colours — capacity bounded at one unit per physical
            // permanent, never per ability.
            if (ability?.cost.tapOtherFilter) {
                units.length = 0;
            }
            const generic = ability?.cost.mana
                ? pureGenericManaSubCost(ability.cost.mana)
                : null;
            if (generic !== null && generic > 0) {
                units.splice(Math.max(0, units.length - generic));
            }
        }
        return units;
    });

    const maxLen = perOptionUnits.reduce((m, u) => Math.max(m, u.length), 0);
    const best: Set<Color>[] = [];
    for (let i = 0; i < maxLen; i++) {
        const colors = new Set<Color>();
        for (const units of perOptionUnits) {
            for (const c of units[i] ?? []) colors.add(c);
        }
        best.push(colors);
    }
    return best;
}

/** Both mana censuses of one battlefield, from ONE walk (issue #3531).
 *
 *  - `now` — what its controller can actually spend this instant: untapped,
 *    not summoning-locked (CR 302.1).
 *  - `base` — every mana source they control, tap state ignored: what the mana
 *    BASE is made of, which is the quantity mana DEVELOPMENT is about (a tapped
 *    Swamp and a summoning-sick Llanowar Elves are both part of the base and
 *    neither can pay for anything right now).
 *
 *  ONE walk because `getManaTapOptionsDetailed` is the expensive part and both
 *  questions want the same per-permanent answer. MEASURED on the ISMCTS leaf
 *  path (10 permanents a side, 5 instants in hand, 20k `evaluate` calls, three
 *  interleaved runs): the scalar proxy this reader replaces ran 49.8 / 58.1 /
 *  54.5 µs per call and the shared census runs 72.2 / 67.2 / 68.0 — about +28%,
 *  which is the price of the colour information itself. Two independent walks
 *  cost roughly half as much again, and bought nothing: the tap-state gates are
 *  the only difference between the two lists.
 *
 *  A cheap `hasManaAbility` pre-filter would skip the expensive call for the
 *  creatures that make up most of a battlefield — and is deliberately NOT here:
 *  `coloredCostLeftover` (the real castability gate, `rules.ts`) shares this
 *  census and has never had one, so adding it would move the CAST AFFORDANCE
 *  for any source the two probes disagree about. A perf tweak must not change
 *  which spells the client offers.
 *
 *  Both lists are folded exactly as the castability gate folds them (CR 605.1a
 *  / 605.4 / 302.1):
 *
 *  - one entry per mana a source taps for, so a {C}{C} source (Sol Ring) is two
 *    units and not one (issue #132);
 *  - a `tapOtherFilter` converter (Urza's "Tap an untapped artifact you
 *    control: Add {U}") WIDENS each matching fodder permanent's own row rather
 *    than adding an independent unit, which would double-count the fodder
 *    (issue #2420) — `manaConverterColors` is the same authority
 *    `planManaPayment` plans against;
 *  - a Wild-Growth-style triggered mana ability (CR 605.4) on another permanent
 *    adds its bonus units, gated on the land actually producing base mana,
 *    because the trigger only fires on a for-mana tap. */
export function boardManaCensus(
    battlefield: readonly CardInstanceState[],
    opts: {
        converters?: ReadonlyMap<string, ReadonlySet<Color>>;
        controllerId?: string;
        battlefields?: BattlefieldsView;
        /** Skip the `base` list when no caller wants it — the leaf heuristic
         *  asks for both, `coloredCostLeftover` only for `now`. */
        wantBase?: boolean;
    } = {}
): { now: Set<Color>[]; base: Set<Color>[] } {
    const converters = opts.converters;
    const wantBase = opts.wantBase ?? true;
    const now: Set<Color>[] = [];
    const base: Set<Color>[] = [];
    for (const perm of battlefield) {
        const widen = converters?.get(perm.id);
        // CR 302.1 — a summoning-sick permanent can't pay {T}. It CAN still be
        // tapped to pay another permanent's `tapOtherFilter` cost (CR 302.6
        // gates a {T}/{Q} cost and nothing else), so it still contributes the
        // converter's colours as its one unit RIGHT NOW.
        const spendableNow =
            !perm.isTapped && !isTapLockedBySummoningSickness(perm);
        if (!spendableNow && !wantBase) {
            if (!perm.isTapped && widen && widen.size > 0) {
                now.push(new Set(widen));
            }
            continue;
        }
        const units = getProducibleManaUnits(
            perm,
            opts.controllerId,
            opts.battlefields
        );
        const row: Set<Color>[] = [];
        if (widen && widen.size > 0) {
            // Fold the converter's colours into ONE unit — the FIRST slot of
            // this permanent's own row when it has one (a second, independent
            // unit would re-introduce the double-count), or a single new row
            // when `perm` has no mana ability of its own.
            if (units.length > 0) {
                row.push(new Set([...units[0], ...widen]));
                for (let i = 1; i < units.length; i++) row.push(units[i]);
            } else {
                row.push(new Set(widen));
            }
        } else {
            for (const unit of units) row.push(unit);
        }
        if (units.length > 0) {
            for (const unit of tapManaBonusUnits(battlefield, perm)) {
                row.push(unit);
            }
        }
        if (wantBase) for (const unit of row) base.push(new Set(unit));
        if (spendableNow) {
            for (const unit of row) now.push(unit);
        } else if (!perm.isTapped && widen && widen.size > 0) {
            now.push(new Set(widen));
        }
    }
    return { now, base };
}

/** The `now` half of {@link boardManaCensus} — what this battlefield can pay
 *  with this instant. `coloredCostLeftover` (`rules.ts`) asks for exactly this,
 *  so the gate and the bot share one census. */
export function boardManaUnits(
    battlefield: readonly CardInstanceState[],
    opts: {
        converters?: ReadonlyMap<string, ReadonlySet<Color>>;
        controllerId?: string;
        battlefields?: BattlefieldsView;
    } = {}
): Set<Color>[] {
    return boardManaCensus(battlefield, { ...opts, wantBase: false }).now;
}

/** The floating pool as units (CR 106.4) — one entry per mana, each a fixed
 *  single colour. */
function poolUnits(player: PlayerState): Set<Color>[] {
    const units: Set<Color>[] = [];
    for (const c of MANA_COLORS) {
        const n = player.manaPool[c] ?? 0;
        for (let i = 0; i < n; i++) units.push(new Set<Color>([c]));
    }
    // CR 106.6 (issue #3235) — floating mana that is tagged but not RESTRICTED
    // (a rider, or firebending's end-of-combat lifetime) is spendable on
    // anything, so it is pool mana as far as this census is concerned. Without
    // it a bot that just attacked with a firebender reads its own four red as
    // zero. Genuinely restricted units stay out: their eligibility depends on
    // the cost being paid, which this census does not know.
    for (const unit of unrestrictedFloatingMana(player)) {
        if (!(MANA_COLORS as readonly string[]).includes(unit.color)) continue;
        for (let i = 0; i < unit.amount; i++) {
            units.push(new Set<Color>([unit.color as Color]));
        }
    }
    return units;
}

/** Both of `player`'s mana censuses, pool included, from one battlefield walk
 *  (issue #3531): `now` is what they can pay with this instant — the
 *  colour-aware replacement for the scalar `availableManaFor` proxy — and
 *  `base` is what their mana base is made of.
 *
 *  `state` is threaded so a board-dependent mana ability is judged against the
 *  REAL, BOTH-PLAYERS board, exactly as the castability gate judges it: Mox
 *  Opal's Metalcraft and Fanatic of Rhonas's Ferocious scan the controller's
 *  own battlefield, Fellwar Stone scans every OTHER player's. A view built
 *  from `player` alone is NOT a safe substitute — Fellwar Stone's chooser
 *  skips the entry matching `controllerId`, sees zero opponents and returns
 *  `[]`, which reads as "no options" instead of falling back to its static
 *  list. Omitted entirely, `minimalManaGateView(undefined)` makes every
 *  board-dependent `canActivate` false, so such a source drops out of the
 *  census — the safe, under-approximating direction, and the fallback for a
 *  caller with no `GameState` on hand.
 *
 *  The floating pool joins BOTH halves: mana already in the pool is spendable
 *  now (CR 106.4) and is evidence the base produced it. */
export function manaCensusFor(
    state: GameState | undefined,
    player: PlayerState
): { now: Set<Color>[]; base: Set<Color>[] } {
    const battlefields = state ? manaGateBattlefields(state) : undefined;
    const census = boardManaCensus(player.battlefield, {
        converters: state ? manaConverterColors(state, player) : undefined,
        controllerId: battlefields ? player.id : undefined,
        battlefields,
    });
    for (const unit of poolUnits(player)) {
        census.now.push(unit);
        census.base.push(new Set(unit));
    }
    return census;
}

/** One half of {@link manaCensusFor}, for a caller that wants only one. */
export function manaUnitsFor(
    state: GameState | undefined,
    player: PlayerState,
    opts: { ignoreTapState?: boolean } = {}
): Set<Color>[] {
    const census = manaCensusFor(state, player);
    return opts.ignoreTapState ? census.base : census.now;
}

/** The normalized cost this module prices, with Phyrexian pips folded (CR
 *  107.4f / 202.3f).
 *
 *  `normalizeManaCost` drops the `phyrexian` record entirely — its value is an
 *  object, not a number — so a Phyrexian pip would read as FREE here, which
 *  over-approximates castability in the one direction this reader must not.
 *  Each pip is charged as one GENERIC mana while the caster can still afford
 *  the 2-life alternative, and as its own COLOUR once they cannot. Charging
 *  the life-payable pip as generic rather than as nothing is deliberate: it is
 *  exactly what the `manaValue` proxy this reader replaces already charged, so
 *  a Phyrexian cost never becomes MORE castable than it was, and the full
 *  mana-vs-life split space stays where it belongs — `solvePhyrexianSplit`, on
 *  the real cast path. */
function pricedCost(
    cost: ManaCost,
    life: number
): {
    normalized: Record<string, number>;
    hybrid: ReadonlyArray<readonly [Color, Color]>;
} {
    const normalized = normalizeManaCost(cost);
    if (cost.phyrexian) {
        let lifeLeft = life;
        for (const [color, count] of Object.entries(cost.phyrexian)) {
            for (let i = 0; i < (count ?? 0); i++) {
                if (lifeLeft >= 2) {
                    lifeLeft -= 2;
                    normalized.X = (normalized.X ?? 0) + 1;
                } else {
                    normalized[color] = (normalized[color] ?? 0) + 1;
                }
            }
        }
    }
    return { normalized, hybrid: normalizedHybridPips(normalized) };
}

/** Whether `units` can pay `cost` outright — every coloured and hybrid pip
 *  matched to its OWN source, and enough sources left over for the generic
 *  portion. The colour-aware replacement for
 *  `manaValue(cost) <= availableManaFor(player)`, and the exact greedy
 *  (`coverColoredAndHybridPips`) the real castability gate runs from
 *  `coloredCostLeftover` (`rules.ts`), so the bot's model and the gate cannot
 *  disagree about what a board can cast. */
export function canPayCost(
    units: ManaUnits,
    cost: ManaCost | undefined,
    opts: { life?: number } = {}
): boolean {
    if (!cost) return true;
    const { normalized, hybrid } = pricedCost(cost, opts.life ?? 0);
    const leftover = coverColoredAndHybridPips(units, normalized, hybrid);
    return leftover !== null && leftover >= (normalized.X ?? 0);
}

/** Whether `units` contain a source for every COLOUR `cost` demands — a
 *  membership question, not a matching one, and deliberately blind to HOW MANY
 *  sources each pip would need.
 *
 *  This is the question a mana BASE answers, and it is a different question
 *  from {@link canPayCost}. Being on curve is about a base a hand is developing
 *  TOWARD: one Island and a held Counterspell ({U}{U}) is the canonical
 *  "behind on lands" position, and `manaDevelopmentTerm` exists to price
 *  exactly it. Running the pip-matching greedy here would answer `null` for
 *  that hand — it consumes one distinct source per pip — so demand could never
 *  exceed the source count, `min(lands, curveTop)` would collapse to
 *  `curveTop`, and the whole "you are behind" half of the term would be
 *  deleted in the commonest shape there is. Five Mountains still develop
 *  nothing toward {B}{B}, which is the blindness this separates out; one Island
 *  develops plenty toward {U}{U}.
 *
 *  A hybrid pip (CR 202.1a) is covered when EITHER of its colours is present —
 *  the same "any source holding either" rule the greedy uses.
 *
 *  Generic and {X} pips demand no colour at all, so they are ignored here;
 *  colourless {C} is a real requirement and is matched like any other. */
export function coversCostColors(
    units: ManaUnits,
    cost: ManaCost | undefined,
    opts: { life?: number } = {}
): boolean {
    if (!cost) return true;
    const { normalized, hybrid } = pricedCost(cost, opts.life ?? 0);
    for (const c of MANA_COLORS) {
        if ((normalized[c] ?? 0) === 0) continue;
        if (!units.some((u) => u.has(c))) return false;
    }
    for (const [c1, c2] of hybrid) {
        if (!units.some((u) => u.has(c1) || u.has(c2))) return false;
    }
    return true;
}
