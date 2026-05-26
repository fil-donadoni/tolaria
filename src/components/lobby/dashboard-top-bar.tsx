import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { Input } from "~/components/ui/input";

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
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-col items-center md:items-start">
                <h1 className="text-3xl font-bold font-beleren tracking-wide text-parchment">
                    Tolaria
                </h1>
            </div>

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
                        <button
                            type="submit"
                            disabled={saving}
                            className="btn-base btn-tone-primary px-3 py-1.5 text-xs disabled:btn-disabled"
                        >
                            {saving ? "Saving…" : "Save"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setEditing(false)}
                            className="btn-base btn-tone-secondary px-3 py-1.5 text-xs"
                        >
                            Cancel
                        </button>
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
                <button
                    type="button"
                    onClick={() => signOut()}
                    className="btn-base btn-tone-secondary px-3 py-1.5 text-xs"
                >
                    Sign out
                </button>
            </div>
        </div>
    );
}
