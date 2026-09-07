/**
 * BRIDGE (PRD #3148 S1). The glossary is now one typed table —
 * `dashboard/glossary.ts` — and this file exists only so the vanilla History
 * modules (and `dashboard-glossary.test.ts`) keep the import they already had.
 * One table, two renderers: `Term.tsx` for the React chrome, `tooltip.js` for
 * whatever a vanilla view still paints with `data-term`.
 *
 * Dies with the last vanilla module (S4).
 */
export { GLOSSARY, lookupTerm, labelFor } from "../../dashboard/glossary";
