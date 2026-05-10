import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "~/components/ui/button";

export function SignOutButton() {
    const { signOut } = useAuthActions();
    return (
        <Button variant="ghost" size="sm" onClick={() => signOut()}>
            Sign out
        </Button>
    );
}
