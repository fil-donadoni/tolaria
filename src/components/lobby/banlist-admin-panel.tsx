import { useCurrentUser } from "~/hooks/useCurrentUser";
import { canEditPresets } from "~/lib/adminGating";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import BanlistFormatSyncRow from "./banlist-format-sync-row";

// The two Formats a DB-backed official banlist exists for (PRD #1138), same
// local literal set `DeckBanlistPanel` uses — `BanlistFormatId` isn't
// exported for frontend consumption (`convex/formats.ts`).
const BANLIST_FORMATS: readonly { id: "premodern" | "old-school"; label: string }[] =
    [
        { id: "premodern", label: "Premodern" },
        { id: "old-school", label: "Old School" },
    ];

/**
 * Admin-only Scryfall banlist sync control (PRD #1138 User Stories 5-9, issue
 * #1146). Self-gated on `canEditPresets` (the same admin predicate the
 * Lobby's Preset Deck controls use, ADR 0033) — renders nothing for a
 * non-admin or a still-loading user, so it can be dropped into the Lobby
 * without the caller threading admin state through. Hiding it here is
 * cosmetic only: the underlying `syncBanlist` action rejects a non-admin
 * caller server-side regardless (`assertIsAdmin` via `requireAdminQuery`,
 * `convex/banlistSync.ts`).
 */
export default function BanlistAdminPanel() {
    const user = useCurrentUser();
    if (!canEditPresets(user)) return null;

    return (
        <Panel>
            <PanelHeader
                title="Banlist Sync"
                subtitle="Admin only — pull official banned/restricted lists from Scryfall"
            />
            <PanelBody>
                {BANLIST_FORMATS.map((format) => (
                    <BanlistFormatSyncRow
                        key={format.id}
                        format={format.id}
                        label={format.label}
                    />
                ))}
            </PanelBody>
        </Panel>
    );
}
