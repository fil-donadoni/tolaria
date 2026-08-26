import type { LobbyModeTile as LobbyModeTileSpec } from "~/lib/lobbyModes";
import { cn } from "~/lib/utils";

interface LobbyModeTileProps {
    tile: LobbyModeTileSpec;
    selected: boolean;
    onSelect: () => void;
}

/**
 * One art-backed Mode Tile (ADR 0103 §6, issue #2726).
 *
 * A toggle button, not a link and not a launcher: picking a tile SELECTS the
 * mode, it does not start anything. The single ivory primary action lives in
 * the Loadout beside it and takes this tile's title as its name, so there is
 * exactly one "go" affordance on the whole surface instead of the four
 * competing plates the v3 Play box carried.
 *
 * `aria-pressed` rather than `role="radio"`: the tile set is a toggle group
 * whose members render conditionally (the Arena/Cockatrice split), and a
 * radiogroup whose membership changes under the user is a worse promise than a
 * pressed-state button group. The accessible name is the tile's own visible
 * text (chip + title + line) — no `aria-label` that could drift from it.
 *
 * The art is `aria-hidden` decoration drawn from the LOCAL ambient frames, so
 * it is deterministic offline and the ui-gate card probe excludes it
 * (`scripts/ui-gate/probe.js` `isDecorativeArt`) instead of scoring a
 * background as an occluded card.
 */
export default function LobbyModeTile({
    tile,
    selected,
    onSelect,
}: LobbyModeTileProps) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            data-mode-tile={tile.key}
            onClick={onSelect}
            className={cn(
                "group relative isolate flex min-h-[7.5rem] flex-col justify-end overflow-hidden rounded-[var(--panel-radius)] border text-left transition",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                // The resting edge is `border-strong`, NOT the decorative
                // `--hairline` pair the ADR's prose names for panels
                // (`.btn-base` in `src/index.css`; #2847 round-3). Worth the
                // argument, because an art-backed tile LOOKS like the one case
                // where the frame is decoration around a picture: the art would
                // bound the control and the hairline would only refine it.
                // It does not. The overlay gradient below ends at
                // `rgba(0,0,0,0.86)`, which composites to about `rgb(18,18,18)`
                // over mid-art — roughly 1.2-1.4:1 against the `surface` panel
                // ground (#14171c, L=0.0085). So across the whole bottom of the
                // tile, exactly where the chip/title/line sit, the art supplies
                // NO boundary and the border is the sole bound, which is the
                // condition `.segment-pill`'s comment states: where a hairline
                // is the only thing bounding a control, it is not decoration.
                // `--color-border-strong` is 3.38:1 there, and stays plainly
                // distinct from the selected state's ivory `--color-accent`
                // (#6f6b62 vs #efe9da, plus the 3px accent ring), so the
                // pressed/unpressed reading is unaffected. Same treatment as
                // the sibling `deck-shelf-tile.tsx` and `draft-lab-seat-card`.
                selected
                    ? "border-accent shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_16%,transparent)]"
                    : "border-border-strong hover:border-accent/60"
            )}
        >
            <img
                src={tile.art}
                alt=""
                aria-hidden
                draggable={false}
                className={cn(
                    "absolute inset-0 -z-10 h-full w-full select-none object-cover object-[50%_30%] transition",
                    selected
                        ? "opacity-100"
                        : "opacity-80 group-hover:opacity-100"
                )}
                style={{ filter: selected ? undefined : "saturate(0.85)" }}
            />
            <span
                aria-hidden
                className="absolute inset-0 -z-10"
                style={{
                    background:
                        "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.24) 40%, rgba(0,0,0,0.86) 100%), linear-gradient(90deg, rgba(0,0,0,0.38), transparent 55%)",
                }}
            />
            <span className="flex flex-col items-start gap-1 p-4">
                <span className="rounded-sm border border-[var(--hairline-strong)] bg-surface-base/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-parchment">
                    {tile.chip}
                </span>
                <span className="text-display text-2xl leading-none text-parchment drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">
                    {tile.title}
                </span>
                <span className="text-xs text-text-muted">{tile.line}</span>
            </span>
        </button>
    );
}
