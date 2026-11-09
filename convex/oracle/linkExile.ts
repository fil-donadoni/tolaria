/**
 * Lowering, card pass: CR 610.3 "until" exiles (ADR 0028), and the refusal of
 * their CR 607.2a look-alike.
 *
 * The engine spells an exile-and-return as a `$source`-keyed bundle:
 * `exileWithAttachments` arms it, `returnExiledForSource` on the source's own
 * departure trigger restores it. "Exile target creature until this enchantment
 * leaves the battlefield" is ONE sentence whose return is a second one-shot
 * effect (CR 610.3) the card never prints as an ability, so no line can emit
 * that trigger: the sentence lowers to the arming half, and this pass tells
 * the card to add the return.
 *
 * The PRINTED pair is a different rule, and is refused. "When this enchantment
 * enters, exile target creature." + "When this enchantment leaves the
 * battlefield, return the exiled card …" are two abilities linked by CR 607.2a,
 * with NO duration: if the source leaves while the exile trigger is still on
 * the stack, the return finds nothing and the exile then resolves for good.
 * `exileWithAttachments` always applies CR 610.3a/b's guard (the interpreter
 * passes `requireSourceOnBattlefield`), so it would exile nothing there — the
 * Op has no non-duration form, and lowering the pair onto it is a misread.
 *
 * The hand return ("return the exiled card to its owner's hand") lowers to
 * `moveZone` over `exiledWithSource`, the selector that reads the stamp
 * `linkToSource` writes; `linkExileAndReturn` sets it on the card's exile
 * instruction(s) in place. The pile return ("each player returns to the
 * battlefield all cards they own exiled with it", Parallax Wave) is a
 * `forEach` over the same stamp; its exile instruction is the battlefield
 * `exile` Op — with no CR 610.3 guard, so a source that already left still
 * exiles, and nothing ever returns that card (CR 607.2a).
 *
 * A KEYWORD can be the exile half: "Hideaway N" (CR 702.75a) is a printed
 * triggered ability whose exile instruction the engine expands from the
 * keyword string, and its Op stamps the link itself. The hand return beside it
 * (Watcher for Tomorrow) then names that one exile — and only when the card
 * prints no other exile instruction for it to name.
 *
 * A linked ability can also READ the exiled card instead of moving it
 * ("the exiled card's owner creates an X/X … token, where X is the mana value
 * of the exiled card", Skyclave Apparition): the card is a new object in
 * exile (CR 400.7) that only the linked ability can still name (CR 607.2a), so
 * the engine reads it through the snapshot the exile took.
 * `captureLinkedExile` binds the ONE battlefield `exile` instruction and hands
 * that row to the source (`captureBinding`) for the reader's
 * `recallCapturedBinding` to restore. DEVIATION: CR 608.2h reads an object
 * still in the public zone it was expected to be in by its CURRENT
 * information, i.e. the card as it is in exile; the snapshot is the permanent
 * as it left the battlefield. The two differ only when that permanent's mana
 * value or owner came from an effect that ends on the zone change (a copy
 * effect, a face-down permanent) — the same reading the hand-written
 * catalogue writes for this card.
 *
 * Fail-closed throughout: a printed return, a card mixing it with an "until"
 * exile, and either half inside a GRANTED ability (whose `$source` is the
 * grantee, not this card) all refuse the card.
 */

import type { EffectOp, TargetRequirement } from "../cards/types";
import { LINKED_EXILE_BINDING } from "./lowerEffects";

/** Every Op object anywhere under `value`, nested scripts included. */
function collectOps(value: unknown, into: Record<string, unknown>[]): void {
    if (Array.isArray(value)) {
        for (const item of value) collectOps(item, into);
        return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.op === "string") into.push(record);
    for (const child of Object.values(record)) collectOps(child, into);
}

const BUNDLE_OPS: ReadonlySet<string> = new Set([
    "exileWithAttachments",
    "returnExiledForSource",
]);

/** A printed CR 607.2a return: `moveZone` of the source's linked exile. */
function isLinkedReturn(op: Record<string, unknown>): boolean {
    const target = op.target as Record<string, unknown> | undefined;
    return op.op === "moveZone" && target?.exiledWithSource === true;
}

/** A printed CR 607.2a pile return: a `forEach` over the linked exile. */
function isLinkedPileReturn(op: Record<string, unknown>): boolean {
    const select = op.select as Record<string, unknown> | undefined;
    return op.op === "forEach" && select?.set === "exiledWithSource";
}

/** The exile instruction a linked return reads back: a `moveZone` to exile. */
function isExileMove(op: Record<string, unknown>): boolean {
    return op.op === "moveZone" && op.to === "exile";
}

/**
 * CR 702.75a — the keyword strings whose expanded trigger is an exile
 * instruction linked to this object (the `hideaway` Op stamps the link).
 */
const LINKED_EXILE_KEYWORD = /^hideaway \d+$/;

export type ExileLink =
    | { readonly ok: false; readonly reason: string }
    /** `untilLeaves` — the card owes the CR 610.3 return trigger. */
    | { readonly ok: true; readonly untilLeaves: boolean };

/**
 * Whether the card owes the CR 610.3 return, or why it cannot compile. A
 * printed hand return stamps `linkToSource` on its exile instruction IN PLACE
 * (the ops are the definition's own).
 */
export function linkExileAndReturn(
    printed: readonly (readonly EffectOp[])[],
    granted: readonly (readonly EffectOp[])[],
    keywords: readonly string[]
): ExileLink {
    const keywordExiles = keywords.filter((k) =>
        LINKED_EXILE_KEYWORD.test(k)
    ).length;
    const grantedOps: Record<string, unknown>[] = [];
    for (const script of granted) collectOps(script, grantedOps);
    if (
        grantedOps.some(
            (op) =>
                BUNDLE_OPS.has(op.op as string) ||
                isLinkedReturn(op) ||
                isLinkedPileReturn(op)
        )
    )
        return {
            ok: false,
            reason: "a granted ability's exile-and-return keys to the grantee, not this card (CR 607.2a)",
        };
    const ops: Record<string, unknown>[] = [];
    for (const script of printed) collectOps(script, ops);
    if (ops.some((op) => op.op === "returnExiledForSource"))
        return {
            ok: false,
            reason: '"the exiled card" is a CR 607.2a linked exile with no duration, which no Op encodes (the bundle Op applies CR 610.3b)',
        };
    // CR 607.2a — the printed pair "exile …" / "return the exiled card to its
    // owner's hand": the two abilities are linked, so the exile instruction
    // stamps its card (`linkToSource`) for the return to name. The stamp is
    // written here because no line can see the other. Exactly ONE exile
    // instruction, a plain `moveZone`, is linkable: with two, or an `exile`
    // Op beside it, which one the return names is unread — refused.
    //
    // CR 607.2a + CR 702.75a — a hideaway keyword IS that one exile
    // instruction, already linked by its own Op: nothing to stamp, and any
    // printed exile beside it leaves which card the return names unread.
    if (ops.some(isLinkedReturn) && keywordExiles > 0) {
        if (
            keywordExiles !== 1 ||
            ops.some(isExileMove) ||
            ops.some((op) => /exile/i.test(op.op as string))
        )
            return {
                ok: false,
                reason: '"the exiled card" names no single exile instruction this card prints (CR 607.2a)',
            };
    } else if (ops.some(isLinkedReturn)) {
        const exiles = ops.filter(isExileMove);
        if (exiles.length !== 1 || ops.some((op) => op.op === "exile"))
            return {
                ok: false,
                reason: '"the exiled card" names no single exile instruction this card prints (CR 607.2a)',
            };
        exiles[0].linkToSource = true;
    }
    // CR 607.2a — the pile return names what the card's ONE battlefield
    // `exile` instruction exiled. A second exile instruction, a hand/graveyard
    // `moveZone` exile, any other exile-family Op (an "until" bundle, a
    // library or self exile), or the singular return beside it leaves which
    // pile it names unread — refused.
    if (ops.some(isLinkedPileReturn)) {
        const exiles = ops.filter((op) => op.op === "exile");
        if (
            keywordExiles > 0 ||
            exiles.length !== 1 ||
            ops.some(isExileMove) ||
            ops.some(isLinkedReturn) ||
            ops.some(
                (op) => op.op !== "exile" && /exile/i.test(op.op as string)
            )
        )
            return {
                ok: false,
                reason: '"cards exiled with it" names no single exile instruction this card prints (CR 607.2a)',
            };
        exiles[0].linkToSource = true;
    }
    return {
        ok: true,
        untilLeaves: ops.some((op) => op.op === "exileWithAttachments"),
    };
}

/** A printed ability's script with the target slots its Ops point at. */
export interface LinkableAbility {
    readonly effects: readonly EffectOp[];
    readonly targetRequirement?: TargetRequirement;
}

/** CR 601.2c — the requirement announces at most one object for its target. */
function singleTarget(requirement: TargetRequirement | undefined): boolean {
    if (requirement === undefined) return false;
    const { count } = requirement;
    if (count === 1) return true;
    return typeof count === "object" && count.max === 1;
}

/**
 * CR 607.2a + CR 608.2h — the snapshot channel between the card's exile
 * instruction and the ability reading "the exiled card" back. A no-op on a
 * card no ability of which recalls the linked exile. Otherwise the card must
 * print exactly ONE exile instruction — a top-level battlefield `exile` of one
 * announced target, unbound — and nothing else that exiles, links or recalls:
 * which card a second one names is unread, and a granted ability's source is
 * the grantee. That `exile` is bound and followed by `captureBinding` IN
 * PLACE (the scripts are the definition's own).
 */
export function captureLinkedExile(
    printed: readonly LinkableAbility[],
    granted: readonly (readonly EffectOp[])[],
    keywords: readonly string[]
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    const isChannel = (op: Record<string, unknown>) =>
        op.op === "recallCapturedBinding" || op.op === "captureBinding";
    const grantedOps: Record<string, unknown>[] = [];
    for (const script of granted) collectOps(script, grantedOps);
    const ops: Record<string, unknown>[] = [];
    for (const ability of printed) collectOps(ability.effects, ops);
    const recalls = ops.filter((op) => op.op === "recallCapturedBinding");
    if (recalls.length === 0 && !grantedOps.some(isChannel))
        return { ok: true };
    const refused = {
        ok: false as const,
        reason: '"the exiled card" names no single exile instruction this card prints (CR 607.2a)',
    };
    if (grantedOps.some(isChannel) || recalls.length !== 1) return refused;
    if (keywords.some((k) => LINKED_EXILE_KEYWORD.test(k))) return refused;
    if (ops.some((op) => op.op === "captureBinding")) return refused;
    const exiles = ops.filter((op) => /exile/i.test(op.op as string));
    if (
        exiles.length !== 1 ||
        exiles[0]!.op !== "exile" ||
        ops.some(isExileMove) ||
        ops.some(isLinkedReturn) ||
        ops.some(isLinkedPileReturn)
    )
        return refused;
    const exile = exiles[0]!;
    const owner = printed.find((ability) =>
        ability.effects.includes(exile as EffectOp)
    );
    const target = exile.target as Record<string, unknown> | undefined;
    if (
        owner === undefined ||
        owner.effects.some((op) => op.op === "recallCapturedBinding") ||
        exile.bind !== undefined ||
        target?.target !== 0 ||
        Object.keys(target).length !== 1 ||
        !singleTarget(owner.targetRequirement)
    )
        return refused;
    exile.bind = LINKED_EXILE_BINDING;
    const script = owner.effects as EffectOp[];
    script.splice(script.indexOf(exile as EffectOp) + 1, 0, {
        op: "captureBinding",
        ref: LINKED_EXILE_BINDING,
    });
    return { ok: true };
}
