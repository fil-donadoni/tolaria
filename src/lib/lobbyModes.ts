// The lobby's Mode Tiles (ADR 0103 §6, issue #2726) — the four art-backed
// entry points a game main menu opens on, and the single fact that names the
// Loadout's one ivory primary action.
//
// This module is DATA, deliberately: the tile a player picks decides what the
// primary action says AND which mutation it runs, and those two must never
// drift apart. Keeping the descriptor list here (rather than inline in the
// tile grid) is what lets `lobby.tsx` dispatch on `key` exhaustively and lets
// the whole mapping be unit-tested without a DOM.
//
// The mode SET is swapped by the Arena/Cockatrice game-mode selector (ADR 0101
// §10, issue #2591), not merely gated per tile: a Manual table has no "Play vs
// Bot" and no "Solo game", so those tiles do not render at all in Cockatrice
// mode — "not offered" means absent from the DOM, the same contract the
// pre-#2726 Play box action set held.
import type { PlayMode } from "./session";

/** Every Mode Tile the lobby can offer, across both game modes. */
export type LobbyModeKey = "bot" | "solo" | "table" | "manual-solo" | "limited";

export interface LobbyModeTile {
    key: LobbyModeKey;
    /** The tile's title AND the name the Loadout's primary action takes
     *  (acceptance criterion #3: "mode tile selection renames the primary
     *  action"). One string, so the two can never disagree. */
    title: string;
    /** One line of supporting copy under the title. */
    line: string;
    /** Small eyebrow chip on the tile. Dynamic for the two tiles that have a
     *  live number to show (difficulty, open Limited events). */
    chip: string;
    /** Local ambient frame painted behind the tile. Local, not Scryfall: the
     *  tile art must be deterministic and offline (the ui-gate probe excludes
     *  it either way — it is `aria-hidden` decoration, see
     *  `scripts/ui-gate/probe.js` `isDecorativeArt`). */
    art: string;
    /** Whether the tile's primary action needs a selected, legal, mode-matching
     *  deck. Limited does not — its action is a navigation to `/limited`, and
     *  gating it behind the deck picker would make the Limited entry point
     *  unreachable for a player with no Constructed deck at all. */
    needsDeck: boolean;
}

const ART = {
    bot: "/img/lobby-bg/05.webp",
    solo: "/img/lobby-bg/02.webp",
    table: "/img/lobby-bg/03.webp",
    manualSolo: "/img/lobby-bg/07.webp",
    limited: "/img/lobby-bg/06.webp",
} as const;

const DIFFICULTY_LABEL: Record<string, string> = {
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
};

export interface LobbyModeInputs {
    mode: PlayMode;
    /** Chosen vs-Bot difficulty — surfaced on the Bot tile's chip so the
     *  setting is legible before the setup dialog is opened. */
    difficulty: string;
    /** Open (joinable) Limited events, for the Limited tile's chip. */
    liveLimitedEvents: number;
}

/**
 * The Mode Tiles for one game mode, in render order.
 *
 * Arena: Play vs Bot · Solo game · Open a table · Limited (the four ADR 0103
 * §6 names). Cockatrice: Solo table · Open a table · Limited — a Manual table
 * has no engine bot and no engine solo game (ADR 0080), so those two tiles are
 * replaced by the one Manual solo entry point rather than shown disabled.
 */
export function lobbyModeTiles({
    mode,
    difficulty,
    liveLimitedEvents,
}: LobbyModeInputs): LobbyModeTile[] {
    const limited: LobbyModeTile = {
        key: "limited",
        title: "Limited",
        line: "Draft · Sealed · Cube",
        chip:
            liveLimitedEvents > 0
                ? `${liveLimitedEvents} open`
                : "Draft · Sealed",
        art: ART.limited,
        needsDeck: false,
    };
    const table: LobbyModeTile = {
        key: "table",
        title: "Open a table",
        line: "Host a seat · share a code",
        chip: "2 players",
        art: ART.table,
        needsDeck: true,
    };

    if (mode === "cockatrice") {
        return [
            {
                key: "manual-solo",
                title: "Solo table",
                line: "Both seats · no rules enforced",
                chip: "Cockatrice",
                art: ART.manualSolo,
                needsDeck: true,
            },
            table,
            limited,
        ];
    }

    return [
        {
            key: "bot",
            title: "Play vs Bot",
            line: "One match against the engine",
            chip: DIFFICULTY_LABEL[difficulty] ?? "Bot",
            art: ART.bot,
            needsDeck: true,
        },
        {
            key: "solo",
            title: "Solo game",
            line: "Both seats · study lines",
            chip: "Sandbox",
            art: ART.solo,
            needsDeck: true,
        },
        table,
        limited,
    ];
}

/**
 * The tile a given key resolves to inside `tiles`, falling back to the FIRST
 * tile of the set.
 *
 * The fallback is the whole point: the selected key is lobby state that
 * survives a game-mode toggle, so `"bot"` can be selected when the Cockatrice
 * set is on screen. Resolving to the first offered tile keeps the Loadout's
 * primary action naming and dispatching one of the tiles actually rendered,
 * rather than an action the tile grid never offered.
 */
export function resolveLobbyMode(
    tiles: LobbyModeTile[],
    key: LobbyModeKey
): LobbyModeTile {
    return tiles.find((t) => t.key === key) ?? tiles[0];
}
