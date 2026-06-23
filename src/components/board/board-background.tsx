import AmbientPageGround from "~/components/ui/ambient-page-ground";

/** Ambient board background — purely presentational, no canvas (#249 board).
 *
 *  Now a thin alias over the shared {@link AmbientPageGround} (PRD #589, issue
 *  #596): the Battlefield's original ambient recipe (depth gradient + warm/cool
 *  glows tinted from the live accent tokens + faint fantasy art + grain +
 *  vignette + arcane ring) was generalised so the Lobby and other pages share
 *  one ambient-vs-signal split. The full arcane ring is kept here for the
 *  Battlefield's signature look. Inert to pointer events. */
export default function BoardBackground() {
    return <AmbientPageGround ring />;
}
