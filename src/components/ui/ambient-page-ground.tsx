import { useState } from "react";

/** Fantasy art pool shipped from `public/img/lobby-bg/`. Shared by every
 *  surface that uses the ambient ground (Battlefield, Lobby, auth screens).
 *  One frame is picked per mount so a screen feels tied to a scene without the
 *  cost of bundling the images. */
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

interface AmbientPageGroundProps {
    /** Render the faint arcane sigil ring layer. Defaults to `true` (the
     *  Battlefield look); the Lobby/auth screens keep it on for coherence. */
    ring?: boolean;
}

/** Shared ambient **page ground** — the atmospheric backdrop generalised from
 *  the Battlefield recipe (`board-background.tsx`, #249) so the Lobby and other
 *  pages share one ambient-vs-signal split (PRD #589, issue #596).
 *
 *  Purely presentational: a stack of absolutely-positioned,
 *  `pointer-events-none` layers painted *behind* the opaque signal panels.
 *  Every tint is derived from the live semantic accent tokens via `color-mix`,
 *  so a theme swap re-grades the whole atmosphere with zero edits here
 *  (ADR 0007 — semantic, theme-swappable):
 *
 *    1. base       — a vertical depth gradient from `surface-base`
 *    2. glow-warm   — a large soft glow tinted from `accent` (warm gold)
 *    3. glow-cool   — a cooler counter-glow tinted from `secondary-accent`
 *    4. ring        — a faint static arcane sigil (optional)
 *    5. image       — a lobby art frame, heavily diluted + colour-graded down
 *    6. grain       — an inline SVG noise tile to kill banding
 *    7. vignette    — darkens the edges to keep focus on the content
 *
 *  **Micro-motion** (#598) lives on three layers and is gated entirely in CSS
 *  behind `prefers-reduced-motion: no-preference` (`index.css`): the warm/cool
 *  glows "breathe" (`data-ambient-glow`), the art slowly drifts with a Ken-Burns
 *  zoom/pan (`data-ambient-art`). With reduced motion requested every layer is
 *  static. All animation is transform/opacity only — no layout shift. The whole
 *  stack is inert to pointer events so it never intercepts the foreground. */
export default function AmbientPageGround({
    ring = true,
}: AmbientPageGroundProps) {
    const [imageSrc] = useState(pickRandom);

    return (
        <div
            data-ambient-ground
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden"
        >
            {/* 1. base depth gradient — anchored on the darkest surface token */}
            <div
                className="absolute inset-0"
                style={{
                    background:
                        "radial-gradient(120% 90% at 50% 22%, color-mix(in oklab, var(--color-surface-base) 86%, var(--color-accent) 5%) 0%, var(--color-surface-base) 58%, #000 100%)",
                }}
            />

            {/* 2. warm glow from the top, tinted from the accent token. No blur
                filter — the radial-gradient is already feathered. It "breathes"
                (scale + opacity) under prefers-reduced-motion: no-preference,
                via the ambientBreath keyframe (#598). `--amb-tx` hands the
                keyframe the horizontal translate so it preserves the centring. */}
            <div
                data-ambient-glow="warm"
                className="absolute -top-1/4 left-1/2 h-[80vmax] w-[80vmax] -translate-x-1/2 rounded-full"
                style={{
                    ["--amb-tx" as string]: "-50%",
                    background:
                        "radial-gradient(circle, color-mix(in oklab, var(--color-accent) 16%, transparent) 0%, color-mix(in oklab, var(--color-accent-soft) 10%, transparent) 38%, transparent 68%)",
                }}
            />

            {/* 3. cool counter-glow from the bottom, tinted from the secondary
                accent token. Breathes on a longer, phase-offset period than the
                warm glow so the two never pulse in lockstep (#598). */}
            <div
                data-ambient-glow="cool"
                className="absolute -bottom-1/3 left-1/2 h-[70vmax] w-[70vmax] -translate-x-1/2 rounded-full"
                style={{
                    ["--amb-tx" as string]: "-50%",
                    background:
                        "radial-gradient(circle, color-mix(in oklab, var(--color-secondary-accent) 14%, transparent) 0%, color-mix(in oklab, var(--color-secondary-accent-soft) 9%, transparent) 40%, transparent 70%)",
                }}
            />

            {/* 4. faint static arcane ring (optional) */}
            {ring && (
                <div
                    className="absolute left-1/2 top-1/2 h-[120vmin] w-[120vmin] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.04]"
                    style={{
                        background:
                            "conic-gradient(from 0deg, transparent 0deg, color-mix(in oklab, var(--color-accent-strong) 70%, transparent) 8deg, transparent 22deg, transparent 180deg, color-mix(in oklab, var(--color-secondary-accent-strong) 60%, transparent) 188deg, transparent 205deg, transparent 360deg)",
                        maskImage:
                            "radial-gradient(circle, transparent 56%, #000 57%, #000 60%, transparent 61%)",
                        WebkitMaskImage:
                            "radial-gradient(circle, transparent 56%, #000 57%, #000 60%, transparent 61%)",
                    }}
                />
            )}

            {/* 5. lobby art frame — heavily diluted and graded down (low
                opacity + reduced saturation/brightness) so it reads as faint
                atmosphere, not a photo. Drifts with a slow Ken-Burns zoom/pan
                under prefers-reduced-motion: no-preference (#598); it stays at
                its baseline scale when reduced motion is requested. */}
            <img
                data-ambient-art
                src={imageSrc}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full select-none object-cover opacity-[0.08]"
                style={{ filter: "saturate(0.45) brightness(0.6)" }}
            />

            {/* 6. grain overlay — inline SVG fractal noise */}
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
