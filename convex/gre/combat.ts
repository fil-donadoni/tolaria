import type { CardInstanceState, GameState } from "./state";
import { refreshCounterGatedStatics } from "./state";
import type {
    ManaCost,
    PermanentView,
    StaticAttackRestriction,
    StaticBlockRestriction,
    StaticDeclaredAttackRestriction,
    StaticDeclaredBlockRestriction,
    StaticBlockRequirement,
} from "../cards/types";
import { isProtectedFromSource } from "./protection";
import { getEffectivePower, STATIC_EFFECT_CTX } from "./layers";
import { tryGetDefinition } from "../cards";
import {
    globalAttackProhibitionReason,
    combatDeclarationCap,
    ATTACK_RESTRICTION_CTX,
} from "../cards/attackRestrictions";
import type { CombatDeclarationCap } from "../cards/attackRestrictions";
import {
    evaluateBlockerKeywords,
    evaluateAttackerKeywords,
    describeMinimumBlockers,
} from "./combatRegistry";

/** Card definition id of the Legends World enchantment whose defender-history
 *  attack restriction carries no per-card predicate (cluster C9, #386) — the
 *  rule is global, so the engine recognises the card without a string-parsing
 *  pass. (Its cluster sibling Caverns of Despair no longer needs an id here:
 *  its combat caps are now DATA on the card, a `combat-declaration-cap` static
 *  effect the whole engine reads through `combatDeclarationCap` — #1127.) */
export const ARBORIA_ID = "095078b0-0f26-442f-9d3b-45e30cdb33c4";

/** CR 508.1 / 508.4 — marks a permanent as attacking, keeping the engine's TWO
 *  representations of "is this creature attacking" in sync: the combat-scoped
 *  id list (`combat.attackerIds`, membership) and the per-permanent flag
 *  (`CardInstanceState.isAttacking`, read by nearly everything combat-scoped —
 *  the layer system's "attacking creatures get +1/+0" statics,
 *  `combatRoleFilter: "attacking"` targeting, `PermanentFilter.isAttacking`,
 *  `SpellContext.getIsAttacking`, and the frontend wire/UI). Every real
 *  "becomes an attacker" transition MUST route through this ONE function —
 *  before it existed, three call sites hand-wrote both halves separately and
 *  one of them (a token entering the battlefield already attacking, issue
 *  #1195) forgot the `isAttacking` half: `combat.attackerIds` correctly
 *  listed the token but `isAttacking` stayed `undefined`, so the token was
 *  only HALF attacking — invisible to every read keyed off the flag instead
 *  of the id list. Idempotent on `attackerIds` (a caller that already pushed
 *  the id, e.g. the declare-attackers move, doesn't duplicate it).
 *
 *  Callers still own TAPPING — the tap rule differs by site (vigilance-gated
 *  at a normal attacker declaration vs. the unconditional CR 508.4 "enters
 *  tapped" token rule) and is deliberately not this function's concern. */
export function markAttacking(
    state: GameState,
    permanent: CardInstanceState
): void {
    if (!state.combat) return;
    if (!state.combat.attackerIds.includes(permanent.id)) {
        state.combat.attackerIds = [...state.combat.attackerIds, permanent.id];
    }
    permanent.isAttacking = true;
}

/** CR 506.3 / 508.1 — records that `permanent` was DECLARED as an attacker
 *  this turn. Deliberately separate from {@link markAttacking}: that one means
 *  "is an attacking creature right now" and is also used for a creature PUT
 *  onto the battlefield attacking (CR 506.3c), which was never declared as an
 *  attacker and so must NOT count as having attacked.
 *
 *  Sets two flags that answer the same question at different scopes:
 *  - `permanent.hasAttackedThisTurn` — per creature (Erg Raiders, Whirling
 *    Dervish);
 *  - `state.creatureAttackedThisTurn` — per GAME ("if no creatures attacked
 *    this turn", Keldon Twilight, issue #1944). It is not derivable from the
 *    per-card flags: CR 506.4 keeps a creature that attacked "having attacked"
 *    after it is removed from combat, and an attacker that DIED is no longer on
 *    any battlefield to scan — so a scan would report "no creatures attacked"
 *    on exactly the turns that saw the most combat.
 *
 *  FOUR declaration paths call this, and they are the complete set: the
 *  `confirmAttackers` mutation (`game.ts`), the auto-pass auto-confirm in
 *  `advancePhase` (`phases.ts`), the ISMCTS search sim (`search.ts`), and the
 *  1-ply greedy sim (`applyMove.ts`). Nothing enforces that mechanically — the
 *  greedy path shipped with `markAttacking` alone and left
 *  `state.creatureAttackedThisTurn` unset in every leaf, so the greedy
 *  evaluator read "no creatures attacked this turn" immediately after
 *  attacking (issue #1944 review fixup). A NEW declaration site must call this
 *  next to its `markAttacking`; grep `markAttacking(` and check each hit.
 *
 *  Deliberately excluded, and the reason the two helpers are separate: the
 *  enters-attacking token path (`state.ts`, CR 506.3c) calls `markAttacking`
 *  ONLY — such a creature was never DECLARED as an attacker. */
export function recordAttackerDeclared(
    state: GameState,
    permanent: CardInstanceState
): void {
    permanent.hasAttackedThisTurn = true;
    state.creatureAttackedThisTurn = true;
}

/** The minimum a caller must supply to answer "which attackers are unblocked".
 *
 *  Structural rather than `GameState` so the CLIENT can call the SAME function
 *  on its projected view (ADR 0074 — the frontend may import pure engine
 *  modules; what it never has is authority). A client that re-derived
 *  CR 509.1h from `blockerAssignments` would disagree with the server the
 *  moment a blocker left combat, and the hand menu would offer a ninjutsu
 *  activation the mutation rejects. */
export type UnblockedAttackerScope = {
    combat?: {
        attackerIds: readonly string[];
        blockedAttackerIds?: readonly string[];
        blockersConfirmed: boolean;
    };
    players: readonly { id: string; battlefield: readonly { id: string }[] }[];
};

/** CR 509.1h — the UNBLOCKED attacking creatures `playerId` controls, in
 *  `combat.attackerIds` order.
 *
 *  "Unblocked" is the negation of the explicit blocked list (ADR 0019): an
 *  attacker becomes blocked when one or more creatures are declared as
 *  blockers for it and STAYS blocked even if every blocker leaves combat, so
 *  it is not derivable from `blockerAssignments` alone. Before blockers are
 *  declared there is no blocked list, so every attacker reads as unblocked —
 *  which is what CR 509.1h says (an attacker is neither blocked nor unblocked
 *  until the declare-blockers step) but NOT what a cost that returns "an
 *  unblocked attacker" may act on. Callers that need the CR 702.49a window
 *  gate on `combat.blockersConfirmed` themselves; this function answers only
 *  "which attackers have no blockers declared for them".
 *
 *  The single authority for the question, so the ninjutsu cost's legality
 *  gate, its candidate picker and the Bot's move enumerator cannot disagree
 *  about which creatures qualify. */
export function unblockedAttackerIds(
    state: UnblockedAttackerScope,
    playerId: string
): string[] {
    const combat = state.combat;
    if (!combat) return [];
    const blocked = new Set(combat.blockedAttackerIds ?? []);
    const controlled = new Set(
        state.players
            .find((p) => p.id === playerId)
            ?.battlefield.map((c) => c.id) ?? []
    );
    return combat.attackerIds.filter(
        (id) => controlled.has(id) && !blocked.has(id)
    );
}

/** CR 509.1a / CR 613.1f — the blocker-side counterpart of
 *  {@link markAttacking}: locks in every creature listed in
 *  `combat.blockerAssignments` as a declared blocker, then IMMEDIATELY
 *  re-materializes the continuous effects whose condition reads that fact.
 *
 *  Marking a blocker is THREE writes that must never drift apart:
 *  - `isBlocking` — "is a blocking creature right now" (CR 509.1a). Read by
 *    combat damage, `combatRoleFilter: "blocking"` targeting, the layer
 *    system's `applies` predicates and the wire/UI.
 *  - `hasBlockedThisTurn` — "blocked this combat" (CR 506.4 keeps it true
 *    after the creature leaves combat). Read by Clockwork Beast / Clockwork
 *    Avian's end-of-combat intervening-if and Fungal Bloom-style shroud.
 *  - `refreshCounterGatedStatics` — a `keyword-grant` static effect carrying a
 *    `condition` is MATERIALIZED into the affected permanent's
 *    `staticAbilities` array, not recomputed at read time (`gre/state.ts`).
 *    A condition that reads `isBlocking` (Snow Devil's "has first strike as
 *    long as it's blocking and you control a snow land", CR 611.2c) is
 *    therefore STALE for every read between the flag write and the next SBA
 *    pass — and the CR 510.4 "skip the first-strike damage step" decision
 *    (`anyCombatantHasFirstOrDoubleStrike`, `phases.ts`) is taken inside that
 *    window whenever `drainAutoPasses` runs straight off a blocker
 *    confirmation. The window is real and was shipped: with both seats
 *    holding a standing Pass Turn intent, the drain reached `advancePhase`
 *    before any SBA pass and FIRST_STRIKE_DAMAGE was skipped outright
 *    (issue #1826 review).
 *
 *  Every "becomes a declared blocker" transition MUST route through this ONE
 *  function — the `confirmBlockers` mutation (`game.ts`), the two auto-confirm
 *  paths in `advancePhase` (camouflage + the no-legal-block fall-through,
 *  `phases.ts`), the ISMCTS search sim (`search.ts`), the 1-ply greedy sim
 *  (`applyMove.ts`), and the two `SpellContext` block writers (`swapBlockers`,
 *  `applyCamouflagePileBlocks`, `state.ts`). Before it existed, all seven
 *  hand-wrote the flags: three forgot `hasBlockedThisTurn` and SIX had no
 *  refresh at all. Like {@link markAttacking}, the routing is CONVENTIONAL —
 *  nothing enforces it mechanically, so a new site can still hand-write
 *  `isBlocking`. A `scripts/__tests__` grep guard (no `isBlocking = true`
 *  outside this function) would make it structural.
 *
 *  Idempotent, and keyed off `combat.blockerAssignments` rather than an id
 *  list so a caller cannot mark a set that differs from the declaration
 *  record. Callers own everything else about confirmation (setting
 *  `blockersConfirmed`, `recordBlockedAttackers`, event emission) — those
 *  differ per site, the flags do not. */
export function markDeclaredBlockers(state: GameState): void {
    if (!state.combat) return;
    for (const blockerId of Object.keys(state.combat.blockerAssignments)) {
        for (const player of state.players) {
            const card = player.battlefield.find((c) => c.id === blockerId);
            if (!card) continue;
            card.isBlocking = true;
            card.hasBlockedThisTurn = true;
            break;
        }
    }
    refreshCounterGatedStatics(state);
}

/** True when any permanent with the given card id is on any player's
 *  battlefield. Used for global World-enchantment effects (CR 109.2 — the
 *  effect applies regardless of controller). */
function isCardOnBattlefield(state: GameState, cardId: string): boolean {
    return state.players.some((p) =>
        p.battlefield.some((c) => (c.card as { id?: string }).id === cardId)
    );
}

/** CR 508.1a — the battlefield-wide cap on how many creatures may be declared
 *  as attackers this combat, with the Oracle sentence that imposes it. Scans
 *  every permanent for a `combat-declaration-cap` static effect (Caverns of
 *  Despair at two, Dueling Grounds at one) and returns the most restrictive,
 *  else `undefined` (no cap). */
export function getAttackerCapEffect(
    state: GameState
): CombatDeclarationCap | undefined {
    return combatDeclarationCap(state as never, "attack");
}

/** CR 509.1a — the declare-blockers twin of `getAttackerCapEffect`. */
export function getBlockerCapEffect(
    state: GameState
): CombatDeclarationCap | undefined {
    return combatDeclarationCap(state as never, "block");
}

/** CR 508.1a — the declared-attacker cap as a bare number, for callers that
 *  only need to bound a count (the bot's move enumeration). */
export function getAttackerCap(state: GameState): number | undefined {
    return getAttackerCapEffect(state)?.max;
}

/** CR 509.1a — the declared-blocker cap as a bare number. */
export function getBlockerCap(state: GameState): number | undefined {
    return getBlockerCapEffect(state)?.max;
}

/** Generic minimum-blocker threshold (CR 509.1b).
 *
 *  Some restrictions don't forbid a blocker outright — they impose a MINIMUM
 *  on how many creatures must block the attacker together. Menace
 *  (CR 702.111a) sets that minimum to two; the parametrized
 *  `minimum-blockers:N` marker covers the keyword-less rules-text form ("can't
 *  be blocked except by three or more creatures").
 *
 *  Both are declared as rows in `MINIMUM_BLOCKER_RULES`
 *  (`gre/combatRegistry.ts`) — the single census of what can raise the
 *  threshold — and `describeMinimumBlockers` takes the MAXIMUM over every
 *  matching row, because CR 509.1b applies every restriction at once.
 *
 *  Returns the per-attacker minimum number of blockers (default 1, i.e. no
 *  constraint). */
export function getMinimumBlockers(attacker: CardInstanceState): number {
    return describeMinimumBlockers(attacker).min;
}

/** Validates the COMPLETE set of declared blocks against every attacker's
 *  minimum-blocker threshold (CR 509.1b). Unlike pairwise blocker eligibility,
 *  a minimum constraint can only be judged once all blocks are known: an
 *  attacker with menace blocked by exactly one creature is an ILLEGAL block
 *  declaration (CR 509.1c), but the same single block is a legal intermediate
 *  state while the defender is still assigning. Hence this runs at confirm
 *  time, not at per-blocker assignment time.
 *
 *  `blockerAssignments` maps blockerId → the attacker ids it blocks. An
 *  attacker is "blocked" by N distinct creatures; the declaration is legal
 *  only when N is 0 (unblocked) or N ≥ the attacker's minimum. */
export function validateMinimumBlockers(
    state: GameState
): { ok: true } | { ok: false; reason: string } {
    const combat = state.combat;
    if (!combat) return { ok: true };

    // Count distinct blockers per attacker from the assignment map.
    const blockerCountByAttacker = new Map<string, number>();
    for (const attackerIds of Object.values(combat.blockerAssignments)) {
        for (const attackerId of attackerIds) {
            blockerCountByAttacker.set(
                attackerId,
                (blockerCountByAttacker.get(attackerId) ?? 0) + 1
            );
        }
    }

    const activePlayer = state.players.find(
        (p) => p.id === state.activePlayerId
    );
    if (!activePlayer) return { ok: true };

    for (const attackerId of combat.attackerIds) {
        const blockedBy = blockerCountByAttacker.get(attackerId) ?? 0;
        if (blockedBy === 0) continue; // unblocked is always legal
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue;
        const { min, sourceLabel } = describeMinimumBlockers(attacker);
        if (blockedBy < min) {
            const cardName = tryGetDefinition(
                (attacker.card as { id?: string }).id ?? ""
            )?.name;
            const label = cardName ?? "This creature";
            // CR 509.1b — name the keyword when there is one (menace); plain
            // rules-text restrictions print no keyword.
            const blame = sourceLabel !== undefined ? ` (${sourceLabel})` : "";
            return {
                ok: false,
                reason: `${label} can't be blocked except by ${min} or more creatures${blame}`,
            };
        }
    }
    return { ok: true };
}

/** Arboria (CR 508.1c) — true when a creature can't be declared as an attacker
 *  against `defenderId` because an Arboria is in play and that player took no
 *  qualifying action (cast a spell / put a nontoken permanent onto the
 *  battlefield) during their last turn. */
export function arboriaForbidsAttack(
    state: GameState,
    defenderId: string
): boolean {
    if (!isCardOnBattlefield(state, ARBORIA_ID)) return false;
    const defender = state.players.find((p) => p.id === defenderId);
    return !defender?.qualifyingActionLastTurn;
}

export type AttackerValidation =
    | { eligible: true }
    | { eligible: false; reason: string };

/** Collects `attack-restriction` static effects from a card's definition
 *  AND from any auras attached to it (CR 303.4 — aura effects apply to their
 *  host), mirroring `collectBlockRestrictions` exactly (issue #1948, Hobble:
 *  "Enchanted creature can't attack" — an Aura-granted restriction, not a
 *  card-own one like Vodalian Serpent/Sea Serpent). `state` is optional to
 *  keep every existing call site (which didn't previously thread it) source
 *  compatible; without it only the card's own restrictions are returned,
 *  same degrade-gracefully contract `collectBlockRestrictions` already
 *  documents. */
function collectAttackRestrictions(
    card: CardInstanceState,
    state?: GameState
): StaticAttackRestriction[] {
    const restrictions: StaticAttackRestriction[] = [];
    const collect = (cardId: string | undefined) => {
        if (!cardId) return;
        const def = tryGetDefinition(cardId);
        if (!def?.staticEffects) return;
        for (const effect of def.staticEffects) {
            if (effect.kind === "attack-restriction") {
                restrictions.push(effect);
            }
        }
    };
    collect((card.card as { id?: string }).id);
    if (state) {
        for (const player of state.players) {
            for (const perm of player.battlefield) {
                if (perm.attachedTo !== card.id) continue;
                collect((perm.card as { id?: string }).id);
            }
        }
    }
    return restrictions;
}

/** Validates whether a card instance is eligible to be declared as an attacker
 *  (CR 508.1a-d). `defenderBattlefield` (CR 508.1c) lets the check evaluate
 *  conditional restrictions whose predicate depends on the defending player's
 *  permanents (Sea Serpent: "can't attack unless defending player controls an
 *  Island"). When omitted the conditional checks are skipped — call sites
 *  that don't yet plumb the defender battlefield retain the previous
 *  behavior, which only matters for the few cards that carry such
 *  restrictions. */
export function validateAttackerEligibility(
    card: CardInstanceState,
    defenderBattlefield?: CardInstanceState[],
    state?: GameState
): AttackerValidation {
    if (!card.types.includes("Creature")) {
        return { eligible: false, reason: "Only creatures can attack" };
    }
    // CR 508.1a (ADR 0053, pile division) — "can't attack this turn" flag.
    // Twin of `cantBlockThisTurn`'s Pass 0 check in
    // `validateBlockerEligibility`; set on the unchosen pile by Fight or
    // Flight.
    if (card.cantAttackThisTurn) {
        return {
            eligible: false,
            reason: "This creature can't attack this turn",
        };
    }
    // CR 702.3a+ — keyword-level attack restrictions (registry-driven).
    const keywordResult = evaluateAttackerKeywords(card);
    if (!keywordResult.eligible) return keywordResult;
    if (card.isTapped) {
        return { eligible: false, reason: "Tapped creatures cannot attack" };
    }
    // CR 702.10b — haste lets a creature attack ignoring summoning sickness.
    // Reads `staticAbilities` directly, which carries both natively-declared
    // haste and haste granted by `grantAbility` (the Op appends to the array;
    // issue #730 — Ray of Command / Magus of the Unseen grant haste to a
    // freshly-stolen permanent so it can attack the turn control is gained).
    if (card.isSummoningSick && !card.staticAbilities.includes("haste")) {
        return { eligible: false, reason: "Creature has summoning sickness" };
    }
    // CR 508.1c — card-level attack restrictions from staticEffects[].
    if (defenderBattlefield) {
        for (const r of collectAttackRestrictions(card, state)) {
            if (!r.predicate(card, defenderBattlefield)) {
                return { eligible: false, reason: r.oracleText };
            }
        }
    }
    // CR 508.1c — battlefield-scanned global attack restrictions. A permanent
    // OTHER than the attacker (Moat, Akron Legionnaire) can forbid the attack
    // via a `global-attack-restriction` static effect. Scanned across the whole
    // board, mirroring the Crusade anthem pattern.
    if (state) {
        const reason = globalAttackProhibitionReason(
            card as unknown as PermanentView,
            state as never
        );
        if (reason) {
            return { eligible: false, reason };
        }
    }
    // Arboria (CR 508.1c) — "Creatures can't attack a player unless that player
    // cast a spell or put a nontoken permanent onto the battlefield during
    // their last turn." A defender-history attack restriction; global, so it
    // lives in the engine rather than on the attacker's staticEffects[].
    if (state) {
        const defenderId = state.players.find(
            (p) => p.id !== card.controllerId
        )?.id;
        if (defenderId && arboriaForbidsAttack(state, defenderId)) {
            return {
                eligible: false,
                reason: "Arboria: that player took no qualifying action during their last turn",
            };
        }
    }
    // Island Sanctuary: defender can only be attacked by flying/islandwalk
    if (state?.islandSanctuaryProtection) {
        const defenderId = state.players.find(
            (p) => p.id !== card.controllerId
        )?.id;
        if (defenderId === state.islandSanctuaryProtection) {
            const hasFlying = card.staticAbilities.includes("flying");
            const hasIslandwalk = card.staticAbilities.includes("islandwalk");
            if (!hasFlying && !hasIslandwalk) {
                return {
                    eligible: false,
                    reason: "Island Sanctuary: can only be attacked by creatures with flying or islandwalk",
                };
            }
        }
    }
    return { eligible: true };
}

/** Collects `declared-attack-restriction` static effects from a card's own
 *  definition and from auras attached to it (CR 303.4 — aura effects apply to
 *  their host). Mirrors `collectBlockRestrictions`: requires `state` to discover
 *  attached auras (Errantry's "can only attack alone"). */
function collectDeclaredAttackRestrictions(
    card: CardInstanceState,
    state: GameState
): StaticDeclaredAttackRestriction[] {
    const restrictions: StaticDeclaredAttackRestriction[] = [];
    const collect = (cardId: string | undefined) => {
        if (!cardId) return;
        const def = tryGetDefinition(cardId);
        if (!def?.staticEffects) return;
        for (const effect of def.staticEffects) {
            if (effect.kind === "declared-attack-restriction") {
                restrictions.push(effect);
            }
        }
    };
    collect((card.card as { id?: string }).id);
    for (const player of state.players) {
        for (const perm of player.battlefield) {
            if (perm.attachedTo !== card.id) continue;
            collect((perm.card as { id?: string }).id);
        }
    }
    return restrictions;
}

/** CR 508.1d — the maximum number of must-attack REQUIREMENTS any legal
 *  declaration can obey. The rule is not "obey every requirement" and not
 *  "stop when the cap is reached": it is *obey the maximum number possible
 *  without violating any restriction*. The battlefield-wide declared-attacker
 *  cap (CR 508.1a) is a restriction, so it wins on the count — but the
 *  declaration must still spend every slot the cap allows on a requirement
 *  before any voluntary attacker gets one. Two Juggernauts under a Dueling
 *  Grounds means exactly ONE Juggernaut attacks and nothing else may. */
export function maxObeyableAttackRequirements(
    requiredCount: number,
    cap: number | undefined
): number {
    return cap === undefined ? requiredCount : Math.min(requiredCount, cap);
}

/** CR 508.1c/508.1d — normalizes a player's raw attacker SELECTION into the
 *  declaration the rules actually produce, and is the single authority on
 *  which declarations are legal.
 *
 *  Every producer of `combat.attackerIds` routes through this: the
 *  `confirmAttackers` mutation, the auto-pass confirm in `drainAutoPasses`
 *  (`gre/phases.ts`), and the bot's `enumerateAttackerMoves` (`gre/moves.ts`),
 *  which enumerates exactly this function's reachable outputs. Before it
 *  existed the mutation and the enumerator disagreed: the enumerator refused a
 *  declaration that crowded a must-attack creature out of the only slot, while
 *  the mutation accepted it.
 *
 *  Ordering encodes the rule: the player's own picks among the REQUIRED
 *  creatures come first (their choice of which requirement to obey is honoured
 *  before the engine picks for them), the quota is then topped up from the rest
 *  of the required set, and only the leftover cap slack goes to voluntary
 *  picks. A voluntary pick that would leave a requirement unobeyed is dropped —
 *  it was never part of a legal declaration. */
export function foldAttackRequirements(
    selected: readonly string[],
    requiredIds: readonly string[],
    cap: number | undefined
): string[] {
    const requiredSet = new Set(requiredIds);
    const quota = maxObeyableAttackRequirements(requiredIds.length, cap);
    const limit = cap ?? Number.POSITIVE_INFINITY;
    const out: string[] = [];
    for (const id of selected) {
        if (out.length >= quota) break;
        if (requiredSet.has(id) && !out.includes(id)) out.push(id);
    }
    for (const id of requiredIds) {
        if (out.length >= quota) break;
        if (!out.includes(id)) out.push(id);
    }
    for (const id of selected) {
        if (out.length >= limit) break;
        if (!requiredSet.has(id) && !out.includes(id)) out.push(id);
    }
    return out;
}

/** The defending player's battlefield (2-player engine), or `[]`. */
function defenderBattlefieldOf(state: GameState): CardInstanceState[] {
    return (
        state.players.find((p) => p.id !== state.activePlayerId)?.battlefield ??
        []
    );
}

/** Validates the COMPLETE set of declared attackers against every attacker's
 *  count-aware attack restrictions (CR 508.1c). The attack-side twin of
 *  `validateMinimumBlockers`: a restriction such as "can only attack alone"
 *  (Errantry) or "can't attack unless at least two other creatures attack"
 *  (Orcish Conscripts) can only be judged once the whole declared-attacker set
 *  is known, so it runs at confirm time rather than per-attacker at selection.
 *
 *  Also enforces the battlefield-wide declared-attacker CAP (CR 508.1a —
 *  Caverns of Despair, Dueling Grounds). The toggle path in `declareAttacker`
 *  already refuses the surplus selection, but that is not the only way an
 *  attacker joins the set: `confirmAttackers` auto-includes creatures that must
 *  attack (CR 508.1d) and a scripted/bot setup writes `attackerIds` directly, so
 *  the cap must ALSO be judged here, over the complete declared set — the one
 *  place every path passes through.
 *
 *  Returns `{ ok: true }` when the declaration is legal, otherwise the oracle
 *  text of the first violated restriction. */
export function validateDeclaredAttackers(
    state: GameState
): { ok: true } | { ok: false; reason: string } {
    const combat = state.combat;
    if (!combat) return { ok: true };
    const activePlayer = state.players.find(
        (p) => p.id === state.activePlayerId
    );
    if (!activePlayer) return { ok: true };

    const declared = combat.attackerIds
        .map((id) => activePlayer.battlefield.find((c) => c.id === id))
        .filter((c): c is CardInstanceState => c !== undefined);
    const declaredViews = declared as unknown as PermanentView[];

    // CR 508.1a — battlefield-wide cap on the number of declared attackers.
    const cap = getAttackerCapEffect(state);
    if (cap !== undefined && declared.length > cap.max) {
        return { ok: false, reason: cap.oracleText };
    }

    // CR 508.1d — the declaration must obey the MAXIMUM number of must-attack
    // requirements the restrictions leave room for. Declaring a voluntary
    // attacker in a slot a required creature could have used obeys fewer
    // requirements than possible, so it is illegal even though the cap check
    // above passes. The same rule the fold (`foldAttackRequirements`) and the
    // bot's enumeration apply constructively — this is the backstop for any
    // producer that writes `combat.attackerIds` directly.
    const requiredIds = getRequiredAttackerIds(
        activePlayer.battlefield,
        state,
        defenderBattlefieldOf(state),
        state.allCreaturesMustAttack
    );
    const quota = maxObeyableAttackRequirements(requiredIds.length, cap?.max);
    const obeyed = requiredIds.filter((id) =>
        combat.attackerIds.includes(id)
    ).length;
    if (obeyed < quota) {
        const missing = requiredIds.find(
            (id) => !combat.attackerIds.includes(id)
        );
        const name = missing
            ? (tryGetDefinition(
                  (
                      activePlayer.battlefield.find((c) => c.id === missing)
                          ?.card as { id?: string }
                  )?.id ?? ""
              )?.name ?? "A creature")
            : "A creature";
        return {
            ok: false,
            reason: `${name} must attack this combat if able`,
        };
    }

    for (const attacker of declared) {
        for (const r of collectDeclaredAttackRestrictions(attacker, state)) {
            if (
                !r.predicate(
                    attacker as unknown as PermanentView,
                    declaredViews
                )
            ) {
                return { ok: false, reason: r.oracleText };
            }
        }
    }
    return { ok: true };
}

export type BlockerValidation =
    | { eligible: true }
    | { eligible: false; reason: string };

/** Collects `block-restriction` static effects from a card's definition
 *  and from any auras attached to it (CR 303.4 — aura effects apply to
 *  their host). Requires `state` to discover attached auras; without state
 *  only the card's own restrictions are returned. */
function collectBlockRestrictions(
    card: CardInstanceState,
    side: "attacker" | "blocker",
    state?: GameState
): StaticBlockRestriction[] {
    const restrictions: StaticBlockRestriction[] = [];
    const collect = (cardId: string | undefined) => {
        if (!cardId) return;
        const def = tryGetDefinition(cardId);
        if (!def?.staticEffects) return;
        for (const effect of def.staticEffects) {
            if (effect.kind === "block-restriction" && effect.side === side) {
                restrictions.push(effect);
            }
        }
    };
    collect((card.card as { id?: string }).id);
    if (state) {
        for (const player of state.players) {
            for (const perm of player.battlefield) {
                if (perm.attachedTo !== card.id) continue;
                collect((perm.card as { id?: string }).id);
            }
        }
    }
    return restrictions;
}

/**
 * Validates whether `blocker` can be legally assigned to block `attacker`
 * given the defending player's battlefield. Evaluation order:
 *  1. Keyword-level evasion (registry): unblockable, landwalk, fear, flying.
 *  2. Card-level block restrictions from staticEffects[] (Juggernaut,
 *     Invisibility, Ironclaw Orcs, etc.) — predicate-driven via S2.
 *  3. Protection (CR 702.16f).
 *
 * `state` is optional — required for block-restriction predicates that check
 * effective P/T (CR 613 layer 7c). Without state, predicates degrade to
 * base P/T values.
 */
export function validateBlockerEligibility(
    attacker: CardInstanceState,
    blocker: CardInstanceState,
    defenderBattlefield: CardInstanceState[],
    state?: GameState
): BlockerValidation {
    // Pass 0 — "can't block this turn" flag (CR 509.1b). Twin of
    // mustBlockAllThisTurn; set by Ydwen Efreet's lost block flip.
    if (blocker.cantBlockThisTurn) {
        return {
            eligible: false,
            reason: "This creature can't block this turn",
        };
    }

    // Pass 0b — attacker "can't be blocked this turn" flag (CR 509.1b). Set on
    // the attacker by Tawnos's Wand; rejects every would-be blocker.
    if (attacker.cantBeBlockedThisTurn) {
        return {
            eligible: false,
            reason: "Attacker can't be blocked this turn",
        };
    }

    // Pass 0c — attacker "can't be blocked by [subtype] this turn" (CR 509.1b).
    // Set on the attacker by Tower of Coireall ("can't be blocked by Walls");
    // rejects only blockers carrying one of the listed subtypes.
    if (attacker.cantBeBlockedBySubtypesThisTurn?.length) {
        const blockerSubtypes = blocker.subtypes ?? [];
        const banned = attacker.cantBeBlockedBySubtypesThisTurn.find((s) =>
            blockerSubtypes.includes(s)
        );
        if (banned !== undefined) {
            return {
                eligible: false,
                reason: `Attacker can't be blocked by ${banned}s this turn`,
            };
        }
    }

    // Pass 0d — CR 702.28b (issue #1156): Shadow is BIDIRECTIONAL — "A
    // creature with shadow can block or be blocked by only creatures with
    // shadow." The attacker-has-shadow half is registry-driven below (the
    // `shadow` `EvasionRule`, keyed on the ATTACKER's keyword like Fear/
    // Flying); this is the reverse half the attacker-keyed `EvasionRule`
    // shape can't express — a BLOCKER carrying shadow is illegal against a
    // non-shadow attacker too. Checked directly (not registry-driven) since
    // it's the only keyword needing a blocker-keyed rule so far (Dauthi
    // Voidwalker, the first and — as of this issue — only shadow creature).
    if (
        blocker.staticAbilities.includes("shadow") &&
        !attacker.staticAbilities.includes("shadow")
    ) {
        return {
            eligible: false,
            reason: "This creature has shadow and can only block creatures with shadow",
        };
    }

    // Pass 1 — keyword-level evasion (registry-driven).
    // Covers: unblockable (509.1b), landwalk (702.13b), fear (702.36b),
    // flying (702.9b), shadow (702.28b).
    const keywordResult = evaluateBlockerKeywords(
        attacker,
        blocker,
        defenderBattlefield
    );
    if (!keywordResult.eligible) return keywordResult;

    // Pass 2 — card-level block restrictions from staticEffects[] (S2).
    const attackerRestrictions = collectBlockRestrictions(
        attacker,
        "attacker",
        state
    );
    const blockerRestrictions = collectBlockRestrictions(
        blocker,
        "blocker",
        state
    );
    if (attackerRestrictions.length > 0 || blockerRestrictions.length > 0) {
        const effAttacker = state
            ? { ...attacker, power: getEffectivePower(state, attacker) }
            : attacker;
        const effBlocker = state
            ? { ...blocker, power: getEffectivePower(state, blocker) }
            : blocker;
        for (const r of attackerRestrictions) {
            if (!r.predicate(effAttacker, effBlocker, state)) {
                // CR 509.1b — a restriction with a `bypassCost` (Hipparion) does
                // not forbid the block outright; the controller may pay to
                // declare it. Allow the assignment here and charge the cost at
                // block confirmation (`collectBlockBypassCharges`).
                if (r.bypassCost) continue;
                return { eligible: false, reason: r.oracleText };
            }
        }
        for (const r of blockerRestrictions) {
            if (!r.predicate(effBlocker, effAttacker, state)) {
                if (r.bypassCost) continue;
                return { eligible: false, reason: r.oracleText };
            }
        }
    }

    // Pass 3 — combat-scoped block restrictions not sourced from a card
    // (Raging River pile combat, ADR 0012). A restricted attacker can be
    // blocked only by flying creatures or creatures in the matching pile.
    const pileRestriction = state?.combatBlockRestrictions?.find(
        (r) => r.attackerId === attacker.id
    );
    if (pileRestriction) {
        const blockerFlies = blocker.staticAbilities.includes("flying");
        if (
            !blockerFlies &&
            blocker.pileLabel !== pileRestriction.allowedPileLabel
        ) {
            return {
                eligible: false,
                reason: `Attacker can be blocked only by flying creatures or creatures in the "${pileRestriction.allowedPileLabel}" pile`,
            };
        }
    }

    // Pass 4 — protection (CR 702.16f).
    // CR 112.1 — a blocker is a battlefield permanent, never a spell. The
    // spell-restricted quality (issue #2296) therefore always answers "no"
    // here: CR 702.16f is vacuous for it, but the path still RUNS.
    if (isProtectedFromSource(attacker, blocker, false)) {
        return {
            eligible: false,
            reason: "Attacker has protection from this blocker",
        };
    }

    return { eligible: true };
}

/** Collects `declared-block-restriction` static effects from a card's own
 *  definition and from auras attached to it (CR 303.4). Block-side twin of
 *  `collectDeclaredAttackRestrictions`. */
function collectDeclaredBlockRestrictions(
    card: CardInstanceState,
    state: GameState
): StaticDeclaredBlockRestriction[] {
    const restrictions: StaticDeclaredBlockRestriction[] = [];
    const collect = (cardId: string | undefined) => {
        if (!cardId) return;
        const def = tryGetDefinition(cardId);
        if (!def?.staticEffects) return;
        for (const effect of def.staticEffects) {
            if (effect.kind === "declared-block-restriction") {
                restrictions.push(effect);
            }
        }
    };
    collect((card.card as { id?: string }).id);
    for (const player of state.players) {
        for (const perm of player.battlefield) {
            if (perm.attachedTo !== card.id) continue;
            collect((perm.card as { id?: string }).id);
        }
    }
    return restrictions;
}

/** The distinct creatures declared as blockers this combat (each blocking at
 *  least one attacker), as instances on the defending player's battlefield. */
function declaredBlockerInstances(state: GameState): CardInstanceState[] {
    const combat = state.combat;
    if (!combat) return [];
    const defender = state.players.find((p) => p.id !== state.activePlayerId);
    if (!defender) return [];
    const out: CardInstanceState[] = [];
    for (const [blockerId, attackerIds] of Object.entries(
        combat.blockerAssignments
    )) {
        if (!attackerIds || attackerIds.length === 0) continue;
        const inst = defender.battlefield.find((c) => c.id === blockerId);
        if (inst) out.push(inst);
    }
    return out;
}

/** The creatures currently declared as blockers (at least one assignment). */
function distinctBlockerIds(state: GameState): string[] {
    const assignments = state.combat?.blockerAssignments ?? {};
    return Object.keys(assignments).filter(
        (id) => (assignments[id] ?? []).length > 0
    );
}

/** True when `blockerId`'s declared assignment obeys none of the must-block
 *  requirements that name it (CR 509.1c) — i.e. it is occupying a
 *  declared-blocker slot voluntarily. `baseline` is the requirement map
 *  computed against an EMPTY declaration ("who must block what, unconstrained
 *  by what has already been declared"). */
function blocksVoluntarily(
    state: GameState,
    blockerId: string,
    baseline: Record<string, string[]>
): boolean {
    const required = baseline[blockerId];
    if (!required || required.length === 0) return true;
    const declared = state.combat?.blockerAssignments[blockerId] ?? [];
    return !required.some((attackerId) => declared.includes(attackerId));
}

/** The two requirement maps `foldBlockRequirements` and its backstop both need:
 *  `baseline` = who must block what if nothing were declared yet;
 *  `missing` = what the CURRENT declaration still owes. */
function blockRequirementMaps(state: GameState): {
    baseline: Record<string, string[]>;
    missing: Record<string, string[]>;
} {
    const combat = state.combat;
    const attacker = state.players.find((p) => p.id === state.activePlayerId);
    const defender = state.players.find((p) => p.id !== state.activePlayerId);
    if (!combat || !attacker || !defender) {
        return { baseline: {}, missing: {} };
    }
    const args = [
        attacker.battlefield,
        defender.battlefield,
        combat.attackerIds,
    ] as const;
    return {
        baseline: getRequiredBlockerAssignments(...args, {}, state),
        missing: getRequiredBlockerAssignments(
            ...args,
            combat.blockerAssignments,
            state
        ),
    };
}

/** CR 509.1a/509.1c — the reason string when the declaration obeys fewer
 *  must-block requirements than the declared-blocker cap leaves room for
 *  (a voluntary block is holding a slot a required blocker needed), else
 *  `undefined`. */
function unobeyedBlockRequirement(state: GameState): string | undefined {
    const { baseline, missing } = blockRequirementMaps(state);
    const missingIds = Object.keys(missing);
    if (missingIds.length === 0) return undefined;
    const wasted = distinctBlockerIds(state).some((id) =>
        blocksVoluntarily(state, id, baseline)
    );
    if (!wasted) return undefined;
    const defender = state.players.find((p) => p.id !== state.activePlayerId);
    const inst = defender?.battlefield.find((c) => c.id === missingIds[0]);
    const name =
        (inst
            ? tryGetDefinition((inst.card as { id?: string }).id ?? "")?.name
            : undefined) ?? "A creature";
    return `${name} must block this combat if able`;
}

/** CR 509.1a/509.1c — folds must-block requirements (Lure, Blaze of Glory)
 *  into the declaration, obeying the MAXIMUM number the declared-blocker cap
 *  leaves room for. The block-side twin of `foldAttackRequirements`, and the
 *  single writer of requirement-driven block assignments.
 *
 *  Two rules the naive "add every requirement" loop got wrong:
 *  - Giving an ALREADY-blocking creature another attacker costs no slot (the
 *    cap counts creatures, not assignments — Two-Headed Giant), so it always
 *    goes through.
 *  - When the cap is full, a REQUIREMENT outranks a VOLUNTARY block: the
 *    voluntary blocker is dropped to free the slot rather than the requirement
 *    being silently skipped. Skipping it obeyed zero requirements where one was
 *    possible, which is illegal (and, once the backstop check exists, would
 *    leave the defender unable to confirm at all). */
export function foldBlockRequirements(state: GameState): void {
    const combat = state.combat;
    if (!combat) return;
    const cap = getBlockerCapEffect(state)?.max;
    const { baseline, missing } = blockRequirementMaps(state);
    const assignments = combat.blockerAssignments;

    for (const [blockerId, attackerIds] of Object.entries(missing)) {
        const existing = assignments[blockerId] ?? [];
        if (
            existing.length === 0 &&
            cap !== undefined &&
            distinctBlockerIds(state).length >= cap
        ) {
            const victim = distinctBlockerIds(state).find((id) =>
                blocksVoluntarily(state, id, baseline)
            );
            // Every slot is already obeying a requirement — the cap, not the
            // declaration, is what leaves this one unobeyed. That is legal.
            if (victim === undefined) continue;
            delete assignments[victim];
        }
        assignments[blockerId] = [
            ...(assignments[blockerId] ?? []),
            ...attackerIds,
        ];
    }
}

/** Validates the COMPLETE set of declared blockers against every blocker's
 *  count-aware block restrictions (CR 509.1b). Block-side twin of
 *  `validateDeclaredAttackers`: "can't block unless at least two other
 *  creatures block" (Orcish Conscripts) is judged once the whole declared set
 *  is known, so it runs at block confirmation. Also enforces the
 *  battlefield-wide declared-blocker CAP (CR 509.1a — Caverns of Despair,
 *  Dueling Grounds) over the complete set, the twin of the attacker-cap check
 *  in `validateDeclaredAttackers`. */
export function validateDeclaredBlockers(
    state: GameState
): { ok: true } | { ok: false; reason: string } {
    const declared = declaredBlockerInstances(state);
    // CR 509.1a — the cap counts distinct BLOCKING CREATURES, which is exactly
    // what `declaredBlockerInstances` returns (a creature blocking two
    // attackers consumes one slot).
    const cap = getBlockerCapEffect(state);
    if (cap !== undefined && declared.length > cap.max) {
        return { ok: false, reason: cap.oracleText };
    }
    // CR 509.1a/509.1c — the block-side twin of the attacker requirement check:
    // when the cap binds, every slot must go to a creature that is obeying a
    // must-block requirement before any voluntary block gets one. Backstop for
    // `foldBlockRequirements`, which enforces the same rule constructively.
    if (cap !== undefined) {
        const unobeyed = unobeyedBlockRequirement(state);
        if (unobeyed) return { ok: false, reason: unobeyed };
    }
    if (declared.length === 0) return { ok: true };
    const declaredViews = declared as unknown as PermanentView[];

    for (const blocker of declared) {
        for (const r of collectDeclaredBlockRestrictions(blocker, state)) {
            if (
                !r.predicate(blocker as unknown as PermanentView, declaredViews)
            ) {
                return { ok: false, reason: r.oracleText };
            }
        }
    }
    return { ok: true };
}

/** A mana cost the defending player must pay to legalize a declared block
 *  (CR 509.1b — Hipparion). One entry per qualifying block. */
export interface BlockBypassCharge {
    controllerId: string;
    cost: ManaCost;
    reason: string;
}

/** Scans the confirmed block assignments for blocks that are only legal because
 *  a `bypassCost`-carrying restriction is being paid (Hipparion). Returns one
 *  charge per qualifying (blocker → attacker) block; the caller pays each at
 *  block confirmation. Read-only — payment happens in `confirmBlockers`. */
export function collectBlockBypassCharges(
    state: GameState
): BlockBypassCharge[] {
    const combat = state.combat;
    if (!combat) return [];
    const activePlayer = state.players.find(
        (p) => p.id === state.activePlayerId
    );
    const defender = state.players.find((p) => p.id !== state.activePlayerId);
    if (!activePlayer || !defender) return [];

    const charges: BlockBypassCharge[] = [];
    for (const [blockerId, attackerIds] of Object.entries(
        combat.blockerAssignments
    )) {
        if (!attackerIds || attackerIds.length === 0) continue;
        const blocker = defender.battlefield.find((c) => c.id === blockerId);
        if (!blocker) continue;
        const restrictions = collectBlockRestrictions(
            blocker,
            "blocker",
            state
        ).filter((r) => r.bypassCost);
        if (restrictions.length === 0) continue;
        const effBlocker = {
            ...blocker,
            power: getEffectivePower(state, blocker),
        };
        for (const attackerId of attackerIds) {
            const attacker = activePlayer.battlefield.find(
                (c) => c.id === attackerId
            );
            if (!attacker) continue;
            const effAttacker = {
                ...attacker,
                power: getEffectivePower(state, attacker),
            };
            for (const r of restrictions) {
                // The cost applies only when the restriction is actually
                // triggered (e.g. the blocked attacker has power 3+). A block
                // the predicate already permits costs nothing.
                if (r.predicate(effBlocker, effAttacker, state)) continue;
                charges.push({
                    controllerId: blocker.controllerId,
                    cost: r.bypassCost!,
                    reason: r.oracleText,
                });
            }
        }
    }
    return charges;
}

/** A land-sacrifice cost the attacking player must pay to legalize the declared
 *  attack (CR 508.1c/1g — Flooded Woodlands, Reclamation). `count` is the number
 *  of lands to sacrifice: one per taxed attacker per active tax source. */
export interface AttackSacrificeCharge {
    controllerId: string;
    count: number;
    reason: string;
}

/** Scans the confirmed declared attackers for the battlefield-scanned
 *  `attack-sacrifice-tax` static effect (Flooded Woodlands: green creatures;
 *  Reclamation: black creatures — #733) and returns the per-controller
 *  land-sacrifice cost. The tax scales with the taxed-attacker count and is
 *  imposed independently by EACH active tax source (two Flooded Woodlands each
 *  charge their own land per green attacker — each is a separate CR 508.1c
 *  restriction). Read-only — the sacrifice itself is executed by the caller at
 *  declare-attackers confirmation (`confirmAttackers`), the attack-side analogue
 *  of `collectBlockBypassCharges`. */
export function collectAttackSacrificeTax(
    state: GameState
): AttackSacrificeCharge[] {
    const combat = state.combat;
    if (!combat) return [];
    const activePlayer = state.players.find(
        (p) => p.id === state.activePlayerId
    );
    if (!activePlayer) return [];

    const declared = combat.attackerIds
        .map((id) => activePlayer.battlefield.find((c) => c.id === id))
        .filter((c): c is CardInstanceState => c !== undefined);
    if (declared.length === 0) return [];

    const perController = new Map<string, { count: number; reason: string }>();
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetDefinition(cardId);
            if (!def?.staticEffects) continue;
            for (const effect of def.staticEffects) {
                if (effect.kind !== "attack-sacrifice-tax") continue;
                for (const attacker of declared) {
                    if (
                        !effect.taxes(
                            attacker as unknown as PermanentView,
                            source as unknown as PermanentView,
                            state as never,
                            ATTACK_RESTRICTION_CTX
                        )
                    ) {
                        continue;
                    }
                    const cur = perController.get(attacker.controllerId) ?? {
                        count: 0,
                        reason: effect.oracleText,
                    };
                    cur.count += 1;
                    perController.set(attacker.controllerId, cur);
                }
            }
        }
    }
    return [...perController.entries()].map(([controllerId, v]) => ({
        controllerId,
        count: v.count,
        reason: v.reason,
    }));
}

/** A mana cost the attacking player must pay to legalize an attack against the
 *  taxing player (CR 508.1c/1g — Propaganda, Ghostly Prison, Windborn Muse,
 *  Elephant Grass). One charge per taxed attacker per active tax source; each
 *  charge is `costPerAttacker`, paid by auto-tapping the payer's mana sources at
 *  declare-attackers confirmation. */
export interface AttackManaCharge {
    controllerId: string;
    cost: ManaCost;
    reason: string;
}

/** Scans the confirmed declared attackers for the battlefield-scanned
 *  `attack-mana-tax` static effect (Propaganda / Ghostly Prison / Elephant
 *  Grass clause 3) and returns the per-attacker mana charges. Unlike
 *  `collectAttackSacrificeTax` — a global "green/black creatures can't attack"
 *  tax that fires regardless of the defending player — this kind is DIRECTED at
 *  the source's controller ("creatures can't attack YOU"), so only sources
 *  controlled by the player being ATTACKED (the non-active player in 2-player
 *  combat) impose the tax. Each taxed attacker yields one `costPerAttacker`
 *  charge; the tax is imposed independently by EACH active tax source (two
 *  Propagandas each charge their own {2} per attacker — each is a separate CR
 *  508.1c restriction). Read-only — the mana payment itself is executed by the
 *  caller at declare-attackers confirmation (`confirmAttackers`), the same
 *  auto-tap path as `collectBlockBypassCharges` (Hipparion `bypassCost`). */
export function collectAttackManaTax(state: GameState): AttackManaCharge[] {
    const combat = state.combat;
    if (!combat) return [];
    const activePlayer = state.players.find(
        (p) => p.id === state.activePlayerId
    );
    if (!activePlayer) return [];

    const declared = combat.attackerIds
        .map((id) => activePlayer.battlefield.find((c) => c.id === id))
        .filter((c): c is CardInstanceState => c !== undefined);
    if (declared.length === 0) return [];

    const charges: AttackManaCharge[] = [];
    for (const player of state.players) {
        for (const source of player.battlefield) {
            // "Creatures can't attack YOU": only a source controlled by the
            // player BEING attacked (the defending, non-active player in
            // 2-player combat) taxes the attack. A source the attacking player
            // controls taxes nobody.
            if (source.controllerId === state.activePlayerId) continue;
            const cardId = (source.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetDefinition(cardId);
            if (!def?.staticEffects) continue;
            for (const effect of def.staticEffects) {
                if (effect.kind !== "attack-mana-tax") continue;
                // issue #1066 — `costPerAttacker` may be a fixed `ManaCost` OR
                // a function evaluated ONCE per source at combat time
                // (Collective Restraint's Domain-scaled `{X}`). Computed
                // outside the attacker loop: the charge is identical for
                // every taxed attacker this source imposes on, so the source
                // controller's board is read once, not per attacker.
                const cost =
                    typeof effect.costPerAttacker === "function"
                        ? effect.costPerAttacker(
                              source as unknown as PermanentView,
                              state as never,
                              ATTACK_RESTRICTION_CTX
                          )
                        : effect.costPerAttacker;
                for (const attacker of declared) {
                    if (
                        !effect.taxes(
                            attacker as unknown as PermanentView,
                            source as unknown as PermanentView,
                            state as never,
                            ATTACK_RESTRICTION_CTX
                        )
                    ) {
                        continue;
                    }
                    charges.push({
                        controllerId: attacker.controllerId,
                        cost,
                        reason: effect.oracleText,
                    });
                }
            }
        }
    }
    return charges;
}

/** True if `card` carries an `attack-requirement` static effect
 *  (CR 508.1d) or has been forced to attack this turn by an external
 *  effect (Nettling Imp — `mustAttackThisTurn`). A `condition` on the
 *  `attack-requirement` (CR 611.2c "as long as ...") is evaluated fresh
 *  against `state` here — the recomputed kind, no refresh sweep needed. */
function hasAttackRequirement(
    card: CardInstanceState,
    state: GameState,
    massAttackPlayerId?: string
): boolean {
    if (card.mustAttackThisTurn) return true;
    if (
        massAttackPlayerId &&
        card.controllerId === massAttackPlayerId &&
        card.types.includes("Creature")
    )
        return true;
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return false;
    const def = tryGetDefinition(cardId);
    if (!def?.staticEffects) return false;
    return def.staticEffects.some(
        (e) =>
            e.kind === "attack-requirement" &&
            (e.condition === undefined ||
                e.condition(card, state, STATIC_EFFECT_CTX))
    );
}

/**
 * True if `card` is subject to an "attacks each combat if able" requirement
 * (CR 508.1d) and is currently eligible to attack. Creatures with the
 * requirement but no legal attack (tapped, sick, defender, etc.) are not
 * required — CR 508.1d only forces requirements that can be obeyed.
 *
 * `state` is REQUIRED (issue #1948 review, BLOCKER 1) — this function used to
 * take it optionally and every real call site simply never supplied it, so
 * `validateAttackerEligibility`'s aura-attached `attack-restriction` scan
 * (Hobble: "enchanted creature can't attack") silently never ran on the
 * must-attack path: a Hobbled Juggernaut ("attacks each combat if able")
 * would be pushed into `combat.attackerIds` by `confirmAttackers` /
 * auto-pass-confirm with NO downstream re-validation, violating CR 508.1a. An
 * optional param on a legality predicate is exactly the fail-open shape —
 * the type system now forces every caller to supply real state. */
export function mustAttack(
    card: CardInstanceState,
    state: GameState,
    defenderBattlefield?: CardInstanceState[],
    massAttackPlayerId?: string
): boolean {
    if (!hasAttackRequirement(card, state, massAttackPlayerId)) return false;
    return validateAttackerEligibility(card, defenderBattlefield, state)
        .eligible;
}

/** Ids of creatures on `battlefield` that are required to attack this combat.
 *  `state` is REQUIRED — see `mustAttack`'s doc comment (issue #1948 review,
 *  BLOCKER 1). */
export function getRequiredAttackerIds(
    battlefield: CardInstanceState[],
    state: GameState,
    defenderBattlefield?: CardInstanceState[],
    massAttackPlayerId?: string
): string[] {
    return battlefield
        .filter((c) =>
            mustAttack(c, state, defenderBattlefield, massAttackPlayerId)
        )
        .map((c) => c.id);
}

/**
 * True if the defender has at least one creature that can legally block at
 * least one declared attacker. Used by the phase engine to auto-skip
 * DECLARE_BLOCKERS when every attacker is unblockable (e.g. all attackers
 * have evasion the defender can't beat).
 */
export function hasAnyLegalBlock(
    attackers: CardInstanceState[],
    defenderBattlefield: CardInstanceState[],
    state?: GameState
): boolean {
    const candidates = defenderBattlefield.filter(
        (c) => c.types.includes("Creature") && !c.isTapped
    );
    for (const attacker of attackers) {
        for (const blocker of candidates) {
            if (
                validateBlockerEligibility(
                    attacker,
                    blocker,
                    defenderBattlefield,
                    state
                ).eligible
            ) {
                return true;
            }
        }
    }
    return false;
}

/** Collects `block-requirement` static effects from a card's definition
 *  and from any auras attached to it (CR 509.1c). The scope "all-able"
 *  means every eligible creature must block this attacker (Lure). */
function collectBlockRequirements(
    card: CardInstanceState,
    state?: GameState
): StaticBlockRequirement[] {
    const requirements: StaticBlockRequirement[] = [];
    const collect = (cardId: string | undefined) => {
        if (!cardId) return;
        const def = tryGetDefinition(cardId);
        if (!def?.staticEffects) return;
        for (const effect of def.staticEffects) {
            if (effect.kind === "block-requirement") {
                requirements.push(effect);
            }
        }
    };
    collect((card.card as { id?: string }).id);
    if (state) {
        for (const player of state.players) {
            for (const perm of player.battlefield) {
                if (perm.attachedTo !== card.id) continue;
                collect((perm.card as { id?: string }).id);
            }
        }
    }
    return requirements;
}

/** Maximum number of attackers a blocker can block. Reads from both the
 *  card definition (static, e.g. Two-Headed Giant) and the instance
 *  (temporary, e.g. Blaze of Glory), taking the max of both. */
export function getMaxBlockTargets(card: CardInstanceState): number {
    const defVal =
        tryGetDefinition((card.card as { id?: string })?.id ?? "")
            ?.canBlockAdditional ?? 0;
    const instanceVal = card.canBlockAdditional ?? 0;
    return 1 + Math.max(defVal, instanceVal);
}

/** Computes mandatory blocker assignments for must-block requirements
 *  (CR 509.1c — Lure, Blaze of Glory mustBlockAll). Returns a map of
 *  blockerId → attackerIds[] that must be added to the current
 *  blockerAssignments. Only assigns blockers that are:
 *  - untapped creatures
 *  - not already at their max block limit
 *  - able to legally block the attacker (evasion, protection, etc.) */
export function getRequiredBlockerAssignments(
    attackerBattlefield: CardInstanceState[],
    defenderBattlefield: CardInstanceState[],
    attackerIds: string[],
    currentAssignments: Record<string, string[]>,
    state?: GameState
): Record<string, string[]> {
    const result: Record<string, string[]> = {};

    const attackers = attackerIds
        .map((id) => attackerBattlefield.find((c) => c.id === id))
        .filter((c): c is CardInstanceState => c !== undefined);

    const candidates = defenderBattlefield.filter(
        (c) => c.types.includes("Creature") && !c.isTapped
    );

    // Phase 1: Collect attackers that have block requirements (Lure)
    const attackersWithRequirement: CardInstanceState[] = [];
    for (const attacker of attackers) {
        const reqs = collectBlockRequirements(attacker, state);
        if (reqs.some((r) => r.scope === "all-able")) {
            attackersWithRequirement.push(attacker);
        }
    }

    // Phase 2: For each candidate blocker, determine what it must block
    for (const blocker of candidates) {
        const currentBlocks = [
            ...(currentAssignments[blocker.id] ?? []),
            ...(result[blocker.id] ?? []),
        ];
        const maxTargets = getMaxBlockTargets(blocker);

        // Check mustBlockAllThisTurn (Blaze of Glory)
        if (blocker.mustBlockAllThisTurn) {
            for (const attacker of attackers) {
                if (currentBlocks.length >= maxTargets) break;
                if (currentBlocks.includes(attacker.id)) continue;
                if (
                    validateBlockerEligibility(
                        attacker,
                        blocker,
                        defenderBattlefield,
                        state
                    ).eligible
                ) {
                    if (!result[blocker.id]) result[blocker.id] = [];
                    result[blocker.id].push(attacker.id);
                    currentBlocks.push(attacker.id);
                }
            }
        }

        // Check block requirements from attackers (Lure)
        for (const attacker of attackersWithRequirement) {
            if (currentBlocks.length >= maxTargets) break;
            if (currentBlocks.includes(attacker.id)) continue;
            if (
                validateBlockerEligibility(
                    attacker,
                    blocker,
                    defenderBattlefield,
                    state
                ).eligible
            ) {
                if (!result[blocker.id]) result[blocker.id] = [];
                result[blocker.id].push(attacker.id);
                currentBlocks.push(attacker.id);
            }
        }
    }

    return result;
}
