// The AI Bot's Brain gate — the pure "does the bot owe an action?" check
// (ADR 0001, issues #109–#111).
//
// `BotView` / `decideBotAction` are the cheap main-thread GATE: a constant-time
// look at the current window that decides whether the bot owes any action at all
// before paying for a Worker round-trip. The actual move CHOICE lives in the GRE
// (`search` — issue #112: ISMCTS over a determinized tree, scored by `evaluate`;
// it supersedes the greedy 1-ply selector of #111), which the Worker
// (`brain.worker.ts`) runs off the UI thread. Both layers are pure and tested
// without a browser; this file is the gate only.
//
// Mid-resolution interactive choices (ADR 0016) split TWO ways (issue #1506):
//
//  * A choice kind WITH a registered candidate generator is an in-tree ISMCTS
//    decision node (PRD #1423 / issue #1425): `decidingPlayer` names its owner
//    and `enumerateMoves` surfaces the candidate submissions. `buildOwedChoice`
//    marks such a choice `searchable`, and the gate answers `search-choice` —
//    a WORKER-realised action, so the SEARCH picks the answer.
//  * A choice no generator applies to (`isSearchableChoiceNode` → false) is still
//    resolved RIGHT HERE on the main thread, like the mulligan heuristic:
//    `chooseOwedChoiceAction` / `chooseResolution` give the bot a
//    weak-but-legal default for every `PendingChoiceKind`, so the game always
//    advances whatever the choice.
//
// The split is registry-driven, never a hand-maintained kind list: a kind that
// gains a generator automatically stops being heuristic-answered (locked by
// `bot-action-dispatch.bot.test.ts`, which enumerates the registry). The
// heuristic ALSO stays the driver's safety net — if the search surfaces no move
// for a searchable choice, `useVsAiDriver` falls back to it rather than stall.

import type { PendingChoiceKind } from "@convex/gre";
import type { AsEntersChoice } from "@convex/cards/types";
import type { ExpectedInputKind } from "@convex/gre/expectedInput";
import type { OwedInput } from "./owed-input";
import type { OwedPayment, ParkKind } from "@convex/gre/owedPayment";
import type { OwedPaymentSubmission } from "@convex/gre/paymentPicks";
import type {
    CastExileChoiceView,
    ConvokeChoiceView,
    ManaSpendChoiceView,
} from "@convex/gre/paymentPicks";
import {
    chooseCastExileCost,
    chooseConvokeCreatures,
    chooseManaSpendOrder,
} from "@convex/gre/paymentPicks";
import type { Color, TargetSelection } from "@convex/cards/types";
import {
    canAddCategorizedPick,
    type PickCategory,
} from "@convex/gre/categorizedPick";

/** The minimal slice of game state the bot needs to decide. Built on the
 *  driving client from the full state (the bot's hand is visible to the human's
 *  process — accepted, vs-AI is single-player; see ADR 0001). For the pass-only
 *  bot only the current decision WINDOW matters, not card contents. */
export type BotView = {
    /** The seat the bot controls (`${userId}-p2`). */
    botId: string;
    phase: string;
    priorityPlayerId: string;
    activePlayerId: string;
    /** Whether a combat is in progress and its declaration flags. */
    hasCombat: boolean;
    attackersConfirmed: boolean;
    blockersConfirmed: boolean;
    /** Combat-damage assignment flag (`combat.damageConfirmed`): `false` while a
     *  multi-block step waits for manual assignment + confirmation, `undefined`
     *  when damage auto-applied or no damage step is open. The server rejects a
     *  `passPriority` while it is `false`, so the bot must confirm instead of
     *  pass (else it loops on the rejection). */
    damageConfirmed?: boolean;
    /** True when a damage step is open (`damageConfirmed === false`), the bot is
     *  one of the step's assigners (CR 702.22j-k — normally the active player,
     *  banding can shift it), and it has NOT yet confirmed its portion. The bot
     *  owes a `confirmDamage`; cleared once it has confirmed so it doesn't loop
     *  re-confirming while waiting on another assigner. */
    botOwesDamageConfirm?: boolean;
    /** Mulligan declaration window (pre-game). */
    mulliganDeclaringId?: string;
    /** True while ANY player is bottoming cards after a mulligan (CR 103.5).
     *  Combined with `mulliganBottomCount` to tell whose turn it is. */
    mulliganBottoming?: boolean;
    /** The bot's opening hand while a mulligan decision (declaration or
     *  bottoming) is owed — `id` + `isLand` per card, enough for the
     *  land-count keep/mull heuristic and the bottom-N selection. */
    mulliganHand?: { id: string; isLand: boolean }[];
    /** Mulligans the bot has already taken this game (CR 103.5). Drives the
     *  keep floor and is the count of cards to bottom on keep. */
    mulligansTaken?: number;
    /** Number of cards the bot must put on the bottom of its library right now
     *  — set only when the active bottoming choice belongs to the bot, else
     *  undefined (some other player is bottoming, or nobody is). */
    mulliganBottomCount?: number;
    /** CR 508.1c/1g — whether the bot can plausibly cover the parked
     *  per-attacker MANA attack tax (Propaganda / Collective Restraint) from its
     *  pool plus untapped mana sources. Set ONLY when that tax is parked on the
     *  bot, so it doubles as the marker that the window exists at all — there is
     *  deliberately no separate `…Owed` flag, because owed-NESS is the engine's
     *  answer on `owedInput` (ADR 0047 / issue #2284) and a second view field
     *  saying the same thing is where a parallel derivation grows back.
     *
     *  Drives pay-vs-cancel: pay when affordable, else cancel the declaration
     *  (a taxed attack it can't fund is dropped). */
    attackManaTaxAffordable?: boolean;
    /** True once the game has ended — the bot must not act. */
    gameOver?: boolean;
    /** A mid-resolution interactive choice owed to the bot (ADR 0016), already
     *  projected into the minimal shape the default-selection policy needs.
     *  Surfaced for any bot-owed `pendingChoices[0]` EXCEPT `mulligan-bottom`,
     *  which the pre-game mulligan branch handles via its own hand heuristic.
     *  Undefined when no choice is owed. */
    owedChoice?: OwedChoice;
    /** CR 601.2g — the parked generic-mana spend choice (#1444) currently
     *  awaiting the bot as PAYER of its own parked cast/activation. Rides
     *  outside `pendingChoices[]` (mirroring the attack-tax park), so it is its
     *  own `BotView` field rather than an `OwedChoice`. Undefined unless the bot
     *  itself owes the choice. */
    manaSpendChoice?: ManaSpendChoiceView;
    /** CR 601.2g (`payWith`, ADR 0063) — the parked graveyard-exile CAST cost
     *  awaiting the bot as PAYER of its own parked cast: delve's variable
     *  offset (#1336), and the fixed flashback / escape exile costs that ride
     *  the same picker. Like `manaSpendChoice` it lives OUTSIDE
     *  `pendingChoices[]` (it hangs off `pendingCast`), so it is its own
     *  `BotView` field rather than an `OwedChoice`. Undefined unless the bot
     *  itself owes the pick. */
    castExileChoice?: CastExileChoiceView;
    /** CR 702.51 (`payWith`, ADR 0063 — issue #1338) — the parked Convoke
     *  creature picker awaiting the bot as PAYER of its own cast (Hogaak). Like
     *  `castExileChoice` it lives OUTSIDE `pendingChoices[]` (it hangs off
     *  `pendingCast`), so it is its own `BotView` field. Undefined unless the bot
     *  itself owes the pick. */
    convokeChoice?: ConvokeChoiceView;
    /** ADR 0091 / issue #1209 — the FIRST payment park the bot owes on its own
     *  in-progress cast / activation announcement, in canonical commit-gate
     *  order (`nextOwedPayment`, `convex/gre/owedPayment.ts`), together with the
     *  conservative submission that pays it (`pickForOwedPayment`). This is the
     *  seam that makes a NEW park non-stalling without new bot wiring: the three
     *  fields above are the parks that earned a tuned answer before it existed.
     *  `submission` is null when no legal payment exists. Undefined when the bot
     *  owes no park. */
    owedPayment?: {
        park: OwedPayment;
        submission: OwedPaymentSubmission | null;
    };
    /** CR 603.3d / 115.7 / 707.10b (issue #2283) — an ENGINE-RAISED target
     *  selection owed to the bot: a targeted trigger it controls (Flickerwisp,
     *  Badgermole Cub), a retarget, or a spell copy's retarget. It is NOT the
     *  bot's own half-built cast/activation target selection — that stays a
     *  continuation the executor drives atomically and is deliberately absent
     *  here (`pendingTargetOrigin` is the compile-time-exhaustive classifier).
     *  Undefined unless the bot owes a raised selection. */
    owedTarget?: OwedTarget;
    /** ADR 0047 / issue #2284 — THE authority on whether the game is waiting on
     *  the bot, and for what. Populated by `buildBotView` by CALLING the
     *  engine's `computeOwedPlayerIds` + `computeExpectedInput` on the bot's own
     *  reconstructed state (`owedInputFor`), never by re-deriving owed-ness from
     *  the pending* fields. Undefined means the game is not waiting on this seat
     *  — and that, not a walk over the individual waiting fields, is the ONLY
     *  reason `decideBotAction` may answer `none`. */
    owedInput?: OwedInput;
    /** CR 508.1c/1g / 701.21a (issue #2284) — the parked attack-declaration
     *  land-sacrifice tax awaiting the bot (`combat.pendingAttackSacrifice`),
     *  with the minimal-legal victims already resolved through the engine's own
     *  selection authority. This is the `sacrifice` Expected Input kind; before
     *  #2284 the bot had no answer for it at all. Undefined when none is owed. */
    attackSacrifice?: { cardInstanceIds: string[] };
    /** CR 601.2h (issue #2284) — which announcement container the bot has
     *  parked (`pendingCast` / `pendingActivation`), so the last escalation rung
     *  can rewind it through the matching cancel mutation. Undefined when the
     *  bot has no announcement in flight. */
    parkedAnnouncement?: "cast" | "activation";
};

/** An engine-raised target selection the bot owes (issue #2283). Like
 *  `owedChoice` it is answered by the SEARCH when possible; `submission` is the
 *  precomputed minimal-legal answer the driver falls back to when the search
 *  yields nothing, so the window never stalls. `null` submission means the
 *  enumerator found no legal answer at all — unreachable in practice (the
 *  engine only raises a selection when a real choice exists, and nothing can
 *  change the board while it freezes priority), kept explicit rather than
 *  papered over with a non-null assertion. */
export type OwedTarget = {
    /** The raised kind, for tracing / tests. Always a `"raised"` origin. */
    kind: "trigger" | "retarget" | "copy-retarget";
    submission: { targets: TargetSelection[]; confirmTargets: boolean } | null;
};

// The parked-park pickers and their view shapes live in the GRE beside the
// owed-payment seam (`convex/gre/paymentPicks.ts`, ADR 0091 / issue #1209) so
// the live bot's reactive fallback answers a park with the SAME function this
// decide-path uses — one implementation, not two opinions. Re-exported here
// because they were brain.ts's own until #1209 and every importer names them
// through the brain.
export type {
    CastExileChoiceView,
    ConvokeChoiceView,
    ManaSpendChoiceView,
} from "@convex/gre/paymentPicks";
export { chooseCastExileCost, chooseConvokeCreatures, chooseManaSpendOrder };

/** A choosable card as the bot sees it on its projected view (ADR 0016). Carries
 *  a projected latent `value` (the shared `cardValue` primitive, ADR 0018,
 *  issue #197) so `chooseResolution` orders by real card worth — fetch/keep the
 *  best, sacrifice/discard the worst — instead of a single is-a-land bit. The
 *  `value` lives ONLY on this bot-only owed-choice path; it is never wired into
 *  the 2-player public projection, so it can't leak per-card valuations of a
 *  hidden hand in real PvP. */
export type ChoiceCandidate = {
    id: string;
    /** Projected latent Forge-scale worth (higher = keep / fetch; lower =
     *  sacrifice / discard). A land ranks lowest, a bomb highest. */
    value: number;
    /** Whether the card is a land (CR 305.1). Lands are the constraining
     *  resource for the discard heuristic (issue #242), so they are ranked by
     *  scarcity rather than by raw `value`. Absent on candidates the policy
     *  never needs it for (only the `discard-hand` path reads it). */
    isLand?: boolean;
    /** Mana value of the card's cost (CR 202.3), folding `X` to its written
     *  value. Drives the "shed the most expensive uncastable spell first"
     *  ordering in the discard heuristic. Undefined for lands / cards with no
     *  cost. */
    manaValue?: number;
    /** Colors required by the card's cost (CR 202.2). A spell whose colors the
     *  controller cannot currently produce is "uncastable" and ranked first to
     *  shed. Empty / undefined for colorless or cost-less cards. */
    colors?: Color[];
    /** PRINTED power (CR 208.2), used by the threshold-mode may-pay sacrifice
     *  greedy (CR 118, "total power ≥ N", Phyrexian Dreadnought). Undefined for
     *  non-creatures / cards the bot doesn't need it for. */
    power?: number;
};

/** The controller's mana picture at the moment of a `discard-hand` choice
 *  (issue #242). Built by `buildBotView` from the bot's visible battlefield and
 *  hand so the discard heuristic can weigh lands as the constraining resource
 *  and rank spells by castability. Pure data — no live search. */
export type ManaSituation = {
    /** Lands the controller already has in play (untapped or not — a land in
     *  play is still a future mana source). */
    landsInPlay: number;
    /** Lands currently in the controller's hand (candidates for the drop). */
    landsInHand: number;
    /** Distinct colors the controller's lands in play can currently produce.
     *  A spell needing a color outside this set is treated as uncastable. */
    producibleColors: Color[];
};

/** A controller with this many or fewer lands in play is still developing its
 *  mana and is "land-light" (issue #242): lands are the constraining resource
 *  and must NOT be auto-discarded. The reported case (1 land in play) sits well
 *  inside this band, so the bot keeps the land and sheds a spell instead. Above
 *  the threshold the board is mana-developed and an excess land is a fair pitch
 *  (the land-flooded counter-case). CR 305.2 caps a player at one land drop per
 *  turn, so ~4 lands in play is enough to operate while extra lands in hand
 *  are surplus. */
export const LAND_LIGHT_LANDS_IN_PLAY = 4;

/** The interactive choice the bot is owed this window (ADR 0016), reduced to the
 *  fields `chooseResolution` reasons about. Built by `buildBotView` from the
 *  active `PendingChoice` and the bot's visible zones. */
export type OwedChoice = {
    kind: PendingChoiceKind;
    /** Whether this choice is an in-tree ISMCTS decision node the SEARCH should
     *  answer instead of the ADR 0016 heuristic (issue #1506). True iff a
     *  registered candidate generator APPLIES to this choice
     *  (`isSearchableChoiceNode`, the single authority — registry membership
     *  alone is not enough, PR #1914 review finding 2) AND no mid-flight
     *  cast/target/activation/companion
     *  continuation is parked — the exact conditions under which
     *  `enumerateMoves` surfaces the choice's candidate answers. Undefined /
     *  false → the heuristic answers it, exactly as before. */
    searchable?: boolean;
    /** Normalized count bounds (`getPendingChoiceMin` / `getPendingChoiceMax`):
     *  the submission must pick between `min` and `max` ids inclusive. */
    min: number;
    max: number;
    /** Legal candidate cards in zone order. Empty for `may-pay` (a yes/no with
     *  no card selection). */
    candidates: ChoiceCandidate[];
    /** `may-pay` only: whether the optional cost is trivially affordable from the
     *  bot's available mana (ADR 0016 minimal policy: accept iff affordable). */
    affordable?: boolean;
    /** `may-pay` only (CR 701.21a): the number of permanents the accepted cost's
     *  sacrifice leg makes the payer choose, when the leg admits a real choice
     *  (more matching permanents than sacrificed). `candidates` then holds the
     *  legal victims and the bot picks `sacrificeCount` of them worst-first.
     *  Undefined / 0 when no sacrifice pick is owed. */
    sacrificeCount?: number;
    /** `may-pay` only (CR 118, Phyrexian Dreadnought): the summed-power
     *  threshold the accepted cost's sacrifice leg must reach ("sacrifice any
     *  number of matching permanents with total power ≥ N"). `candidates` holds
     *  the legal victims and the bot greedily takes the highest-power ones until
     *  the running total reaches the threshold. Mutually exclusive with
     *  `sacrificeCount`; undefined when no threshold pick is owed. */
    sacrificeThreshold?: number;
    /** `may-pay` only (CR 701.9 / 118.3, issue #899): the number of hand cards
     *  the accepted cost's discard leg makes the payer choose, when the leg
     *  admits a real choice (more hand cards than discarded). Descriptive only
     *  — the pick itself is `discardIds`. Undefined / 0 when no discard pick is
     *  owed. */
    discardCount?: number;
    /** `may-pay` only (CR 701.9 / 118.9): the CONCRETE hand cards to submit
     *  alongside an accepted discard leg, already resolved by `buildOwedChoice`
     *  through the engine's one hand-leg assignment authority
     *  (`assignMayPayHandCards`) over the bot's worst-first preference.
     *
     *  It is a resolved SET, not a count, because the policy cannot legally
     *  derive one from the other: slicing `discardCount` cards off `candidates`
     *  ignores the leg's per-requirement filters, and the resulting submission
     *  is rejected server-side — the driver then re-answers the same state
     *  forever (bot freeze, PR #1963 review round 2). Undefined when no discard
     *  pick is owed, or when the leg cannot be covered at all (in which case
     *  `affordable` is already false and the bot declines). */
    discardIds?: string[];
    /** `discard-hand` only: the controller's mana picture, so the discard
     *  heuristic can protect scarce lands and rank spells by castability
     *  (issue #242). Undefined for every other choice kind. */
    manaSituation?: ManaSituation;
    /** ADR 0100 D3 — which `AsEntersChoice` leg a CR 614.1c as-enters prompt is
     *  answering, verbatim off `PendingChoice.asEntersKind`. Undefined for every
     *  ordinary mid-resolution choice.
     *
     *  Every as-enters prompt REUSES an existing `PendingChoiceKind` shape, so
     *  `kind` alone cannot tell one apart — and for `discard` the difference is
     *  not cosmetic but a sign flip: an ordinary `discard-hand` submission is
     *  the price of something already happening (CR 514.1 cleanup, Mind Warp),
     *  and its `min` is what the bot owes. An as-enters `discard` is an OPTIONAL
     *  COST with `min: 0`, so the shared "submit `min` worst-first" default
     *  silently declines it — and declining is what puts Mox Diamond in the
     *  graveyard. This field is the explicit discriminator that branch needs;
     *  deriving it from `min === 0` instead would fail open on the next
     *  zero-floor `discard-hand` producer. */
    asEntersKind?: AsEntersChoice["kind"];
    /** `name-card` only (CR 202.3 / 201.3 / 614.1c): the bot's legal default
     *  card name to submit through `submitNameCard`. `buildOwedChoice` picks it
     *  through `isLegalNamedCard` — the SAME authority `applyNameCardSubmit`
     *  validates against — so it satisfies this head's own restriction
     *  (`no-basic-land`) and its as-enters `filter` by construction, not just
     *  the bare registry-existence check (issue #2497). Undefined for every
     *  other choice kind, AND for a `name-card` head no registered name can
     *  answer — never a stand-in the server would reject, because the `choice`
     *  escalation ladder has no rung below this submission. */
    nameCardDefault?: string;
    /** `look-distribute` (issue #1364, Atraxa) / `choose-categorized` (issue
     *  #1945) — the CATEGORIZED pick's buckets. When present, `max` alone
     *  does NOT describe a legal submission (three creatures under a max of
     *  three is illegal), so the greedy must test each addition through
     *  `canAddCategorizedPick`. Undefined for an ordinary dig, where the
     *  count bounds are the whole story. */
    categories?: PickCategory[];
    /** Which categorized legality rule the server will validate the
     *  submission with (issue #1945, `PendingChoice.categoryRule`).
     *  `"cover"` additionally requires EVERY non-empty category to be
     *  answered — a submission that leaves one unanswered is rejected, and a
     *  rejected submission freezes the bot. Undefined = the injective rule,
     *  where any matchable subset is legal. */
    categoryRule?: "cover";
    /** Whether being picked is the GOOD half or the BAD half for the chooser
     *  (issue #1945, `PendingChoice.pickPolarity`). `"picked-removed"`
     *  (Planar Overlay's bounce) inverts the value ordering: the picks are
     *  exactly what the chooser LOSES, so ranking them "best first" makes the
     *  bot deterministically bounce its two best lands. Undefined =
     *  `"picked-kept"` — a pick is something gained. */
    pickPolarity?: "picked-kept" | "picked-removed";
};

/** A bot decision, realised by the executor through EXISTING mutations only
 *  (no new move surface — issue #109 / ADR 0001):
 *   - `keep`              → `declareMulligan({ decision: "keep" })`
 *   - `mull`              → `declareMulligan({ decision: "mull" })`
 *   - `mulligan-bottom`   → `submitResolutionChoice` (kind "mulligan-bottom")
 *   - `resolution-choice` → `submitResolutionChoice` (any zone-pick kind, ADR 0016)
 *   - `may-pay`           → `submitMayPay` (yes-no family, ADR 0016)
 *   - `declare-attackers` → `confirmAttackers` (empty selection = no attack)
 *   - `declare-blockers`  → `confirmBlockers` (empty selection = no block)
 *   - `confirm-combat-damage` → `confirmDamage` (default assignment, multi-block)
 *   - `pass`              → `passPriority`
 *   - `search-choice`     → the Worker search picks the answer to the owed
 *                           pending choice and the executor submits it through
 *                           whichever mutation that Move names (issue #1506)
 *   - `resolve-mana-spend` → `resolveManaSpendChoice` (CR 601.2g, issue #1446;
 *                           the parked generic-spend choice, driven directly —
 *                           not a Move, mirrors `pay-attack-tax`)
 *   - `none`              → the bot owes no action right now; do nothing. */
export type BotAction =
    | {
          /** A generator-covered pending choice (`OwedChoice.searchable`): NOT
           *  answered here. The driver hands the window to the ISMCTS Worker,
           *  whose `enumerateMoves` surfaces the candidate submissions, and
           *  realises the returned Move through the ordinary executor. Carries
           *  no payload — the answer is the search's, not the gate's. */
          kind: "search-choice";
      }
    | { kind: "keep" }
    | { kind: "mull" }
    | { kind: "mulligan-bottom"; cardInstanceIds: string[] }
    | { kind: "resolution-choice"; cardInstanceIds: string[] }
    | {
          kind: "may-pay";
          accept: boolean;
          sacrificeIds?: string[];
          discardIds?: string[];
      }
    | { kind: "land-entry"; accept: boolean }
    | { kind: "draw-replacement"; accept: boolean }
    | { kind: "name-card"; cardName: string }
    | { kind: "random-reveal-ack" }
    | { kind: "madness-decline" }
    | { kind: "rebound-decline" }
    | { kind: "declare-attackers" }
    | { kind: "declare-blockers" }
    | { kind: "confirm-combat-damage" }
    | { kind: "pay-attack-tax" }
    | { kind: "cancel-attack-tax" }
    | {
          /** CR 601.2g (issue #1446) — the deterministic flexibility-preserving
           *  answer to a parked generic-spend choice: one color per owed generic
           *  pip, drawn from `ManaSpendChoiceView.candidateColors`. */
          kind: "resolve-mana-spend";
          spendOrder: string[];
      }
    | {
          /** CR 601.2g / 702.66 (`payWith`, ADR 0063) — the parked
           *  graveyard-exile cast cost: the ids the bot exiles to pay. Driven
           *  straight through `selectCastExileCost`, mirroring
           *  `resolve-mana-spend` (it lives outside `pendingChoices[]`, so the
           *  Worker surfaces no move for it and would stall on it forever). */
          kind: "cast-exile-cost";
          cardInstanceIds: string[];
      }
    | {
          /** CR 702.51 (`payWith`, ADR 0063 — issue #1338) — the parked Convoke
           *  creature picker: the creatures the bot taps to pay. Driven straight
           *  through `selectConvokeCreatures`, mirroring `cast-exile-cost` (it
           *  lives outside `pendingChoices[]`, so the Worker surfaces no move for
           *  it and would stall on it forever). */
          kind: "convoke-creatures";
          creatureInstanceIds: string[];
      }
    | {
          /** ADR 0091 / issue #1209 — ANY payment park the bot owes that has no
           *  dedicated kind above: the exhaustive reactive answer. `submission`
           *  names the exact human `select*` mutation and its arguments
           *  (`pickForOwedPayment`, `convex/gre/paymentPicks.ts`), so the driver
           *  dispatches it without a hand-maintained per-park branch — which is
           *  the whole point: a park added to the census cannot compile without
           *  a pick, and the pick is realisable here without further wiring.
           *
           *  Mandatory even once the payment travels on the Move (#2135): a
           *  carried payload can be STALE (Drought enters between search and
           *  execution; an opponent response invalidates a pick), and this is
           *  what answers the park it did not anticipate. */
          kind: "pay-owed-payment";
          park: ParkKind;
          submission: OwedPaymentSubmission;
      }
    | {
          /** An ENGINE-RAISED pending target (issue #2283): NOT answered here.
           *  Like `search-choice`, the driver hands the window to the ISMCTS
           *  Worker, whose `enumerateMoves` surfaces the legal submissions
           *  (`enumerateRaisedTargetMoves`), and realises the returned Move
           *  through the ordinary executor. Carries no payload — the answer is
           *  the search's, not the gate's; `BotView.owedTarget.submission` is
           *  the driver's minimal-legal fallback. */
          kind: "search-target";
      }
    | {
          /** CR 603.3d / 115.7 / 707.10b (issue #2283) — the deterministic
           *  minimal-legal answer to an engine-raised target selection, used
           *  when the search yields no move (mirroring how `search-choice`
           *  degrades to `chooseOwedChoiceAction`). Realised by the executor
           *  through `selectTargets` + `confirmTargets`, the same mutations a
           *  human's clicks make. */
          kind: "submit-target";
          targets: TargetSelection[];
          confirmTargets: boolean;
      }
    | {
          /** CR 508.1c/1g / 701.21a (issue #2284) — the parked
           *  attack-declaration land-sacrifice tax: the victims the bot
           *  sacrifices, resolved through the engine's own selection authority
           *  (`completeSacrificeSelection`). One `selectSacrifice` call per id.
           *  Before this existed the `sacrifice` Expected Input window had NO
           *  bot answer at all — the bot passed into a gate rejection forever. */
          kind: "select-sacrifice";
          cardInstanceIds: string[];
      }
    | {
          /** CR 608.2b / 601.2 (issue #2284) — the engine's own decline for a
           *  target selection, through `cancelTarget`: a mandatory target
           *  nobody chooses removes the ability from the stack, an "up to"
           *  selection resolves with none, and an announced cast's selection
           *  rewinds the announcement. An escalation rung, never a first
           *  choice. */
          kind: "cancel-target";
      }
    | {
          /** CR 509.1 (issue #2284) — an empty blocker declaration through
           *  `confirmBlockers`. Both the conservative default and the legal way
           *  to abandon the window. */
          kind: "confirm-no-blockers";
      }
    | {
          /** CR 508.1 (issue #2284) — an empty attacker declaration through
           *  `confirmAttackers`. The escalation form of `declare-attackers`,
           *  which is otherwise a real search decision. */
          kind: "confirm-no-attackers";
      }
    | {
          /** CR 601.2h (issue #2284) — rewind a parked announcement whose costs
           *  were never paid, through `cancelCast` / `cancelActivation`. The
           *  last legal exit from a `priority` window the bot has jammed with
           *  its own half-built cast. */
          kind: "abort-announcement";
          container: "cast" | "activation";
      }
    | {
          /** THE value that was inexpressible before issue #2284: the game is
           *  waiting on the bot (the engine's Expected Input names it) and the
           *  bot has no answer for that window. It used to collapse to `none` —
           *  indistinguishable from a correct idle, which is exactly why every
           *  freeze was silent. The driver treats it as a defect: it asserts in
           *  development, is recorded in the AI decision trace, and triggers the
           *  watchdog IMMEDIATELY instead of burning the full interval. */
          kind: "unanswered";
          expectedKind: ExpectedInputKind;
      }
    | { kind: "pass" }
    | { kind: "none" };

const NONE: BotAction = { kind: "none" };

/** How the vs-AI driver (`useVsAiDriver`) must realise a decided {@link
 *  BotAction}:
 *   - `"executor"`      — a brain-resolved choice/mulligan window realised on
 *                          the MAIN THREAD via `botActionToMove` → `executeMove`.
 *                          For a choice kind with NO registered candidate
 *                          generator the GRE surfaces no search move, so the
 *                          Worker cannot make it (issue #1506: a kind WITH a
 *                          generator is `"worker"` instead, see below).
 *   - `"worker"`        — a real decision that needs the Worker search
 *                          (priority pass, combat declarations, and a
 *                          generator-covered pending choice).
 *   - `"confirm-damage"`— the multi-block damage confirmation, a direct mutation.
 *   - `"none"`          — the bot owes nothing; do nothing.
 *
 *  This switch is COMPILE-TIME EXHAUSTIVE (`assertNever`): a new `BotAction`
 *  kind cannot build until it is classified here. That is the structural guard
 *  against the recurring "bot freezes on a new choice mechanic" class — every
 *  prior freeze was a new kind silently absent from the driver's old
 *  hand-maintained executor list, falling through to the Worker (which stalls
 *  while a pending choice is active). The driver now branches on THIS result
 *  instead of an ad-hoc list, so a forgotten kind is a build error, not a hang. */
export type BotActionRealisation =
    | "executor"
    | "worker"
    | "confirm-damage"
    | "attack-tax"
    | "mana-spend"
    | "cast-exile-cost"
    | "convoke-creatures"
    | "owed-payment"
    /** issue #2284 — an escalation rung: a LEGAL decline/abort routed through
     *  an existing mutation by `submitDeclineAction` (`src/lib/ai/decline.ts`),
     *  whose switch is exhaustive over the decline sub-union. Joining the same
     *  compile-time-exhaustive dispatch as every other realisation is the point:
     *  a new escalation kind is a build error until the driver can realise it. */
    | "decline"
    /** issue #2284 — "the game is waiting on me and I have no answer". Not a
     *  submission: the driver escalates immediately and records the defect. */
    | "unanswered"
    | "none";

export function botActionRealisation(
    kind: BotAction["kind"]
): BotActionRealisation {
    switch (kind) {
        case "none":
            return "none";
        case "confirm-combat-damage":
            return "confirm-damage";
        // CR 508.1c/1g — the parked mana attack tax is resolved by a direct
        // mutation (auto-tap to pay, or cancel the declaration), like the
        // damage-confirmation step; no Worker search, no pending choice.
        case "pay-attack-tax":
        case "cancel-attack-tax":
            return "attack-tax";
        // CR 601.2g (issue #1446) — the parked generic-spend choice is resolved
        // by a direct mutation (`resolveManaSpendChoice`), like the attack-tax
        // park above: it lives outside `pendingChoices[]`, so no Worker search.
        case "resolve-mana-spend":
            return "mana-spend";
        // CR 601.2g / 702.66 (issue #1336) — the parked cast-cost graveyard
        // exile picker (delve's variable offset, and the fixed flashback /
        // escape exile costs) is resolved by a direct mutation
        // (`selectCastExileCost`), like the mana-spend park above: it hangs off
        // `pendingCast`, not `pendingChoices[]`, so no Worker search can answer
        // it and the bot would stall mid-cast without this branch.
        case "cast-exile-cost":
            return "cast-exile-cost";
        // CR 702.51 (issue #1338) — the parked convoke creature picker is
        // resolved by a direct mutation (`selectConvokeCreatures`), like the
        // cast-exile-cost park above: it hangs off `pendingCast`, not
        // `pendingChoices[]`, so no Worker search can answer it and the bot
        // would stall mid-cast (Hogaak) without this branch.
        case "convoke-creatures":
            return "convoke-creatures";
        // ADR 0091 / issue #1209 — every OTHER payment park (both containers'
        // filtered sacrifice, the cast exile additional cost, the alternative-
        // cost hand leg, the activation-side exile / tap-other / discard legs)
        // is realised by the driver dispatching the submission's named
        // mutation. Like the three parks above it hangs off `pendingCast` /
        // `pendingActivation`, not `pendingChoices[]`, so no Worker search can
        // answer it and the bot stalls mid-announcement without this branch.
        case "pay-owed-payment":
            return "owed-payment";
        // issue #2284 — the escalation ladder's rungs. Each is a LEGAL engine
        // path (CR 608.2b decline, CR 509.1/508.1 empty declaration, CR 601.2h
        // rewind, CR 508.1g minimal victim pick) driven by a direct mutation,
        // never a search: the ladder only runs because the search already had
        // nothing to say.
        case "select-sacrifice":
        case "cancel-target":
        case "confirm-no-blockers":
        case "confirm-no-attackers":
        case "abort-announcement":
            return "decline";
        case "unanswered":
            return "unanswered";
        case "keep":
        case "mull":
        case "mulligan-bottom":
        case "resolution-choice":
        case "may-pay":
        case "land-entry":
        case "draw-replacement":
        case "name-card":
        case "random-reveal-ack":
        case "madness-decline":
        case "rebound-decline":
        case "submit-target":
            // CR 603.3d / 115.7 / 707.10b (issue #2283) — `submit-target` is
            // the minimal-legal answer to an ENGINE-RAISED target selection,
            // realised through the executor (`selectTargets` +
            // `confirmTargets`) like every other brain-resolved fallback. The
            // SEARCHED answer is `search-target` → "worker" below.
            return "executor";
        // issue #1506 — `search-choice` (a generator-covered pending choice) IS
        // a search node (PRD #1423): `decidingPlayer` names the bot and
        // `enumerateMoves` surfaces the candidate submissions, so the Worker can
        // and must decide it. (The pre-#1506 blanket "the Worker surfaces no move
        // while a choice is pending" is only true of kinds with NO generator,
        // which still take the executor branch above.)
        // issue #2283 — an engine-raised target selection is a search node for
        // exactly the same reason: `decidingPlayer` names its owner and
        // `enumerateMoves` surfaces the legal submissions.
        case "search-choice":
        case "search-target":
        case "pass":
        case "declare-attackers":
        case "declare-blockers":
            return "worker";
        default:
            return assertNever(kind);
    }
}

/** Strategic mulligan floor: once the bot has taken this many mulligans it
 *  keeps whatever it draws rather than digging further into card disadvantage
 *  (CR 103.5 hard-locks at a 0-card hand; this is the bot's softer cap). */
export const MULLIGAN_FLOOR = 3;

/** Land-count keep/mull heuristic (issue #145). Deterministic and pure. Mulls a
 *  hand with no lands or no spells; keeps everything else, and always keeps once
 *  the mulligan floor is reached. Curve / colour evaluation is out of scope. */
function decideMulligan(view: BotView): BotAction {
    if ((view.mulligansTaken ?? 0) >= MULLIGAN_FLOOR) return { kind: "keep" };
    const hand = view.mulliganHand ?? [];
    const lands = hand.filter((c) => c.isLand).length;
    const spells = hand.length - lands;
    if (lands === 0 || spells === 0) return { kind: "mull" };
    return { kind: "keep" };
}

/** Choose which `count` cards to put on the bottom after a mulligan keep
 *  (CR 103.5). Heuristic: shed excess lands first (aiming to keep ~40% lands in
 *  the final hand, at least one), then the trailing spells; deterministic by
 *  hand order. Returns exactly `count` ids (or all of them if `count` exceeds
 *  the hand). */
export function chooseMulliganBottoms(
    hand: { id: string; isLand: boolean }[],
    count: number
): string[] {
    if (count <= 0) return [];
    if (count >= hand.length) return hand.map((c) => c.id);

    const lands = hand.filter((c) => c.isLand);
    const spells = hand.filter((c) => !c.isLand);
    const keep = hand.length - count;
    const targetKeepLands = Math.min(
        lands.length,
        Math.max(keep > 0 ? 1 : 0, Math.round(keep * 0.4))
    );
    let landsToBottom = Math.min(
        count,
        Math.max(0, lands.length - targetKeepLands)
    );

    const bottoms: string[] = [];
    // Excess lands, taken from the back of the hand for a stable order.
    for (let i = lands.length - 1; i >= 0 && landsToBottom > 0; i--) {
        bottoms.push(lands[i].id);
        landsToBottom--;
    }
    // Fill the rest with trailing spells.
    for (let i = spells.length - 1; i >= 0 && bottoms.length < count; i--) {
        bottoms.push(spells[i].id);
    }
    // Fallback: if spells ran out, bottom remaining lands.
    for (let i = 0; i < lands.length && bottoms.length < count; i++) {
        if (!bottoms.includes(lands[i].id)) bottoms.push(lands[i].id);
    }
    return bottoms.slice(0, count);
}

/** Compile-time exhaustiveness guard (ADR 0016 criterion): adding a new
 *  `PendingChoiceKind` without a `chooseResolution` case makes `kind` non-`never`
 *  here and fails the build, so no future choice kind can silently freeze the
 *  bot. */
function assertNever(x: never): never {
    throw new Error(`Unhandled PendingChoiceKind: ${String(x)}`);
}

/** Order candidates by projected card `value` (ADR 0018): `bestFirst` highest
 *  worth first (fetch / keep these), `worstFirst` lowest first (sacrifice /
 *  discard these). Stable `Array.sort` keeps zone order on ties, so every pick
 *  stays deterministic. */
function bestFirst(candidates: ChoiceCandidate[]): ChoiceCandidate[] {
    return [...candidates].sort((a, b) => b.value - a.value);
}
function worstFirst(candidates: ChoiceCandidate[]): ChoiceCandidate[] {
    return [...candidates].sort((a, b) => a.value - b.value);
}

/** CR 118 threshold-mode may-pay sacrifice (Phyrexian Dreadnought): greedily
 *  take the highest-power candidates until the running total reaches
 *  `threshold`, returning their ids. Highest-power-first minimizes the number of
 *  bodies given up; over-payment on the final pick is legal (the server
 *  validates only that the summed EFFECTIVE power ≥ threshold). Falls back to
 *  every candidate when the running total never reaches the threshold (a
 *  best-effort legal set — affordability was already gated upstream). */
function thresholdSacrifice(
    candidates: ChoiceCandidate[],
    threshold: number
): string[] {
    const byPower = [...candidates].sort(
        (a, b) => (b.power ?? 0) - (a.power ?? 0)
    );
    const chosen: string[] = [];
    let running = 0;
    for (const c of byPower) {
        if (running >= threshold) break;
        chosen.push(c.id);
        running += c.power ?? 0;
    }
    return chosen;
}

/** Mana-aware discard priority (issue #242). Higher score = shed sooner. The
 *  heuristic ranks by the board's mana situation, not by a fixed card value
 *  alone (ADR 0016 / ADR 0018 deferred-quality follow-up):
 *
 *  - A land is the constraining resource while the controller is land-light
 *    (`landsInPlay <= LAND_LIGHT_LANDS_IN_PLAY`); it gets the LOWEST priority so
 *    the bot keeps it and sheds a spell instead (the reported 1-land case).
 *    Once the board is mana-developed, an EXCESS land (more than one land in
 *    hand, or already flooded) becomes a fair pitch and ranks high.
 *  - A spell is ranked by how hard it is to cast against current mana: an
 *    uncastable spell (needs a color the lands in play can't produce) is shed
 *    first, then the most expensive spells (highest mana value) ahead of cheap
 *    ones the controller can realistically deploy. */
function discardPriority(c: ChoiceCandidate, mana: ManaSituation): number {
    if (c.isLand) {
        const landLight = mana.landsInPlay <= LAND_LIGHT_LANDS_IN_PLAY;
        // Land-light: protect the land (never shed it ahead of any spell).
        if (landLight) return -1000;
        // Mana-developed: a SURPLUS land (2+ in hand) is a fair pitch and ranks
        // above kept spells. A lone extra land is insurance against a flood
        // dry-spell, so it ranks below every spell (but above a protected
        // land-light land) — a hand that is otherwise all spells still sheds
        // its worst spell first, and the land only goes if nothing else can.
        return mana.landsInHand >= 2 ? 500 : -900;
    }
    // Spell: castability first, then mana value, then inverse card worth as a
    // deterministic tie-break (a weaker card sheds before an equal-cost bomb).
    const colors = c.colors ?? [];
    const producible = new Set(mana.producibleColors);
    const uncastable = colors.some((col) => !producible.has(col));
    const mv = c.manaValue ?? 0;
    // Uncastable spells dominate the shed order; among castable spells the most
    // expensive go first. `value` (0..~) only breaks exact ties.
    return (uncastable ? 1000 : 0) + mv * 10 - c.value;
}

/** Order discard candidates highest-shed-priority first (issue #242). Stable on
 *  ties so the pick stays deterministic. */
function discardOrder(
    candidates: ChoiceCandidate[],
    mana: ManaSituation
): ChoiceCandidate[] {
    return [...candidates].sort(
        (a, b) => discardPriority(b, mana) - discardPriority(a, mana)
    );
}

/** CR 614.1a — whether to PAY an as-enters optional discard cost (Mox Diamond),
 *  and with which card. `[]` declines, which puts the entering permanent in its
 *  owner's graveyard; a one-id answer pays and lets it enter.
 *
 *  The pitch is only worth making out of SURPLUS, and for the one printed card
 *  in this family the surplus is lands (its `filter` admits nothing else). Two
 *  ways to have a spare land, reusing the same `LAND_LIGHT_LANDS_IN_PLAY` band
 *  the #242 discard heuristic already draws:
 *   - two or more lands in hand — one covers this turn's land drop (CR 305.2
 *     caps it at one), the second is surplus;
 *   - one land in hand on a mana-developed board (>= the band) — the extra land
 *     is surplus there too, which is the land-flood case the Mox is for.
 *  Otherwise the land IS the mana development and the bot keeps it, taking the
 *  graveyard branch — the same "don't auto-discard the constraining resource"
 *  judgement, applied to a cost instead of a levy.
 *
 *  `candidates` arrives already ordered by shed priority and already filtered to
 *  the legal payments (the engine's `candidateIds`), so paying is "take the
 *  first". With no `manaSituation` the policy declines rather than guessing —
 *  declining is always legal, and `buildBotView` always supplies one for a
 *  `discard-hand` head. */
function asEntersDiscardAnswer(
    candidates: ChoiceCandidate[],
    mana: ManaSituation | undefined
): string[] {
    const pitch = candidates[0];
    if (!pitch || !mana) return [];
    const surplus =
        mana.landsInHand >= 2 ||
        (mana.landsInHand >= 1 && mana.landsInPlay >= LAND_LIGHT_LANDS_IN_PLAY);
    return surplus ? [pitch.id] : [];
}

/** The bot's weak-but-legal default for a mid-resolution zone-pick choice
 *  (ADR 0016). Returns the card-instance ids to submit through
 *  `submitResolutionChoice`. Pure and deterministic. The switch is EXHAUSTIVE
 *  over `PendingChoiceKind`; adding a kind without a case fails the build
 *  (`assertNever`) so no future choice can silently freeze the bot.
 *
 *  Every branch returns a count within `[min, max]` of candidates the server
 *  will accept (the candidate set is already zone/filter/allow-list filtered in
 *  `buildBotView`). Quality is explicitly deferred to the evaluation work —
 *  these are minimal legal actions, not the best ones. */
export function chooseResolution(choice: OwedChoice): string[] {
    const { kind, candidates, min, max } = choice;
    switch (kind) {
        // Keep / fetch the best `min` (non-lands first): the chooser retains
        // these and the rest are sacrificed / discarded / left behind.
        case "search-library":
        case "keep-permanents":
        case "keep-hand":
            return bestFirst(candidates)
                .slice(0, min)
                .map((c) => c.id);

        // Shed the worst `min` (lands first): the submission is what gets
        // sacrificed. A permanent in play is already deployed mana/board, so
        // raw card worth is the right axis here.
        case "sacrifice-permanents":
            return worstFirst(candidates)
                .slice(0, min)
                .map((c) => c.id);

        // Discard the `min` cards the controller can least use (issue #242):
        // keep scarce lands while land-light, shed uncastable / most-expensive
        // spells first. Falls back to raw card worth when the mana situation is
        // absent (it always accompanies a `discard-hand` choice from
        // `buildBotView`, but the policy stays total over its input).
        case "discard-hand": {
            const order = choice.manaSituation
                ? discardOrder(candidates, choice.manaSituation)
                : worstFirst(candidates);
            // CR 614.1a (Mox Diamond, #2389) — an as-enters `discard` is an
            // OPTIONAL COST, not a levy: `min` is 0, so the shared "submit
            // `min`" default below would always decline it, and declining is
            // what bins the permanent. Answered by its own policy instead.
            if (choice.asEntersKind === "discard") {
                return asEntersDiscardAnswer(order, choice.manaSituation);
            }
            return order.slice(0, min).map((c) => c.id);
        }

        // Untap cap (CR 502.1, Winter Orb / Smoke): the floor is 0 (the active
        // player MAY untap zero), but untapping is pure upside — declining it is
        // strictly self-harming (a permissive `min` here would leave the bot's
        // lands tapped every turn). Untap up to the cap (`max`), best-first by
        // projected card value, so the bot reclaims its most valuable eligible
        // permanents and never submits an empty selection while an eligible
        // permanent is tapped. The server commit (`finalizeUntapPick`) accepts
        // any subset within `[min, max]`, so this stays a legal submission.
        case "untap-pick":
            return bestFirst(candidates)
                .slice(0, max)
                .map((c) => c.id);

        // Neutral pick of exactly `min` legal candidates in zone order. For the
        // range kinds `min` is 0 ("up to" partitions; optional Illusionary
        // Mask), so these resolve to an empty, always-legal submission.
        // `look-top` (Stock Up / Preordain, #942): the picked subset means
        // "keep" (Stock Up) or "bottom" (Preordain) — no single smart default
        // spans both, so the first `min` in exposed (top) order is always a
        // legal submission (ADR 0016); the engine never freezes. Smart
        // keep/bottom selection is deferred.
        // ADR 0053 (pile division) — the divider's partition (step 1 of the
        // divide-then-choose family) is exactly the `partition` shape: a
        // subset of the object set becomes pile A, the rest pile B. The
        // minimal-legal default (ADR 0016) submits an empty pile A (min = 0),
        // so everything lands in pile B — a weak-but-legal choice; smart
        // partitioning is deferred.
        case "choose-permanents":
            // CR 707.5 (#2451) — an as-enters `copy` is an OPTIONAL choice
            // (`min` is 0, every printed clause is a "you may"), so the shared
            // "submit `min`" default below would decline it every time, and
            // declining is what leaves a Clone / Phantasmal Image / Phyrexian
            // Metamorph as a printed 0/0 the next sweep bins (CR 704.5f). The
            // exact `discard` shape at #2389, so it gets the same treatment:
            // its own policy, best-first by projected value. Copying the best
            // body on the board is a strictly better body than 0/0 in every
            // position, so there is no decline branch to weigh.
            if (choice.asEntersKind === "copy") {
                return bestFirst(candidates)
                    .slice(0, Math.max(min, Math.min(1, max)))
                    .map((c) => c.id);
            }
            return candidates.slice(0, min).map((c) => c.id);
        case "pick-source":
        case "choose-hand-card":
        case "partition":
        case "divide-piles":
        case "look-top":
            return candidates.slice(0, min).map((c) => c.id);

        // "Any target of an opponent's choice" (CR 115.4, Cuombajj Witches):
        // the bot is the opponent picking where 1 damage lands. Minimal-legal
        // default (ADR 0016) — pick exactly `min` (=1) by lowest projected
        // value, so it tends to ping the least valuable target (a player or a
        // small creature) rather than its own bomb. Smart targeting is deferred.
        case "choose-damage-target":
            return worstFirst(candidates)
                .slice(0, min)
                .map((c) => c.id);

        // Trigger-time "up to one target player" (CR 115.1a, Endurance).
        // Minimal-legal default (ADR 0016): `min` is 0, so the bot declines
        // (submits no player) rather than gratuitously bottoming a graveyard.
        case "choose-player":
            return worstFirst(candidates)
                .slice(0, min)
                .map((c) => c.id);

        // Recall (CR 400.7): return up to `max` cards from the graveyard to
        // hand. Greedy value-max (ADR 0018) — take the best-valued cards first
        // so the bot recurs its strongest cards, capping at `max`.
        case "choose-graveyard-card":
            return bestFirst(candidates)
                .slice(0, max)
                .map((c) => c.id);

        // Dauthi Voidwalker (CR 601.3, issue #1156): choose an exiled card
        // an opponent owns with a void counter to grant a free cast. Greedy
        // value-max (ADR 0018) — take the best-valued candidate, mirroring
        // `choose-graveyard-card`'s Recall default.
        case "choose-exile-card":
            return bestFirst(candidates)
                .slice(0, max)
                .map((c) => c.id);

        // Reveal-hand only acknowledges (count 0) — submit nothing.
        case "reveal-hand":
            return [];

        // Scry / reorder (CR 401.4): keep the best on top — submit the peeked
        // cards highest projected value first, so the bot draws its best card
        // next (ADR 0018). Ties keep the exposed order (stable sort).
        case "reorder-library":
            return bestFirst(candidates).map((c) => c.id);

        // Scry / surveil / ponder ordered-top (CR 701.22/701.25, drag picker):
        // minimal-legal default (ADR 0016) — keep EVERY looked-at card on top,
        // best projected value first, so the bot draws its best card next and
        // sends nothing to the bottom/graveyard (empty `secondZoneIds`). Smart
        // "bottom the dead cards" scrying is deferred.
        case "order-top":
            return bestFirst(candidates).map((c) => c.id);

        // Look-distribute (CR 401.4 — Impulse, Stock Up, Narset, Thassa's
        // Oracle): look at the top N, put up to `max` (= `keep`) to `keepTo`
        // (hand, or the library top — issue #2070) and bottom the rest.
        // `candidates` is already narrowed to the KEEP-eligible subset
        // (`eligibleIds`, Narset's "noncreature, nonland") in `buildOwedChoice`.
        // Greedy value-max (ADR 0018) — take the best-valued eligible cards up to
        // `max`; for an OPTIONAL dig (min 0) the bot still digs when a card is
        // worth taking rather than declining (value-max is destination-agnostic:
        // the best card is worth keeping whether it lands in hand or on top of
        // the library). The bot submits only the keep picks (empty
        // `secondZoneIds`), so the engine auto-bottoms the rest.
        // A CATEGORIZED look-distribute (Atraxa, issue #1364) adds a constraint
        // the count bounds cannot express: at most one card per category, each
        // card claimable by only one of them. `max` is the maximum matching, so
        // a blind `slice(0, max)` would hand the server three creatures for a
        // max of three — rejected, and a rejected submission freezes the bot.
        // Walk the value order instead and take each card only while the set
        // stays matchable, through the SAME helper the server validates with.
        // `choose-categorized` (issue #1945, Noxious Vapors / Planar Overlay)
        // is `look-distribute`'s hand/battlefield sibling — same `categories`
        // shape (`bot-view.ts` populates it for both kinds), same bipartite
        // core, so it shares this branch. Two things it adds, both of which
        // the plain look-distribute greedy gets WRONG on its own:
        //
        //  1. POLARITY (`pickPolarity`). Under `onPicked: "returnToHand"` the
        //     picks are exactly what the chooser LOSES, so "keep the best"
        //     is inverted — the bot would bounce its two best lands. Walk
        //     the value order WORST first for that shape.
        //  2. COVER (`categoryRule: "cover"`). The submission must answer
        //     EVERY non-empty category or the server rejects it (bot freeze).
        //     For the LOSING polarity the bot also wants the SMALLEST such
        //     answer, so it stops the moment every category is covered
        //     (each pick taken must answer a still-unanswered category,
        //     which also keeps the set matchable by construction). For the
        //     keeping polarity the maximal greedy below is already a cover:
        //     if a category were unanswered, one of its members would still
        //     be addable, so the walk would have taken it.
        case "look-distribute":
        case "choose-categorized": {
            if (!choice.categories) {
                return bestFirst(candidates)
                    .slice(0, max)
                    .map((c) => c.id);
            }
            const cats = choice.categories;
            const losing = choice.pickPolarity === "picked-removed";
            const minimalCover = losing && choice.categoryRule === "cover";
            const ordered = losing
                ? worstFirst(candidates)
                : bestFirst(candidates);
            const picks: string[] = [];
            const answered = new Set<number>();
            const stillOwed = () =>
                cats.some((c, i) => c.cardIds.length > 0 && !answered.has(i));
            for (const candidate of ordered) {
                if (picks.length >= max) break;
                if (minimalCover) {
                    if (!stillOwed()) break;
                    const answersSomethingNew = cats.some(
                        (c, i) =>
                            !answered.has(i) && c.cardIds.includes(candidate.id)
                    );
                    if (!answersSomethingNew) continue;
                }
                if (!canAddCategorizedPick(cats, picks, candidate.id)) continue;
                picks.push(candidate.id);
                cats.forEach((c, i) => {
                    if (c.cardIds.includes(candidate.id)) answered.add(i);
                });
            }
            return picks;
        }

        // Aladdin's Lamp (CR 614): look at the top X, keep the single best
        // card to draw — the rest are bottomed at random by the engine.
        case "draw-look-keep":
            return bestFirst(candidates)
                .slice(0, min)
                .map((c) => c.id);

        // Legend rule (CR 704.5j, #378): keep exactly one of the same-name
        // duplicates; the rest go to the graveyard. Minimal-legal default
        // (ADR 0016) — keep the best-valued copy so the bot sheds the weaker
        // duplicate. Smart keep-which (counters / attached auras) is deferred.
        case "legend-keep":
            return bestFirst(candidates)
                .slice(0, min)
                .map((c) => c.id);

        // Non-cast Aura host (CR 303.4f — Replenish, Living Death): pick the one
        // legal host the reanimated Aura enchants. Minimal-legal default
        // (ADR 0016) — first candidate in scan order, so the engine never
        // freezes. Smart host selection (buff my best creature vs. steal the
        // opponent's for Control Magic) is deferred to the evaluation work.
        case "choose-aura-host":
            return candidates.slice(0, min).map((c) => c.id);

        // "As it enters, choose …" body selection (CR 614.12 — Primal Clay,
        // Shapeshifter). The options are appended to `candidates` as neutral-
        // value picks in `buildOwedChoice`; a minimal-legal default (ADR 0016)
        // takes the first `min` (=1) in author order — the engine never
        // freezes on the choice. Smart body selection is deferred.
        case "option-pick":
            return candidates.slice(0, min).map((c) => c.id);

        // CR 603.3c (issue #2461) — announce the mode of a modal TRIGGERED
        // ability. Only the CHOOSABLE modes reach `options` (a mode with no
        // legal target is filtered out engine-side), so the first one in author
        // order is always a legal announcement and the bot never stalls on a
        // modal trigger. This is the FALLBACK policy only: the real decision is
        // an in-tree ISMCTS node via `CHOICE_CANDIDATE_GENERATORS`
        // (`gre/ai/choiceCandidates.ts`), which values each mode's own script.
        case "trigger-mode":
            return candidates.slice(0, min).map((c) => c.id);

        // ADR 0053 (pile division) — step 2 of the divide-then-choose family:
        // pick pile "A" or "B" (appended as neutral-value synthetic
        // candidates in `buildOwedChoice`, like `option-pick`'s options). A
        // minimal-legal default (ADR 0016) takes the first (`min` = 1) — the
        // engine never freezes on the choice. Smart pile evaluation (which
        // pile is worth more to keep/inflict) is deferred.
        case "pick-pile":
            return candidates.slice(0, min).map((c) => c.id);

        // CR 603.3b (ADR 0058) — order this bot's simultaneous-trigger slice.
        // `candidates` are the slice ids (appended in `buildOwedChoice`); `min`
        // equals the whole slice (count is fixed), so this returns every id in
        // collection order — a legal permutation. Self-ordering own triggers is
        // tactically immaterial, so the flat default suffices (ADR 0058).
        case "trigger-order":
            return candidates.slice(0, min).map((c) => c.id);

        // `may-pay` is a yes/no answer routed through `submitMayPay`
        // (`decideBotAction` handles it before reaching here), and
        // `mulligan-bottom` has its own pre-game branch. Reaching either via
        // `chooseResolution` is a programming error.
        // `may-pay` is yes/no (`submitMayPay`), `mulligan-bottom` has its own
        // pre-game branch, and `random-reveal` is an engine-drawn reveal acked
        // via `random-reveal-ack` (`decideBotAction` handles all three before
        // reaching here). Reaching any via `chooseResolution` is a bug.
        // `madness-cast` (CR 702.35a) also has its own dedicated path in
        // `decideBotAction` (the bot declines): never resolved here.
        // `rebound-cast` (CR 702.88a) mirrors it — its own dedicated path in
        // `decideBotAction` (the bot declines): never resolved here.
        case "may-pay":
        case "land-entry-tapped":
        case "draw-replacement":
        case "mulligan-bottom":
        case "random-reveal":
        case "name-card":
        case "madness-cast":
        case "rebound-cast":
            throw new Error(
                `chooseResolution: "${kind}" is not resolved here (use the dedicated path)`
            );

        default:
            return assertNever(kind);
    }
}

/** Decide the bot's action for the current window. Deterministic and
 *  side-effect free.
 *
 *  **Owed-ness is the ENGINE's answer, not this function's** (ADR 0047, issue
 *  #2284). `view.owedInput` is `computeOwedPlayerIds` + `computeExpectedInput`
 *  run on the bot's own reconstructed state; when it is undefined the game is
 *  simply not waiting on the bot and the only correct answer is `none`. This
 *  replaced a hand-rolled walk over the individual waiting fields — a mulligan
 *  branch keyed on `mulliganDeclaringId === botId`, a choice branch, a target
 *  branch, then a tail of combat and `priorityPlayerId === botId` guards — that
 *  was a SECOND, independent derivation of the same question. The two could
 *  disagree; when they did, the engine kept waiting and the bot kept idling, and
 *  nothing could tell that apart from a correct idle.
 *
 *  What survives from the old walk is the per-window ANSWER policy, now reached
 *  through a switch that is compile-time exhaustive over the Expected Input kind
 *  union: a new waiting kind cannot be added to the engine without this failing
 *  to build. And a window the bot cannot answer no longer collapses to `none` —
 *  it returns `unanswered`, which the driver escalates. */
export function decideBotAction(view: BotView): BotAction {
    if (view.gameOver) return NONE;

    // ADR 0047 — the single gate. No `=== view.botId` check anywhere below.
    const owed = view.owedInput;
    if (!owed) return NONE;

    const action = answerOwedInput(owed.kind, view);
    // The game is waiting on the bot and the bot produced nothing: a DEFECT,
    // and one that used to be silent. Report it as such (issue #2284).
    if (action.kind === "none") {
        return { kind: "unanswered", expectedKind: owed.kind };
    }
    return action;
}

/** How the bot answers each Expected Input kind (ADR 0047, issue #2284). The
 *  switch is exhaustive (`assertNever`): a new kind on the engine's union is a
 *  build error here, which is the structural half of the liveness invariant —
 *  the bot cannot silently inherit a waiting state nobody taught it to answer. */
function answerOwedInput(kind: ExpectedInputKind, view: BotView): BotAction {
    switch (kind) {
        // CR 608.2 / 101.4 — a mid-resolution interactive choice, including the
        // pre-game bottoming choice (CR 103.5) which rides the same queue.
        //
        // A GENERATOR-COVERED choice is a real ISMCTS decision node (PRD #1423,
        // issue #1506) — hand it to the Worker instead of answering it with the
        // ADR 0016 minimal default. The gate is `OwedChoice.searchable`,
        // computed in `buildOwedChoice` from `isSearchableChoiceNode` (the
        // single authority), so a kind that gains a generator stops being
        // heuristic-answered with no edit here.
        case "choice":
            if (view.mulliganBottomCount !== undefined) {
                return {
                    kind: "mulligan-bottom",
                    cardInstanceIds: chooseMulliganBottoms(
                        view.mulliganHand ?? [],
                        view.mulliganBottomCount
                    ),
                };
            }
            if (view.owedChoice) {
                if (view.owedChoice.searchable)
                    return { kind: "search-choice" };
                return chooseOwedChoiceAction(view.owedChoice);
            }
            return NONE;

        // CR 601.2c / 603.3d / 115.7 / 707.10b — a target selection. An
        // ENGINE-RAISED one (targeted trigger, retarget, copy retarget — issue
        // #2283) is a search node with a precomputed minimal-legal fallback; an
        // ANNOUNCED one is the bot's own half-built cast, which the executor
        // drives atomically as a continuation. Either way the SEARCH decides,
        // and `escalationLadder` is what covers a window it cannot answer.
        case "target":
            return { kind: "search-target" };

        // CR 509.1 — the declare-blockers turn-based action.
        case "blockers":
            return { kind: "declare-blockers" };

        // CR 508.1c/1g / 701.21a — the parked attack-declaration land-sacrifice
        // tax. The engine's own selection authority resolved the victims in
        // `buildBotView`; submitting them is the only legal exit (the tax has no
        // cancel mutation, CR 508.1g).
        case "sacrifice":
            return view.attackSacrifice
                ? {
                      kind: "select-sacrifice",
                      cardInstanceIds: view.attackSacrifice.cardInstanceIds,
                  }
                : NONE;

        // CR 508.1c/1g — the parked per-attacker MANA attack tax (Propaganda /
        // Collective Restraint): pay it when the bot can plausibly cover it,
        // else cancel the whole declaration.
        case "attack-mana-tax":
            return view.attackManaTaxAffordable
                ? { kind: "pay-attack-tax" }
                : { kind: "cancel-attack-tax" };

        // CR 117 — the default window. Also where the engine files the pre-game
        // mulligan declaration (`priorityPlayerId` IS the declaring player,
        // `setup.ts`), the payment parks (the payer holds priority while
        // paying), the combat-damage assignment sub-flow and the
        // declare-attackers turn-based action.
        case "priority":
            return decidePriorityAction(view);

        default:
            return assertNever(kind);
    }
}

/** The minimal-legal answer to an engine-raised target selection (issue #2283)
 *  — the driver's safety net when the ISMCTS search surfaces no move for the
 *  window, mirroring `chooseOwedChoiceAction`'s role for a searchable choice.
 *  `buildOwedTarget` already resolved the submission through the SAME
 *  enumerator the search reads (`enumerateRaisedTargetMoves`), so it is legal
 *  by construction; a null submission (no legal answer at all) yields `none`
 *  rather than an illegal guess the server would reject. */
export function chooseOwedTargetAction(owed: OwedTarget): BotAction {
    if (!owed.submission) return NONE;
    return {
        kind: "submit-target",
        targets: owed.submission.targets,
        confirmTargets: owed.submission.confirmTargets,
    };
}

/** The ADR 0016 minimal-legal answer to an owed pending choice — the fallback
 *  for every kind the ISMCTS search does NOT cover (no registered candidate
 *  generator), and the driver's safety net when a searchable choice yields no
 *  search move. Every branch returns a LEGAL submission, so the game always
 *  advances whatever the choice. Deterministic and side-effect free. */
export function chooseOwedChoiceAction(choice: OwedChoice): BotAction {
    if (choice.kind === "may-pay") {
        // Yes/no family: accept only when the cost is trivially affordable
        // from the bot's mana pool, else decline (ADR 0016 minimal policy —
        // smart "should I pay?" is deferred). Both answers are legal.
        const accept = choice.affordable === true;
        // CR 701.21a — a sacrifice leg with a real victim choice needs a
        // legal pick supplied alongside the accept, or the submit throws and
        // the bot freezes. Pick `sacrificeCount` worst-first candidates (a
        // minimal-legal default — smart victim choice is deferred).
        if (accept && choice.sacrificeCount && choice.sacrificeCount > 0) {
            return {
                kind: "may-pay",
                accept,
                sacrificeIds: worstFirst(choice.candidates)
                    .slice(0, choice.sacrificeCount)
                    .map((c) => c.id),
            };
        }
        // CR 118 threshold mode (Phyrexian Dreadnought) — greedily take the
        // highest-power candidates until the running total reaches the
        // threshold (fewest bodies given up; over-payment is legal).
        if (
            accept &&
            choice.sacrificeThreshold &&
            choice.sacrificeThreshold > 0
        ) {
            return {
                kind: "may-pay",
                accept,
                sacrificeIds: thresholdSacrifice(
                    choice.candidates,
                    choice.sacrificeThreshold
                ),
            };
        }
        // CR 701.9 / 118.9 (issue #899) — a discard leg with a real card
        // choice needs a legal pick supplied alongside the accept, or the
        // submit throws and the bot freezes. Unlike the sacrifice pick above,
        // the set is NOT derivable here: `buildOwedChoice` already resolved it
        // through the engine's one hand-leg assignment authority over the
        // bot's worst-first preference, because the leg's per-requirement
        // filters — not a count — decide what is legal (PR #1963 review round
        // 2; the old `worstFirst(candidates).slice(0, discardCount)` was
        // routinely illegal for a filtered multi-requirement leg).
        if (accept && choice.discardIds && choice.discardIds.length > 0) {
            return {
                kind: "may-pay",
                accept,
                discardIds: choice.discardIds,
            };
        }
        return { kind: "may-pay", accept };
    }
    if (choice.kind === "land-entry-tapped") {
        // CR 614.12 / ADR 0051 — shock land: pay iff affordable (life ≥
        // cost) to enter untapped, else enter tapped. Same minimal-legal
        // default as may-pay (ADR 0016); routed through its own mutation.
        return { kind: "land-entry", accept: choice.affordable === true };
    }
    if (choice.kind === "random-reveal") {
        // CR 705.2 / ADR 0023 — a no-decision reveal: the engine already
        // drew the outcome. The bot just acknowledges to resume (the human
        // client auto-acks on animation end).
        return { kind: "random-reveal-ack" };
    }
    if (choice.kind === "name-card") {
        // CR 202.3 / 201.3 / 614.1c — name a card. `buildOwedChoice` picked a
        // name through `isLegalNamedCard`, the SAME authority
        // `applyNameCardSubmit` validates the submission with, so this
        // submission is legal by construction (issue #2497).
        //
        // The old `?? "Plains"` fallback that stood here was the illegal-answer
        // door: a `no-basic-land` head (Desperate Research) rejects that exact
        // literal, and the `choice` kind has no ladder rung below this one, so
        // the rejection was a frozen game rather than a retry. `undefined` now
        // means the registry holds NO legal name for this head; `none` surfaces
        // that as an unanswered window (rung 5, a user-visible actionable
        // state) instead of looping on a string the server throws on.
        if (!choice.nameCardDefault) return NONE;
        return { kind: "name-card", cardName: choice.nameCardDefault };
    }
    if (choice.kind === "madness-cast") {
        // CR 702.35a — the reflexive Madness cast-choice: the bot's minimal
        // policy is to DECLINE (send the card to the graveyard). Casting from
        // exile for the madness cost is a real value decision deferred to a
        // later slice (ADR 0016); declining is always legal and never stalls.
        return { kind: "madness-decline" };
    }
    if (choice.kind === "rebound-cast") {
        // CR 702.88a — the reflexive Rebound cast-choice: the bot's minimal
        // policy is to DECLINE, mirroring Madness. Casting again for free
        // (picking a fresh target) is a real value decision deferred to a
        // later slice (ADR 0016); declining is always legal and never stalls
        // (unlike Madness, the card simply stays exiled — CR 702.88c).
        return { kind: "rebound-decline" };
    }
    if (choice.kind === "draw-replacement") {
        // CR 614 / issue #735 — Zur's Weirding "any other player may pay N
        // life to bin the revealed draw". The bot's minimal-legal default
        // (ADR 0016) is to DECLINE (let them draw) — paying life to deny an
        // unknown card is a value decision deferred to a later slice.
        // Declining is always legal and never stalls.
        return { kind: "draw-replacement", accept: false };
    }
    return {
        kind: "resolution-choice",
        cardInstanceIds: chooseResolution(choice),
    };
}

/** ADR 0091 / issue #1209 — how the bot ANSWERS each payment park.
 *
 *  `"dedicated"` — the park has its own `BotAction` kind below, because its
 *  answer is a TUNED heuristic that reads the bot's projected view rather than
 *  raw state (the mana-spend flexibility score, #1446) or predates the seam.
 *  `"generic"`   — the park is answered by the shared conservative pick
 *  (`pickForOwedPayment`) dispatched through `pay-owed-payment`.
 *
 *  `Record<ParkKind, …>` is the guard: a park added to the census in
 *  `gre/owedPayment.ts` cannot compile until it is routed here, and either
 *  route reaches a real mutation. That is the axis the earlier `assertNever`
 *  over `BotAction["kind"]` (#1506) could not cover — it classified union
 *  members that already existed, while every instance of this bug was a member
 *  nobody had added. */
export const PARK_ANSWER_ROUTE: Record<ParkKind, "dedicated" | "generic"> = {
    "cast:sacrificeSelection": "generic",
    "cast:additionalCost": "generic",
    "cast:convokeCreatureChoice": "dedicated",
    "cast:exileFromGraveyardChoice": "dedicated",
    "cast:alternativeCostHandChoice": "generic",
    "cast:manaSpendChoice": "dedicated",
    "activation:sacrificeSelection": "generic",
    "activation:exileFromGraveyardChoice": "generic",
    "activation:tapOtherChoice": "generic",
    "activation:discardFilterChoice": "generic",
    "activation:manaSpendChoice": "dedicated",
};

/** The bot's answer inside a CR 117 priority window — the payment parks, the
 *  pre-game mulligan declaration, the combat-damage confirmation, the
 *  declare-attackers turn-based action and finally the ordinary pass. Reached
 *  only once the engine's Expected Input has already named the bot (issue
 *  #2284), so it contains no owed-ness checks of its own; exported because the
 *  escalation ladder's rung 2 needs the same conservative default WITHOUT going
 *  back through `decideBotAction`. */
export function decidePriorityAction(view: BotView): BotAction {
    // Pre-game mulligan declaration (CR 103.5, London mulligan). The engine
    // files this under `priority` — `setup.ts` sets
    // `priorityPlayerId = mulligan.declaringPlayerId` and `mulligan.ts` keeps it
    // there — so the Expected Input authority already named the declarer and no
    // `mulliganDeclaringId === botId` check is needed (nor wanted: that check
    // WAS the parallel derivation). Bottoming rides `pendingChoices`, so it
    // arrives as the `choice` kind instead.
    if (view.phase === "MULLIGAN") return decideMulligan(view);

    // ADR 0091 / issue #1209 — the FIRST payment park owed, in canonical gate
    // order (`nextOwedPayment`). A park blocks the announcement's commit and
    // lives outside `pendingChoices[]`, so nothing else the bot could do is
    // legal while one is owed: it is answered before every other branch. Parks
    // routed `"dedicated"` fall through to their own tuned branch below; the
    // rest are answered by the shared conservative pick, which is what makes a
    // NEW park non-stalling for free.
    const owed = view.owedPayment;
    if (
        owed &&
        PARK_ANSWER_ROUTE[owed.park.kind] === "generic" &&
        owed.submission
    ) {
        return {
            kind: "pay-owed-payment",
            park: owed.park.kind,
            submission: owed.submission,
        };
    }

    // CR 601.2g / 702.66 (issue #1336) — the parked graveyard-exile CAST cost
    // (delve's variable offset; the fixed flashback / escape exile costs ride
    // the same picker). Same "resolve the park before anything else" class as
    // the mana-spend branch below, and ordered FIRST because the exile pick is
    // what determines how much mana is still owed (CR 601.2g: reduce → payWith
    // → mana), so any generic-spend ambiguity is only meaningful after it.
    // CR 702.51 / 601.2g (issue #1338) — the parked Convoke creature picker,
    // ordered BEFORE the delve exile picker: convoke pays the coloured / hybrid
    // pips and reduces the generic, and the delve picker is only built after the
    // convoke pick lands (`recordConvokeCreaturePick`). Same "resolve the park
    // before anything else" class, closed by a direct mutation.
    if (view.convokeChoice) {
        return {
            kind: "convoke-creatures",
            creatureInstanceIds: chooseConvokeCreatures(view.convokeChoice),
        };
    }

    if (view.castExileChoice) {
        return {
            kind: "cast-exile-cost",
            cardInstanceIds: chooseCastExileCost(view.castExileChoice),
        };
    }

    // CR 601.2g (issue #1446) — the parked generic-spend choice: a cast or
    // activated ability the bot itself is paying for parked because the
    // payer's choice of which pooled color covers the remaining generic is
    // meaningful (CR 601.2g). The payer holds priority but the parked
    // cast/activation blocks passing, so this MUST resolve first — the same
    // "resolve the park before anything else" class as the attack-tax branch
    // below, closed here the same way (a direct mutation, no Worker/search).
    if (view.manaSpendChoice) {
        return {
            kind: "resolve-mana-spend",
            spendOrder: chooseManaSpendOrder(view.manaSpendChoice),
        };
    }

    // Combat declarations are gated before priority can pass (the server
    // rejects passPriority until they are confirmed), so handle them first.
    // No `activePlayerId === view.botId` guard: at DECLARE_ATTACKERS with an
    // unconfirmed declaration the Expected Input names the ACTIVE player, and
    // the gate above already established that it named the bot (issue #2284 —
    // re-checking it here is the parallel derivation this issue removes).
    if (
        view.phase === "DECLARE_ATTACKERS" &&
        view.hasCombat &&
        !view.attackersConfirmed
    ) {
        return { kind: "declare-attackers" };
    }

    // Combat-damage assignment (CR 510.1c, multi-block). The assigner must
    // confirm damage before priority can pass; `passPriority` is rejected while
    // `damageConfirmed === false`. Confirm instead of passing.
    //
    // The old "bot holds priority but is not the outstanding assigner → wait"
    // branch is gone with the parallel derivation: `computeOwedPlayerIds` folds
    // this sub-flow in (it names the outstanding ASSIGNERS, not
    // `priorityPlayerId`), so a bot that is not one of them is never owed here
    // and `decideBotAction` returned `none` before reaching this function.
    // Likewise the "attacker awaiting the defender's blocks" wait: that window's
    // Expected Input is `blockers`, naming the defender.
    if (
        (view.phase === "FIRST_STRIKE_DAMAGE" ||
            view.phase === "COMBAT_DAMAGE") &&
        view.hasCombat &&
        view.damageConfirmed === false &&
        view.botOwesDamageConfirm
    ) {
        return { kind: "confirm-combat-damage" };
    }

    // Ordinary priority window (CR 117). The engine already said this seat is
    // the one being waited on, so a pass is legal by construction.
    return { kind: "pass" };
}
