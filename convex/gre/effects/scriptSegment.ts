// Effect Script SEGMENTS — the pure rewrites that let one script join another
// as a later segment of a single resolution: its announced-target reads moved
// past the earlier segment's slots, and its own binding names renamed so the
// persisted choice store (keyed by name) cannot hand it the earlier segment's
// answer. Two rules merge scripts this way: Splice (CR 702.47b/d,
// `gre/splice.ts`) and Fuse (CR 702.102d, `cards/fusedSplit.ts`).
//
// A leaf module — no registry, no engine state — so `convex/cards` can build a
// fused split spell at hydration without importing the engine.

import { isBindingDeclarationField } from "./bindingFields";
import { TARGET_BINDING_PREFIX } from "./targetRef";

/** True when every read of an announced target slot in `node` is an
 *  `{ target: i }` ref — the one shape a segment merge rebases.
 *  The reserved `$target<N>` string refs and the whole-set `forEach
 *  { set: "targets" }` selector would read the merged spell's slots as their
 *  own, so a segment using either is refused by the rule merging it rather
 *  than mis-read. */
export function targetReadsAreRebasable(node: unknown): boolean {
    if (typeof node === "string") {
        return !node.startsWith(TARGET_BINDING_PREFIX);
    }
    if (Array.isArray(node)) return node.every(targetReadsAreRebasable);
    if (!node || typeof node !== "object") return true;
    for (const [key, value] of Object.entries(node)) {
        if (key === "set" && value === "targets") return false;
        if (!targetReadsAreRebasable(value)) return false;
    }
    return true;
}

/** The binding names `node` declares, anywhere in its op tree. */
export function declaredBindingNames(node: unknown, out: Set<string>): void {
    if (Array.isArray(node)) {
        for (const child of node) declaredBindingNames(child, out);
        return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
        if (
            typeof value === "string" &&
            value.startsWith("$") &&
            isBindingDeclarationField(key)
        ) {
            out.add(value);
        }
        declaredBindingNames(value, out);
    }
}

/** `node` with every reference to a name in `rename` rewritten, structurally.
 *
 *  A binding is referred to as a plain STRING everywhere it appears — the
 *  declaration (`bind: "$x"`), the whole-object ref (`{ ref: "$x" }`) and the
 *  property ref (`{ ref: "$x.power" }`) — so one deep string rewrite covers
 *  every grammar position, present and future, without this module having to
 *  know the shape of any Op. Only the part before the first `.` is matched, and
 *  only names the segment itself declared: `$source`, `$host`, `$each` and
 *  `$event` are engine-provided, never declared, and so never rewritten.
 *  Object KEYS are left alone — a `delayedTrigger`'s `capture` keys name a
 *  payload local to that trigger instance, not a script binding. */
export function renameBindings<T>(
    node: T,
    rename: ReadonlyMap<string, string>
): T {
    if (Array.isArray(node)) {
        return node.map((child) =>
            renameBindings(child, rename)
        ) as unknown as T;
    }
    if (typeof node === "string") {
        if (!node.startsWith("$")) return node;
        const dot = node.indexOf(".");
        const base = dot === -1 ? node : node.slice(0, dot);
        const renamed = rename.get(base);
        if (renamed === undefined) return node;
        return (dot === -1
            ? renamed
            : renamed + node.slice(dot)) as unknown as T;
    }
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
        out[key] = renameBindings(value, rename);
    }
    return out as T;
}

/** `node` with every `{ target: i }` ref rewritten to `{ target: i + offset }`.
 *  The ref is matched by SHAPE — an object whose only key is `target`, holding
 *  a number — which is the whole `EffectTargetRef` grammar, wherever an Op
 *  nests it (`{ controllerOf: { target: 0 } }` included). */
export function rebaseTargetRefs<T>(node: T, offset: number): T {
    if (Array.isArray(node)) {
        return node.map((child) =>
            rebaseTargetRefs(child, offset)
        ) as unknown as T;
    }
    if (!node || typeof node !== "object") return node;
    const entries = Object.entries(node);
    if (
        entries.length === 1 &&
        entries[0][0] === "target" &&
        typeof entries[0][1] === "number"
    ) {
        return { target: (entries[0][1] as number) + offset } as T;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of entries) {
        out[key] = rebaseTargetRefs(value, offset);
    }
    return out as T;
}
