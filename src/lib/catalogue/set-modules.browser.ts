// The CLIENT's hand-written Set modules (issue #5615, PRD #5602, ADR 0113
// Amendment V): what `vite.config.ts` aliases `./setModules` to — the
// specifier `convex/cards/catalogue.ts` imports its Sets from — in BOTH the
// app graph and the `brain.worker` graph (since issue #5617 a chunk of the
// same build, so a Set chunk is one URL for both).
//
// The server's `convex/cards/setModules.ts` imports every Set statically. Here
// a Set is RESIDENT only once `install` has loaded its chunk
// (`./set-chunk-loader`), so a game installs the Sets of its Definition
// Manifest and a whole-catalogue surface installs them all
// (`src/lib/catalogue/definitionShards.ts`). `getDefinition` stays
// synchronous (ADR 0113 §1): the catalogue answers `null` for a card whose
// Set is not resident, and the gate holds the board until every Set it needs
// is.
//
// `codes` is read off the hand-written Definition Index — the same file the
// catalogue builds its lookups from — in first-seen order, which is the
// server's module order (the index is written in catalogue load order). A Set
// directory with no definition has no code here, and nothing to install.
import type {
    SetModuleExports,
    SetModuleSource,
} from "@convex/cards/setModuleSource";
import type { HandWrittenDefinitionIndex } from "@convex/cards/definitionIndex";
import definitionIndexJson from "../../../data/catalogue/definition-index.json";
import { loadSetModule } from "./set-chunk-loader";
import { noteResident } from "./residency";

const codes: readonly string[] = (() => {
    const raw = definitionIndexJson as unknown as
        | Partial<HandWrittenDefinitionIndex>
        | undefined;
    const seen = new Set<string>();
    for (const [, , setCode] of raw?.entries ?? []) seen.add(setCode);
    return [...seen];
})();

const known = new Set(codes);
const resident = new Map<string, SetModuleExports>();
const loading = new Map<string, Promise<SetModuleExports>>();

export { residencyVersion, subscribeResidency } from "./residency";

function install(code: string): Promise<SetModuleExports> {
    const installed = resident.get(code);
    if (installed !== undefined) return Promise.resolve(installed);
    const inFlight = loading.get(code);
    if (inFlight !== undefined) return inFlight;
    if (!known.has(code)) {
        return Promise.reject(
            new Error(
                `Unknown Set module: ${code} (not in the Definition Index)`
            )
        );
    }
    const load = loadSetModule(code).then(
        (exports) => {
            // A loader that answers nothing (the dev bundle missing a
            // namespace) is a failed install, never a resident empty Set —
            // the board would wait on a residency that never comes.
            if (exports === undefined || exports === null) {
                throw new Error(`Set module ${code} loaded no exports`);
            }
            resident.set(code, exports);
            loading.delete(code);
            noteResident();
            return exports;
        },
        (cause: unknown) => {
            // Not memoised: a retry (the gate's button) really re-loads.
            loading.delete(code);
            throw cause;
        }
    );
    loading.set(code, load);
    return load;
}

export const setModuleSource: SetModuleSource = {
    codes,
    resident: (code) => resident.get(code),
    install,
};
