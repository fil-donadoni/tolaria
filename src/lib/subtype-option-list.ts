import type { PendingChoice } from "~/types/game";

/** True when the option list IS an as-enters `{ kind: "subtypes" }` choice —
 *  the engine tags every such option with `subtype` (`PendingChoice.options`
 *  doc in `gre/state.ts`) and no other option-pick family sets it. The one
 *  option-pick whose list is two orders of magnitude wider than a mode list,
 *  so it gets the searchable combobox instead of the button grid (issue
 *  #3323). */
export function isSubtypeOptionList(
    options: NonNullable<PendingChoice["options"]>
): boolean {
    return options.length > 0 && options.every((o) => o.subtype !== undefined);
}

/** Case-insensitive SUBSTRING match on the option label (issue #3323) — not
 *  cmdk's default fuzzy score, which would let "gb" match "Goblin" and bury
 *  the type the chooser actually typed under subsequence noise. */
export function subtypeOptionFilter(value: string, search: string): number {
    return value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0;
}
