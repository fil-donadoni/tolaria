import { useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Swords } from "lucide-react";
import {
    Panel,
    PanelHeader,
    PanelBody,
    PanelFooter,
} from "~/components/ui/panel";
import { Banner } from "~/components/ui/banner";
import { Button } from "~/components/ui/button";
import LobbyBackground from "~/components/lobby/lobby-background";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";
import { friendlyAuthError } from "~/lib/auth-errors";
import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * The credentials flows this component owns. `"forgotPassword"` is not one of
 * them — it is a third MODE, handed off wholesale to `<ForgotPasswordForm>`,
 * which drives the provider's own `reset` / `reset-verification` flows.
 */
type Flow = "signIn" | "signUp";
type Mode = Flow | "forgotPassword";

const NICKNAME_MIN = 1;
const NICKNAME_MAX = 32;
const PASSWORD_MIN = 8;

export function AuthForm() {
    const { signIn } = useAuthActions();
    const [mode, setMode] = useState<Mode>("signIn");
    // Narrowed for everything below the reset branch, which returns early.
    const flow: Flow = mode === "forgotPassword" ? "signIn" : mode;
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [nickname, setNickname] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // The auth screen replaces the whole app (`AuthGate`), so it is a page in
    // its own right — no route ever mounts underneath it to name the tab.
    // It names the tab for the reset mode too: React runs a parent's effects
    // AFTER its children's, so a title set inside `<ForgotPasswordForm>` would
    // be overwritten by this one on every render (see `useDocumentTitle`).
    useDocumentTitle(
        mode === "forgotPassword"
            ? "Reset Password"
            : mode === "signIn"
              ? "Sign In"
              : "Create Account"
    );

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);

        const trimmedEmail = email.trim().toLowerCase();
        if (!trimmedEmail) {
            setError("Email is required");
            return;
        }
        if (password.length < PASSWORD_MIN) {
            setError(`Password must be at least ${PASSWORD_MIN} characters`);
            return;
        }
        if (flow === "signUp") {
            const trimmedNickname = nickname.trim();
            if (
                trimmedNickname.length < NICKNAME_MIN ||
                trimmedNickname.length > NICKNAME_MAX
            ) {
                setError(
                    `Nickname must be ${NICKNAME_MIN}-${NICKNAME_MAX} characters`
                );
                return;
            }
        }

        setSubmitting(true);
        try {
            const params: Record<string, string> = {
                email: trimmedEmail,
                password,
                flow,
            };
            if (flow === "signUp") {
                params.nickname = nickname.trim();
            }
            await signIn("password", params);
        } catch (err) {
            setError(friendlyAuthError(err, flow));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        // `overflow-y-auto` + `my-auto` on the panel, NOT `items-center` +
        // `overflow-hidden`: a flex item centred on the cross axis and taller
        // than its container overflows EQUALLY in both directions, and the
        // half above the scroll origin is unreachable by any gesture. The
        // ui-gate probe caught it as `ctrlsStranded 1` at 844x390 — the
        // sign-in panel's footer links, off the bottom of a landscape phone
        // with nothing to scroll. An auto cross-axis margin centres the same
        // way while leaving the overflow scrollable. The ambient art clips
        // itself (`ambient-page-ground.tsx` is `absolute inset-0
        // overflow-hidden`), so nothing needed the clip here.
        //
        // `h-svh`, not `min-h-svh`: a min-height box GROWS past the viewport
        // instead of scrolling, which hands the scroll to the document. This
        // screen renders outside `<AppShell>`, so there is no `<main>`
        // scroller above it to inherit — the container has to BE the scroll
        // port, or the overflow has none.
        <div className="relative flex h-svh justify-center overflow-x-hidden overflow-y-auto bg-surface-base p-6">
            <LobbyBackground />
            {mode === "forgotPassword" ? (
                <ForgotPasswordForm onCancel={() => setMode("signIn")} />
            ) : (
                <form
                    onSubmit={submit}
                    className="relative z-10 my-auto w-full max-w-sm"
                >
                    <Panel tone="accent">
                        <PanelHeader
                            title={
                                flow === "signIn" ? "Sign In" : "Create Account"
                            }
                            subtitle={
                                flow === "signIn"
                                    ? "Welcome back to Tolaria."
                                    : "Pick a nickname — you can change it later."
                            }
                            icon={<Swords className="h-6 w-6 text-accent" />}
                        />
                        <PanelBody>
                            <label className="flex flex-col gap-1.5">
                                <span className="text-label">Email</span>
                                <input
                                    type="email"
                                    autoComplete="email"
                                    required
                                    value={email}
                                    onChange={(e) =>
                                        setEmail(e.currentTarget.value)
                                    }
                                    className="input-field"
                                />
                            </label>

                            <label className="flex flex-col gap-1.5">
                                <span className="text-label">Password</span>
                                <input
                                    type="password"
                                    autoComplete={
                                        flow === "signIn"
                                            ? "current-password"
                                            : "new-password"
                                    }
                                    required
                                    value={password}
                                    onChange={(e) =>
                                        setPassword(e.currentTarget.value)
                                    }
                                    className="input-field"
                                />
                            </label>

                            {flow === "signUp" && (
                                <label className="flex flex-col gap-1.5">
                                    <span className="text-label">Nickname</span>
                                    <input
                                        type="text"
                                        autoComplete="nickname"
                                        required
                                        maxLength={NICKNAME_MAX}
                                        value={nickname}
                                        onChange={(e) =>
                                            setNickname(e.currentTarget.value)
                                        }
                                        className="input-field"
                                    />
                                </label>
                            )}

                            {error && (
                                <Banner tone="danger" role="alert">
                                    {error}
                                </Banner>
                            )}
                        </PanelBody>
                        {/* `stack`, not the responsive default: the flow toggle
                        is a secondary link that belongs on its own line under
                        the CTA at every width. */}
                        <PanelFooter layout="stack">
                            <Button
                                type="submit"
                                variant="primary"
                                size="lg"
                                disabled={submitting}
                                className="w-full"
                            >
                                {submitting
                                    ? "Working…"
                                    : flow === "signIn"
                                      ? "Sign In"
                                      : "Create Account"}
                            </Button>
                            <button
                                type="button"
                                className="mt-1 min-h-11 text-center text-sm text-text-muted transition-colors hover:text-parchment"
                                onClick={() => {
                                    setError(null);
                                    setMode(
                                        flow === "signIn" ? "signUp" : "signIn"
                                    );
                                }}
                            >
                                {flow === "signIn"
                                    ? "No account? Sign up"
                                    : "Already have an account? Sign in"}
                            </button>
                            {flow === "signIn" && (
                                <button
                                    type="button"
                                    className="mt-1 min-h-11 text-center text-sm text-text-muted transition-colors hover:text-parchment"
                                    onClick={() => {
                                        setError(null);
                                        setMode("forgotPassword");
                                    }}
                                >
                                    Forgot password?
                                </button>
                            )}
                        </PanelFooter>
                    </Panel>
                </form>
            )}
        </div>
    );
}
