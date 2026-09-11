import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button";

export type UserRoleRow = FunctionReturnType<
    typeof api.users.listUserRoles
>[number];

/**
 * One account in the `/admin/testers` list, with the control that grants or
 * revokes its tester role (issue #3402, PRD #3397).
 *
 * TWO ROLE FACTS, SHOWN SEPARATELY. `testerFlag` is what the button writes;
 * `isTester` is whether the account may actually submit a Verdict, which an
 * admin is regardless of the flag. Binding the button to the effective value
 * would make an admin's row render as granted, write `false`, and render as
 * granted again — a control that looks broken because it is reporting a
 * different question than the one it answers. So the button always states the
 * FLAG, and an admin's row says in words why the flag does not decide.
 *
 * Disabled while the mutation is in flight (project-wide convention for any
 * Convex-firing button).
 */
export default function TesterRoleRow({ row }: { row: UserRoleRow }) {
    const setTesterRole = useMutation(api.users.setTesterRole);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function toggle() {
        if (saving) return;
        setSaving(true);
        setError(null);
        try {
            await setTesterRole({ userId: row._id, isTester: !row.testerFlag });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border-subtle/40 p-3">
            <div className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate text-sm font-semibold text-text">
                    {row.nickname}
                    {row.isAdmin && (
                        <span className="ml-2 text-xs font-normal text-text-muted">
                            admin
                        </span>
                    )}
                </p>
                <p className="truncate text-xs text-text-muted">
                    {row.email ?? "no email on file"}
                </p>
                <p className="text-xs text-text-muted">
                    {row.isAdmin && !row.testerFlag
                        ? "May give Verdicts — every admin is a tester, flag or not"
                        : row.isTester
                          ? "May give Verdicts"
                          : "May not give Verdicts"}
                </p>
                {error && <p className="text-xs text-danger-strong">{error}</p>}
            </div>
            <Button
                type="button"
                variant={row.testerFlag ? "ghost" : "secondary"}
                size="sm"
                onClick={() => void toggle()}
                disabled={saving}
            >
                {saving
                    ? "Saving…"
                    : row.testerFlag
                      ? "Revoke tester"
                      : "Grant tester"}
            </Button>
        </div>
    );
}
