import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { LogOut } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import CornerFiligreeFrame from "~/components/ui/corner-filigree-frame";
import OrnamentalDivider from "~/components/ui/ornamental-divider";

const NICKNAME_MIN = 1;
const NICKNAME_MAX = 32;

/** Ornate Lobby app-bar (PRD #589, issue #600): a brand wordmark, the player
 *  profile (nickname + email, inline-editable) and sign-out, framed by the
 *  shared SVG corner filigree and closed with an ornamental divider — the same
 *  chrome language as the panels. */
export default function DashboardTopBar() {
    const user = useCurrentUser();
    const { signOut } = useAuthActions();
    const updateNickname = useMutation(api.users.updateNickname);
    const [editing, setEditing] = useState(false);
    const [nickname, setNickname] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [signingOut, setSigningOut] = useState(false);

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

    const handleSignOut = async () => {
        if (signingOut) return;
        setSigningOut(true);
        try {
            await signOut();
        } finally {
            setSigningOut(false);
        }
    };

    const initial = user.nickname.charAt(0).toUpperCase();

    return (
        <div className="panel-physical relative rounded-md border border-border-subtle">
            <CornerFiligreeFrame overlay size={32} subtle />
            <div className="flex flex-col items-center justify-between gap-4 px-5 py-3 md:flex-row">
                <span className="font-beleren text-2xl tracking-[0.22em] text-accent-strong">
                    TOLARIA
                </span>

                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-base font-bold text-surface-base">
                        {initial}
                    </div>
                    {editing ? (
                        <form
                            onSubmit={submit}
                            className="flex items-center gap-2"
                        >
                            <Input
                                value={nickname}
                                onChange={(e) =>
                                    setNickname(e.currentTarget.value)
                                }
                                maxLength={NICKNAME_MAX}
                                autoFocus
                                className="h-8 w-48"
                            />
                            <Button
                                type="submit"
                                variant="primary"
                                size="sm"
                                disabled={saving}
                            >
                                {saving ? "Saving…" : "Save"}
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
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
                            <Button
                                type="button"
                                variant="link"
                                size="xs"
                                onClick={startEdit}
                                className="text-left text-sm font-semibold text-parchment"
                                title="Edit nickname"
                            >
                                {user.nickname}
                            </Button>
                            <span className="text-xs text-text-muted">
                                {user.email}
                            </span>
                        </div>
                    )}
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleSignOut()}
                        disabled={signingOut}
                        title="Sign out"
                    >
                        <LogOut className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">
                            {signingOut ? "Signing out…" : "Sign out"}
                        </span>
                    </Button>
                </div>
            </div>
            <OrnamentalDivider className="px-5 pb-2" />
        </div>
    );
}
