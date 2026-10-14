/** What a gated surface needs resident before it renders (issue #5615, ADR
 *  0113 Amendment V):
 *  - `whole` — the packed corpus and every hand-written Set: the deck
 *    builder, deck detail, the Draft Lab, admin, the join antechamber.
 *  - `game` — the packed corpus only. The game route then loads the Sets of
 *    its Definition Manifest itself (`DefinitionManifestGate`), so a game
 *    downloads its own cards and never the catalogue. */
export type CatalogueGateMode = "whole" | "game";

/** What the matched route tree asks of the catalogue (`src/router.tsx`,
 *  read by `RouteOutlet`): `none` — every non-root match is a declared
 *  `lightSurface`; else a {@link CatalogueGateMode}. */
export type RouteCatalogueNeed = "none" | CatalogueGateMode;
