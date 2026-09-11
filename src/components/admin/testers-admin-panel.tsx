import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import TesterRoleRow from "./tester-role-row";

/**
 * `/admin/testers` — every account and whether it may give a Verdict
 * (issue #3402, PRD #3397, ADR 0124 §1).
 *
 * A Verdict is "the Bot should have played X here", and it feeds a fit of the
 * evaluation's weights: the role exists because whose judgement is worth
 * fitting to is a decision somebody has to make on purpose. It is granted from
 * here and nowhere else, which is the same gate that scopes the scenario
 * library to admins.
 *
 * Renders nothing new for a regular player — the whole `/admin` section is
 * behind `AdminRouteGate` (`canViewAdminSection`), and `listUserRoles` /
 * `setTesterRole` are `assertIsAdmin`-gated server-side regardless.
 */
export default function TestersAdminPanel() {
    const rows = useQuery(api.users.listUserRoles, {});
    const testers = rows?.filter((row) => row.isTester).length ?? 0;

    return (
        <Panel>
            <PanelHeader
                title="Accounts"
                subtitle={
                    rows === undefined
                        ? "Loading…"
                        : `${testers} of ${rows.length} may give Verdicts`
                }
            />
            <PanelBody className="flex flex-col gap-2">
                {rows === undefined ? (
                    <span className="text-xs text-text-disabled">Loading…</span>
                ) : rows.length === 0 ? (
                    <span className="text-xs text-text-disabled">
                        No accounts on this deployment
                    </span>
                ) : (
                    rows.map((row) => <TesterRoleRow key={row._id} row={row} />)
                )}
            </PanelBody>
        </Panel>
    );
}
