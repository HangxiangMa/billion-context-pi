import type { Prompts } from "acp-kernel";
import { sanitizePromptSections } from "../system-prompt.js";
import { sanitizeToolPrompts, sanitizeNudgeSections } from "../surface.js";
import type { PackSurface, PromptPackFile } from "./types.js";

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
