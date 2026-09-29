import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { BOUNDED_READ_ONLY_REPORT, framePressure, injectResult, protocolOverflowNote } from "../src/delegate-tool.js";

test("delegate report contract prevents oversized recursive reports", () => {
  assert.match(BOUNDED_READ_ONLY_REPORT, /under 8 KiB UTF-8/);
  assert.match(BOUNDED_READ_ONLY_REPORT, /complete file, complete diff/);
  assert.match(BOUNDED_READ_ONLY_REPORT, /NEEDS_SPLIT/);
  assert.match(BOUNDED_READ_ONLY_REPORT, /another sub-agent/);
});

test("framePressure uses the documented byte thresholds", () => {
  assert.equal(framePressure(0, 100), "NORMAL");
  assert.equal(framePressure(59, 100), "NORMAL");
  assert.equal(framePressure(60, 100), "WARN");
  assert.equal(framePressure(79, 100), "WARN");
  assert.equal(framePressure(80, 100), "CONVERGE");
  assert.equal(framePressure(99, 100), "CONVERGE");
  assert.equal(framePressure(100, 100), "OVERFLOW");
  assert.equal(framePressure(101, 100), "OVERFLOW");
});

test("framePressure counts UTF-8 bytes rather than JavaScript characters", () => {
  const text = "中".repeat(20); // 60 UTF-8 bytes
  assert.equal(Buffer.byteLength(text, "utf8"), 60);
  assert.equal(framePressure(Buffer.byteLength(text, "utf8"), 100), "WARN");
});

test("framePressure resets naturally after a completed frame", () => {
  assert.equal(framePressure(85, 100), "CONVERGE");
  assert.equal(framePressure(0, 100), "NORMAL");
});

test("protocol overflow note tells the parent how to recover", () => {
  const note = protocolOverflowNote("OVERFLOW");
  assert.match(note, /reason: protocol-frame-overflow/);
  assert.match(note, /partialOutput: true/);
  assert.match(note, /pressure: OVERFLOW/);
  assert.match(note, /recommendedAction: split-and-retry/);
});

test("overflow failure notification points to retained partial output", () => {
  const sent: string[] = [];
  const ok = injectResult(
    { sendUserMessage: (text: string) => sent.push(text) } as any,
    "reviewer",
    "del_overflow",
    "Review the camera binding, DTS, driver, and all validation",
    "failed",
    null,
    "/tmp/del_overflow.out",
    undefined,
    undefined,
    "separate",
    false,
    protocolOverflowNote("OVERFLOW") + "\n\npartial reply:\nfirst finding",
    "/tmp/del_overflow.activity",
    "SIGTERM",
  );
  assert.equal(ok, true);
  const text = sent[0]!;
  assert.match(text, /protocol-frame-overflow/);
  assert.match(text, /partialOutput: true/);
  assert.match(text, /split the task by independent area and retry/);
  assert.match(text, /\/tmp\/del_overflow\.out/);
  assert.match(text, /\/tmp\/del_overflow\.activity/);
  assert.doesNotMatch(text, /its result is missing from your work/);
});
