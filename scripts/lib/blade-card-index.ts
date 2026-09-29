/**
 * The Bot Findings blade card index — pure over a `BladeScenario` shape
 * (issue #4177, review). Split out of `scripts/build-blade-card-index.ts`
 * so building the index never loads `convex/gre/ai/blade/registry.ts` — a
 * VALUE import that drags the whole search engine, move enumerator and card
 * catalogue with it (`scripts/__tests__/bot-suite-boundary.test.ts`'s
 * `convex/gre/ai/` prefix). This module stays registry-free; only the
 * generator script (`import.meta.main`) and the drift test
 * (`*.bot.test.ts`) ever import the real registry.
 *
 * Card names come from the winning matcher's `card`/`cards` fields on a
 * `moves` expectation — the CORRECT move(s) the entry asserts, never
 * `spec.cards[].name` (issue #4177 review, finding B1): a card merely sitting
 * on the board proves nothing — an opponent's hand card, a negative control
 * ("does not cast X"), a wasted-mana check are all real committed entries
 * that place a card without ever asserting the bot handles it correctly.
 * Only `moves` counts; `forbidden` asserts what the bot must NOT do, and
 * `predicate` names no card at all.
 */
import type {
    BladeCardIndex,
    BladeCardIndexEntry,
} from "../../convex/gre/ai/botFindingState";

export const BLADE_CARD_INDEX_PATH = "data/blade-card-index.json";

/** One blade scenario, as far as the index needs to see it — a structural
 *  subset of `BladeScenario` so this stays testable with a plain fixture
 *  rather than a slice of the real 9,000-line registry. */
export interface IndexableBladeScenario {
    readonly label: string;
    readonly tier: "must" | "stretch";
    readonly expect: {
        readonly moves?: readonly {
            readonly card?: string;
            readonly cards?: readonly string[];
        }[];
    };
    readonly setup?: readonly unknown[];
    readonly revisit?: readonly unknown[];
}

/** PURE over the registry: every card a `moves` expectation names as part of
 *  the CORRECT play, mapped to the entries proving it, sorted for a stable
 *  diff. */
export function buildBladeCardIndex(
    scenarios: readonly IndexableBladeScenario[]
): BladeCardIndex {
    const byName = new Map<string, BladeCardIndexEntry[]>();
    for (const scenario of scenarios) {
        const moves = scenario.expect.moves;
        if (moves === undefined) continue;
        const needsSetup =
            (scenario.setup?.length ?? 0) > 0 ||
            (scenario.revisit?.length ?? 0) > 0;
        const names = new Set<string>();
        for (const matcher of moves) {
            if (matcher.card !== undefined) names.add(matcher.card);
            for (const card of matcher.cards ?? []) names.add(card);
        }
        for (const name of names) {
            const entries = byName.get(name) ?? [];
            entries.push({
                label: scenario.label,
                tier: scenario.tier,
                needsSetup,
            });
            byName.set(name, entries);
        }
    }
    const sorted: Record<string, BladeCardIndexEntry[]> = {};
    for (const name of [...byName.keys()].sort())
        sorted[name] = byName
            .get(name)!
            .sort((a, b) => a.label.localeCompare(b.label));
    return sorted;
}
