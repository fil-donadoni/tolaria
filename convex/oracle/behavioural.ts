/**
 * The BEHAVIOURAL gold harness (issue #2703, PRD #2693 user stories 11/23/13).
 *
 * ── Why a second harness ───────────────────────────────────────────────────
 *
 * `gold.ts` proves the compiler by STRUCTURAL equality: compile a hand-written
 * card's own Oracle text and diff the two definitions. That is decisive for a
 * DSL card and impossible for a `resolve()` card — its body is a JavaScript
 * function, and no projection can diff a closure against an `EffectOp[]`. Those
 * cards land in `GoldReport.incomparable`: accepted by the compiler, unproven
 * by the comparison.
 *
 * Unproven is exactly where the `resolve()`→`effects[]` migration lives. The
 * migration classifier (`scripts/migration-classifier.mjs`) says a closure
 * COULD be expressed in Ops; it cannot say the compiler's Ops mean the same
 * thing the closure meant. The card's OWN tests can: they were written against
 * the hand-written behaviour, by a human, citing the CR. Serve the compiled
 * definition from the registry, run those tests unchanged, and a green run is
 * behavioural equality — evidence of the same kind structural equality gives a
 * DSL card, obtained the only way available here.
 *
 * ── The seam ───────────────────────────────────────────────────────────────
 *
 * The swap goes through `preloadDefinitions` (ADR 0046, the single registry
 * seam) — the same door `catalogue.ts` and `compiledCatalogue.ts` use. Nothing
 * in the engine, the projections or the Bot learns that the definition it read
 * was compiled, which is the whole point: a test that passed against a
 * hand-written definition and passes against the twin passed against the SAME
 * code paths.
 *
 * Per-card tests reference their card as `someCard.id` (a string) and drive
 * behaviour through `resolveTopOfStack` / `getLegalTargets` / the projections,
 * every one of which resolves the definition through `getDefinition`. So the
 * import in the test file keeps pointing at the hand-written module while the
 * BEHAVIOUR under assertion is the compiled twin's.
 *
 * ── Fail loud, never vacuous ───────────────────────────────────────────────
 *
 * The failure mode this module is written against is a run that proves nothing
 * while reporting green: the swap silently does not happen (unknown id, card
 * did not compile, registry write landed somewhere else) and the card's tests
 * pass against the hand-written definition they have always passed against.
 * That is a false RETIREMENT signal — it would delete a working closure on the
 * strength of a test that never saw the compiler's output. So every failure
 * here THROWS out of the setup file, which fails the whole vitest run, and the
 * caller is required to assert the registry actually serves the twin
 * afterwards (`assertSwapped`).
 */

import { getAllCards } from "../cards/catalogue";
import { getDefinition } from "../cards/registry";
import type { CardDefinition } from "../cards/types";
import { compiledTwin } from "./gold";

/** Env var read by `vitest.setup.node.ts`: a comma-separated list of card ids
 *  to serve compiled for the duration of the run. Named here so the setup file
 *  and `scripts/oracle-behavioural.ts` cannot disagree about the spelling. */
export const SWAP_ENV = "TOLARIA_ORACLE_SWAP";

/** Thrown for every reason a requested swap did not happen. A distinct class so
 *  the setup file's failure is unmistakably this harness and not a red suite. */
export class BehaviouralSwapError extends Error {
    constructor(message: string) {
        super(`[${SWAP_ENV}] ${message}`);
        this.name = "BehaviouralSwapError";
    }
}

/** Parse the env var's value. Empty/whitespace entries are dropped; an env var
 *  that is set but names nothing is an error, not an empty run — a typo in the
 *  driver must not read as "nothing to swap, all green". */
export function parseSwapIds(raw: string): string[] {
    const ids = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    if (ids.length === 0) {
        throw new BehaviouralSwapError(
            `is set but names no card id (value: ${JSON.stringify(raw)})`
        );
    }
    return ids;
}

/** One card's swap: what to register, and what `getDefinition` must then
 *  return. Two objects because the registry expands on READ (ADR 0054) — see
 *  `TwinResult`. */
export interface SwapTwin {
    readonly id: string;
    readonly name: string;
    /** Register this one. */
    readonly raw: CardDefinition;
    /** `getDefinition(id)` must return this one afterwards. */
    readonly expanded: CardDefinition;
}

/**
 * Compile each named card's twin, or throw naming the card and the reason.
 *
 * Pure: reads the catalogue, writes nothing. The caller owns the registry write
 * so the freezing discipline of `vitest.setup.node.ts` stays in one place.
 */
export function resolveSwapTwins(ids: readonly string[]): SwapTwin[] {
    const byId = new Map(getAllCards().map((c) => [c.id, c]));
    return ids.map((id) => {
        const handWritten = byId.get(id);
        if (handWritten === undefined) {
            throw new BehaviouralSwapError(
                `"${id}" is not a card in the hand-written catalogue`
            );
        }
        const twin = compiledTwin(handWritten);
        if (!twin.ok) {
            throw new BehaviouralSwapError(
                `"${id}" (${handWritten.name}) did not compile — ${twin.kind}: ${twin.detail}`
            );
        }
        return {
            id,
            name: handWritten.name,
            raw: twin.raw,
            expanded: twin.definition,
        };
    });
}

/**
 * The anti-vacuity assertion: after the caller's `preloadDefinitions`, the
 * registry must hand back the twin's expansion for every swapped id.
 *
 * Identity, not equality. A twin structurally identical to the hand-written
 * definition is the COMMON case here — most closure cards the compiler accepts
 * carry a closure that was already dead code — so a structural comparison would
 * pass whether the write landed or not, and a run that swapped nothing would
 * report the hand-written card's own green as the compiler's. Identity asks the
 * only question that matters: is the definition the engine will read the one
 * this harness compiled?
 */
export function assertSwapped(twins: readonly SwapTwin[]): void {
    for (const { id, name, expanded } of twins) {
        if (getDefinition(id) !== expanded) {
            throw new BehaviouralSwapError(
                `"${id}" (${name}) was compiled but the registry serves a different object — the swap did not take, and this run proves nothing`
            );
        }
    }
}
