// Which half of an effect each announced target of ONE target group receives
// (CR 601.2c) — the per-Target analogue of ADR 0094's per-mode-instance
// provenance (issue #2264), one level down.
//
// CR 601.2c lets a single instance of the word "target" announce several
// objects, and an Effect Script reads them POSITIONALLY: `{ target: 0 }`,
// `{ target: 1 }`. Nothing about the announcement says which position a click
// fills, so when the two positions receive DIFFERENT halves of the effect the
// caster is picking blind — Jilt ("Return target creature to its owner's
// hand. If this spell was kicked, it deals 2 damage to another target
// creature.") returns whichever creature was clicked FIRST and burns the
// other. That was invisible while every card on this encoding was symmetric
// (Magma Burst, Falling Timber, Rushing River, Dwarven Landslide — both
// halves identical, so index order changed nothing); issue #4193 is the first
// asymmetric one.
//
// This module answers two questions about a group, from the script alone, so
// the prompt, the resolution and the Bot all read ONE derivation:
//
//   - {@link announcedTargetSlotsDiffer} — do the group's slots receive
//     different halves at all? (the Bot reads it to enumerate the ORDERED
//     arrangements of a group whose order matters, and the catalogue guard
//     reads it to demand a label whenever the answer is yes)
//   - {@link announcedTargetRoles} — the per-slot phrase the prompt prints.
//
// FAIL-CLOSED is the whole design. Every question is answered from a CLOSED
// table of (Op, selector key) pairs; anything outside it — an unlisted Op, an
// unlisted destination, or a slot read from somewhere that is not an Op's own
// direct selector — makes BOTH answers "cannot tell", which is today's
// behaviour (one label for the group, no per-Target text). The alternative,
// guessing, would print a label resolution then contradicts, which is strictly
// worse than the bug this module exists to fix.
//
// The "direct selector" rule is what keeps Barrin's Spite out ("Choose two
// target creatures controlled by the same player. Their controller chooses
// and sacrifices one of them. Return the other to its owner's hand."): its
// slots are read through a `choice` Op's `candidates` list and a
// `controllerOf`, never as an Op's own recipient, and they are genuinely
// interchangeable — the controller picks afterwards. A mechanism that labelled
// them would be inventing a distinction the card does not print.

import type { CardDefinition, EffectOp, SpellMode } from "../cards/types";

/** The script whose slot reads decide this announcement's roles: the chosen
 *  MODE's body when there is one — CR 700.2a, the mode is chosen as part of
 *  casting, so by announcement time the script is already decided — otherwise
 *  the cast SUBJECT's.
 *
 *  `subjectDef` is the cast SUBJECT, never the printed card (CR 715.3a, ADR
 *  0120 §4): an Adventure half and a split half are their own
 *  `CardDefinition`s with their own `targetRequirement` AND their own
 *  `effects`, and the announcement already derives its requirement from the
 *  subject. Reading the printed card here would pair one half's requirement
 *  with the other's script — today only ever fail-closed, because no printed
 *  adventurer or split card in the catalogue carries `effects`, which is the
 *  kind of accident that stops being true without anything going red.
 *
 *  ONE helper because the server and the Bot's enumerator both need the
 *  answer, and two spellings of one rule is how they drift. */
export function announcedRoleScript(
    subjectDef: CardDefinition | undefined,
    chosenMode: SpellMode | undefined
): EffectOp[] | undefined {
    return chosenMode ? chosenMode.effects : subjectDef?.effects;
}

/** One announced slot read as an Op's own direct selector. */
interface SlotReference {
    /** `${op}.${key}` — the pair the phrase table is keyed by. */
    readonly site: string;
    /** The Op node, with every announced-slot index normalized away, so two
     *  slots that receive the SAME half compare equal (CR 601.2c — Magma
     *  Burst's two `dealDamage` Ops differ only in which slot they name). */
    readonly shape: string;
    /** The phrase the prompt prints, or undefined when this site has none. */
    readonly phrase: string | undefined;
}

/** CR 400.1 — how each zone a `moveZone` can name reads to the player being
 *  asked (the seven zones of that rule, less the ones no announced target is
 *  ever sent to). A destination absent from this table is unlabelled, so the
 *  whole derivation fails closed rather than printing a zone name raw. */
const MOVE_ZONE_PHRASE: Record<string, string> = {
    hand: "returned to its owner's hand",
    graveyard: "put into its owner's graveyard",
    exile: "exiled",
    library: "put into its owner's library",
    battlefield: "put onto the battlefield",
};

/** The CLOSED table: `${op}.${key}` -> the phrase for the target sitting in
 *  that selector. Keyed by the PAIR because one Op names different roles
 *  through different keys (`preventDamage.source` is the damage's SOURCE, not
 *  its recipient). An (Op, key) pair absent here fails the derivation closed —
 *  see the catalogue guard, which turns "absent" into a red rather than the
 *  silent regression it would otherwise be the day a card needs it. */
const ROLE_PHRASE: Record<
    string,
    (op: Record<string, unknown>) => string | undefined
> = {
    "dealDamage.to": (op) =>
        typeof op.amount === "number"
            ? `dealt ${op.amount} damage`
            : "dealt damage",
    "destroy.target": () => "destroyed",
    "exile.target": () => "exiled",
    "moveZone.target": (op) =>
        typeof op.to === "string" ? MOVE_ZONE_PHRASE[op.to] : undefined,
    // CR 615.1 — the target here is the damage's SOURCE, not its recipient
    // (Falling Timber prevents the damage the creature WOULD DEAL).
    "preventDamage.source": (op) =>
        op.combatOnly === true
            ? "prevented from dealing combat damage"
            : "prevented from dealing damage",
};

/** An announced-slot selector is the object shape `{ target: <int> }` sitting
 *  DIRECTLY under one of an Op's own keys. An array of them (a `choice`'s
 *  `candidates`) is not one, and neither is one nested inside another
 *  selector (`{ controllerOf: { target: 0 } }`) — both fall through to the
 *  generic walk, which aborts. */
function directSlot(value: unknown): number | undefined {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const slot = (value as Record<string, unknown>).target;
    return typeof slot === "number" && Number.isInteger(slot) && slot >= 0
        ? slot
        : undefined;
}

/** Replace every announced-slot index in a subtree with a constant, so two
 *  Ops that do the same thing to different slots compare equal. */
function normalizeSlots(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(normalizeSlots);
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        out[key] =
            key === "target" && typeof v === "number" ? "#" : normalizeSlots(v);
    }
    return out;
}

/** Every direct-selector read of an announced slot in a script, indexed by
 *  slot. `undefined` — the fail-closed answer — the moment the script reads a
 *  slot anywhere that is not an Op's own direct selector. */
function collectSlotReferences(
    effects: readonly EffectOp[] | undefined
): Map<number, SlotReference[]> | undefined {
    if (!effects) return undefined;
    const bySlot = new Map<number, SlotReference[]>();

    const walk = (value: unknown): boolean => {
        if (value === null || typeof value !== "object") return true;
        if (Array.isArray(value)) return value.every(walk);
        const obj = value as Record<string, unknown>;
        if (typeof obj.op !== "string") {
            // A bare `{ target: n }` reached outside an Op's selector position
            // — a `choice`'s candidate list, a `controllerOf`, a predicate.
            // Nothing here can say what that slot receives.
            if (typeof obj.target === "number") return false;
            return Object.values(obj).every(walk);
        }
        for (const [key, v] of Object.entries(obj)) {
            if (key === "op") continue;
            const slot = directSlot(v);
            if (slot === undefined) {
                if (!walk(v)) return false;
                continue;
            }
            const site: string = `${obj.op as string}.${key}`;
            const list = bySlot.get(slot) ?? [];
            list.push({
                site,
                shape: JSON.stringify([site, normalizeSlots(obj)]),
                phrase: ROLE_PHRASE[site]?.(obj),
            });
            bySlot.set(slot, list);
        }
        return true;
    };

    return walk(effects) ? bySlot : undefined;
}

/** The slots of the group that starts at `firstSlot` and announces `count`
 *  targets, as the references each one is read through — `undefined` when the
 *  window is not a fixed group of at least two slots, when the script reads a
 *  slot outside a direct selector, or when a slot in the window is never read
 *  (a slot nothing does anything with has no half to name). */
function slotWindow(
    effects: readonly EffectOp[] | undefined,
    firstSlot: number,
    count: number
): SlotReference[][] | undefined {
    if (!Number.isInteger(firstSlot) || firstSlot < 0) return undefined;
    if (!Number.isInteger(count) || count < 2) return undefined;
    const bySlot = collectSlotReferences(effects);
    if (!bySlot) return undefined;
    const window: SlotReference[][] = [];
    for (let slot = firstSlot; slot < firstSlot + count; slot++) {
        const refs = bySlot.get(slot);
        if (!refs || refs.length === 0) return undefined;
        window.push(refs);
    }
    return window;
}

/** The per-slot signature {@link announcedTargetSlotsDiffer} compares. */
function slotSignature(refs: readonly SlotReference[]): string {
    return refs
        .map((r) => r.shape)
        .sort()
        .join("||");
}

/** CR 601.2c — do this group's announced slots receive DIFFERENT halves of the
 *  effect, so that which target is picked first changes what the spell does?
 *
 *  Purely structural: it compares the Ops that read each slot with the slot
 *  indices normalized away, and knows nothing about the phrase table. That
 *  separation is what lets the catalogue guard be fail-CLOSED — a card whose
 *  slots differ but whose Ops carry no phrase reds there instead of silently
 *  shipping the pick-order bug.
 *
 *  `false` whenever the derivation cannot tell, which is also the answer that
 *  keeps the Bot's enumeration at combinations (the cheaper shape). */
export function announcedTargetSlotsDiffer(
    effects: readonly EffectOp[] | undefined,
    firstSlot: number,
    count: number
): boolean {
    const window = slotWindow(effects, firstSlot, count);
    if (!window) return false;
    const first = slotSignature(window[0]);
    return window.some((refs) => slotSignature(refs) !== first);
}

/** CR 601.2c — one phrase per announced target of this group, saying which
 *  half of the effect that target will receive ("returned to its owner's
 *  hand", "dealt 2 damage").
 *
 *  `undefined` — print nothing per-Target, exactly as before issue #4193 —
 *  when the slots are indistinguishable ({@link announcedTargetSlotsDiffer} is
 *  false: a symmetric card's prompt must not grow noise) or when any slot in
 *  the window is read through an Op the phrase table does not carry. */
export function announcedTargetRoles(
    effects: readonly EffectOp[] | undefined,
    firstSlot: number,
    count: number
): string[] | undefined {
    if (!announcedTargetSlotsDiffer(effects, firstSlot, count)) {
        return undefined;
    }
    const window = slotWindow(effects, firstSlot, count);
    if (!window) return undefined;
    const roles: string[] = [];
    for (const refs of window) {
        const phrases: string[] = [];
        for (const ref of refs) {
            if (ref.phrase === undefined) return undefined;
            if (!phrases.includes(ref.phrase)) phrases.push(ref.phrase);
        }
        // Two DIFFERENT phrases on one slot are not "both happen": an `if`
        // with an `else` reads the same slot in two branches of which exactly
        // one runs, so joining them would print a statement resolution
        // contradicts. That is the one thing this module must never do.
        if (phrases.length !== 1) return undefined;
        roles.push(phrases[0]);
    }
    // Two slots the phrase table cannot tell apart, though their Ops differ,
    // would print the same line twice — noise that answers nothing.
    return new Set(roles).size > 1 ? roles : undefined;
}
