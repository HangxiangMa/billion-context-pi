import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
const FOOTER_STATUS_KEY = "billion-context-pi";
let ui: ExtensionContext["ui"] | undefined;
let legacyStatusCleared = false;

/** Mirrors pi's footer.js formatTokens: lowercase k/M, thresholds <1000/<10000/<1e6/<1e7. */
export function formatCompactTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export function initFooterStatus(ctx: ExtensionContext): void {
  ui = ctx.ui;
  legacyStatusCleared = false;
  // Clear status written by older versions. Usage is rendered by pi-mine's
  // unified task dock, never as a competing footer status item.
  clearLegacyStatus();
}

function clearLegacyStatus(): void {
  if (!ui || legacyStatusCleared) return;
  try {
    ui.setStatus(FOOTER_STATUS_KEY, undefined);
    legacyStatusCleared = true;
  } catch {
    // session is tearing down — best effort
  }
}

/** Kept as a lifecycle-compatible no-op. The task dock owns delegate usage UI. */
export function updateFooterStatus(): void {
  // Usage is included in the billion-context-pi delegate bridge payload.
}

export function disposeFooterStatus(): void {
  clearLegacyStatus();
  ui = undefined;
  legacyStatusCleared = false;
}
