import type { ReactNode } from "react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { AuthForm } from "./auth-form";
import LobbyBackground from "~/components/lobby/lobby-background";

export function AuthGate({ children }: { children: ReactNode }) {
    return (
        <>
            <AuthLoading>
                <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-surface-base">
                    <LobbyBackground />
                    <span className="relative z-10 text-sm text-text-muted">
                        Loading…
                    </span>
                </div>
            </AuthLoading>
            <Unauthenticated>
                <AuthForm />
            </Unauthenticated>
            <Authenticated>{children}</Authenticated>
        </>
    );
}
