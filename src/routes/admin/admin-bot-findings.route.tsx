// `/admin/bot-findings` — every card the play Bot is known to struggle with
// (issue #4176, PRD #4174, ADR 0141).
import AdminPageFrame from "@/components/admin/admin-page-frame";
import BotFindingsAdminPanel from "@/components/admin/bot-findings-admin-panel";

export default function AdminBotFindingsRoute() {
    return (
        <AdminPageFrame
            title="Bot Findings"
            description="Cards the play Bot does not play, as the last Bot-play sweep measured them (ADR 0141): the Bot Gap class each card is blocked by, what that class means, and whether the Bot or the sweep's own harness owes the fix. A row is a measurement — it changes when the sweep is re-run and re-seeded, never by a click."
        >
            <BotFindingsAdminPanel />
        </AdminPageFrame>
    );
}
