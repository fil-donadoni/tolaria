import { useState } from "react";

/** Shared with the lobby (`lobby-background.tsx`) — the same fantasy art pool
 *  ships from `public/img/lobby-bg/`. One is picked per mount so a match feels
 *  tied to a scene without the cost of bundling the images. */
const BG_IMAGES = [
    "/img/lobby-bg/01.webp",
    "/img/lobby-bg/02.webp",
    "/img/lobby-bg/03.webp",
    "/img/lobby-bg/04.webp",
    "/img/lobby-bg/05.webp",
    "/img/lobby-bg/06.webp",
    "/img/lobby-bg/07.webp",
    "/img/lobby-bg/08.webp",
];

function pickRandom() {
    return BG_IMAGES[Math.floor(Math.random() * BG_IMAGES.length)];
}

/** Ambient board background — purely presentational, no canvas (#249 board).
 *
 *  A stack of absolutely-positioned, `pointer-events-none` layers painted
 *  behind every board zone. The look leans on the existing BotW design tokens
 *  (deep `surface` base, warm `accent` gold, cool `secondary-accent` teal) so
 *  it stays coherent with the rest of the UI rather than introducing new hues:
 *
 *    1. base       — a vertical depth gradient anchoring the scene
 *    2. glow-warm  — a large soft gold light from the top
 *    3. glow-cool  — a cooler teal counter-glow from the bottom
 *    4. ring       — a faint static arcane sigil
 *    5. image      — a lobby art frame, heavily diluted + colour-graded down
 *    6. grain      — an inline SVG noise tile to kill banding
 *    7. vignette   — darkens the edges to keep focus on the play area
 *
 *  Fully static (no motion): a slow pan of these large layers read as judder
 *  on some displays even while composited at 60fps, so the ambience is held
 *  still. The whole thing is inert to pointer events so it never interferes
 *  with card interaction. */
export default function BoardBackground() {
    const [imageSrc] = useState(pickRandom);

    return (
        <div
            data-board-bg
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden"
        >
            {/* 1. base depth gradient */}
            <div
                className="absolute inset-0"
                style={{
                    background:
                        "radial-gradient(120% 90% at 50% 22%, #15161f 0%, #0c0d12 52%, #07070b 100%)",
                }}
            />

            {/* 2. warm gold glow from the top. No blur filter — the
                radial-gradient is already feathered. */}
            <div
                className="absolute -top-1/4 left-1/2 h-[80vmax] w-[80vmax] -translate-x-1/2 rounded-full"
                style={{
                    background:
                        "radial-gradient(circle, rgba(200,160,96,0.14) 0%, rgba(122,90,46,0.07) 38%, transparent 68%)",
                }}
            />

            {/* 3. cool teal counter-glow from the bottom */}
            <div
                className="absolute -bottom-1/3 left-1/2 h-[70vmax] w-[70vmax] -translate-x-1/2 rounded-full"
                style={{
                    background:
                        "radial-gradient(circle, rgba(90,122,138,0.12) 0%, rgba(46,68,80,0.06) 40%, transparent 70%)",
                }}
            />

            {/* 4. faint static arcane ring */}
            <div
                className="absolute left-1/2 top-1/2 h-[120vmin] w-[120vmin] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.04]"
                style={{
                    background:
                        "conic-gradient(from 0deg, transparent 0deg, rgba(224,192,138,0.6) 8deg, transparent 22deg, transparent 180deg, rgba(140,176,196,0.5) 188deg, transparent 205deg, transparent 360deg)",
                    maskImage:
                        "radial-gradient(circle, transparent 56%, #000 57%, #000 60%, transparent 61%)",
                    WebkitMaskImage:
                        "radial-gradient(circle, transparent 56%, #000 57%, #000 60%, transparent 61%)",
                }}
            />

            {/* 5. lobby art frame — heavily diluted and graded down (low
                opacity + reduced saturation/brightness) so it reads as faint
                atmosphere, not a photo. Static. */}
            <img
                src={imageSrc}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full select-none object-cover opacity-[0.08]"
                style={{ filter: "saturate(0.45) brightness(0.6)" }}
            />

            {/* 6. grain overlay — inline SVG fractal noise, blended soft-light */}
            <div
                className="absolute inset-0 opacity-[0.05]"
                style={{
                    backgroundImage:
                        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
                }}
            />

            {/* 7. vignette */}
            <div
                className="absolute inset-0"
                style={{
                    background:
                        "radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.45) 100%)",
                }}
            />
        </div>
    );
}
