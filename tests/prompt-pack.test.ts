import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { defaultPrompts } from "acp-kernel";
import { buildAcpSystemPrompt } from "../src/system-prompt.js";
import {
  BUILTIN_PACKS,
  isValidPackName,
  discoverPack,
  resolvePackName,
  resolveActivePack,
  packSurface,
  mergeSurface,
  readToolSurfaceWithPacks,
} from "../src/prompt-pack.js";
import type { AdapterConfig } from "../src/config.js";

function adapter(compress?: AdapterConfig["compress"]): AdapterConfig {
  return { ...(compress ? { compress } : {}) };
}

test("builtin lean pack surface is well-formed", () => {
  const s = packSurface(BUILTIN_PACKS.lean);
  assert.equal(s.promptSections?.acpTags, BUILTIN_PACKS.lean.promptSections?.acpTags);
  for (const k of ["summariesInContext", "tools", "philosophy", "howToCompress", "tier2", "tier3", "multiTierIntro", "decompressPhilosophy", "contextBreakdown", "throttleRetry", "whenToCompress", "whenNotToCompress"]) {
    assert.equal((s.promptSections as Record<string, unknown>)?.[k], null, `${k} should be null`);
  }
  assert.equal(s.toolPrompts?.compress?.promptSnippet, "");
  assert.deepEqual(s.toolPrompts?.compress?.promptGuidelines, []);
  assert.equal(typeof s.toolPrompts?.compress?.description, "string");
  for (const t of ["decompress", "search_context", "acp_status"]) {
    assert.equal(s.toolPrompts?.[t as "decompress"]?.promptSnippet, "");
  }
  assert.equal(s.delegatePrompt, undefined);
  assert.deepEqual(s.prompts, {});
});

test("lean pack system prompt collapses to header + lean bullets", () => {
  const merged = mergeSurface(packSurface(BUILTIN_PACKS.lean), {});
  const text = buildAcpSystemPrompt(defaultPrompts, merged.promptSections);
  assert.ok(text.startsWith("\nACP context management\n\n"));
  assert.ok(text.includes("Never echo the XML tags"));
  assert.ok(!text.includes("ACP TAGS"));
  assert.ok(!text.includes("COMPRESSION SUMMARIES IN CONTEXT"));
  assert.ok(!text.includes("Compression Philosophy"));
  assert.ok(!text.includes("WHEN TO COMPRESS"));
  assert.ok(!text.includes("Compress by need, not by percentage"));
  assert.ok(!text.includes("TIER 2 COMPRESSION"));
});

test("resolvePackName walks the three compress levels, model wins", () => {
  const a = adapter({ promptPack: "lean" });
  assert.equal(resolvePackName(a), "lean");
  const b = adapter({ promptPack: "default", providers: { openai: { promptPack: "lean" } } });
  assert.equal(resolvePackName(b, "openai", "gpt-4o"), "lean");
  assert.equal(resolvePackName(b, "anthropic", "claude"), "default");
  const c = adapter({ promptPack: "lean", providers: { openai: { promptPack: "default", models: { "gpt-4o-mini": { promptPack: "lean" } } } } });
  assert.equal(resolvePackName(c, "openai", "gpt-4o-mini"), "lean");
  assert.equal(resolvePackName(c, "openai", "gpt-4o"), "default");
  assert.equal(resolvePackName(c), "lean");
});

test("resolveActivePack: default → null; project pack file discovered; project shadows builtin", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "acp-pack-"));
  try {
    assert.equal(resolveActivePack(adapter(), dir), null);
    assert.equal(resolveActivePack(adapter({ promptPack: "default" }), dir), null);
    assert.equal(resolveActivePack(adapter({ promptPack: "lean" }), dir), BUILTIN_PACKS.lean);

    await mkdir(path.join(dir, ".pi/acp/packs"), { recursive: true });
    await writeFile(path.join(dir, ".pi/acp/packs/my-pack.json"), JSON.stringify({ name: "my-pack", promptSections: { acpTags: "PROJECT PACK" } }), "utf8");
    const found = resolveActivePack(adapter({ promptPack: "my-pack" }), dir);
    assert.equal(found?.name, "my-pack");

    await writeFile(path.join(dir, ".pi/acp/packs/lean.json"), JSON.stringify({ name: "lean", promptSections: { acpTags: "SHADOW LEAN" } }), "utf8");
    const shadow = resolveActivePack(adapter({ promptPack: "lean" }), dir);
    assert.equal((shadow?.promptSections as Record<string, unknown>)?.acpTags, "SHADOW LEAN");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("discoverPack rejects path traversal names", () => {
  assert.equal(isValidPackName("../etc"), false);
  assert.equal(isValidPackName("a/b"), false);
  assert.equal(isValidPackName(".."), false);
  assert.equal(isValidPackName("my-pack.v2"), true);
  assert.equal(discoverPack("../etc", process.cwd()), null);
});

test("mergeSurface: inline wins per field, pack fills the rest", () => {
  const pack = packSurface({
    promptSections: { acpTags: "PACK TAGS", tools: "PACK TOOLS" },
    nudgeSections: { efficiencyNote: "PACK NOTE" },
    toolPrompts: { compress: { description: "PACK DESC", paramDescriptions: { startId: "pack-start", endId: "pack-end" } } },
    delegatePrompt: "PACK DELEGATE",
    prompts: { compressPhilosophy: "PACK PHILO" },
  });
  const merged = mergeSurface(pack, {
    promptSections: { acpTags: null },
    toolPrompts: { compress: { paramDescriptions: { startId: "inline-start" } } },
    prompts: { compressPhilosophy: "INLINE PHILO" },
  });
  assert.equal((merged.promptSections as Record<string, unknown>).acpTags, null);
  assert.equal((merged.promptSections as Record<string, unknown>).tools, "PACK TOOLS");
  assert.equal((merged.nudgeSections as Record<string, unknown>).efficiencyNote, "PACK NOTE");
  assert.equal(merged.toolPrompts.compress?.description, "PACK DESC");
  assert.equal(merged.toolPrompts.compress?.paramDescriptions?.startId, "inline-start");
  assert.equal(merged.toolPrompts.compress?.paramDescriptions?.endId, "pack-end");
  assert.equal(merged.delegatePrompt, "PACK DELEGATE");
  assert.equal((merged.prompts as Record<string, string>).compressPhilosophy, "INLINE PHILO");
});

test("mergeSurface: inline delegatePrompt (incl. null) beats pack", () => {
  const pack = packSurface({ delegatePrompt: "PACK DELEGATE" });
  assert.equal(mergeSurface(pack, {}).delegatePrompt, "PACK DELEGATE");
  assert.equal(mergeSurface(pack, { delegatePrompt: "INLINE" }).delegatePrompt, "INLINE");
  assert.equal(mergeSurface(pack, { delegatePrompt: null }).delegatePrompt, null);
});

test("packSurface sanitizes junk: bad types dropped, only 4 rule keys kept for prompts", () => {
  const s = packSurface({
    prompts: { compressPhilosophy: "ok", bogus: "x", howToCompressRules: 7 },
    promptSections: { acpTags: 42, tools: null },
    nudgeSections: { t2Guidance: "t" },
    toolPrompts: { bash: { description: "nope" } },
    delegatePrompt: "D",
  });
  assert.deepEqual(s.prompts, { compressPhilosophy: "ok" });
  assert.deepEqual(s.promptSections, { tools: null });
  assert.deepEqual(s.nudgeSections, { t2Guidance: "t" });
  assert.deepEqual(s.toolPrompts, {});
  assert.equal(s.delegatePrompt, "D");
});

test("readToolSurfaceWithPacks applies base pack under inline (per-field, per-param)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "acp-toolsurf-"));
  try {
    await mkdir(path.join(dir, ".pi"), { recursive: true });
    await writeFile(
      path.join(dir, ".pi/acp.json"),
      JSON.stringify({
        toolPrompts: { compress: { promptSnippet: "inline-snip", paramDescriptions: { startId: "inline-start" } } },
        compress: { promptPack: "lean" },
      }),
      "utf8",
    );
    const out = readToolSurfaceWithPacks(dir);
    assert.equal(out.compress?.promptSnippet, "inline-snip");
    assert.equal(out.compress?.description, "Replace consumed conversation ranges with self-contained summaries using mNNNNN or bN refs.");
    assert.equal(out.compress?.paramDescriptions?.startId, "inline-start");
    assert.equal(out.compress?.paramDescriptions?.endId, "Inclusive last mNNNNN or bN ref.");
    assert.deepEqual(out.compress?.promptGuidelines, []);
    assert.equal(out.decompress?.promptSnippet, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
