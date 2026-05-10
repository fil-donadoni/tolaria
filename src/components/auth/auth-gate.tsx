import type { ReactNode } from "react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { AuthForm } from "./auth-form";

export function AuthGate({ children }: { children: ReactNode }) {
    return (
        <>
            <AuthLoading>
                <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
                    Loading…
                </div>
            </AuthLoading>
            <Unauthenticated>
                <AuthForm />
            </Unauthenticated>
            <Authenticated>{children}</Authenticated>
        </>
    );
}
