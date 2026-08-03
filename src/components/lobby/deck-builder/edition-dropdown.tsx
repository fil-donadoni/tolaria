import { ChevronDownIcon } from "lucide-react";
import type { EditionOption } from "~/lib/editions";

interface EditionDropdownProps {
    options: EditionOption[];
    value: string;
    onChange: (printId: string) => void;
    onOpen?: () => void;
}

/** Compact per-card edition picker. A native `<select>` so it scales to any
 *  number of printings (basic lands have several) and stays keyboard- and
 *  screen-reader-accessible. Click is stopped from bubbling to the card's
 *  add-on-click handler. */
export default function EditionDropdown({
    options,
    value,
    onChange,
    onOpen,
}: EditionDropdownProps) {
    return (
        <div className="relative" onClick={(e) => e.stopPropagation()}>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onFocus={() => onOpen?.()}
                aria-label="Edition"
                className="w-full appearance-none rounded-sm border border-border-subtle/40 bg-surface-elevated/40 py-0.5 pl-2 pr-5 text-[10px] uppercase tracking-wide text-text-muted transition hover:text-parchment focus:outline-none"
            >
                {options.map((opt) => (
                    <option key={opt.printId} value={opt.printId}>
                        {opt.label}
                    </option>
                ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 opacity-60" />
        </div>
    );
}
