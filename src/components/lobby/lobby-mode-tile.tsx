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
                selected
                    ? "border-accent shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_16%,transparent)]"
                    : "border-[var(--hairline)] hover:border-[var(--hairline-strong)]"
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
