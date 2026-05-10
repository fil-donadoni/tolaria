import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SignOutButton } from "./sign-out-button";

const NICKNAME_MIN = 1;
const NICKNAME_MAX = 32;

export function AccountMenu() {
    const user = useCurrentUser();
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

    return (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 text-sm">
            {editing ? (
                <form onSubmit={submit} className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-muted-foreground">
                            Nickname
                        </span>
                        <Input
                            value={nickname}
                            onChange={(e) => setNickname(e.currentTarget.value)}
                            maxLength={NICKNAME_MAX}
                            autoFocus
                        />
                    </label>
                    {error && (
                        <p className="text-xs text-destructive">{error}</p>
                    )}
                    <div className="flex gap-2">
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
                    </div>
                </form>
            ) : (
                <>
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col">
                            <span className="font-medium">{user.nickname}</span>
                            <span className="text-xs text-muted-foreground">
                                {user.email}
                            </span>
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={startEdit}
                        >
                            Edit nickname
                        </Button>
                    </div>
                    <SignOutButton />
                </>
            )}
        </div>
    );
}
