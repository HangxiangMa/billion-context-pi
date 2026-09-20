import type { CompressionBlock } from "acp-kernel";

/**
 * Machine-readable contract for the `<sessionFile>.acp.json` sidecar (#368).
 *
 * Downstream tools (e.g. pi-billion-memory) glob the sidecar directly instead
 * of running inside pi. To keep that stable across releases:
 *
 *  - `schemaVersion` is written on every save. A MISSING version means v1
 *    (pre-contract files). An unknown NEWER version means "fields may have
 *    changed" — skip it, log once, never rewrite the file.
 *  - `producer` identifies the writer (`billion-context-pi@x.y.z`).
 *  - The file is replaced atomically (tmp + rename), so a reader either sees
 *    the previous or the next complete file, never a torn write.
 *  - Blocks are stored verbatim as the kernel's CompressionBlock; unknown
 *    extra fields are additive and must be ignored by readers.
 */
export const SIDECAR_SCHEMA_VERSION = 1;

/** One compressed block, as persisted in the sidecar's `blocks[]`. */
export type BcpBlockV1 = CompressionBlock;

/** Top-level shape of the sidecar (state fields beyond the contract allowed). */
export interface BcpSidecarV1 {
  schemaVersion: number;
  producer: string;
  blocks: BcpBlockV1[];
  [extra: string]: unknown;
}

export function sidecarProducer(): string {
  return `billion-context-pi@${typeof CURRENT_VERSION !== "undefined" ? CURRENT_VERSION : "dev"}`;
}

declare const CURRENT_VERSION: string;
