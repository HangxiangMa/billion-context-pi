import type { Prompts } from "acp-kernel";
import type { PiPromptSections } from "../system-prompt.js";
import type { NudgeSectionsConfig, ToolPromptsConfig } from "../surface.js";

/**
 * Raw on-disk pack JSON schema (user-authored file or future installer payload).
 * Every field optional; sanitized into a PackSurface before use.
 */
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

/** Sanitized surface bundle a pack contributes, layered under inline acp.json overrides. */
export interface PackSurface {
  prompts?: Partial<Prompts>;
  promptSections?: Partial<PiPromptSections>;
  nudgeSections?: NudgeSectionsConfig;
  toolPrompts?: ToolPromptsConfig;
  delegatePrompt?: string | null;
}

/**
 * A resolved prompt pack: a name plus a sanitized surface, tagged with its
 * provenance (`builtin:lean`, `file:/home/u/.pi/acp/packs/x.json`, …).
 * Built-in packs, user file packs, and future installer-managed packs all
 * implement this single contract.
 */
export interface Pack {
  name: string;
  version?: string;
  description?: string;
  surface: PackSurface;
  source: string;
}

/**
 * A pluggable pack origin. Sources are consulted in resolver order; the first
 * non-null wins. Implementations must be safe to call per turn (sync, no throw).
 */
export interface PackSource {
  readonly id: string;
  resolve(name: string): Pack | null;
  list?(): Pack[];
}

export function isValidPackName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes("..");
}
