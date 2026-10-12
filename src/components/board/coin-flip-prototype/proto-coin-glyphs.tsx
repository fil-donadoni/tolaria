// PROTOTYPE (issue #4433) — heads (sun) / tails (moon) coin glyphs.
export function SunGlyph({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            className={className}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
        >
            <circle
                cx="12"
                cy="12"
                r="4.2"
                fill="currentColor"
                fillOpacity="0.25"
            />
            {Array.from({ length: 8 }).map((_, i) => {
                const a = (i * Math.PI) / 4;
                return (
                    <line
                        key={i}
                        x1={12 + Math.cos(a) * 7}
                        y1={12 + Math.sin(a) * 7}
                        x2={12 + Math.cos(a) * 10}
                        y2={12 + Math.sin(a) * 10}
                    />
                );
            })}
        </svg>
    );
}

export function MoonGlyph({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            className={className}
            fill="currentColor"
            fillOpacity="0.25"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
        >
            <path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5Z" />
        </svg>
    );
}
