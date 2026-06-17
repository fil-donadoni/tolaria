import { useMemo } from "react";
import { getAllSetCodes } from "@convex/cards";
import MatchModePills from "./match-mode-pills";
import type { ComboboxOption } from "./multi-combobox";
import MultiCombobox from "./multi-combobox";
import type { MatchMode } from "./useCardSearch";

interface SetFilterProps {
    selected: string[];
    onToggle: (setCode: string) => void;
    mode: MatchMode;
    onChangeMode: (mode: MatchMode) => void;
}

export default function SetFilter({
    selected,
    onToggle,
    mode,
    onChangeMode,
}: SetFilterProps) {
    const options = useMemo<ComboboxOption[]>(
        () =>
            getAllSetCodes().map((value) => ({
                value,
                label: value.toUpperCase(),
            })),
        []
    );

    return (
        <div className="flex flex-col gap-1.5">
            <MultiCombobox
                options={options}
                selected={selected}
                onToggle={onToggle}
                placeholder="Set"
                searchPlaceholder="Search set…"
                emptyText="No matching set."
            />
            {selected.length >= 2 && (
                <MatchModePills mode={mode} onChange={onChangeMode} />
            )}
        </div>
    );
}
