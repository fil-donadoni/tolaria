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
    return (
        <div className="relative flex-1">
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
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
