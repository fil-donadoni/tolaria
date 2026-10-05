// `defineCard` — a hand-written Card Definition as a memoised FACTORY (issue
// #4857, PRD #4849, ADR 0113 Amendment IV).
//
// A Set module that declares `export const fooBar = defineCard(() => ({ … }))`
// evaluates no object literal when it is imported: the definition is built the
// first time someone asks for it — the catalogue, resolving a Card ID through
// the Definition Index (`./catalogue` § `handWrittenDefinition`), or a test
// calling `fooBar()` — and every later request returns that SAME object for
// as long as the module instance lives: at least the whole of one Convex call
// (an isolate may keep it across calls, which a built, immutable definition
// does not mind). Identity is stable, so engine code and tests that compare
// definitions by identity keep working.
//
// An eagerly built definition (`export const fooBar: CardDefinition = { … }`)
// keeps working unchanged; `resolveCardExport` is the one place that tells the
// two shapes apart.
//
// No imports beyond types: a Set module imports this, and the catalogue reads
// it, without pulling anything else into either graph.
import type { CardDefinition } from "./types";

/** The brand a {@link CardFactory} carries. `Symbol.for`, so two evaluations
 *  of this module (a fresh test graph beside the worker's own) agree on it. */
const CARD_FACTORY = Symbol.for("tolaria.cardFactory");

/** A hand-written Card Definition built on first call and memoised: every call
 *  returns the same object. */
export interface CardFactory {
    (): CardDefinition;
    readonly [CARD_FACTORY]: true;
    /** How many times the definition has been BUILT — `0` before the first
     *  call, `1` after it, and never more. The observable a test reads to
     *  prove a card was built only when requested. */
    readonly builds: () => number;
}

/** Declare a hand-written Card Definition as a memoised factory. `build` runs
 *  at most once, on the first call. */
export function defineCard(build: () => CardDefinition): CardFactory {
    let built: CardDefinition | undefined;
    let builds = 0;
    const factory = (): CardDefinition => {
        if (built === undefined) {
            built = build();
            builds++;
        }
        return built;
    };
    return Object.assign(factory, {
        [CARD_FACTORY]: true as const,
        builds: () => builds,
    });
}

export function isCardFactory(value: unknown): value is CardFactory {
    return (
        typeof value === "function" &&
        (value as Partial<CardFactory>)[CARD_FACTORY] === true
    );
}

/** A Set module export as the definition it declares: a factory's built
 *  object, an eager definition as is, anything else (a helper, a shared
 *  ability template) as `undefined`. */
export function resolveCardExport(value: unknown): CardDefinition | undefined {
    const candidate = isCardFactory(value) ? value() : value;
    return isCardDefinitionObject(candidate) ? candidate : undefined;
}

function isCardDefinitionObject(value: unknown): value is CardDefinition {
    return (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        "name" in value &&
        "types" in value
    );
}
