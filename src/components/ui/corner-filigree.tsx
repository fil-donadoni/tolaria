// SVG corner filigree (Troy / Bayonetta scrollwork): an L anchor with feathered
// tendrils ending in dots + a corner stud. One path designed for top-left,
// rotated per corner. Colour = the accent token. Replaces the old 1px corner
// brackets on Panel (issue #595).

type Corner = "tl" | "tr" | "br" | "bl";

const ROTATION: Record<Corner, string> = {
    tl: "rotate(0deg)",
    tr: "rotate(90deg)",
    br: "rotate(180deg)",
    bl: "rotate(270deg)",
};

export default function CornerFiligree({
    corner,
    size = 40,
    subtle = false,
}: {
    corner: Corner;
    size?: number;
    subtle?: boolean;
}) {
    return (
        <svg
            data-slot="corner-filigree"
            data-corner={corner}
            width={size}
            height={size}
            viewBox="0 0 44 44"
            fill="none"
            aria-hidden
            className={`pointer-events-none absolute text-accent ${
                subtle ? "opacity-55" : ""
            }`}
            style={{
                filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.85))",
                transform: ROTATION[corner],
                top: corner.startsWith("t") ? 0 : undefined,
                bottom: corner.startsWith("b") ? 0 : undefined,
                left: corner.endsWith("l") ? 0 : undefined,
                right: corner.endsWith("r") ? 0 : undefined,
            }}
        >
            <path
                d="M4 4 L22 4 M4 4 L4 22"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
            <path
                d="M4 13 C4 8 8 4 13 4"
                stroke="currentColor"
                strokeWidth="1"
                opacity="0.85"
            />
            <path
                d="M22 4 C29 4 28 10 34 10"
                stroke="currentColor"
                strokeWidth="1"
                opacity="0.7"
            />
            <path
                d="M4 22 C4 29 10 28 10 34"
                stroke="currentColor"
                strokeWidth="1"
                opacity="0.7"
            />
            <circle cx="34" cy="10" r="1.3" fill="currentColor" />
            <circle cx="10" cy="34" r="1.3" fill="currentColor" />
            <circle cx="4" cy="4" r="2.2" fill="currentColor" />
        </svg>
    );
}

export type { Corner };
