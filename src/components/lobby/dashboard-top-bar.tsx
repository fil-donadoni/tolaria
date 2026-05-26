import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Panel } from "~/components/ui/panel";

const NICKNAME_MIN = 1;
const NICKNAME_MAX = 32;

export default function DashboardTopBar() {
    const user = useCurrentUser();
    const { signOut } = useAuthActions();
    const updateNickname = useMutation(api.users.updateNickname);
    const [editing, setEditing] = useState(false);
    const [nickname, setNickname] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    if (!user) return null;

    const startEdit = () => {
        setNickname(user.nickname);
        setError(null);
        setEditing(true);
    };

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        const trimmed = nickname.trim();
        if (trimmed.length < NICKNAME_MIN || trimmed.length > NICKNAME_MAX) {
            setError(
                `Nickname must be ${NICKNAME_MIN}-${NICKNAME_MAX} characters`
            );
            return;
        }
        if (trimmed === user.nickname) {
            setEditing(false);
            return;
        }
        setSaving(true);
        try {
            await updateNickname({ nickname: trimmed });
            setEditing(false);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Failed to update nickname"
            );
        } finally {
            setSaving(false);
        }
    };

    const initial = user.nickname.charAt(0).toUpperCase();

    return (
        <Panel
            density="compact"
            className="flex-row items-center justify-between gap-4"
        >
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-base font-bold text-surface-base">
                    {initial}
                </div>
                {editing ? (
                    <form onSubmit={submit} className="flex items-center gap-2">
                        <Input
                            value={nickname}
                            onChange={(e) => setNickname(e.currentTarget.value)}
                            maxLength={NICKNAME_MAX}
                            autoFocus
                            className="h-8 w-48"
                        />
                        <Button type="submit" size="sm" disabled={saving}>
                            {saving ? "Saving…" : "Save"}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(false)}
                        >
                            Cancel
                        </Button>
                        {error && (
                            <span className="text-xs text-danger-strong">
                                {error}
                            </span>
                        )}
                    </form>
                ) : (
                    <div className="flex flex-col leading-tight">
                        <button
                            type="button"
                            onClick={startEdit}
                            className="text-left text-sm font-semibold text-parchment hover:underline"
                            title="Edit nickname"
                        >
                            {user.nickname}
                        </button>
                        <span className="text-xs text-text-muted">
                            {user.email}
                        </span>
                    </div>
                )}
            </div>
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => signOut()}
            >
                Sign out
            </Button>
        </Panel>
    );
}
