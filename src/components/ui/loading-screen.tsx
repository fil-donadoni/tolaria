import { LEGAL_TAGLINE } from "@/lib/legal";
import AmbientPageGround from "@/components/ui/ambient-page-ground";
import { Panel } from "@/components/ui/panel";

type LoadingScreenProps = {
    /** Primary status line. Defaults to a generic loading message. */
    message?: string;
};

/** Full-viewport loader. Shares the general page layout (ambient page ground +
 *  opaque signal Panel, PRD #589) and surfaces the fan-content notice while
 *  waiting, the way Forge shows its disclaimer on the loading screen. */
export default function LoadingScreen({
    message = "Loading...",
}: LoadingScreenProps) {
    return (
        <div className="relative flex h-dvh flex-col items-center justify-center overflow-hidden bg-surface-base text-text">
            <AmbientPageGround ring />
            <Panel className="relative z-10 flex max-w-md flex-col items-center gap-6 text-center">
                <div className="flex items-center gap-3">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-accent/40 border-t-text" />
                    <span className="text-sm">{message}</span>
                </div>
                <p className="px-2 text-xs text-text-disabled">
                    {LEGAL_TAGLINE}
                </p>
            </Panel>
        </div>
    );
}
