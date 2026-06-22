import { useMemo, useState } from "react";
import { getAllCardNames } from "@convex/cards";

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

    // Top suggestions: prefix matches first, then substring, capped for the UI.
    const suggestions = useMemo(() => {
        const q = trimmed.toLowerCase();
        if (q.length === 0) return [];
        const prefix: string[] = [];
        const substring: string[] = [];
        for (const n of allNames) {
            const lower = n.toLowerCase();
            if (lower === q) continue;
            if (lower.startsWith(q)) prefix.push(n);
            else if (lower.includes(q)) substring.push(n);
            if (prefix.length >= 6) break;
        }
        return [...prefix, ...substring].slice(0, 6);
    }, [allNames, trimmed]);

    const submit = () => {
        if (disabled || !isValid) return;
        onSubmit(canonical);
    };

    return (
        <div className="flex flex-col items-stretch gap-1.5 mt-1 w-64">
            <input
                type="text"
                autoFocus
                value={value}
                disabled={disabled}
                placeholder="Type a card name…"
                aria-label="Card name"
                className="px-2.5 py-1.5 rounded-sm text-xs bg-[#0c0d12] border border-[#c8a060]/45 text-[#f1f1e8] placeholder:text-zinc-600 focus:outline-none focus:border-[#c8a060]/80 disabled:opacity-40"
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        submit();
                    }
                }}
            />
            {suggestions.length > 0 && (
                <ul className="flex flex-col rounded-sm border border-zinc-800/80 bg-[#0c0d12] divide-y divide-zinc-800/60 overflow-hidden">
                    {suggestions.map((name) => (
                        <li key={name}>
                            <button
                                type="button"
                                disabled={disabled}
                                className="w-full text-left px-2.5 py-1 text-xs text-zinc-300 hover:bg-[#7a5a2e]/40 disabled:opacity-40 cursor-pointer"
                                onClick={() => setValue(name)}
                            >
                                {name}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <button
                type="button"
                disabled={disabled || !isValid}
                className="px-3 py-1.5 rounded-sm text-xs font-beleren tracking-wide bg-[#7a5a2e]/30 border border-[#c8a060]/45 text-[#e0c08a] hover:bg-[#7a5a2e]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                onClick={submit}
            >
                Name it
            </button>
            {trimmed.length > 0 && !isValid && (
                <p className="text-[11px] text-zinc-500 text-center">
                    No implemented card by that name
                </p>
            )}
        </div>
    );
}
