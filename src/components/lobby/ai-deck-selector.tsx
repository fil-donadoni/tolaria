// vs-AI opponent deck picker. Lets the player choose which deck the AI plays
// instead of always mirroring their own (issue: choose AI opponent deck). The
// empty value means "mirror" — `createSoloGame` falls back to the human's deck
// when `deck2` is omitted, so the bot plays the same list.

import type { LobbyDeck } from "~/lib/deckTypes";

const MIRROR_VALUE = "";

export default function AiDeckSelector({
    decks,
    value,
    onChange,
    disabled = false,
}: {
    decks: LobbyDeck[];
    /** Selected opponent deck presetId, or null to mirror the player's deck. */
    value: string | null;
    onChange: (presetId: string | null) => void;
    disabled?: boolean;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                AI Opponent Deck
            </span>
            <select
                aria-label="AI Opponent Deck"
                disabled={disabled}
                value={value ?? MIRROR_VALUE}
                onChange={(e) =>
                    onChange(
                        e.target.value === MIRROR_VALUE ? null : e.target.value
                    )
                }
                className="rounded-sm border border-border-subtle/40 bg-surface-elevated/30 px-3 py-1 text-xs font-medium text-text transition hover:bg-surface-elevated/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
                <option value={MIRROR_VALUE}>Same as your deck (mirror)</option>
                {decks.map((d) => (
                    <option key={d.presetId} value={d.presetId}>
                        {d.name}
                    </option>
                ))}
            </select>
        </label>
    );
}
