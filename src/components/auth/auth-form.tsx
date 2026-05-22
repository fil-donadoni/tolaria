import { useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

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
        <div className="flex min-h-svh items-center justify-center bg-background p-6">
            <form
                onSubmit={submit}
                className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
                <header className="space-y-1">
                    <h1 className="text-xl font-semibold">
                        {flow === "signIn" ? "Sign in" : "Create account"}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {flow === "signIn"
                            ? "Welcome back to Tolaria."
                            : "Pick a nickname — you can change it later."}
                    </p>
                </header>

                <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium">Email</span>
                    <Input
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.currentTarget.value)}
                    />
                </label>

                <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium">Password</span>
                    <Input
                        type="password"
                        autoComplete={
                            flow === "signIn"
                                ? "current-password"
                                : "new-password"
                        }
                        required
                        value={password}
                        onChange={(e) => setPassword(e.currentTarget.value)}
                    />
                </label>

                {flow === "signUp" && (
                    <label className="flex flex-col gap-1.5 text-sm">
                        <span className="font-medium">Nickname</span>
                        <Input
                            type="text"
                            autoComplete="nickname"
                            required
                            maxLength={NICKNAME_MAX}
                            value={nickname}
                            onChange={(e) => setNickname(e.currentTarget.value)}
                        />
                    </label>
                )}

                {error && (
                    <p className="text-sm text-destructive" role="alert">
                        {error}
                    </p>
                )}

                <Button type="submit" disabled={submitting}>
                    {submitting
                        ? "Working…"
                        : flow === "signIn"
                          ? "Sign in"
                          : "Create account"}
                </Button>

                <button
                    type="button"
                    className="text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => {
                        setError(null);
                        setFlow(flow === "signIn" ? "signUp" : "signIn");
                    }}
                >
                    {flow === "signIn"
                        ? "No account? Sign up"
                        : "Already have an account? Sign in"}
                </button>
            </form>
        </div>
    );
}
