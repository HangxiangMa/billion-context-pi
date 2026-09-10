import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Breeze exposes Sonnet 5 under both `sonnet5` and Claude's full spelling. */
export function isSonnet5Model(model: { provider?: string; id?: string } | undefined): boolean {
  if (!model) return false;
  const provider = model.provider?.toLowerCase() ?? "";
  const id = model.id?.toLowerCase() ?? "";
  if (provider !== "breeze" && provider !== "breeze-1m") return false;
  return id === "sonnet5" || id === "claude-sonnet-5" || /(^|[-_/])sonnet[-_]?5($|[-_/\[])/.test(id);
}

/**
 * Return whether ACP should own native Pi compaction for this active model.
 *
 * Breeze's 200K Sonnet 5 endpoint needs ACP's reference-aware compression.
 * Breeze's 1M Sonnet 5 endpoint has enough room for Pi's native compaction;
 * cancelling it leaves that endpoint with no usable automatic compaction path.
 */
export function shouldAcpOwnCompaction(ctx: Pick<ExtensionContext, "model" | "getContextUsage"> | undefined): boolean {
  const model = ctx?.model as { provider?: string; id?: string; contextWindow?: number } | undefined;
  if (!isSonnet5Model(model)) return true;

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
