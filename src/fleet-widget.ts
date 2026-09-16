import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FleetRunView } from "./delegate-tool.js";
import { getDelegateUsage } from "./delegate-tool.js";
import { initFooterStatus, updateFooterStatus, disposeFooterStatus } from "./footer-status.js";

const BRIDGE_CHANNEL = "billion-context-pi:delegate:v1";
const REFRESH_MS = 500;

interface WidgetRun {
  runId: string;
  agent: string;
  task: string;
  startedAt: number;
}

type RunsSnapshot = () => WidgetRun[];
type FleetSnapshot = () => FleetRunView[];

let pi: ExtensionAPI | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let runsSnapshot: RunsSnapshot | undefined;
let fleetSnapshot: FleetSnapshot | undefined;

export function formatShortcutLabel(shortcut: string): string {
  return shortcut.split("+").map((part) => {
    const normalized = part.trim().toLowerCase();
    if (normalized === "ctrl") return "Ctrl";
    if (normalized === "alt") return "Alt";
    if (normalized === "shift") return "Shift";
    if (normalized === "super") return "Super";
    return normalized.length === 1 ? normalized.toUpperCase() : part.trim();
  }).join("+");
}

function emitBridge(): void {
  if (!pi?.events || !fleetSnapshot) return;
  try {
    const runs = fleetSnapshot().map((r) => ({
      id: r.runId, agent: r.agent, task: r.task, status: r.status,
      startedAt: r.startedAt, finishedAt: r.finishedAt, model: r.model,
      summary: r.summary, activity: r.activity,
      transcriptFile: r.transcriptFile ?? r.sessionFile,
      cost: r.usage?.cost.total,
      tokens: r.usage ? { input: r.usage.input, output: r.usage.output } : undefined,
    }));
    const usage = getDelegateUsage();
    pi.events.emit(BRIDGE_CHANNEL, {
      runs,
      usage: usage ? { input: usage.input, output: usage.output, cost: usage.cost.total } : undefined,
    });
  } catch {
    // Best-effort UI hint; never break delegation.
  }
}

function stopTimer(): void {
  if (timer) { clearInterval(timer); timer = undefined; }
}

function refresh(): void {
  emitBridge();
  updateFooterStatus();
  if (runsSnapshot?.().length === 0) stopTimer();
}

export const delegateStatusWidget = {
  setContext(ctx: ExtensionContext, snapshot: RunsSnapshot, extApi?: ExtensionAPI, fleet?: FleetSnapshot, _shortcut?: string): void {
    if (ctx.mode !== "tui") return;
    initFooterStatus(ctx);
    pi = extApi;
    runsSnapshot = snapshot;
    fleetSnapshot = fleet;
    if (!timer) { timer = setInterval(refresh, REFRESH_MS); timer.unref?.(); }
    refresh();
  },
  dispose(): void {
    stopTimer(); disposeFooterStatus();
    pi = undefined; runsSnapshot = undefined; fleetSnapshot = undefined;
  },
  poke(): void {
    if (pi && !timer) { timer = setInterval(refresh, REFRESH_MS); timer.unref?.(); }
    refresh();
  },
};
