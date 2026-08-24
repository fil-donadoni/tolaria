import { useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { KeyRound } from "lucide-react";
import {
    Panel,
    PanelHeader,
    PanelBody,
    PanelFooter,
} from "~/components/ui/panel";
import { Banner } from "~/components/ui/banner";
import { Button } from "~/components/ui/button";
import { friendlyAuthError, isUnknownAccountError } from "~/lib/auth-errors";

/**
 * `request` asks for the address; `verify` takes the emailed code plus the new
 * password. Two steps of ONE flow, not two screens — the email typed in the
 * first is what the second submits, and going back re-uses it.
 */
type Step = "request" | "verify";

const PASSWORD_MIN = 8;
/** Kept in sync with `CODE_DIGITS` in `convex/resendOtpPasswordReset.ts`. */
const CODE_LENGTH = 8;

/**
 * The password-reset screen: `flow: "reset"` then `flow: "reset-verification"`
 * against the `Password` provider (see `convex/auth.ts`).
 *
 * A successful verification signs the user in immediately, so there is no
 * success state to render — `<AuthGate>`'s `<Unauthenticated>` branch unmounts
 * this whole subtree the moment the mutation resolves. That is also why
 * `onCancel` is the only way out.
 */
export function ForgotPasswordForm({ onCancel }: { onCancel: () => void }) {
    const { signIn } = useAuthActions();
    const [step, setStep] = useState<Step>("request");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    // The tab title is `<AuthForm>`'s: React runs a parent's effects AFTER
    // its children's, so a `useDocumentTitle` here would lose the race on
    // every render. See the call site.

    const requestCode = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        setNotice(null);

        const trimmedEmail = email.trim().toLowerCase();
        if (!trimmedEmail) {
            setError("Email is required");
            return;
        }

        setSubmitting(true);
        try {
            await signIn("password", {
                email: trimmedEmail,
                flow: "reset",
            });
        } catch (err) {
            // An address with no account is NOT reported — see
            // `isUnknownAccountError`. Anything else is a real failure and is
            // shown instead of advancing to a code that will never arrive.
            if (!isUnknownAccountError(err)) {
                setError(friendlyAuthError(err, "resetRequest"));
                setSubmitting(false);
                return;
            }
        }
        setEmail(trimmedEmail);
        setStep("verify");
        setNotice(
            `If an account exists for ${trimmedEmail}, a ${CODE_LENGTH}-digit code is on its way. It expires in 15 minutes.`
        );
        setSubmitting(false);
    };

    const submitNewPassword = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);

        const trimmedCode = code.trim();
        if (trimmedCode.length !== CODE_LENGTH) {
            setError(`Enter the ${CODE_LENGTH}-digit code from the email`);
            return;
        }
        if (newPassword.length < PASSWORD_MIN) {
            setError(`Password must be at least ${PASSWORD_MIN} characters`);
            return;
        }
        if (newPassword !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        setSubmitting(true);
        try {
            await signIn("password", {
                email,
                code: trimmedCode,
                newPassword,
                flow: "reset-verification",
            });
            // Signed in — `<AuthGate>` unmounts this component.
        } catch (err) {
            setError(friendlyAuthError(err, "resetVerify"));
            setSubmitting(false);
        }
    };

    const backToEmail = () => {
        setError(null);
        setNotice(null);
        setCode("");
        setNewPassword("");
        setConfirmPassword("");
        setStep("request");
    };

    return (
        <form
            onSubmit={step === "request" ? requestCode : submitNewPassword}
            // `my-auto`, not the parent's cross-axis centring — see the
            // container comment in `<AuthForm>`: centring strands the
            // overflow on a short viewport.
            className="relative z-10 my-auto w-full max-w-sm"
        >
            <Panel tone="accent">
                <PanelHeader
                    title="Reset Password"
                    subtitle={
                        step === "request"
                            ? "We'll email you a code to set a new password."
                            : "Enter the code we emailed you, then pick a new password."
                    }
                    icon={<KeyRound className="h-6 w-6 text-accent" />}
                />
                <PanelBody>
                    {step === "request" ? (
                        <label className="flex flex-col gap-1.5">
                            <span className="text-label">Email</span>
                            <input
                                type="email"
                                autoComplete="email"
                                required
                                autoFocus
                                value={email}
                                onChange={(e) =>
                                    setEmail(e.currentTarget.value)
                                }
                                className="input-field"
                            />
                        </label>
                    ) : (
                        <>
                            <label className="flex flex-col gap-1.5">
                                <span className="text-label">
                                    Verification code
                                </span>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    autoComplete="one-time-code"
                                    maxLength={CODE_LENGTH}
                                    required
                                    autoFocus
                                    value={code}
                                    onChange={(e) =>
                                        // Paste from a mail client carries the
                                        // display grouping ("1234 5678"); the
                                        // server only ever stored the digits.
                                        setCode(
                                            e.currentTarget.value.replace(
                                                /\D/g,
                                                ""
                                            )
                                        )
                                    }
                                    className="input-field font-mono tracking-[0.3em]"
                                />
                            </label>

                            <label className="flex flex-col gap-1.5">
                                <span className="text-label">New password</span>
                                <input
                                    type="password"
                                    autoComplete="new-password"
                                    required
                                    value={newPassword}
                                    onChange={(e) =>
                                        setNewPassword(e.currentTarget.value)
                                    }
                                    className="input-field"
                                />
                            </label>

                            <label className="flex flex-col gap-1.5">
                                <span className="text-label">
                                    Confirm new password
                                </span>
                                <input
                                    type="password"
                                    autoComplete="new-password"
                                    required
                                    value={confirmPassword}
                                    onChange={(e) =>
                                        setConfirmPassword(
                                            e.currentTarget.value
                                        )
                                    }
                                    className="input-field"
                                />
                            </label>
                        </>
                    )}

                    {notice && !error && (
                        <Banner tone="info" role="status">
                            {notice}
                        </Banner>
                    )}
                    {error && (
                        <Banner tone="danger" role="alert">
                            {error}
                        </Banner>
                    )}
                </PanelBody>
                {/* `stack`, not the responsive default: both trailing controls
                    are secondary links that belong under the CTA at every
                    width — same shape as `<AuthForm>`. */}
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
                            : step === "request"
                              ? "Send Code"
                              : "Reset Password"}
                    </Button>
                    {step === "verify" && (
                        <button
                            type="button"
                            className="mt-1 min-h-11 text-center text-sm text-text-muted transition-colors hover:text-parchment"
                            onClick={backToEmail}
                        >
                            Use a different email
                        </button>
                    )}
                    <button
                        type="button"
                        className="mt-1 min-h-11 text-center text-sm text-text-muted transition-colors hover:text-parchment"
                        onClick={onCancel}
                    >
                        Back to sign in
                    </button>
                </PanelFooter>
            </Panel>
        </form>
    );
}
