/** Single source of truth for turn-boundary decisions (#364).
 *
 * "What counts as a new-turn start" used to be decided independently in three
 * places (per-turn token estimation, turnKey scoping, context-entry
 * projection) and disagreed on host-injected custom_message entries: they
 * enter LLM context but started no turn, so multiple real turns collapsed
 * into one turnKey — nudge ledger cells misaligned, retry-cap and throttle
 * cycle stats distorted, reasoning-drop closing against the wrong turn.
 * Every turn-boundary check in the adapter goes through isTurnBoundary.
 */

/** Host-injected status panel custom messages (src/commands.ts) — UI-only,
 *  never projected into LLM context, so they never count as user-like entries. */
export const ACP_STATUS_CUSTOM_TYPE = "acp-status";

/** /acp-export handoff docs (src/export.ts) — UI-only transcript output,
 *  persistent in the session but never projected into LLM context (#255). */
export const ACP_EXPORT_CUSTOM_TYPE = "acp-export";

/** Custom-message types excluded from LLM-context projection (#255, #380):
 *  UI-only panels/docs that persist in the session but must not reach the
 *  model. Shared by the context projection (src/messages.ts) and the
 *  turn-boundary predicate below so the two views can never drift apart. */
const CONTEXT_EXCLUDED_CUSTOM_TYPES = new Set<string>([ACP_STATUS_CUSTOM_TYPE, ACP_EXPORT_CUSTOM_TYPE]);

/** Minimal structural shape of a session-log entry for boundary checks. Pi's
 *  SessionEntry and the narrower arrays used by token accounting both satisfy
 *  it without casts. */
export interface TurnBoundaryEntry {
  type?: string;
  id?: string;
  customType?: string;
  content?: unknown;
  message?: { role?: string };
}

/** Host multi-session policy (#364). Unset/false = pi-native behavior: only
 *  genuine user-role messages start a turn. Inline multi-session hosts (Prime
 *  RLM & co.) inject agent turns as custom_message entries; set
 *  countCustomMessages to make those delimit turns too. Default-off keeps
 *  standalone pi users' nudge cadence unchanged. */
export interface TurnBoundaryPolicy {
  countCustomMessages?: boolean;
}

/** True for host-injected custom_message entries that participate in LLM
 *  context — every custom_message except the UI-only types in
 *  CONTEXT_EXCLUDED_CUSTOM_TYPES (acp-status panels, acp-export docs). Type
 *  guard so callers keep narrowing the session-entry union (shared by the
 *  context projection in src/messages.ts and the policy-aware boundary check
 *  below so the two can never drift apart). */
export function isCustomMessageEntry(entry: TurnBoundaryEntry): entry is TurnBoundaryEntry & { type: "custom_message" } {
  return entry.type === "custom_message" && !CONTEXT_EXCLUDED_CUSTOM_TYPES.has(entry.customType);
}

/** The ONE turn-boundary predicate (#364): does this entry start a new turn?
 *  Genuine user-role messages always do (pi-native); host-injected
 *  custom_message entries do only when the host opts in via policy. */
export function isTurnBoundary(entry: TurnBoundaryEntry, policy: TurnBoundaryPolicy = {}): boolean {
  if (entry.message?.role === "user") return true;
  return policy.countCustomMessages === true && isCustomMessageEntry(entry);
}

/** Id of the last turn-boundary entry — the per-turn key for nudge
 *  accounting, retry caps and outcome scoping. Defaults to pi-native
 *  boundaries (user-role only); pass a host policy to also count injected
 *  custom_message entries. Returns undefined when no boundary exists yet. */
export function lastTurnBoundaryId(entries: readonly TurnBoundaryEntry[], policy?: TurnBoundaryPolicy): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (isTurnBoundary(e, policy)) return e.id;
  }
  return undefined;
}

/** Index of the last turn-boundary entry — the start of the current turn for
 *  compress-outcome scoping. Same policy semantics as lastTurnBoundaryId;
 *  -1 when no boundary has been seen yet. */
export function lastTurnBoundaryIndex(entries: readonly TurnBoundaryEntry[], policy?: TurnBoundaryPolicy): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isTurnBoundary(entries[i]!, policy)) return i;
  }
  return -1;
}
