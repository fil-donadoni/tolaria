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
 * Fail-closed throughout: a printed return, a card mixing it with an "until"
 * exile, and either half inside a GRANTED ability (whose `$source` is the
 * grantee, not this card) all refuse the card.
 */

import type { EffectOp } from "../cards/types";

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

export type ExileLink =
    | { readonly ok: false; readonly reason: string }
    /** `untilLeaves` — the card owes the CR 610.3 return trigger. */
    | { readonly ok: true; readonly untilLeaves: boolean };

/** Whether the card owes the CR 610.3 return, or why it cannot compile. */
export function linkExileAndReturn(
    printed: readonly (readonly EffectOp[])[],
    granted: readonly (readonly EffectOp[])[]
): ExileLink {
    const grantedOps: Record<string, unknown>[] = [];
    for (const script of granted) collectOps(script, grantedOps);
    if (grantedOps.some((op) => BUNDLE_OPS.has(op.op as string)))
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
    return {
        ok: true,
        untilLeaves: ops.some((op) => op.op === "exileWithAttachments"),
    };
}
