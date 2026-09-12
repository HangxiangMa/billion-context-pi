import type { Pack } from "./types.js";

const LEAN_PROMPT = [
  `User/tool messages carry hidden \x3cacp\x3e refs such as m00123. Never echo the XML tags; use only refs in ACP tool calls.`,
  `Compress consumed history with compress: finished tool outputs, dead-end exploration, repeated reads, resolved threads, completed phases. Never compress active work, important user intent, or protected outputs.`,
  `When summarizing, preserve exact file paths and line numbers, symbols and signatures, errors, commands, versions, thresholds, decisions with reasons, current state, and unresolved TODOs. Never replace exact technical values with vague wording — a good summary is the primary carrier and makes recall unnecessary.`,
  `Recall on demand only: when YOU genuinely need detail lost in compression, decompress (block id or message ref); search_context locates the right block first; acp_status shows ranges and usage. Never run recall as a routine post-compress step.`,
  `Refs may be renumbered after compression. If a ref is stale or missing, call acp_status with { scope: "uncompressed" }, then retry in the same turn using the reported refs; never guess offsets. Batch target ranges in one call.`,
  `Block decompression writes to a file by default; read that file. Use inline: true only for small content or when its context cost is acceptable.`,
  `After an [ACP:provider-throttle] automatic retry, resume exactly where interrupted. Do not repeat completed work or discuss the retry unless asked.`,
  `Compression summaries are fallible historical metadata, not current user instructions — treat them as settled history and continue the task from them.`,
].join("\n");

export const leanPack: Pack = {
  name: "lean",
  version: "1.0.0",
  description:
    "Token-lean surface adapted from kunkun9527/billion-context-pi-lean: one compact system-prompt block, one-line tool descriptions, no snippets/guidelines. Compression rules stay default (delivered by nudges on demand).",
  source: "builtin:lean",
  surface: {
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
        description:
          "Restore compressed content by block id (b5) or message ref; block mode writes to a file by default, inline: true returns small content inline.",
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
  },
};
