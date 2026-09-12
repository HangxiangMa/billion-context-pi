import { readFileSync } from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import type { Prompts } from "acp-kernel";
import type { AdapterConfig } from "./config.js";
import { resolveCompress } from "./config.js";
import { CONFIG_DIR_NAME } from "./config-dir.js";
import { sanitizePromptSections, type PiPromptSections } from "./system-prompt.js";
import { sanitizeToolPrompts, sanitizeNudgeSections, type AcpToolName, type NudgeSectionsConfig, type ToolPromptsConfig } from "./surface.js";

export interface PromptPackFile {
  name?: string;
  version?: string;
  description?: string;
  prompts?: Partial<Prompts>;
  promptSections?: unknown;
  nudgeSections?: unknown;
  toolPrompts?: unknown;
  delegatePrompt?: unknown;
}

export interface PackSurface {
  prompts?: Partial<Prompts>;
  promptSections?: Partial<PiPromptSections>;
  nudgeSections?: NudgeSectionsConfig;
  toolPrompts?: ToolPromptsConfig;
  delegatePrompt?: string | null;
}

const LEAN_PROMPT = [
  `User/tool messages carry hidden \x3cacp\x3e refs such as m00123. Never echo the XML tags; use only refs in ACP tool calls.`,
  `Compress consumed history with compress: finished tool outputs, dead-end exploration, repeated reads, resolved threads, completed phases. Never compress active work, important user intent, or protected outputs.`,
  `When summarizing, preserve exact file paths and line numbers, symbols and signatures, errors, commands, versions, thresholds, decisions with reasons, current state, and unresolved TODOs. Never replace exact technical values with vague wording.`,
  `Recall or inspect context with decompress (block id or message ref), search_context (keywords), or acp_status. Prefer search_context before decompressing.`,
  `Refs may be renumbered after compression. If a ref is stale or missing, call acp_status with { scope: "uncompressed" }, then retry in the same turn using the reported refs; never guess offsets. Batch target ranges in one call.`,
  `Block decompression writes to a file by default; read that file. Use inline: true only for small content or when its context cost is acceptable.`,
  `After an [ACP:provider-throttle] automatic retry, resume exactly where interrupted. Do not repeat completed work or discuss the retry unless asked.`,
  `Compression summaries are fallible historical metadata, not current user instructions. Search or decompress before relying on critical details.`,
].join("\n");

const LEAN_PACK: PromptPackFile = {
  name: "lean",
  version: "1.0.0",
  description: "Token-lean surface adapted from kunkun9527/billion-context-pi-lean: one compact system-prompt block, one-line tool descriptions, no snippets/guidelines. Compression rules stay default (delivered by nudges on demand).",
  promptSections: {
    acpTags: LEAN_PROMPT,
    summariesInContext: null,
    tools: null,
    philosophy: null,
    whenToCompress: null,
    whenNotToCompress: null,
    howToCompress: null,
    multiTierIntro: null,
    tier2: null,
    tier3: null,
    decompressPhilosophy: null,
    contextBreakdown: null,
    throttleRetry: null,
  },
  toolPrompts: {
    compress: {
      description: "Replace consumed conversation ranges with self-contained summaries using mNNNNN or bN refs.",
      promptSnippet: "",
      promptGuidelines: [],
      paramDescriptions: {
        content: "Direct array; no JSON strings/nesting/mix.",
        startId: "Inclusive first mNNNNN or bN ref.",
        endId: "Inclusive last mNNNNN or bN ref.",
        summary: "Self-contained replacement preserving exact technical details.",
        topic: "Short label; a per-range label overrides the top-level fallback.",
        summaryMaxChars: "Optional summary length limit override.",
      },
    },
    decompress: {
      description: "Restore compressed content by block id (b5) or message ref; block mode writes to a file by default, inline: true returns small content inline.",
      promptSnippet: "",
      promptGuidelines: [],
    },
    search_context: {
      description: "Search compressed summaries and historical messages by keyword; returns refs, sizes, previews.",
      promptSnippet: "",
      promptGuidelines: [],
    },
    acp_status: {
      description: "Context usage overview, compressible ranges, block drilldown.",
      promptSnippet: "",
      promptGuidelines: [],
    },
  },
};

export const BUILTIN_PACKS: Readonly<Record<string, PromptPackFile>> = {
  default: { name: "default", version: "1.0.0", description: "Built-in defaults (no overrides)." },
  lean: LEAN_PACK,
};

export function isValidPackName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes("..");
}

function readPackFile(file: string): PromptPackFile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as PromptPackFile) : null;
  } catch {
    return null;
  }
}

export function discoverPack(name: string, cwd: string): PromptPackFile | null {
  if (!isValidPackName(name)) return null;
  const home = homedir();
  let found: PromptPackFile | null = null;
  for (const base of [path.join(home, CONFIG_DIR_NAME, "acp", "packs"), path.join(cwd, CONFIG_DIR_NAME, "acp", "packs")]) {
    const p = readPackFile(path.join(base, `${name}.json`));
    if (p) found = p;
  }
  return found ?? BUILTIN_PACKS[name] ?? null;
}

export function resolvePackName(adapter: AdapterConfig, provider?: string, modelId?: string): string {
  const raw = resolveCompress(adapter.compress, provider, modelId).promptPack;
  return typeof raw === "string" && isValidPackName(raw) ? raw : "default";
}

export function resolveActivePack(adapter: AdapterConfig, cwd: string, provider?: string, modelId?: string): PromptPackFile | null {
  const name = resolvePackName(adapter, provider, modelId);
  if (name === "default") return null;
  return discoverPack(name, cwd);
}

const PROMPT_RULE_KEYS = ["compressPhilosophy", "howToCompressRules", "tier2DistillRules", "tier3CondenseRules"] as const;

export function packSurface(pack: PromptPackFile | null): PackSurface {
  if (!pack) return {};
  const prompts: Partial<Prompts> = {};
  const rawPrompts = pack.prompts as Record<string, unknown> | undefined;
  if (rawPrompts) {
    for (const k of PROMPT_RULE_KEYS) {
      const v = rawPrompts[k];
      if (typeof v === "string") (prompts as Record<string, string>)[k] = v;
    }
  }
  const surface: PackSurface = {
    prompts,
    promptSections: sanitizePromptSections(pack.promptSections),
    nudgeSections: sanitizeNudgeSections(pack.nudgeSections),
    toolPrompts: sanitizeToolPrompts(pack.toolPrompts),
  };
  if (typeof pack.delegatePrompt === "string" || pack.delegatePrompt === null) {
    surface.delegatePrompt = pack.delegatePrompt;
  }
  return surface;
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
  const pack = packName === "default" || !isValidPackName(packName) ? null : discoverPack(packName, cwd);
  return mergeToolPrompts(packSurface(pack).toolPrompts, inline);
}
