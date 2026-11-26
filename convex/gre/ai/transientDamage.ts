// "Can the damage this move marked still kill anything this turn?" — the
// second provable shape of the dominance proof (`dominance.ts`, issue #9956).
//
// THE DECISION IT SERVES. Damage marked on a creature that survives it is
// removed at cleanup (CR 514.2) and does nothing unless more damage, or less
// toughness, reaches that creature first (CR 704.5g). The bot used to cast a
// 2-damage instant at a 4/4 with a lone 1/1 beside it: the exact no-op
// comparison reads the marked damage as a real difference, and the search
// then prefers the cast because the line that still holds the card is the one
// its own playouts dilute.
//
// WHY `pass` DOMINATES. Marked damage adds up in any order, so a plan that
// needs this move can make it LAST, once the rest of the lethal sum is in
// place, at the same price. Denying it now loses nothing unless one of three
// things holds, and each is a condition below:
//
//   * the rest of the sum is combat damage, which is dealt without the bot
//     choosing a moment for it (`combatCannotFinish`);
//   * the rest of the sum is another announcement this same proof would also
//     deny, so the two would wait for each other forever
//     (`otherAnnouncementsAreInert`);
//   * the rest of the sum arrives from a triggered ability or under a damage
//     replacement, where the bot cannot count on a window between the two
//     (`boardCannotAddDamage`).
//
// IT FAILS CLOSED. A wrongly denied move is invisible (the bot never considers
// the play); a wrongly kept one costs a little search width. Every unproven
// input answers `false` and leaves the move to the search.

import type { CardDefinition, EffectOp } from "../../cards/types";
import { tryGetDefinition } from "../../cards";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { cloneGameState } from "../clone";
import { isCreature, liveStaticDefinition } from "../constants";
import { effectiveTriggeredAbilities } from "../copy";
import { getEffectivePT } from "../layers";
import { findCardInAnyZone } from "../lookup";
import type { CardInstanceState, GameState } from "../state";
// Type-only: erased at compile time, so this module stays off `moves.ts`'
// runtime import graph, like `dominance.ts`.
import type { Move } from "../moves";
import { childOpArrays } from "./effectOpChildren";

/** The move list of `playerId` in `state`, handed in by `enumerateMoves`'
 *  caller: this module cannot import the enumerator it is called from. */
export type MoveEnumerator = (state: GameState, playerId: string) => Move[];

/** Ops that cannot be the other half of a lethal sum: none deals damage,
 *  changes power or toughness, grants an ability, or puts a permanent onto the
 *  battlefield. An allowlist, so an Op added tomorrow blocks the prune until
 *  someone reads it. Drawing and adding mana are here on purpose: neither is
 *  denied by this proof, so the bot can do it first and the damage is judged
 *  again in the position it leaves. */
const DAMAGE_INERT_OPS: ReadonlySet<EffectOp["op"]> = new Set<EffectOp["op"]>([
    "gainLife",
    "loseLife",
    "draw",
    "discard",
    "discardAtRandom",
    "mill",
    "scryReorder",
    "reveal",
    "counter",
    "addMana",
    "preventDamage",
    "regenerate",
]);

/** The constructs an inert script may nest its Ops in. Every other script
 *  host (a delayed or reflexive trigger, a pile split) is read as not inert. */
const INERT_SCRIPT_HOSTS: ReadonlySet<EffectOp["op"]> = new Set<EffectOp["op"]>(
    ["if", "forEach", "optionChoice", "coinFlip"]
);

/** Ops by which a TRIGGERED ability can finish a damaged creature, or raise
 *  what combat deals to it: damage and its redirection, every change to power,
 *  toughness or abilities, a permanent arriving or changing sides, another
 *  combat phase.
 *  A denylist, unlike the announcement reading: a trigger is not something the
 *  bot waits on, so only the ones that reach the sum matter. */
const DAMAGE_OR_SIZE_OPS: ReadonlySet<EffectOp["op"]> = new Set<EffectOp["op"]>(
    [
        "dealDamage",
        "dealDamageDividedAsChosen",
        "dealDamageToEach",
        "fight",
        "pump",
        "counters",
        "distributeCountersAsChosen",
        "setBasePT",
        "animate",
        "becomeCopy",
        "transform",
        "exileAndReturnTransformed",
        "grantAbility",
        "loseAbility",
        "loseAllAbilities",
        "loseAllAbilitiesWhileSourceRemains",
        "setCardTypes",
        "addCardType",
        "setLevel",
        "monstrosity",
        "explore",
        "meld",
        "attach",
        "createToken",
        "createTokenCopy",
        "moveZone",
        "gainControl",
        "extraCombat",
        "redirectDamage",
    ]
);

/** `CardDefinition` keys an inert spell may set: identity, presentation, its
 *  cost, its script and target slots, and the AI-only hints. Any other key (a
 *  keyword, a static or replacement effect, an ability, another face, an
 *  alternative or additional cost) is a clause this reading does not see. */
const INERT_SPELL_KEYS: ReadonlySet<string> = new Set([
    "id",
    "name",
    "rarity",
    "oracleText",
    "setCode",
    "imagePrintId",
    "imagePrintFace",
    "types",
    "subtypes",
    "supertypes",
    "manaCost",
    "effects",
    "aiEffects",
    "modes",
    "modeSelection",
    "targetRequirement",
    "additionalTargetRequirements",
    "aiValue",
    "aiCombatHint",
]);

/** One script-bearing site: a spell, a mode, an activated or triggered
 *  ability. */
type ScriptSite = {
    effects?: EffectOp[];
    modes?: readonly ScriptSite[];
    resolve?: unknown;
    resolveSteps?: unknown;
    effect?: unknown;
};

/** The real scripts of `site`, or `null` when part of it is an imperative body.
 *  An `aiEffects` shadow is an approximation of such a body and proves
 *  nothing here. */
function scriptsOf(site: ScriptSite): EffectOp[][] | null {
    if (
        site.resolve !== undefined ||
        site.resolveSteps !== undefined ||
        site.effect !== undefined
    ) {
        return null;
    }
    if (site.effects) return [site.effects];
    const scripts: EffectOp[][] = [];
    const modeList = site.modes ?? [];
    for (let i = 0; i < modeList.length; i++) {
        const mode = modeList[i];
        const modeScripts = scriptsOf(mode);
        if (modeScripts === null) return null;
        scripts.push(...modeScripts);
    }
    return scripts;
}

/** Whether every Op of `script`, at any depth, satisfies `leaf`. An Op that
 *  carries nested scripts may satisfy `host` instead, and its scripts are
 *  walked either way. */
function everyOp(
    script: readonly EffectOp[],
    leaf: (op: EffectOp) => boolean,
    host: (op: EffectOp) => boolean
): boolean {
    for (let i = 0; i < script.length; i++) {
        const op = script[i];
        const children = childOpArrays(op);
        const admitted = leaf(op) || (children.length > 0 && host(op));
        if (!admitted) return false;
        if (!children.every((child) => everyOp(child, leaf, host))) {
            return false;
        }
    }
    return true;
}

/** Whether `site` has a readable script made of inert Ops only. */
function isInertSite(site: ScriptSite): boolean {
    const scripts = scriptsOf(site);
    return (
        scripts !== null &&
        scripts.every((script) =>
            everyOp(
                script,
                (op) => DAMAGE_INERT_OPS.has(op.op),
                (op) => INERT_SCRIPT_HOSTS.has(op.op)
            )
        )
    );
}

/** Whether casting `def` can only do inert things: an instant or sorcery
 *  whose whole definition is an inert script. */
function isInertSpell(def: CardDefinition): boolean {
    const entryList = Object.entries(def);
    for (let i = 0; i < entryList.length; i++) {
        const [key, value] = entryList[i];
        if (value === undefined || INERT_SPELL_KEYS.has(key)) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        return false;
    }
    if (!def.types.every((t) => t === "Instant" || t === "Sorcery")) {
        return false;
    }
    return isInertSite(def as ScriptSite);
}

/** Whether `move`, one the mover could still announce, is inert. Only the
 *  three shapes this module can read are ever inert; a land drop is not, since
 *  the mana it adds can pay for a card that was out of reach. */
function isInertAnnouncement(state: GameState, move: Move): boolean {
    switch (move.kind) {
        // A combat declaration is `combatCannotFinish`'s business, and a mana
        // ability only pays for the announcements already on the list.
        case "pass":
        case "declare-attackers":
        case "declare-blockers":
        case "activate-mana-ability":
            return true;
        case "cast-spell": {
            if (move.alternativeCostId !== undefined) return false;
            const card = findCardInAnyZone(state, move.cardInstanceId);
            const cardId = (card?.card as { id?: string } | undefined)?.id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            return def != null && isInertSpell(def);
        }
        case "activate-ability": {
            const card = findCardInAnyZone(state, move.cardInstanceId);
            if (!card) return false;
            const ability = getEffectiveActivatedAbilities(card).find(
                ({ ability }) => ability.id === move.abilityId
            )?.ability;
            return ability !== undefined && isInertSite(ability as ScriptSite);
        }
        default:
            return false;
    }
}

/** `state` as the mover's next sorcery window (CR 307.1): its own main phase,
 *  the stack empty, priority its own. `null` when no such window is left this
 *  turn, or when `state` already is one. Read by the enumerator only. */
function laterSorceryWindow(
    state: GameState,
    moverId: string
): GameState | null {
    if (state.activePlayerId !== moverId) return null;
    if (state.phase === "END_STEP" || state.phase === "CLEANUP") return null;
    const inMain =
        state.phase === "PRECOMBAT_MAIN" || state.phase === "POSTCOMBAT_MAIN";
    if (
        inMain &&
        state.stack.length === 0 &&
        state.priorityPlayerId === moverId
    ) {
        return null;
    }
    const window = cloneGameState(state);
    if (!inMain) {
        window.phase = "POSTCOMBAT_MAIN";
        window.combat = undefined;
    }
    window.stack = [];
    window.priorityPlayerId = moverId;
    window.passCount = 0;
    return window;
}

/** Condition 2 — nothing else the mover can still announce this turn is a
 *  possible half of a lethal sum. Read off the engine's own move list in the
 *  settled position, so mana already spent counts on its own: with one land,
 *  a second burn spell is simply not on the list. */
function otherAnnouncementsAreInert(
    settled: GameState,
    moverId: string,
    enumerate: MoveEnumerator
): boolean {
    const windows = [settled];
    const later = laterSorceryWindow(settled, moverId);
    if (later) windows.push(later);
    return windows.every((window) => {
        const moves = enumerate(window, moverId);
        // The enumerator answers with nothing when the mover does not hold
        // priority (a trigger that landed during the probe hands it to the
        // active player): an empty list is no reading, not an inert one.
        return (
            moves.some((move) => move.kind === "pass") &&
            moves.every((move) => isInertAnnouncement(window, move))
        );
    });
}

/** Whether the combat phase can still deal damage this turn: the turn has not
 *  passed its last combat-damage step (CR 510), or another combat phase is
 *  owed (CR 500.8). */
function combatDamageStillOwed(state: GameState): boolean {
    if ((state.extraPhases?.length ?? 0) > 0) return true;
    return (
        state.phase !== "END_OF_COMBAT" &&
        state.phase !== "POSTCOMBAT_MAIN" &&
        state.phase !== "END_STEP" &&
        state.phase !== "CLEANUP"
    );
}

/** Condition 3 — each damaged creature has more toughness left than combat can
 *  still deal to it. The bound is every creature on the other side at its
 *  effective power, twice with double strike (CR 702.4b); any deathtouch
 *  there makes one point lethal (CR 702.2b), so nothing is proved. */
function combatCannotFinish(
    settled: GameState,
    damagedIds: readonly string[]
): boolean {
    const owed = combatDamageStillOwed(settled);
    for (let i = 0; i < damagedIds.length; i++) {
        const id = damagedIds[i];
        const controller = settled.players.find((p) =>
            p.battlefield.some((c) => c.id === id)
        );
        const damaged = controller?.battlefield.find((c) => c.id === id);
        if (!controller || !damaged) return false;
        const left =
            getEffectivePT(settled, damaged).toughness -
            (damaged.damageMarked ?? 0);
        let bound = 0;
        if (owed) {
            const playerList = settled.players;
            for (let j = 0; j < playerList.length; j++) {
                const player = playerList[j];
                if (player.id === controller.id) continue;
                const otherList = player.battlefield;
                for (let k = 0; k < otherList.length; k++) {
                    const other = otherList[k];
                    if (!isCreature(other)) continue;
                    if (other.staticAbilities.includes("deathtouch")) {
                        return false;
                    }
                    const power = Math.max(
                        0,
                        getEffectivePT(settled, other).power
                    );
                    bound += other.staticAbilities.includes("double strike")
                        ? power * 2
                        : power;
                }
            }
        }
        if (left <= bound) return false;
    }
    return true;
}

/** Whether `perm` carries a triggered ability that could finish a damaged
 *  creature or raise the combat bound: one whose script has a damage or size
 *  Op at any depth, or no script to read. */
function carriesDamageTrigger(perm: CardInstanceState): boolean {
    // The list the engine's own trigger scan reads: printed, granted and
    // keyword triggers alike.
    const triggerList = effectiveTriggeredAbilities(perm);
    for (let i = 0; i < triggerList.length; i++) {
        const trigger = triggerList[i];
        const scripts = scriptsOf(trigger as ScriptSite);
        if (scripts === null) return true;
        const harmless = scripts.every((script) =>
            everyOp(
                script,
                (op) => !DAMAGE_OR_SIZE_OPS.has(op.op),
                () => true
            )
        );
        if (!harmless) return true;
    }
    return false;
}

/** Condition 4 — no permanent, on either side, adds damage the bot does not
 *  announce: a triggered ability that deals damage or changes a size, or a
 *  replacement effect that rewrites damage (CR 614 — a doubler makes the
 *  combat bound wrong).
 *
 *  Narrowings, each unread rather than proved absent: a trigger that functions
 *  from a graveyard or an emblem, and toughness that expires when combat ends
 *  rather than at cleanup. */
function boardCannotAddDamage(settled: GameState): boolean {
    // A delayed trigger already scheduled (CR 603.7) is not read: none proves
    // nothing.
    if ((settled.delayedTriggers?.length ?? 0) > 0) return false;
    const playerList = settled.players;
    for (let i = 0; i < playerList.length; i++) {
        const player = playerList[i];
        const permList = player.battlefield;
        for (let j = 0; j < permList.length; j++) {
            const perm = permList[j];
            if (carriesDamageTrigger(perm)) return false;
            const replacements =
                liveStaticDefinition(perm)?.replacementEffects ?? [];
            if (replacements.some((r) => r.eventKind === "damage")) {
                return false;
            }
        }
    }
    return true;
}

/** Whether the damage marked on `damagedIds` in `settled` — the position
 *  right after the move resolved, state-based actions run — cannot become
 *  lethal before cleanup removes it. `damagedIds` are creatures still on the
 *  battlefield whose marked damage is the move's only lasting difference;
 *  `dominance.ts` establishes that before calling. */
export function markedDamageCannotBecomeLethal(
    settled: GameState,
    moverId: string,
    damagedIds: readonly string[],
    enumerate: MoveEnumerator
): boolean {
    return (
        combatCannotFinish(settled, damagedIds) &&
        boardCannotAddDamage(settled) &&
        otherAnnouncementsAreInert(settled, moverId, enumerate)
    );
}
