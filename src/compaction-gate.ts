import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Match Breeze and future suffixed Breeze provider variants (for example `breeze-1m`). */
export function isBreezeModel(model: { provider?: string } | undefined): boolean {
  const provider = model?.provider?.toLowerCase() ?? "";
  return /^breeze(?:[-_].+)?$/.test(provider);
}

/**
 * Return whether ACP should own native Pi compaction for this active model.
 *
 * Breeze model providers encode endpoint variants in their provider name, but
 * model catalogs can change. Use the active context window instead of a model
 * allowlist: sub-1M Breeze endpoints use ACP's reference-aware compression,
 * while 1M+ endpoints retain Pi's native compaction.
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
