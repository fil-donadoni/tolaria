import { LEGAL_TAGLINE } from "@/lib/legal";

type LoadingScreenProps = {
    /** Primary status line. Defaults to a generic loading message. */
    message?: string;
};

/** Full-viewport loader. Surfaces the fan-content notice while waiting, the
 *  way Forge shows its disclaimer on the loading screen. */
export default function LoadingScreen({
    message = "Loading...",
}: LoadingScreenProps) {
    return (
        <div className="flex h-dvh flex-col items-center justify-center gap-6 bg-surface-base text-text">
            <div className="flex items-center gap-3">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-accent/40 border-t-text" />
                <span className="text-sm">{message}</span>
            </div>
            <p className="max-w-md px-6 text-center text-xs text-text-disabled">
                {LEGAL_TAGLINE}
            </p>
        </div>
    );
}
