/** Heads glyph of the 3D coin: a sun. Drawn in `currentColor`. */
export default function CoinSunGlyph({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            className={className}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
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
