import type { LobbyModeKey, LobbyModeTile as Tile } from "~/lib/lobbyModes";
import LobbyModeTile from "./lobby-mode-tile";

interface LobbyModeTilesProps {
    tiles: Tile[];
    selected: LobbyModeKey;
    onSelect: (key: LobbyModeKey) => void;
}

/**
 * The Mode Tile grid (ADR 0103 §6, issue #2726) — the lobby's headline: what
 * you can start, as pictures, at a glance.
 *
 * Two columns from `sm:` up (2×2 for the Arena set, 2+1 for the Cockatrice
 * set), one column below it — the phone band the shell already switches on at
 * 767px (`useViewportMode`'s `PORTRAIT_QUERY`), where the destinations sit in
 * `AppBottomNav` under the thumb and a two-up art tile would be ~180px wide.
 * The tiles stretch to fill whatever height the row gives them, so on desktop
 * the grid is as tall as the Loadout column beside it instead of leaving a
 * band of empty ground under either one.
 */
export default function LobbyModeTiles({
    tiles,
    selected,
    onSelect,
}: LobbyModeTilesProps) {
    return (
        <div
            aria-label="Game modes"
            role="group"
            className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2"
        >
            {tiles.map((tile) => (
                <LobbyModeTile
                    key={tile.key}
                    tile={tile}
                    selected={tile.key === selected}
                    onSelect={() => onSelect(tile.key)}
                />
            ))}
        </div>
    );
}
