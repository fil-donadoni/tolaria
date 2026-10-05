/**
 * The card names a `must` blade entry covers (`mustCoveredCards`, ADR 0143),
 * loaded from the live registry. Dynamic import on purpose: the registry is
 * large and drags engine modules, so only a caller that needs the set pays for
 * it (`oracle-report` does the same). `gaps:sync` and `check:gaps` both read
 * it, so a `never-chosen` card a Test Position covers drops out of the Bot Gap
 * filer and of the claim check by the same set.
 */
import { mustCoveredCards } from "./target-completed";

export async function loadBladeMustCovered(): Promise<Set<string>> {
    const { BLADE_SCENARIOS } =
        await import("../../convex/gre/ai/blade/registry");
    return mustCoveredCards(BLADE_SCENARIOS);
}
