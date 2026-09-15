import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { createAcpExtension } from "../src/index.js";
import { retryBreakerKey } from "../src/runtime.js";
import { isCompressNoopText } from "../src/compress-tool.js";
import { setRunNpmForTest } from "../src/update.js";

// Issue #453 (evidence from the #452 log): under a declared fork host
// (PI_ACP_FORK_HOST=1, e.g. omp) the context handler keyed the compress-retry
// circuit breaker on lastTurnBoundaryId(MERGED entries) — and the merged tail
// carries volatile live-N ids for messages the host has not persisted yet.
// The current user message stays live across every context fire of a long
// tool loop and renumbers between fires (its own prior ref blocks
// nextLiveId's base candidate), so the breaker's failTurnKey churned and the
// counter reset on nearly every fire: the MAX_COMPRESS_ATTEMPTS cap never
// latched, and a session pinned at emergency kept getting emergency-injected
// and burning guaranteed-to-fail compress attempts forever (#452 log: cap →
// inject every ~45 s).
//
// Contract under test: the breaker keys off PERSISTED boundaries only
// (retryBreakerKey — immutable ids), so the cap latches through live-id
// churn and releases only when a genuine new user message reaches the session
// log (or a compress succeeds).

setRunNpmForTest(async (args) => ({ code: 0, stdout: args[0] === "view" ? "0.0.1\n" : "", stderr: "" }));
process.env.ACP_AUTO_UPDATE = "false";
delete process.env.BILLION_CONTEXT_PROXY;

function captureApi() {
  const handlers = new Map<string, ((event: any, ctx: any) => any)[]>();
  const api = {
    on(event: string, handler: (e: any, ctx: any) => any) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    tools: [] as any[],
    commands: new Map<string, any>(),
    registerTool(tool: any) { this.tools.push(tool); },
    registerCommand(name: string, options: any) { this.commands.set(name, options); },
  };
  return { api, handlers };
}

function roleMsg(id: string, role: string, text: string) {
  return { type: "message", id, parentId: null, timestamp: "", message: { role, content: text, timestamp: Date.now() } };
}

function toolResultMsg(id: string, toolCallId: string, text: string, isError: boolean) {
  return {
    type: "message", id, parentId: null, timestamp: "",
    message: {
      role: "toolResult", toolCallId, toolName: "compress",
      content: [{ type: "text", text }], isError, timestamp: Date.now(),
    },
  };
}

// Declared fork host: getBranch only (no buildContextEntries); the branch
// lags behind the host's send view (event.messages carries the not-yet-
// persisted tail) — the omp shape documented in src/runtime.ts stateFor.
function forkCtx(getBranch: () => any[], stateFile: string): any {
  return {
    mode: "rpc",
    cwd: "/tmp",
    hasUI: false,
    ui: { notify: () => {}, confirm: async () => true, select: async () => undefined, input: async () => "", setStatus: () => {} },
    model: { contextWindow: 200_000, id: "test-model" },
    getContextUsage: () => null,
    sessionManager: {
      getBranch: () => getBranch(),
      getSessionId: () => "fork-breaker-session",
      getSessionFile: () => stateFile,
    },
  };
}

const textOf = (out: any) => (typeof out === "string" ? out : out.content?.[0]?.text ?? String(out));

const ZH = "中".repeat(6000);

test("issue #453: retryBreakerKey derives from persisted entries only", () => {
  const forkSm = {
    getBranch: () => [roleMsg("p-u1", "user", "a"), roleMsg("p-a1", "assistant", "b"), roleMsg("p-u2", "user", "c")],
  };
  assert.equal(retryBreakerKey(forkSm as any), "p-u2");
  const piSm = {
    buildContextEntries: () => [roleMsg("q-u1", "user", "a"), roleMsg("q-u2", "user", "c")],
    getBranch: () => [roleMsg("p-u1", "user", "a")],
  };
  assert.equal(retryBreakerKey(piSm as any), "q-u2", "buildContextEntries wins (pi precedence)");
});

test("issue #453: cap latches through fork-host live-id churn; new persisted user message releases", async () => {
  const prevForkHost = process.env.PI_ACP_FORK_HOST;
  process.env.PI_ACP_FORK_HOST = "1";
  try {
    const { api, handlers } = captureApi();
    createAcpExtension({ modelContextLimit: 200_000 })(api as any);
    const stateFile = "/tmp/pai-acp-fork-breaker.session.json";
    await rm(`${stateFile}.acp.json`, { force: true });

    const persisted: any[] = [roleMsg("p-u1", "user", "u1 " + ZH), roleMsg("p-a1", "assistant", "a1 " + ZH)];
    let live: any[] = [roleMsg("p-u1", "user", "u1 " + ZH), roleMsg("p-a1", "assistant", "a1 " + ZH), roleMsg("live-u3", "user", "u3 " + ZH)];
    const ctx = forkCtx(() => persisted, stateFile);

    await handlers.get("session_start")![0]!({ type: "session_start", reason: "startup" }, ctx);
    const fire = () => handlers.get("context")![0]!({ type: "context", messages: live }, ctx);
    await fire();

    assert.equal(retryBreakerKey(ctx.sessionManager), "p-u1", "breaker key is the persisted boundary, not the live-N tail");

    const compressTool = api.tools.find((t: any) => t.name === "compress")!;
    const S = () => [{ startId: "m00999", endId: "m00100", summary: "dead refs" }];
    const run = async (id: string) => {
      const text = textOf(await (compressTool as any).execute(id, { content: S() }, undefined, undefined, ctx));
      live = [...live, toolResultMsg(`r-${id}`, id, text, false)];
      await fire();
      return text;
    };

    const f1 = await run("fc1");
    assert.ok(isCompressNoopText(f1) && f1.includes("does not exist"), `f1 is the kernel unknown-ref panel: ${f1}`);
    const f2 = await run("fc2");
    assert.ok(f2.includes("REJECTED"), `f2 is the dead-range hard rejection: ${f2}`);
    const f3 = await run("fc3");
    assert.ok(f3.includes("REJECTED"), `f3 still rejected: ${f3}`);

    // Three failures burned the cap while U3 stayed unpersisted and its
    // merged-view boundary id churned between fires. Pre-fix the counter was
    // keyed on those volatile ids, reset on nearly every fire, and never
    // latched — f4 would have executed instead of pausing.
    const f4 = await run("fc4");
    assert.ok(f4.includes("PAUSED"), `f4 must be paused by the latched cap despite live-id churn: ${f4}`);

    // The host finally persists the stuck turn's tail, including the current
    // user message — a genuine new user boundary reaches the log → release.
    persisted.push(roleMsg("p-u3", "user", "u3 " + ZH), toolResultMsg("p-r1", "fc1", f1, false), toolResultMsg("p-r2", "fc2", f2, false), toolResultMsg("p-r3", "fc3", f3, false));
    live = [...persisted];
    await fire();
    assert.equal(retryBreakerKey(ctx.sessionManager), "p-u3", "key advances only when the user message persists");

    const f5 = await run("fc5");
    assert.ok(f5.includes("REJECTED") && !f5.includes("PAUSED"), `cap released by the new user message (dead-range guard still applies): ${f5}`);
    await rm(`${stateFile}.acp.json`, { force: true });
  } finally {
    if (prevForkHost === undefined) delete process.env.PI_ACP_FORK_HOST;
    else process.env.PI_ACP_FORK_HOST = prevForkHost;
  }
});
