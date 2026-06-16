import { useMemo } from "react";
import { getAllSetCodes } from "@convex/cards";
import type { ComboboxOption } from "./multi-combobox";
import MultiCombobox from "./multi-combobox";

interface SetFilterProps {
    selected: string[];
    onToggle: (setCode: string) => void;
}

export default function SetFilter({ selected, onToggle }: SetFilterProps) {
    const options = useMemo<ComboboxOption[]>(
        () =>
            getAllSetCodes().map((value) => ({
                value,
                label: value.toUpperCase(),
            })),
        []
    );

    return (
        <MultiCombobox
            options={options}
            selected={selected}
            onToggle={onToggle}
            placeholder="Set"
            searchPlaceholder="Search set…"
            emptyText="No matching set."
            labelClassName="uppercase"
        />
    );
}
