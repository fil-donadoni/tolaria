import { Fragment, useMemo, useState } from "react";
import { ChevronDownIcon, X } from "lucide-react";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "~/lib/utils";

export interface ComboboxOption {
    value: string;
    label: string;
}

export interface ComboboxGroup {
    options: ComboboxOption[];
}

interface MultiComboboxProps {
    /** Flat option list. Mutually exclusive with `groups`. */
    options?: ComboboxOption[];
    /** Grouped options rendered with a separator between each group. */
    groups?: ComboboxGroup[];
    selected: string[];
    onToggle: (value: string) => void;
    /** Trigger text when nothing is selected. */
    placeholder: string;
    searchPlaceholder: string;
    emptyText: string;
    /** Applied to option items, chips, and the trigger summary. */
    labelClassName?: string;
    /** Custom render for an option row inside the dropdown. Defaults to the
     *  plain `opt.label`. Lets callers (e.g. the set filter) inject a symbol +
     *  name + code layout without baking those fields into ComboboxOption. */
    renderOption?: (opt: ComboboxOption) => React.ReactNode;
    /** Custom render for a selected chip. Defaults to `labelOf(value)`. Used to
     *  keep chips compact (symbol + code) while options stay verbose. */
    renderTag?: (opt: ComboboxOption) => React.ReactNode;
}

export default function MultiCombobox({
    options,
    groups,
    selected,
    onToggle,
    placeholder,
    searchPlaceholder,
    emptyText,
    labelClassName = "capitalize",
    renderOption,
    renderTag,
}: MultiComboboxProps) {
    const [open, setOpen] = useState(false);
    const resolvedGroups = useMemo<ComboboxGroup[]>(
        () => groups ?? [{ options: options ?? [] }],
        [groups, options]
    );
    const optionOf = (value: string): ComboboxOption => {
        for (const g of resolvedGroups) {
            const hit = g.options.find((o) => o.value === value);
            if (hit) return hit;
        }
        return { value, label: value };
    };
    const labelOf = (value: string) => optionOf(value).label;

    return (
        <div className="flex items-center gap-1">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                    aria-expanded={open}
                    className={cn(
                        "flex h-8 min-w-50 items-center justify-between gap-2 rounded-sm border border-border-subtle/40 bg-surface-elevated/20 px-2.5 text-[11px] tracking-wide text-text-muted transition hover:bg-surface-elevated/30 hover:text-parchment",
                        labelClassName
                    )}
                >
                    <span>
                        {selected.length === 0
                            ? placeholder
                            : `${placeholder}: ${selected.length} selected`}
                    </span>
                    <ChevronDownIcon className="size-3.5 opacity-60" />
                </PopoverTrigger>
                <PopoverContent
                    className="w-80 border-border-subtle/40 bg-surface p-0"
                    align="start"
                    side="bottom"
                    sideOffset={4}
                >
                    <Command>
                        <CommandInput placeholder={searchPlaceholder} />
                        <CommandList>
                            <CommandEmpty>{emptyText}</CommandEmpty>
                            {resolvedGroups.map((group, i) => (
                                <Fragment key={i}>
                                    {i > 0 && <CommandSeparator />}
                                    <CommandGroup>
                                        {group.options.map((opt) => {
                                            const active = selected.includes(
                                                opt.value
                                            );
                                            return (
                                                <CommandItem
                                                    key={opt.value}
                                                    value={opt.label}
                                                    onSelect={() =>
                                                        onToggle(opt.value)
                                                    }
                                                    data-checked={active}
                                                    className={cn(
                                                        "tracking-wide",
                                                        labelClassName
                                                    )}
                                                >
                                                    {renderOption
                                                        ? renderOption(opt)
                                                        : opt.label}
                                                </CommandItem>
                                            );
                                        })}
                                    </CommandGroup>
                                </Fragment>
                            ))}
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>

            {selected.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                    {selected.map((value) => (
                        <span
                            key={value}
                            className={cn(
                                "flex items-center gap-1 rounded-full bg-accent-soft/30 px-2 py-0.5 text-[10px] tracking-wide text-parchment",
                                labelClassName
                            )}
                        >
                            {renderTag
                                ? renderTag(optionOf(value))
                                : labelOf(value)}
                            <button
                                onClick={() => onToggle(value)}
                                className="text-text-muted hover:text-parchment"
                                aria-label={`Remove ${labelOf(value)}`}
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
