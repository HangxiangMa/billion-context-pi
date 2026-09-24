import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Match providers with separate 1M endpoints. Model IDs are intentionally not allowlisted. */
export function isBreezeModel(model: { provider?: string } | undefined): boolean {
  const provider = model?.provider?.toLowerCase() ?? "";
  return provider === "breeze" || provider === "breeze-1m" || provider === "qgenie";
}

/**
 * Return whether ACP should own native Pi compaction for this active model.
 *
 * Breeze and QGenie providers encode endpoint variants in their provider name
 * or model catalog. Use the active context window instead of a model ID
 * allowlist: sub-1M endpoints use ACP's reference-aware compression, while 1M+
 * endpoints retain Pi's native compaction.
 */
export function shouldAcpOwnCompaction(ctx: Pick<ExtensionContext, "model" | "getContextUsage"> | undefined): boolean {
  const model = ctx?.model as { provider?: string; contextWindow?: number } | undefined;
  if (!isBreezeModel(model)) return true;

  const modelWindow = model?.contextWindow;
  const usageWindow = ctx?.getContextUsage?.()?.contextWindow;
  const contextWindow =
    typeof modelWindow === "number" && modelWindow > 0
      ? modelWindow
      : typeof usageWindow === "number" && usageWindow > 0
        ? usageWindow
        : 0;
  return contextWindow < 1_000_000;
}
