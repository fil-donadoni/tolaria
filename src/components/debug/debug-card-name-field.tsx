import { useMemo, useState } from "react";
import { getAllCardNames } from "@convex/cards/catalogue";
import { getAllTokenKeys } from "@convex/cards/tokenCatalogue";

/** Controlled card-name autocomplete for the debug scenario builder. Unlike
 *  `CardNameInput` (which owns a submit button for a `name-card` choice), this
 *  is a plain value/onChange field: the parent repeater owns the value and the
 *  save. Suggestions are filtered over the implemented card registry
 *  (`getAllCardNames`) — or, with `source="tokens"`, over the token catalogue
 *  (`getAllTokenKeys`, CR 111 / 707.2: a token has no CardDefinition, so it is
 *  named by catalogue key) — with exact → prefix → substring ranking, capped
 *  for the UI. A dropdown of matches shows while the field is focused and the
 *  typed value isn't already an exact match. */
export default function DebugCardNameField({
    value,
    onChange,
    placeholder = "Card name…",
    ariaLabel = "Card name",
    source = "cards",
}: {
    value: string;
    onChange: (name: string) => void;
    placeholder?: string;
    ariaLabel?: string;
    /** Which name space to suggest from: the card registry (default) or the
     *  token catalogue. */
    source?: "cards" | "tokens";
}) {
    const [focused, setFocused] = useState(false);
    const allNames = useMemo(
        () => (source === "tokens" ? getAllTokenKeys() : getAllCardNames()),
        [source]
    );

    const trimmed = value.trim();
    const suggestions = useMemo(() => {
        const q = trimmed.toLowerCase();
        if (q.length === 0) return [];
        const exact: string[] = [];
        const prefix: string[] = [];
        const substring: string[] = [];
        for (const n of allNames) {
            const lower = n.toLowerCase();
            if (lower === q) exact.push(n);
            else if (lower.startsWith(q)) prefix.push(n);
            else if (lower.includes(q)) substring.push(n);
            if (prefix.length >= 8) break;
        }
        return [...exact, ...prefix, ...substring].slice(0, 8);
    }, [allNames, trimmed]);

    // Hide the dropdown once the typed value is an exact registry match — no
    // point suggesting the card that's already chosen.
    const exactMatch = suggestions.length === 1 && suggestions[0] === value;
    const showList = focused && suggestions.length > 0 && !exactMatch;

    return (
        <div className="relative flex-1">
            <input
                type="text"
                value={value}
                placeholder={placeholder}
                aria-label={ariaLabel}
                onChange={(e) => onChange(e.target.value)}
                onFocus={() => setFocused(true)}
                // Delay blur so a suggestion click registers before the list unmounts.
                onBlur={() => setTimeout(() => setFocused(false), 120)}
                className="input-field w-full px-2 py-1 text-xs"
            />
            {showList && (
                <ul className="absolute top-full right-0 left-0 z-10 mt-0.5 max-h-40 overflow-y-auto rounded-sm border border-border-strong bg-surface shadow-xl">
                    {suggestions.map((name) => (
                        <li key={name}>
                            <button
                                type="button"
                                className="w-full px-2 py-1 text-left text-xs text-text hover:bg-accent-soft/40 hover:text-parchment"
                                onMouseDown={(e) => {
                                    // onMouseDown (not onClick) so it fires before blur.
                                    e.preventDefault();
                                    onChange(name);
                                    setFocused(false);
                                }}
                            >
                                {name}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
