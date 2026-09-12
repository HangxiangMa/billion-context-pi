import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { packSurface } from "./sanitize.js";
import { isValidPackName, type Pack, type PackSource, type PromptPackFile } from "./types.js";

function readPackFile(file: string): PromptPackFile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as PromptPackFile) : null;
  } catch {
    return null;
  }
}

/**
 * A pack directory source: `<dir>/<name>.json` files. Used for project-local
 * and user-global pack dirs; the same factory serves any future
 * installer-managed directory with zero core changes.
 */
export function createDirPackSource(id: string, dir: string): PackSource {
  return {
    id,
    resolve(name: string): Pack | null {
      if (!isValidPackName(name)) return null;
      const file = path.join(dir, `${name}.json`);
      const raw = readPackFile(file);
      if (!raw) return null;
      return {
        name: typeof raw.name === "string" ? raw.name : name,
        version: typeof raw.version === "string" ? raw.version : undefined,
        description: typeof raw.description === "string" ? raw.description : undefined,
        surface: packSurface(raw),
        source: `file:${file}`,
      };
    },
    list(): Pack[] {
      let names: string[];
      try {
        names = readdirSync(dir).filter((f) => f.endsWith(".json"));
      } catch {
        return [];
      }
      const out: Pack[] = [];
      for (const f of names) {
        const name = f.slice(0, -5);
        const pack = this.resolve(name);
        if (pack) out.push(pack);
      }
      return out;
    },
  };
}
