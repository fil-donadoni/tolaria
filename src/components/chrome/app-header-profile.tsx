// The header's right-hand side: avatar, inline-editable nickname, email, and
// sign-out. Extracted verbatim from the old `DashboardTopBar` (PRD #589, issue
// #600) when the lobby's app-bar became the app-wide header — the profile block
// is the half that has its own state (edit mode, validation, in-flight saves),
// so it lives in its own file and `AppHeader` stays layout.
import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, Settings } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

const NICKNAME_MIN = 1;
const NICKNAME_MAX = 32;

export default function AppHeaderProfile() {
    const user = useCurrentUser();
    const navigate = useNavigate();
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
        <div className="flex items-center gap-3 short-viewport:gap-2">
            {/* short-viewport:h-6/w-6 (issue #2056 defect 3 amplification):
                the avatar circle was the tallest element in the nav row
                (40px) — with the two-line nickname+email block below also
                shrunk, this becomes the row's height driver, so it's the one
                that has to shrink for the row to hit the ~40px band budget. */}
            <div className="flex h-10 w-10 short-viewport:h-6 short-viewport:w-6 items-center justify-center rounded-full bg-accent text-base short-viewport:text-xs font-bold text-surface-base">
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
                        className="text-left text-sm short-viewport:text-xs font-semibold text-parchment"
                        title="Edit nickname"
                    >
                        {user.nickname}
                    </Button>
                    {/* short-viewport:hidden (issue #2056 defect 3
                        amplification): the "two-line identity block" the
                        browser measurement called out — with the avatar
                        shrunk to 24px, a still-two-line nickname+email
                        column would become the row's height driver instead.
                        Dropping the second line keeps the row single-line. */}
                    <span className="text-xs text-text-muted short-viewport:hidden">
                        {user.email}
                    </span>
                </div>
            )}
            {/* Settings entry point (issue #2595) — density, motion, phase
                stops, preview default. Kept as a minimal, additive icon-only
                link here rather than a full nav item: #2582's AppShell owns
                `src/components/chrome/**` and is expected to relocate the
                real entry point (bottom nav "Me" on phone, profile menu on
                desktop) once it lands. */}
            {/* min-h-[var(--control-h)] (issue #2595 round-3 fixup): `size="sm"`
                resolves its height off `--control-h-sm`, the DELIBERATELY
                dense rung (`--control-h` minus 4px — 40px on a coarse pointer,
                see `.segment-pill` in index.css) meant for pills and
                secondary controls that are not themselves the touch target.
                Settings and Sign out ARE the touch target here, so they need
                the full pointer-aware rung — same fix EditingActionButton
                already applies (`src/components/editing/editing-action-button.tsx`)
                for the same WCAG 2.5.8 reason. `--control-h` is still the
                token, not a hardcoded 44px, so it stays 32px on a fine
                pointer and only becomes 44px under `@media (pointer:
                coarse)`; the `min-h-[...]` utility here wins over the `sm`
                variant's via `cn()`'s `twMerge` (last conflicting utility
                wins), so the padding/text-size stay at the `sm` rung. */}
            <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-[var(--control-h)] short-viewport:px-1.5 short-viewport:py-0.5"
                onClick={() => void navigate({ to: "/settings" })}
                title="Settings"
            >
                <Settings className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Settings</span>
            </Button>
            <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-[var(--control-h)] short-viewport:px-1.5 short-viewport:py-0.5"
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
    );
}
