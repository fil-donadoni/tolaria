/** Graveyard zone glyph (tombstone) for the card piles (PRD #249). Full-colour
 *  decorative icon — its fills are fixed (not `currentColor`), so text-colour
 *  utilities don't tint it; size it via `className` (e.g. `w-7 h-7`). */
export default function GraveyardIcon({ className }: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 100 100"
            className={className}
            aria-hidden
        >
            <g fill="none" stroke="none">
                {/* Stylised grass / ground base */}
                <path
                    d="M20,85 C35,83 65,83 80,85 L80,90 L20,90 Z"
                    fill="#2d3748"
                />
                {/* Tombstone shadow */}
                <path
                    d="M25,85 L75,85 L70,80 L30,80 Z"
                    fill="#1a202c"
                    opacity="0.4"
                />
                {/* Tombstone body (shadow side / thickness) */}
                <path d="M25,85 L33,40 L50,20 L67,40 L75,85 Z" fill="#4a5568" />
                {/* Tombstone body (main face) */}
                <path d="M28,85 L35,42 L50,23 L65,42 L72,85 Z" fill="#718096" />
                {/* Geometric fantasy bevels on the stone */}
                <path
                    d="M50,23 L50,85"
                    stroke="#4a5568"
                    strokeWidth="0.5"
                    opacity="0.3"
                />
                <path
                    d="M35,42 L65,42"
                    stroke="#4a5568"
                    strokeWidth="0.5"
                    opacity="0.3"
                />
                {/* Minimal geometric cracks */}
                <path
                    d="M35,42 L42,48 L40,55"
                    stroke="#2d3748"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <path
                    d="M72,70 L65,73 L67,80"
                    stroke="#2d3748"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                {/* Geometric grass tufts at the base */}
                <path d="M22,85 L25,75 L29,85" fill="#4a5568" />
                <path d="M73,85 L78,73 L82,85" fill="#4a5568" />
                <path d="M26,85 L31,70 L35,85" fill="#2d3748" />
                <path d="M66,85 L71,68 L75,85" fill="#2d3748" />
            </g>
        </svg>
    );
}
