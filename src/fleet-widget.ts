import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FleetRunView } from "./delegate-tool.js";
import { getDelegateUsage } from "./delegate-tool.js";
import { initFooterStatus, updateFooterStatus, disposeFooterStatus } from "./footer-status.js";

// Bridge channel; pi-mine's task-dock is the sole delegate UI owner.
// Payload: { runs: BridgeRun[] }.
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

let ui: ExtensionContext["ui"] | undefined;
let pi: ExtensionAPI | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let runsSnapshot: RunsSnapshot | undefined;
let fleetSnapshot: FleetSnapshot | undefined;

function emitBridge(): void {
  if (!pi?.events || !fleetSnapshot) return;
  try {
    const runs = fleetSnapshot().map((r) => ({
      id: r.runId,
      agent: r.agent,
      task: r.task,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      model: r.model,
      summary: r.summary,
      activity: r.activity,
      transcriptFile: r.transcriptFile ?? r.sessionFile,
      cost: r.usage?.cost.total,
      tokens: r.usage ? { input: r.usage.input, output: r.usage.output } : undefined,
    }));
    const usage = getDelegateUsage();
    pi.events.emit(BRIDGE_CHANNEL, {
      runs,
      usage: usage
        ? {
            input: usage.input,
            output: usage.output,
            cost: usage.cost.total,
          }
        : undefined,
    });
  } catch {
    // best-effort UI hint — never let it break delegation
  }
}

function stopTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

function refresh(): void {
  if (!ui) return;
  // Keep host task-dock rows and elapsed-time snapshots fresh.
  emitBridge();
  const runs = runsSnapshot ? runsSnapshot() : [];
  // pi-mine's task-dock owns all delegate rows. This extension only publishes
  // the bridge snapshot and keeps legacy cumulative usage cleanup alive.
  updateFooterStatus();
  if (runs.length === 0) stopTimer();
}

export const delegateStatusWidget = {
  setContext(ctx: ExtensionContext, snapshot: RunsSnapshot, extApi?: ExtensionAPI, fleet?: FleetSnapshot): void {
    // Only interactive TUI sessions publish the bridge. RPC/print/json do not
    // need a host task-dock update loop.
    if (ctx.mode !== "tui") return;
    initFooterStatus(ctx);
    ui = ctx.ui;
    pi = extApi;
    runsSnapshot = snapshot;
    fleetSnapshot = fleet;
    if (!timer) {
      timer = setInterval(refresh, REFRESH_MS);
      timer.unref?.();
    }
    refresh();
  },
  dispose(): void {
    stopTimer();
    disposeFooterStatus();
    ui = undefined;
    pi = undefined;
  },
  poke(): void {
    // A new spawn may arrive after refresh() stopped the timer on an empty
    // list. Restart bridge publication.
    if (ui && !timer) {
      timer = setInterval(refresh, REFRESH_MS);
      timer.unref?.();
    }
    refresh();
  },
};
