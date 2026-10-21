/**
 * Reading a lockfile's fragments (issue #6169): the one resolver every
 * reader goes through, and the structure check `check:oracle` and the
 * `merge=regenerated` driver run.
 *
 * Kept OUT of `oracle-lockfile.ts` on purpose: that file is in the
 * compiler's DRIVER_FILES, so every byte of it is in the header's
 * `compilerHash`, and a reader-side edit there would demand a full
 * recompile and conflict with every grammar PR. Nothing here decides the
 * lockfile's bytes — what a key is and how the table is ordered stay there.
 */

import {
    compareFragmentContent,
    fragmentKey,
    type CardRow,
    type FragmentRow,
    type Lockfile,
} from "./oracle-lockfile";

/** Whether a parsed value has the lockfile's shape — header and tables. */
export function isLockfileShaped(value: unknown): value is Lockfile {
    const lock = value as Partial<Lockfile> | null;
    return (
        Array.isArray(lock?.fragments) &&
        Array.isArray(lock?.cards) &&
        lock?.header !== undefined
    );
}

/**
 * The RANK order: blast radius first, the table order breaking ties — the
 * backlog that ranks the next grammar rule (PRD #2693 user story 9), and the
 * order in which a reader meets a card's fragments.
 */
export function compareFragmentRank(a: FragmentRow, b: FragmentRow): number {
    return b.cards - a.cards || compareFragmentContent(a, b);
}

/** The one way a reader resolves `gaps` (issue #6169). */
export interface FragmentIndex {
    /** Every fragment, in {@link compareFragmentRank} order. */
    readonly ranked: readonly FragmentRow[];
    /** The fragments a card's `gaps` cite, in rank order — so a reader
     *  taking a card's FIRST fragment takes its widest-blocking one. */
    readonly of: (card: CardRow) => readonly FragmentRow[];
}

/**
 * Index a lockfile's fragments by key. Throws on a duplicate key and on a
 * `gaps` key the table does not hold: either is a lockfile no reader can
 * trust (a hand-edit, a bad merge), and a reader guessing past it would
 * misattribute a card silently.
 */
export function indexFragments(
    lock: Pick<Lockfile, "fragments">
): FragmentIndex {
    const ranked = [...lock.fragments].sort(compareFragmentRank);
    const rank = new Map<string, number>();
    ranked.forEach((fragment, i) => {
        if (rank.has(fragment.key))
            throw new Error(
                `oracle lockfile: fragment key ${fragment.key} is on two rows — run: bun run oracle:compile`
            );
        rank.set(fragment.key, i);
    });
    const of = (card: CardRow): FragmentRow[] =>
        (card.gaps ?? [])
            .map((key) => {
                const i = rank.get(key);
                if (i === undefined)
                    throw new Error(
                        `oracle lockfile: ${card.name} cites fragment ${key}, which the table does not hold — run: bun run oracle:compile`
                    );
                return i;
            })
            .sort((a, b) => a - b)
            .map((i) => ranked[i]!);
    return { ranked, of };
}

/**
 * Everything a lockfile must satisfy on its own, with no corpus: each key is
 * its row's content key, the table and the rows are in canonical order, each
 * row's `gaps` resolve, and each fragment declares exactly the cards citing
 * it. (The state counts are derived from the rows on read — ADR 0157 § 1a —
 * so there is no committed figure left to disagree with them.)
 *
 * `check:oracle` runs it on every checkout. It is also what tells a CORRECT
 * clean textual merge from a wrong one: two branches each moving one card
 * onto the same fragment edit its `cards` identically, git keeps one edit,
 * and the count is one short.
 *
 * Not re-derived here: the `botGaps` table. The same identical-edit merge can
 * leave it short — two branches each moving a `ready` card onto one Bot Gap
 * key — and only tier 3's regenerate-and-diff sees it.
 */
export function lockfileStructureProblems(
    lock: Pick<Lockfile, "fragments" | "cards">
): string[] {
    const problems: string[] = [];
    const declared = new Map<string, number>();
    lock.fragments.forEach((fragment, i) => {
        const key = fragmentKey(fragment);
        if (fragment.key !== key)
            problems.push(
                `fragment ${JSON.stringify(fragment.text)} carries key ${fragment.key}, its content's key is ${key}`
            );
        if (declared.has(fragment.key))
            problems.push(`fragment key ${fragment.key} is on two rows`);
        declared.set(fragment.key, fragment.cards);
        const prev = lock.fragments[i - 1];
        if (prev !== undefined && compareFragmentContent(prev, fragment) >= 0)
            problems.push(
                `fragment ${fragment.key} is out of table order (text, reason, attribution)`
            );
    });
    const cited = new Map<string, number>();
    lock.cards.forEach((card, i) => {
        const prev = lock.cards[i - 1];
        if (prev !== undefined && prev.oracleId >= card.oracleId)
            problems.push(
                `card ${card.name} is out of oracle-id order or duplicated`
            );
        const gaps = card.gaps ?? [];
        if ((card.state === "unparsed") !== gaps.length > 0)
            problems.push(
                `card ${card.name} is ${card.state} with ${gaps.length} gap(s)`
            );
        gaps.forEach((key, j) => {
            if (j > 0 && gaps[j - 1]! >= key)
                problems.push(
                    `card ${card.name}'s gaps are not sorted and distinct`
                );
            if (!declared.has(key))
                problems.push(
                    `card ${card.name} cites fragment ${key}, which the table does not hold`
                );
            cited.set(key, (cited.get(key) ?? 0) + 1);
        });
    });
    for (const [key, cards] of declared) {
        const actual = cited.get(key) ?? 0;
        if (cards !== actual)
            problems.push(
                `fragment ${key} declares ${cards} card(s), ${actual} cite it`
            );
    }
    return problems;
}
