import { LEGAL_TAGLINE } from "@/lib/legal";
import AmbientPageGround from "@/components/ui/ambient-page-ground";
import { Panel } from "@/components/ui/panel";

type LoadingScreenProps = {
    /** Primary status line. Defaults to a generic loading message. */
    message?: string;
};

/** Shell-filling loader. Shares the general page layout (ambient page ground +
 *  opaque signal Panel, PRD #589) and surfaces the fan-content notice while
 *  waiting, the way Forge shows its disclaimer on the loading screen.
 *
 *  Claims the shell's REMAINING height as a FLOOR (`min-h-full`), never a whole
 *  viewport (issue #2274). It is rendered as a route's own root — the direct
 *  child of `AppShell`'s `<main flex flex-1 min-h-0 flex-col>` — on routes that
 *  DO wear the shared header (the lobby, `/limited`, the Pool builder, the join
 *  antechamber) as well as on `/game`, which does not. An `h-dvh` here was a
 *  whole viewport under a ~112px header band, i.e. an overflow of exactly the
 *  band on every headered route. `min-h-full` is the same box on `/game` (where
 *  `<main>` IS the viewport) and the right one everywhere else — and, being a
 *  floor rather than a hard height, it still grows past `<main>` if the Panel
 *  ever outgrows the space, so this component's own `overflow-hidden` (which
 *  clips the ambient ring) can never clip the message itself. */
export default function LoadingScreen({
    message = "Loading...",
}: LoadingScreenProps) {
    return (
        <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-surface-base text-text">
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
