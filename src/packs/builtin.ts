import { leanPack } from "./lean.js";
import type { Pack, PackSource } from "./types.js";

export const defaultPack: Pack = {
  name: "default",
  version: "1.0.0",
  description: "Built-in defaults (no overrides).",
  source: "builtin:default",
  surface: {},
};

/** Built-in packs registered under their stable names. Adding a built-in = adding an entry. */
const BUILTIN_REGISTRY: Readonly<Record<string, Pack>> = {
  default: defaultPack,
  lean: leanPack,
};

export const builtinSource: PackSource = {
  id: "builtin",
  resolve(name: string): Pack | null {
    return BUILTIN_REGISTRY[name] ?? null;
  },
  list(): Pack[] {
    return Object.values(BUILTIN_REGISTRY);
  },
};
