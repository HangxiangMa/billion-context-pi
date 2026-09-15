import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FleetRunView } from "./delegate-tool.js";
import { getDelegateUsage } from "./delegate-tool.js";
import { initFooterStatus, updateFooterStatus, disposeFooterStatus } from "./footer-status.js";

const BRIDGE_CHANNEL = "billion-context-pi:delegate:v1";
const DELEGATE_WIDGET_KEY = "billion-context-pi-delegates";
const REFRESH_MS = 500;
const MAX_TASK_LEN = 48;

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
let lastRenderKey = "";
let runsSnapshot: RunsSnapshot | undefined;
let fleetSnapshot: FleetSnapshot | undefined;
let fleetShortcut = "";

function truncateTask(task: string): string {
  const oneLine = task.replace(/\n/g, " ").trim();
  if (oneLine.length <= MAX_TASK_LEN) return oneLine;
  return `${oneLine.slice(0, MAX_TASK_LEN - 1)}…`;
}

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

function renderLines(runs: WidgetRun[]): string[] | undefined {
  if (runs.length === 0) return undefined;
  const now = Date.now();
  const header = `acp_delegate · ${runs.length} running`;
  const rows = runs.map((r) => {
    const elapsed = Math.max(0, Math.round((now - r.startedAt) / 1000));
    return `  ● ${r.agent} (${elapsed}s) — ${truncateTask(r.task)}`;
  });
  const hint = fleetShortcut
    ? `  /acp-fleet · ${formatShortcutLabel(fleetShortcut)} — inspect`
    : "  /acp-fleet — inspect";
  return [header, ...rows, hint];
}

function renderKeyFor(runs: WidgetRun[]): string {
  return runs.map((r) => `${r.agent}:${Math.round((Date.now() - r.startedAt) / 1000)}:${truncateTask(r.task)}`).join("|");
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

function clearWidget(): void {
  if (!ui) return;
  try { ui.setWidget(DELEGATE_WIDGET_KEY, undefined); } catch { /* teardown */ }
}

function refresh(): void {
  if (!ui) return;
  emitBridge();
  const runs = runsSnapshot ? runsSnapshot() : [];
  if (runs.length === 0) {
    if (lastRenderKey !== "") { lastRenderKey = ""; clearWidget(); }
    updateFooterStatus();
    stopTimer();
    return;
  }
  const sorted = [...runs].sort((a, b) => a.startedAt - b.startedAt);
  const renderKey = renderKeyFor(sorted);
  if (renderKey !== lastRenderKey) {
    lastRenderKey = renderKey;
    try { ui.setWidget(DELEGATE_WIDGET_KEY, renderLines(sorted), { placement: "belowEditor" }); }
    catch { ui = undefined; stopTimer(); }
  }
  updateFooterStatus();
}

export const delegateStatusWidget = {
  setContext(ctx: ExtensionContext, snapshot: RunsSnapshot, extApi?: ExtensionAPI, fleet?: FleetSnapshot, shortcut?: string): void {
    if (ctx.mode !== "tui") return;
    initFooterStatus(ctx);
    ui = ctx.ui;
    pi = extApi;
    runsSnapshot = snapshot;
    fleetSnapshot = fleet;
    fleetShortcut = shortcut ?? "";
    if (!timer) { timer = setInterval(refresh, REFRESH_MS); timer.unref?.(); }
    refresh();
  },
  dispose(): void {
    stopTimer(); clearWidget(); disposeFooterStatus();
    ui = undefined; pi = undefined; runsSnapshot = undefined; fleetSnapshot = undefined;
    lastRenderKey = ""; fleetShortcut = "";
  },
  poke(): void {
    if (ui && !timer) { timer = setInterval(refresh, REFRESH_MS); timer.unref?.(); }
    refresh();
  },
};
