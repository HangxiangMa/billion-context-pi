import { readFileSync } from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import type { Prompts } from "acp-kernel";
import type { AdapterConfig } from "./config.js";
import { resolveCompress } from "./config.js";
import { CONFIG_DIR_NAME } from "./config-dir.js";
import type { PiPromptSections } from "./system-prompt.js";
import { sanitizeToolPrompts, type AcpToolName, type NudgeSectionsConfig, type ToolPromptsConfig } from "./surface.js";
import { builtinSource, defaultPack } from "./packs/builtin.js";
import { createDirPackSource } from "./packs/dir.js";
import { isValidPackName, type Pack, type PackSource, type PackSurface } from "./packs/types.js";

export { leanPack } from "./packs/lean.js";
export { defaultPack, builtinSource } from "./packs/builtin.js";
export { createDirPackSource } from "./packs/dir.js";
export { packSurface } from "./packs/sanitize.js";
export { isValidPackName };
export type { Pack, PackSource, PackSurface, PromptPackFile } from "./packs/types.js";

/**
 * Ordered pack resolution over pluggable sources. The default chain is
 * [project dir > user dir > builtin]; custom sources (e.g. an installer-managed
 * registry) can be prepended without touching any core code.
 */
export interface PackResolver {
  readonly sources: readonly PackSource[];
  resolve(name: string): Pack | null;
  listPacks(): Pack[];
}

export function createPackResolver(sources: readonly PackSource[]): PackResolver {
  return {
    sources,
    resolve(name: string): Pack | null {
      if (!isValidPackName(name)) return null;
      for (const source of sources) {
        const pack = source.resolve(name);
        if (pack) return pack;
      }
      return null;
    },
    listPacks(): Pack[] {
      const seen = new Set<string>();
      const out: Pack[] = [];
      for (const source of sources) {
        for (const pack of source.list?.() ?? []) {
          if (!seen.has(pack.name)) {
            seen.add(pack.name);
            out.push(pack);
          }
        }
      }
      return out;
    },
  };
}

export function defaultPackSources(cwd: string): PackSource[] {
  return [
    createDirPackSource("project", path.join(cwd, CONFIG_DIR_NAME, "acp", "packs")),
    createDirPackSource("user", path.join(homedir(), CONFIG_DIR_NAME, "acp", "packs")),
    builtinSource,
  ];
}

export function packResolver(cwd: string): PackResolver {
  return createPackResolver(defaultPackSources(cwd));
}

export function discoverPack(name: string, cwd: string): Pack | null {
  return packResolver(cwd).resolve(name);
}

export function resolvePackName(adapter: AdapterConfig, provider?: string, modelId?: string): string {
  const raw = resolveCompress(adapter.compress, provider, modelId).promptPack;
  return typeof raw === "string" && isValidPackName(raw) ? raw : "default";
}

export function resolveActivePack(
  adapter: AdapterConfig,
  cwd: string,
  provider?: string,
  modelId?: string,
  resolver?: PackResolver,
): Pack {
  const name = resolvePackName(adapter, provider, modelId);
  if (name === "default") return defaultPack;
  const r = resolver ?? packResolver(cwd);
  return r.resolve(name) ?? defaultPack;
}

function mergeToolPrompts(pack?: ToolPromptsConfig, inline?: ToolPromptsConfig): ToolPromptsConfig {
  if (!pack) return inline ?? {};
  if (!inline) return pack;
  const out: ToolPromptsConfig = {};
  for (const name of new Set([...Object.keys(pack), ...Object.keys(inline)])) {
    const p = pack[name as AcpToolName];
    const i = inline[name as AcpToolName];
    if (!i) {
      out[name as AcpToolName] = p;
      continue;
    }
    if (!p) {
      out[name as AcpToolName] = i;
      continue;
    }
    out[name as AcpToolName] = {
      ...p,
      ...i,
      paramDescriptions: { ...p.paramDescriptions, ...i.paramDescriptions },
    };
  }
  return out;
}

export interface InlineSurface {
  prompts?: Partial<Prompts>;
  promptSections?: Partial<PiPromptSections>;
  nudgeSections?: NudgeSectionsConfig;
  toolPrompts?: ToolPromptsConfig;
  delegatePrompt?: string | null;
}

export interface MergedSurface {
  prompts: Partial<Prompts>;
  promptSections: Partial<PiPromptSections>;
  nudgeSections: NudgeSectionsConfig;
  toolPrompts: ToolPromptsConfig;
  delegatePrompt?: string | null;
}

export function mergeSurface(pack: PackSurface | null, inline: InlineSurface): MergedSurface {
  const p = pack ?? {};
  const prompts: Partial<Prompts> = { ...(p.prompts ?? {}), ...(inline.prompts ?? {}) };
  return {
    prompts,
    promptSections: { ...(p.promptSections ?? {}), ...(inline.promptSections ?? {}) },
    nudgeSections: { ...(p.nudgeSections ?? {}), ...(inline.nudgeSections ?? {}) },
    toolPrompts: mergeToolPrompts(p.toolPrompts, inline.toolPrompts),
    delegatePrompt: inline.delegatePrompt !== undefined ? inline.delegatePrompt : p.delegatePrompt,
  };
}

export function readToolSurfaceWithPacks(cwd: string): ToolPromptsConfig {
  const home = homedir();
  let inline: ToolPromptsConfig = {};
  let packName = "default";
  for (const base of [path.join(home, CONFIG_DIR_NAME), path.join(cwd, CONFIG_DIR_NAME)]) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path.join(base, "acp.json"), "utf8"));
      if (parsed && typeof parsed === "object") {
        const rec = parsed as Record<string, unknown>;
        if (rec.toolPrompts) inline = sanitizeToolPrompts(rec.toolPrompts);
        const c = rec.compress;
        if (c && typeof c === "object" && typeof (c as Record<string, unknown>).promptPack === "string") {
          packName = (c as Record<string, unknown>).promptPack as string;
        }
      }
    } catch {
      // missing file or bad JSON — keep prior
    }
  }
  const pack = packName === "default" || !isValidPackName(packName) ? null : packResolver(cwd).resolve(packName);
  return mergeToolPrompts(pack?.surface.toolPrompts, inline);
}
