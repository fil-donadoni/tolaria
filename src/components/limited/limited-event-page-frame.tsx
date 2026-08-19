import type { ReactNode } from "react";
import { Panel } from "~/components/ui/panel";

/** Page frame for the Limited Event detail surface. `Panel size="wide"` only
 *  CAPS the width (`max-w-[90vw]`) — with no centring wrapper the panel sat
 *  flush against the left edge of the viewport, unlike every other Limited
 *  page (the events lobby centres its own `mx-auto max-w-3xl` container). This
 *  wrapper supplies the missing centring + page gutter in one place, so both
 *  render branches of the detail page (the live event and the
 *  "event no longer exists" fallback) stay aligned with each other. */
export default function LimitedEventPageFrame({
    children,
    dropOrnamentOnCompact = false,
}: {
    children: ReactNode;
    /** Drop the decorative corner filigree (40px of pure ornament, issue
     *  #2515) on a compact viewport. Gated by the CALLER's own condition
     *  (draft in progress) rather than the media query alone: the ornament
     *  must stay put on a compact viewport whenever the event is NOT
     *  drafting, where the full chrome is the point of the page. Default
     *  `false` keeps every other caller (and the "event no longer exists"
     *  fallback) unaffected. */
    dropOrnamentOnCompact?: boolean;
}) {
    return (
        <div className="flex w-full justify-center px-6 py-8">
            <Panel
                size="wide"
                className="w-full"
                frameClassName={
                    dropOrnamentOnCompact ? "compact-chrome:hidden" : undefined
                }
            >
                {children}
            </Panel>
        </div>
    );
}
