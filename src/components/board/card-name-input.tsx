import { useMemo, useState } from "react";
import { getAllCardNames } from "@convex/cards/catalogue";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

/** Autocomplete name input for a `name-card` pending choice (CR 202.3 — "chooses
 *  a card name", Petra Sphinx). The chooser types a card name; the field
 *  suggests matches filtered over the implemented card registry and the submit
 *  is gated to a name that resolves to a registered card (the server re-validates
 *  against the registry). Stateless w.r.t. the game — the parent owns the submit
 *  mutation and the in-flight `disabled` gate (project-wide: buttons firing a
 *  Convex mutation disable while it's in flight). */
export default function CardNameInput({
    disabled,
    onSubmit,
}: {
    disabled: boolean;
    onSubmit: (cardName: string) => void;
}) {
    const [value, setValue] = useState("");
    // The whole implemented registry is the candidate set (CR 202.3 — name ANY
    // card; here, any card we model). Computed once.
    const allNames = useMemo(() => getAllCardNames(), []);
    // Case-insensitive registry membership — gates the submit and disambiguates
    // casing (the server normalizes to canonical casing on submit).
    const canonicalByLower = useMemo(() => {
        const map = new Map<string, string>();
        for (const n of allNames) map.set(n.toLowerCase(), n);
        return map;
    }, [allNames]);

    const trimmed = value.trim();
    const canonical = canonicalByLower.get(trimmed.toLowerCase());
    const isValid = canonical !== undefined;

    // Exact match first, then prefix matches, then substring, capped for the UI.
    // The exact match MUST NOT be dropped: many card names are substrings of
    // longer ones (every basic land is a substring of its "Snow-Covered …"
    // variant; "Island" ⊂ "Island Sanctuary"). Skipping it hid the very card
    // the chooser typed, leaving only the longer superset in the list.
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
            if (prefix.length >= 6) break;
        }
        return [...exact, ...prefix, ...substring].slice(0, 6);
    }, [allNames, trimmed]);

    const submit = () => {
        if (disabled || !isValid) return;
        onSubmit(canonical);
    };

    return (
        <div className="flex flex-col items-stretch gap-1.5 mt-1 w-64">
            <Input
                type="text"
                autoFocus
                value={value}
                disabled={disabled}
                placeholder="Type a card name…"
                aria-label="Card name"
                className="h-auto px-2.5 py-1.5 text-xs"
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        submit();
                    }
                }}
            />
            {suggestions.length > 0 && (
                <ul className="flex flex-col rounded-sm border border-border-subtle bg-surface divide-y divide-border-subtle overflow-hidden">
                    {suggestions.map((name) => (
                        <li key={name}>
                            <button
                                type="button"
                                disabled={disabled}
                                className="w-full text-left px-2.5 py-1 text-xs text-text-muted hover:bg-accent-soft/40 disabled:opacity-40 cursor-pointer"
                                onClick={() => setValue(name)}
                            >
                                {name}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={disabled || !isValid}
                onClick={submit}
            >
                Name it
            </Button>
            {trimmed.length > 0 && !isValid && (
                <p className="text-[11px] text-text-disabled text-center">
                    No implemented card by that name
                </p>
            )}
        </div>
    );
}
