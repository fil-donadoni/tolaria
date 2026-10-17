import { useEffect, useMemo, useState } from "react";
import { getAllCardNames } from "@convex/cards/catalogue";
import { getAllTokenKeys } from "@convex/cards/tokenCatalogue";
import { hydrateCatalogue, isCatalogueHydrated } from "~/lib/catalogueArtifact";
import { useCompiledIndex } from "~/hooks/useCompiledIndex";

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
    // The token catalogue is derived by walking EVERY hand-written
    // definition (`getAllCards`): a whole-catalogue read, on a game route
    // that holds only its game's shards (issues #5615, #5616). The card
    // names are read off the Definition Index, whose compiled section this
    // field loads on demand (a names asset, never a shard); the token keys
    // wait for the whole catalogue, which this field starts loading — admin
    // tooling pays the catalogue, the game does not.
    const names = useCompiledIndex(source === "cards");
    const [whole, setWhole] = useState(isCatalogueHydrated);
    useEffect(() => {
        if (source !== "tokens") return;
        let cancelled = false;
        hydrateCatalogue().then(
            () => {
                if (!cancelled) setWhole(true);
            },
            (cause: unknown) => {
                // Suggestions stay empty; the typed key is still submitted
                // and validated server-side.
                console.warn("token catalogue not loaded", cause);
            }
        );
        return () => {
            cancelled = true;
        };
    }, [source]);
    const allNames = useMemo(
        () =>
            source === "tokens"
                ? whole
                    ? getAllTokenKeys()
                    : []
                : names.ready
                  ? getAllCardNames()
                  : [],
        [source, whole, names.ready]
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
