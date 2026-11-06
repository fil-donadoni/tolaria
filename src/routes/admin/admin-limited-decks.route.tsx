// `/admin/limited-decks` — the global Limited Deck Archive (PRD #8407, issue
// #8410): every player's Limited decks by Limited Origin. Read-only.
import AdminPageFrame from "@/components/admin/admin-page-frame";
import LimitedDeckArchivePanel from "@/components/admin/limited-deck-archive-panel";

export default function AdminLimitedDecksRoute() {
    return (
        <AdminPageFrame
            title="Limited Decks"
            description="Every Limited deck of every player, grouped by the Limited Origin it was built from; decks with no origin sit in their own group. Open a deck to read its full list. Read-only."
        >
            <LimitedDeckArchivePanel />
        </AdminPageFrame>
    );
}
