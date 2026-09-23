import type { PendingChoice } from "~/types/game";

/** True when the option list is a SUBTYPE list — the engine tags every such
 *  option with `subtype` (`PendingChoice.options` doc in `gre/state.ts`) and
 *  no other option-pick family sets it. Two producers share the tag: the
 *  as-enters `{ kind: "subtypes" }` choice (Engineered Plague, Conspiracy) and
 *  the RESOLUTION-time `chooseCreatureType` Op (issue #3721, Tsabo's Decree).
 *  The test is structural on purpose — it asks what the options ARE, not which
 *  producer raised them, which is why the second producer needed no change
 *  here. Either way it is the one option-pick whose list is two orders of
 *  magnitude wider than a mode list, so it gets the searchable combobox
 *  instead of the button grid (issue #3323). */
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
