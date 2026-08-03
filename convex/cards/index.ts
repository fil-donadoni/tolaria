// Card registry + catalogue — server-side entry point.
//
// On the Convex backend `import { ... } from "./cards"` resolves to this file,
// which re-exports from both the runtime registry and the full catalogue.
//
// The client uses a separate entry point (`client.ts`) through a Vite alias
// (`@convex/cards`), which exports only the runtime registry and keeps the
// catalogue out of the main bundle.
export * from "./registry";
export * from "./catalogue";
