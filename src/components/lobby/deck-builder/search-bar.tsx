import { useEffect, useRef } from "react";
import { acceptsShortcut } from "~/lib/keyboard-shortcuts";

interface SearchBarProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

export default function SearchBar({
    value,
    onChange,
    placeholder = "Search cards by name or rules text…",
}: SearchBarProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    // `/` FOCUSES SEARCH (issue #2593, ADR 0101 §6 keyboard model).
    //
    // Bound here rather than in the deckbuilder shell, because this is the
    // component that OWNS the input: the shortcut and its target cannot drift
    // apart, and it works on every surface that mounts a SearchBar without any
    // of them opting in. `acceptsShortcut` is what keeps `/` typeable — the
    // shared admission test bails on a typing target, so pressing `/` while
    // already inside the box (or any other field) inserts a slash as usual.
    //
    // Escape is the way back out, so the keyboard is never trapped in the box.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "/") return;
            if (!acceptsShortcut(event)) return;
            const input = inputRef.current;
            if (!input) return;
            event.preventDefault();
            input.focus();
            input.select();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    return (
        <div className="relative min-w-0 flex-1 overflow-hidden">
            <input
                ref={inputRef}
                type="text"
                aria-label="Search cards"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Escape") e.currentTarget.blur();
                }}
                placeholder={placeholder}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="input-field w-full"
            />
            {value.length > 0 && (
                <button
                    onClick={() => onChange("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 text-xs text-text-disabled hover:text-parchment"
                    aria-label="Clear search"
                >
                    ×
                </button>
            )}
        </div>
    );
}
