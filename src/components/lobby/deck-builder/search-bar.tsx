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
                className="w-full rounded border border-white/20 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:bg-white/10 focus:outline-none"
            />
            {value.length > 0 && (
                <button
                    onClick={() => onChange("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 text-xs text-white/40 hover:text-white"
                    aria-label="Clear search"
                >
                    ×
                </button>
            )}
        </div>
    );
}
