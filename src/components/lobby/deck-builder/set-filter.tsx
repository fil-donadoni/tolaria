import { useMemo } from "react";
import { getAllSetCodes } from "@convex/cards/catalogue";
import { setName, setSymbolClass } from "@convex/cards/setMeta";
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

/** Keyrune set glyph. `aria-hidden` — the surrounding text carries the name. */
function SetSymbol({ code }: { code: string }) {
    return <i className={setSymbolClass(code)} aria-hidden />;
}

export default function SetFilter({
    selected,
    onToggle,
    mode,
    onChangeMode,
}: SetFilterProps) {
    // label drives the combobox's fuzzy search → include name + code so typing
    // either matches. The custom renderers below own the visual layout.
    const options = useMemo<ComboboxOption[]>(
        () =>
            getAllSetCodes().map((value) => ({
                value,
                label: `${setName(value)} (${value.toUpperCase()})`,
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
                labelClassName=""
                renderOption={(opt) => (
                    <span className="flex items-center gap-2">
                        <SetSymbol code={opt.value} />
                        <span>{setName(opt.value)}</span>
                        <span className="text-text-muted">
                            ({opt.value.toUpperCase()})
                        </span>
                    </span>
                )}
                renderTag={(opt) => (
                    <span className="flex items-center gap-1">
                        <SetSymbol code={opt.value} />
                        <span>{opt.value.toUpperCase()}</span>
                    </span>
                )}
            />
            {selected.length >= 2 && (
                <MatchModePills mode={mode} onChange={onChangeMode} />
            )}
        </div>
    );
}
