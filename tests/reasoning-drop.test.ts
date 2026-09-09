import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { DEFAULT_COMPRESS_REASONING, dropCompressReasoning, resolveReasoningDrop } from "../src/reasoning-drop.js";
import { resolveCompress } from "../src/config.js";

type AgentMessage = SessionMessageEntry["message"];

function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: 0 } as unknown as AgentMessage;
}

function assistant(parts: unknown[]): AgentMessage {
  return { role: "assistant", content: parts, timestamp: 0 } as unknown as AgentMessage;
}

function thinking(len: number, extra: Record<string, unknown> = {}): { type: "thinking"; thinking: string } & Record<string, unknown> {
  return { type: "thinking", thinking: "x".repeat(len), ...extra };
}

function compressCall(id = "c1"): { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> } {
  return { type: "toolCall", id, name: "compress", arguments: {} };
}

function otherCall(name = "bash"): { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> } {
  return { type: "toolCall", id: "t1", name, arguments: {} };
}

test("defaults: drop=true, threshold=2048; drop:false disables", () => {
  assert.deepEqual(DEFAULT_COMPRESS_REASONING, { drop: true, threshold: 2048 });
  assert.deepEqual(resolveReasoningDrop(undefined), { drop: true, threshold: 2048 });
  assert.deepEqual(resolveReasoningDrop({}), { drop: true, threshold: 2048 });
  assert.deepEqual(resolveReasoningDrop({ drop: false }), { drop: false, threshold: 2048 });
  assert.deepEqual(resolveReasoningDrop({ threshold: 0 }), { drop: true, threshold: 0 });
});

test("invalid threshold falls back to default, invalid drop is truthy", () => {
  assert.equal(resolveReasoningDrop({ threshold: -1 }).threshold, 2048);
  assert.equal(resolveReasoningDrop({ threshold: Number.NaN }).threshold, 2048);
  assert.equal(resolveReasoningDrop({ threshold: 8192.9 }).threshold, 8192);
  assert.equal(resolveReasoningDrop({ drop: "yes" as unknown as boolean }).drop, true);
});

test("gate: closed turn — messages from the last genuine user message onward are untouched", () => {
  const big = thinking(4096);
  const msgs = [
    assistant([{ type: "text", text: "old" }, thinking(4096), compressCall()]),
    user("go"),
    assistant([{ type: "text", text: "active" }, thinking(4096), compressCall()]),
  ];
  const out = dropCompressReasoning(msgs, { drop: true, threshold: 0 });
  assert.equal((out[0]!.content as unknown[]).includes(big), false);
  assert.deepEqual(out[2]!.content, msgs[2]!.content);
});

test("gate: selector — only messages carrying a compress toolCall part are touched", () => {
  const think = thinking(4096);
  const textOnly = assistant([{ type: "text", text: "hi" }, thinking(4096)]);
  const otherTool = assistant([{ type: "text", text: "hi" }, thinking(4096), otherCall()]);
  const msgs = [textOnly, otherTool, user("go")];
  const out = dropCompressReasoning(msgs, { drop: true, threshold: 0 });
  assert.deepEqual(out[0]!.content, textOnly.content);
  assert.deepEqual(out[1]!.content, otherTool.content);
  assert.equal(thinking(1).type, "thinking");
});

test("gate: size — strictly exceeds threshold, summed across parts of the same message only", () => {
  const at = assistant([{ type: "text", text: "hi" }, thinking(1024), thinking(1024), compressCall()]);
  const above = assistant([{ type: "text", text: "hi" }, thinking(1025), thinking(1025), compressCall()]);
  const splitKept = [assistant([{ type: "text", text: "hi" }, thinking(1500), compressCall()]), assistant([{ type: "text", text: "hi" }, thinking(1500), compressCall()]), user("go")];
  const out = dropCompressReasoning([at, above, user("go")], { drop: true, threshold: 2048 });
  assert.deepEqual(out[0]!.content, at.content); // 2048 == threshold → kept
  assert.equal((out[1]!.content as unknown[]).some((p) => p === (above.content as unknown[])[1]), false); // 2050 > 2048 → dropped
  const out2 = dropCompressReasoning(splitKept, { drop: true, threshold: 2048 });
  assert.deepEqual(out2[0]!.content, splitKept[0]!.content); // lengths not accumulated across messages
  assert.deepEqual(out2[1]!.content, splitKept[1]!.content);
});

test("threshold 0 drops any non-empty reasoning; zero-length survives", () => {
  const nonEmpty = assistant([{ type: "text", text: "hi" }, thinking(3), compressCall()]);
  const empty = assistant([{ type: "text", text: "hi" }, thinking(0), compressCall()]);
  const out = dropCompressReasoning([nonEmpty, empty, user("go")], { drop: true, threshold: 0 });
  assert.equal((out[0]!.content as unknown[]).length, 2);
  assert.equal((out[1]!.content as unknown[]).length, 3);
});

test("purity and idempotence: input never mutated; second pass is a no-op", () => {
  const original = assistant([{ type: "text", text: "hi" }, thinking(4096), compressCall()]);
  const msgs = [original, user("go")];
  const out1 = dropCompressReasoning(msgs, { drop: true, threshold: 0 });
  assert.deepEqual(original.content, [{ type: "text", text: "hi" }, thinking(4096), compressCall()]); // input unmutated
  assert.notEqual(out1[0], msgs[0]); // rewritten message is a new object
  const out2 = dropCompressReasoning(out1, { drop: true, threshold: 0 });
  assert.equal(out2, out1); // idempotent
});

test("fail-safe: malformed messages return the input unchanged", () => {
  const msgs = [
    { role: "assistant", content: null },
    { role: "assistant" },
    "garbage",
    user("go"),
  ] as unknown as AgentMessage[];
  assert.equal(dropCompressReasoning(msgs, { drop: true, threshold: 0 }), msgs);
});

test("drop:false is a full kill-switch", () => {
  const msgs = [assistant([{ type: "text", text: "hi" }, thinking(99999), compressCall()]), user("go")];
  assert.equal(dropCompressReasoning(msgs, { drop: false }), msgs);
});

test("no user message at all → nothing touched (all open round)", () => {
  const msgs = [assistant([{ type: "text", text: "hi" }, thinking(4096), compressCall()])];
  assert.equal(dropCompressReasoning(msgs, { drop: true, threshold: 0 }), msgs);
});

test("text and toolCall parts (incl. thoughtSignature) survive the drop", () => {
  const call = { ...compressCall(), thoughtSignature: "sig" };
  const out = dropCompressReasoning(
    [assistant([{ type: "text", text: "keep" }, thinking(4096), call]), user("go")],
    { drop: true, threshold: 0 },
  );
  const content = out[0]!.content as unknown[];
  assert.deepEqual(content, [{ type: "text", text: "keep" }, call]);
});

test("three-level merge: model > provider > global, field-wise", () => {
  const merged = resolveCompress(
    {
      reasoning: { drop: true, threshold: 2048 },
      providers: {
        openai: { reasoning: { drop: false }, models: { "gpt-5": { reasoning: { threshold: 0 } } } },
      },
    },
    "openai",
    "gpt-5",
  );
  assert.deepEqual(merged.reasoning, { drop: false, threshold: 0 });
  const provOnly = resolveCompress(
    { reasoning: { threshold: 100 }, providers: { openai: { reasoning: { drop: false } } } },
    "openai",
    undefined,
  );
  assert.deepEqual(provOnly.reasoning, { drop: false, threshold: 100 }); // provider only overrides drop
});
