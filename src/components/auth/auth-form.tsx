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

type Flow = "signIn" | "signUp";

const NICKNAME_MIN = 1;
const NICKNAME_MAX = 32;
const PASSWORD_MIN = 8;

function friendlyAuthError(err: unknown, flow: Flow): string {
    const raw = err instanceof Error ? err.message : "";
    if (/InvalidAccountId/i.test(raw)) {
        return flow === "signIn"
            ? "Invalid email or password"
            : "Could not create account";
    }
    if (/InvalidSecret|InvalidPassword/i.test(raw)) {
        return "Invalid email or password";
    }
    if (/AccountAlreadyExists|already exists/i.test(raw)) {
        return "An account with this email already exists";
    }
    return flow === "signIn"
        ? "Sign-in failed. Check your credentials and try again."
        : "Sign-up failed. Please try again.";
}

export function AuthForm() {
    const { signIn } = useAuthActions();
    const [flow, setFlow] = useState<Flow>("signIn");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [nickname, setNickname] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // The auth screen replaces the whole app (`AuthGate`), so it is a page in
    // its own right — no route ever mounts underneath it to name the tab.
    useDocumentTitle(flow === "signIn" ? "Sign In" : "Create Account");

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
        <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-surface-base p-6">
            <LobbyBackground />
            <form onSubmit={submit} className="relative z-10 w-full max-w-sm">
                <Panel tone="accent">
                    <PanelHeader
                        title={flow === "signIn" ? "Sign In" : "Create Account"}
                        subtitle={
                            flow === "signIn"
                                ? "Welcome back to Tolaria."
                                : "Pick a nickname — you can change it later."
                        }
                        icon={<Swords className="w-14 h-14 text-accent" />}
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
                    <PanelFooter className="flex-col items-stretch">
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
                            className="text-sm text-text-muted hover:text-parchment transition-colors text-center"
                            onClick={() => {
                                setError(null);
                                setFlow(
                                    flow === "signIn" ? "signUp" : "signIn"
                                );
                            }}
                        >
                            {flow === "signIn"
                                ? "No account? Sign up"
                                : "Already have an account? Sign in"}
                        </button>
                    </PanelFooter>
                </Panel>
            </form>
        </div>
    );
}
