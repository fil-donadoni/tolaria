import type { PendingChoice } from "~/types/game";
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
} from "~/components/ui/command";
import { subtypeOptionFilter } from "~/lib/subtype-option-list";

/** Searchable single-pick list for an as-enters `{ kind: "subtypes" }` choice
 *  (CR 205.3m's creature types for Conspiracy / Engineered Plague, CR 205.3i's
 *  basic land types). The creature-type table is ~280 entries — as a button
 *  grid it was unscannable — so the chooser types to filter, moves the
 *  highlight with the arrow keys and confirms with Enter or a click (all
 *  native to cmdk). Picking an item fires the SAME `onPick(id)` the button
 *  grid fires, so the submit path and payload are unchanged. Stateless w.r.t.
 *  the game — the parent owns the submit + pending state. */
export default function SubtypeOptionCombobox({
    options,
    disabled,
    onPick,
}: {
    options: NonNullable<PendingChoice["options"]>;
    disabled: boolean;
    onPick: (id: string) => void;
}) {
    return (
        <Command
            filter={subtypeOptionFilter}
            // `shrink-0`: the prompt Panel is a max-h flex column, and on a
            // short viewport (844x390) a shrinkable Command collapsed its list
            // to a 38px window — the Panel scrolls instead.
            className="mt-1 h-auto w-64 max-w-full shrink-0 rounded-sm! border border-border-subtle/40 bg-surface"
        >
            <CommandInput
                autoFocus
                disabled={disabled}
                placeholder="Search a type…"
                aria-label="Search types"
            />
            <CommandList className="max-h-48">
                <CommandEmpty className="py-3 text-xs text-text-muted">
                    No matching type
                </CommandEmpty>
                {options.map((opt) => (
                    <CommandItem
                        key={opt.id}
                        value={opt.label}
                        disabled={disabled}
                        onSelect={() => onPick(opt.id)}
                        // Same row height as a `Button size="sm"` — the token
                        // grows under `pointer: coarse` for touch targets.
                        className="min-h-[var(--control-h-sm)] text-xs tracking-wide"
                    >
                        {opt.label}
                    </CommandItem>
                ))}
            </CommandList>
        </Command>
    );
}
