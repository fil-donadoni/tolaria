/** Exile zone glyph (dimensional void / vortex) for the card piles (PRD #249).
 *  Full-colour decorative icon — its strokes/fills are fixed (not
 *  `currentColor`), so text-colour utilities don't tint it; size it via
 *  `className` (e.g. `w-7 h-7`). */
export default function ExileIcon({ className }: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 100 100"
            className={className}
            aria-hidden
        >
            <g fill="none" strokeLinecap="round">
                {/* Centre of the void (dimensional black) */}
                <circle cx="50" cy="50" r="12" fill="#0d0e15" />
                {/* Inner dark spire */}
                <path
                    d="M50,38 C58,38 64,45 61,53 C58,60 48,64 42,58 C37,53 40,43 48,41 C54,40 58,45 56,50"
                    stroke="#2d3748"
                    strokeWidth="3"
                />
                {/* Mid spire (teal / inversion) */}
                <path
                    d="M50,30 C65,30 74,42 71,56 C67,70 50,75 38,67 C27,58 28,40 40,32 C50,26 62,30 66,40"
                    stroke="#4a6b6c"
                    strokeWidth="4"
                />
                {/* Outer spire (violet / exile) */}
                <path
                    d="M50,20 C72,20 86,36 83,58 C79,78 55,86 35,77 C17,67 14,43 28,27 C40,14 62,15 73,28"
                    stroke="#5a5266"
                    strokeWidth="4.5"
                />
                {/* Orbiting outer fragments (dissolve) */}
                <path
                    d="M78,25 C82,30 85,37 86,45"
                    stroke="#5a5266"
                    strokeWidth="2"
                    strokeDasharray="1 4"
                />
                <path
                    d="M22,75 C18,70 15,63 14,55"
                    stroke="#4a6b6c"
                    strokeWidth="2"
                    strokeDasharray="1 4"
                />
                {/* Geometric particles (stars / shards of reality) */}
                <polygon
                    points="50,12 51,15 54,15 52,17 53,20 50,18 47,20 48,17 46,15 49,15"
                    fill="#4a6b6c"
                    opacity="0.7"
                />
                <polygon
                    points="20,60 21,62 23,62 21,63 22,65 20,64 18,65 19,63 17,62 19,62"
                    fill="#5a5266"
                    opacity="0.7"
                />
                <polygon
                    points="80,55 81,57 83,57 81,58 82,60 80,59 78,60 79,58 77,57 79,57"
                    fill="#2d3748"
                    opacity="0.8"
                />
            </g>
        </svg>
    );
}
