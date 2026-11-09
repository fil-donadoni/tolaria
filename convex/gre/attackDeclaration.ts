// Attack-declaration confirmation and finalization (CR 508), auth-free —
// moved out of `convex/game.ts` (issues #9002, #9028) so the Bot liveness
// ladder can confirm an open declaration, or complete a parked attack tax,
// without a Convex context. `confirmAttackers`, the attack-tax resume paths,
// `selectSacrificeOnState` and the ladder all call it; the rules live here once.
import type { PermanentFilter } from "../cards/filters";
import type { ManaCost } from "../cards/types";
import { assertGameNotOver } from "./activation";
import { isLegalBandComposition } from "./banding";
import {
    collectAttackManaTax,
    collectAttackSacrificeTax,
    foldAttackRequirements,
    getAttackerCapEffect,
    getRequiredAttackerIds,
    markAttacking,
    recordAttackerDeclared,
    validateDeclaredAttackers,
} from "./combat";
import { pruneEnlistChoices } from "./enlist";
import { assertExpectedInput } from "./expectedInput";
import { getOpponentId, getPlayer } from "./lookup";
import type { DeclineOutcome } from "./owedInputDeclines";
import { drainAutoPasses, emitAttackersDeclaredEvents } from "./phases";
import {
    applySacrificeSelection,
    autoResolveFungible,
    buildSacrificeRequirements,
    isSacrificeSelectionComplete,
    sacrificeCandidates,
    type SacrificeSelection,
} from "./sacrificeChoice";
import { normalizeManaCost, tapPermanent, type GameState } from "./state";

/** The guards an attack CONFIRMATION runs: the game is live, this player owes
 *  the `priority` input (ADR 0047), the step is DECLARE_ATTACKERS, the caller
 *  is the active player (CR 508.1) and the selection is open. Returns the
 *  open `combat`, or `null` when it is already confirmed — a fast double-press
 *  (Space×2) queues two confirms; the second is a benign no-op, the desired
 *  end-state already holds. */
function assertAttackConfirmationOpen(
    state: GameState,
    playerId: string
): NonNullable<GameState["combat"]> | null {
    assertGameNotOver(state);
    assertExpectedInput(state, { playerId, expect: "priority" });
    if (state.phase !== "DECLARE_ATTACKERS") {
        throw new Error("Not in DECLARE_ATTACKERS phase");
    }
    if (playerId !== state.activePlayerId) {
        throw new Error("Only the active player can confirm attackers");
    }
    if (!state.combat) {
        throw new Error("Attacker selection is not open");
    }
    return state.combat.confirmed ? null : state.combat;
}

/** A dropped attacker takes its planeswalker attack target (CR 508.1b), its
 *  optional exert cost (CR 508.1g / 701.43d) and its band membership (CR
 *  702.22f) with it — the same cleanup the deselect branch of `toggleAttacker`
 *  performs. The declaration can PARK after this (`pendingAttackManaTax` /
 *  `pendingAttackSacrifice`) and be saved, so a stale entry would be visible
 *  to the client and the Bot in between. */
function dropAttackerChoices(
    state: GameState,
    combat: NonNullable<GameState["combat"]>,
    droppedAttackers: string[]
): void {
    if (droppedAttackers.length === 0) return;
    const dropped = new Set(droppedAttackers);
    if (combat.attackTargets) {
        for (const id of droppedAttackers) delete combat.attackTargets[id];
        if (Object.keys(combat.attackTargets).length === 0) {
            combat.attackTargets = undefined;
        }
    }
    if (combat.exertedIds) {
        const kept = combat.exertedIds.filter((id) => !dropped.has(id));
        combat.exertedIds = kept.length > 0 ? kept : undefined;
    }
    if (combat.bands) {
        const player = getPlayer(state, state.activePlayerId);
        combat.bands = combat.bands
            .map((b) => ({
                ...b,
                memberIds: b.memberIds.filter((id) => !dropped.has(id)),
            }))
            .filter((b) => {
                if (b.memberIds.length < 2) return false;
                const members = b.memberIds
                    .map((id) => player.battlefield.find((c) => c.id === id))
                    .filter((c): c is NonNullable<typeof c> => !!c);
                return isLegalBandComposition(members);
            });
        if (combat.bands.length === 0) combat.bands = undefined;
    }
}

/** Confirm `voluntary` as the declaration: fold the requirements in, validate
 *  the complete set, then charge the attack costs and finalize. */
function confirmDeclaration(
    state: GameState,
    combat: NonNullable<GameState["combat"]>,
    playerId: string,
    voluntary: string[]
): DeclineOutcome {
    // CR 508.1c/508.1d: normalize the selection into the legal declaration —
    // fold in every eligible creature required to attack, capped by the
    // battlefield-wide declared-attacker cap, which as a CR 508.1c
    // RESTRICTION outranks the requirements. `foldAttackRequirements`
    // (`gre/combat.ts`) is the one authority the Bot's move enumeration shares,
    // so a confirmation can never accept a declaration the enumerator considers
    // illegal. A voluntary attacker that would crowd a must-attack creature out
    // of the last slot is dropped here — it was never part of a legal
    // declaration.
    const player = getPlayer(state, playerId);
    const defenderBattlefield = getPlayer(
        state,
        getOpponentId(state, playerId)
    ).battlefield;
    const foldedAttackers = foldAttackRequirements(
        voluntary,
        getRequiredAttackerIds(
            player.battlefield,
            state,
            defenderBattlefield,
            state.allCreaturesMustAttack
        ),
        getAttackerCapEffect(state)?.max
    );
    const droppedAttackers = combat.attackerIds.filter(
        (id) => !foldedAttackers.includes(id)
    );
    combat.attackerIds = foldedAttackers;
    // CR 702.154a — the fold can drop an attacker, or fold in a creature that
    // had been chosen as a partner.
    pruneEnlistChoices(combat);
    dropAttackerChoices(state, combat, droppedAttackers);

    // CR 508.1c-d — count-aware attack restrictions (Errantry "can only attack
    // alone", Orcish Conscripts "can't attack unless at least two other
    // creatures attack"). These read the COMPLETE declared-attacker set, so
    // they are enforced here at confirm rather than per-attacker at selection
    // (the mirror of validateMinimumBlockers).
    const declaredAttackCheck = validateDeclaredAttackers(state);
    if (!declaredAttackCheck.ok) {
        throw new Error(declaredAttackCheck.reason);
    }

    // CR 508.1h — per-attacker MANA attack tax directed at the taxing player
    // (Propaganda / Ghostly Prison / Windborn Muse / Collective Restraint,
    // #1053/#1066). Rather than silently auto-tapping the payer's lands (or
    // throwing when unpayable), the declaration PARKS on
    // `combat.pendingAttackManaTax` and the player pays via a prompt, mirroring
    // a cast payment. Charged BEFORE the land-sacrifice tax; the two never park
    // at once (the mana tax resumes into the sacrifice tax once paid).
    // CR 508.1h / 701.21a — otherwise the per-attacker sacrifice-a-land
    // attack tax (Flooded Woodlands, Reclamation, #733) then finalize: parks on
    // a real sacrifice choice (`combat.pendingAttackSacrifice`) or finalizes
    // inline.
    if (!beginAttackManaTax(state)) applyAttackSacrificeTaxAndFinalize(state);
    return { changed: true };
}

/** Lock in the attacker selection as declared (CR 508.1), charge the attack
 *  costs (CR 508.1g-h), tap the attackers and hand priority to the active
 *  player. Already confirmed → `already-confirmed`, a no-op. An illegal
 *  declaration (a count-aware restriction, too few lands for the sacrifice
 *  tax) throws, leaving the selection as the fold left it. */
export function confirmAttackersOnState(
    state: GameState,
    playerId: string
): DeclineOutcome {
    const combat = assertAttackConfirmationOpen(state, playerId);
    if (!combat) return { changed: false, reason: "already-confirmed" };
    return confirmDeclaration(state, combat, playerId, combat.attackerIds);
}

/** Declare NO voluntary attackers (CR 508.1a — the active player chooses which
 *  creatures attack, none included). Requirements still bind — CR 508.1d's
 *  must-attack creatures are folded back in by the confirmation, so this
 *  yields the smallest LEGAL declaration, not an illegal empty one. */
export function declareNoAttackersOnState(
    state: GameState,
    playerId: string
): DeclineOutcome {
    const combat = assertAttackConfirmationOpen(state, playerId);
    if (!combat) return { changed: false, reason: "already-confirmed" };
    return confirmDeclaration(state, combat, playerId, []);
}

/** Aggregate a list of mana costs into a single ManaCost (CR 508.1c/1g — one
 *  charge per taxed attacker per taxing source). Each cost is normalized (a
 *  numeric `{X}` folded into generic), then summed per colour; the total generic
 *  lands in `generic`. Colourless-generic-only in practice (attack taxes are all
 *  `{N}`), but colour-safe. Returns `{}` when every charge is zero (Domain-0
 *  Collective Restraint), which the caller reads as "no tax". */
function aggregateManaCosts(costs: ManaCost[]): ManaCost {
    const total: Record<string, number> = {};
    for (const c of costs) {
        for (const [k, v] of Object.entries(normalizeManaCost(c))) {
            if (typeof v === "number" && v > 0) total[k] = (total[k] ?? 0) + v;
        }
    }
    const result: ManaCost = {};
    for (const [k, v] of Object.entries(total)) {
        if (v <= 0) continue;
        // normalizeManaCost stores the whole generic total under key "X".
        if (k === "X") result.generic = (result.generic ?? 0) + v;
        else (result as Record<string, number>)[k] = v;
    }
    return result;
}

/** CR 508.1c/1g — park the per-attacker MANA attack tax (Propaganda / Ghostly
 *  Prison / Collective Restraint) so the attacking player PAYS it via a prompt
 *  (auto-tap or manual land taps) instead of the engine silently auto-tapping.
 *  Aggregates every taxed-attacker charge into one payment on
 *  `combat.pendingAttackManaTax`. Returns true when a payment was parked (the
 *  caller saves and returns, suspending the declaration); false when there is no
 *  tax (or it aggregates to zero — Domain 0), in which case the declaration
 *  continues to the sacrifice tax + finalize. */
export function beginAttackManaTax(state: GameState): boolean {
    const combat = state.combat;
    if (!combat) return false;
    const charges = collectAttackManaTax(state);
    if (charges.length === 0) return false;
    // The directed "creatures can't attack YOU" tax is always paid by the
    // attacking (active) player, so all charges share one payer. A future
    // multi-payer tax would need per-payer prompts — flag rather than mis-charge.
    if (new Set(charges.map((c) => c.controllerId)).size > 1) {
        throw new Error("Multi-payer attack mana tax is not supported");
    }
    const cost = aggregateManaCosts(charges.map((c) => c.cost));
    // Domain-0 Collective Restraint (every {X} = 0) — the attack is free.
    if (Object.keys(normalizeManaCost(cost)).length === 0) return false;
    combat.pendingAttackManaTax = {
        playerId: charges[0].controllerId,
        cost,
        reason: charges[0].reason,
        tappedLandIds: [],
    };
    return true;
}

/** CR 508.1c/1g / 701.21a — the per-attacker land-SACRIFICE attack tax (Flooded
 *  Woodlands, Reclamation) plus the finalize. Factored out of the confirmation so
 *  both the inline path and the mana-tax resume path (`tryCommitAttackManaTax`)
 *  run the identical continuation. Returns true when the declaration parked on a
 *  real sacrifice choice (`combat.pendingAttackSacrifice` — the caller saves and
 *  waits); false once the attack was finalized. Throws when the payer has too few
 *  lands to pay (the declaration is illegal — pre-existing Flooded Woodlands
 *  behavior, unchanged). */
export function applyAttackSacrificeTaxAndFinalize(state: GameState): boolean {
    const combat = state.combat;
    if (!combat) return false;
    const charges = collectAttackSacrificeTax(state);
    if (charges.length > 0) {
        // The attack-tax cards tax the attacking (active) player, so all
        // charges share one controller. A future multi-payer tax would need a
        // per-payer selection — flag it rather than silently paying one.
        if (new Set(charges.map((c) => c.controllerId)).size > 1) {
            throw new Error(
                "Multi-payer attack sacrifice tax is not supported"
            );
        }
        const payerId = charges[0].controllerId;
        const landFilter: PermanentFilter = { types: ["Land"] };
        const totalNeeded = charges.reduce((a, ch) => a + ch.count, 0);
        if (
            sacrificeCandidates(state, payerId, landFilter).length < totalNeeded
        ) {
            throw new Error(charges[0].reason);
        }
        const sel: SacrificeSelection = {
            playerId: payerId,
            reason: charges[0].reason,
            requirements: buildSacrificeRequirements(
                charges.map((ch) => ({ filter: landFilter, count: ch.count }))
            ),
            picked: [],
        };
        autoResolveFungible(state, sel);
        if (!isSacrificeSelectionComplete(sel)) {
            // Park the choice; selectSacrifice resumes finalizeConfirmAttackers.
            combat.pendingAttackSacrifice = sel;
            return true;
        }
        applySacrificeSelection(state, sel);
    }
    finalizeConfirmAttackers(state);
    return false;
}

/** Finalize the attacker declaration once every combat-declaration cost is paid
 *  (CR 508): tap and mark the attackers, open blocker declaration, fire the
 *  "when creatures attack" triggers, and hand priority to the active player.
 *  Shared by the inline path (fungible/no tax) and the selectSacrifice resume
 *  path (attack sacrifice tax chosen). */
export function finalizeConfirmAttackers(state: GameState): void {
    const player = getPlayer(state, state.activePlayerId);
    const combat = state.combat;
    if (!combat) return;
    // Tap and mark each attacker (vigilance creatures don't tap)
    for (const attackerId of combat.attackerIds) {
        const card = player.battlefield.find((c) => c.id === attackerId);
        if (card) {
            if (!card.staticAbilities.includes("vigilance")) {
                // CR 708.9 / ADR 0013 — a face-down attacker turns up as it
                // taps to attack.
                tapPermanent(state, card);
            }
            // Shared helper (`gre/combat.ts`, issue #1195) — sets BOTH
            // `combat.attackerIds` membership (already true here; idempotent)
            // AND `isAttacking` together, the single sync point every
            // combat-scoped read depends on.
            markAttacking(state, card);
            // CR 506.3 — the shared declaration record: per-card
            // `hasAttackedThisTurn` plus the game-level
            // `creatureAttackedThisTurn` (issue #1944).
            recordAttackerDeclared(state, card);
        }
    }
    combat.confirmed = true;
    combat.blockerAssignments = {};
    combat.blockersConfirmed = false;
    // ADR 0012 — fire "when creatures attack" triggers (Raging River).
    emitAttackersDeclaredEvents(state);
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
    drainAutoPasses(state);
}
