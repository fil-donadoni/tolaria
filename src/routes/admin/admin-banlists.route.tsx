// `/admin/banlists` — extracted from the bottom of the Lobby, where it sat
// below the deck panels for every admin on every visit.
import AdminPageFrame from "@/components/admin/admin-page-frame";
import BanlistAdminPanel from "@/components/lobby/banlist-admin-panel";

export default function AdminBanlistsRoute() {
    return (
        <AdminPageFrame
            title="Banlists"
            description="Per-format banned/restricted lists, pulled from Scryfall and reconciled against the card catalogue."
        >
            <BanlistAdminPanel />
        </AdminPageFrame>
    );
}
