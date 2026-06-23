import AmbientPageGround from "~/components/ui/ambient-page-ground";

/** Lobby ambient page ground (PRD #589, issue #596).
 *
 *  Previously a single heavily-diluted art `<img>`; now consumes the shared
 *  {@link AmbientPageGround} so the Lobby (and the auth screens that reuse this
 *  component) get the full Battlefield ambient recipe — depth gradient +
 *  warm/cool glows tinted from the live accent tokens + faint fantasy art +
 *  grain + vignette + arcane ring. Opaque signal panels sit on top
 *  (ambient-vs-signal split). Static here; motion ships in a later slice.
 *  Inert to pointer events so foreground controls stay fully interactive. */
export default function LobbyBackground() {
    return <AmbientPageGround ring />;
}
