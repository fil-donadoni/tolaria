import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import MatchModePills from "./match-mode-pills";
import MultiCombobox, {
    type ComboboxGroup,
    type ComboboxOption,
} from "./multi-combobox";
import type { MatchMode } from "./useCardSearch";

// Card types pinned to the top of the list; everything else (sub/supertypes)
// follows below a separator, alphabetically. All toggle the same `types`
// filter — `matchesTypes` checks types, subtypes, and supertypes together.
const CARD_TYPE_OPTIONS: ComboboxOption[] = [
    "Creature",
    "Instant",
    "Sorcery",
    "Artifact",
    "Enchantment",
    "Land",
    "Planeswalker",
].map((value) => ({ value, label: value }));

const CARD_TYPE_VALUES = new Set(CARD_TYPE_OPTIONS.map((o) => o.value));

interface TypeFilterProps {
    selected: string[];
    onToggle: (type: string) => void;
    mode: MatchMode;
    onChangeMode: (mode: MatchMode) => void;
}

export default function TypeFilter({
    selected,
    onToggle,
    mode,
    onChangeMode,
}: TypeFilterProps) {
    const all = useQuery(api.cardIndex.list, {});

    const groups = useMemo<ComboboxGroup[]>(() => {
        const set = new Set<string>();
        if (all) {
            for (const row of all) {
                for (const s of row.subtypes) set.add(s);
                for (const s of row.supertypes) set.add(s);
            }
        }
        // Drop any subtype that collides with a card type name (none today,
        // but keeps the two groups disjoint if the catalogue grows).
        const subAndSuper = Array.from(set)
            .filter((s) => !CARD_TYPE_VALUES.has(s))
            .sort((a, b) => a.localeCompare(b))
            .map((value) => ({ value, label: value }));
        return [{ options: CARD_TYPE_OPTIONS }, { options: subAndSuper }];
    }, [all]);

    return (
        <div className="flex flex-col gap-1.5">
            <MultiCombobox
                groups={groups}
                selected={selected}
                onToggle={onToggle}
                placeholder="Type"
                searchPlaceholder="Search type…"
                emptyText="No matching type."
            />
            {selected.length >= 2 && (
                <MatchModePills mode={mode} onChange={onChangeMode} />
            )}
        </div>
    );
}
