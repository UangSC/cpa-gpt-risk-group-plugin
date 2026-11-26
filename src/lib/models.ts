import type { Credential, PrefixSettings } from '../types'
import { isManuallyExcluded } from './derive'
import { stripGroupPrefix } from './prefix'

const NON_CHAT_MODEL_PATTERNS: readonly RegExp[] = [
  // Image generation / editing
  /^(?:gpt|chatgpt)-image(?:$|[-_.])/,
  /^dall-?e(?:$|[-_.])/,
  /^imagen(?:$|[-_.])/,
  /^flux(?:$|[-_.])/,
  /^midjourney(?:$|[-_.])/,
  /^ideogram(?:$|[-_.])/,
  /^recraft(?:$|[-_.])/,
  /^seedream(?:$|[-_.])/,
  /^cogview(?:$|[-_.])/,
  /^wanx(?:$|[-_.])/,
  /^stable-diffusion(?:$|[-_.])/,
  /^sdxl(?:$|[-_.])/,
  /(?:^|[-_.])image(?:$|[-_.])/,

  // Decision / approval review / guardian / moderation / rerank / classifier
  /^codex-auto-review(?:$|[-_.])/,
  /(?:^|[-_.])auto-review(?:$|[-_.])/,
  /(?:^|[-_.])decisions?(?:$|[-_.])/,
  /(?:^|[-_.])guardian(?:$|[-_.])/,
  /(?:^|[-_.])moderation(?:$|[-_.])/,
  /(?:^|[-_.])rerank(?:er)?(?:$|[-_.])/,
  /(?:^|[-_.])classifier(?:$|[-_.])/,
  /(?:^|[-_.])judge(?:$|[-_.])/,
  /(?:^|[-_.])guard(?:$|[-_.])/,

  // Video generation
  /^sora(?:$|[-_.])/,
  /^veo(?:$|[-_.])/,
  /(?:^|[-_.])video(?:$|[-_.])/,

  // Live / Realtime / Audio / Speech / TTS / Transcription
  /^gpt-live(?:$|[-_.])/,
  /^gpt-realtime(?:$|[-_.])/,
  /(?:^|[-_.])realtime(?:$|[-_.])/,
  /(?:^|[-_.])tts(?:$|[-_.])/,
  /^whisper(?:$|[-_.])/,
  /(?:^|[-_.])transcribe(?:$|[-_.])/,
  /(?:^|[-_.])audio(?:$|[-_.])/,
  /(?:^|[-_.])speech(?:$|[-_.])/,

  // Embeddings
  /(?:^|[-_.])embeddings?(?:$|[-_.])/,
]

export interface QuickModelChoice {
  name: string
  count: number
}

function canonicalModelId(model: string, prefixes?: PrefixSettings): string {
  const stripped = prefixes ? stripGroupPrefix(model, prefixes) : model.trim()
  const slashIndex = stripped.lastIndexOf('/')
  const bare = slashIndex >= 0 ? stripped.slice(slashIndex + 1) : stripped
  return bare.trim().toLowerCase()
}

/**
 * Returns true when a model identifier represents a chat/text-completion model
 * suitable for inspection tests (excluding image generation, decision/review,
 * video, realtime/audio, and embedding models).
 */
export function isChatInspectionModel(model: string, prefixes?: PrefixSettings): boolean {
  const canonical = canonicalModelId(model, prefixes)
  if (!canonical) return false
  return !NON_CHAT_MODEL_PATTERNS.some((pattern) => pattern.test(canonical))
}

/**
 * Collects available chat models from active, non-excluded credentials for the
 * quick inspection config popover, keeping the current inspectionModel first
 * only if it is itself a chat model.
 */
export function collectQuickModelChoices(
  credentials: Credential[],
  inspectionModel: string,
  prefixes: PrefixSettings,
): QuickModelChoice[] {
  const counts = new Map<string, number>()
  for (const credential of credentials) {
    if (credential.disabled || isManuallyExcluded(credential)) continue
    const unique = new Set(
      credential.models
        .map((m) => stripGroupPrefix(m, prefixes))
        .filter((name) => isChatInspectionModel(name, prefixes)),
    )
    for (const name of unique) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }

  const names = new Set<string>(counts.keys())
  const cleanCurrent = inspectionModel.trim()
  if (cleanCurrent && isChatInspectionModel(cleanCurrent, prefixes)) {
    names.add(cleanCurrent)
  }

  return [...names]
    .filter(Boolean)
    .sort((a, b) => (a === cleanCurrent ? -1 : b === cleanCurrent ? 1 : a.localeCompare(b)))
    .map((name) => ({ name, count: counts.get(name) ?? 0 }))
}

/**
 * Collects unique, sorted chat model names across all credentials for Settings.
 */
export function collectSettingsModelChoices(
  credentials: Credential[],
  prefixes: PrefixSettings,
): string[] {
  const names = new Set<string>()
  for (const credential of credentials) {
    for (const m of credential.models) {
      const stripped = stripGroupPrefix(m, prefixes)
      if (stripped && isChatInspectionModel(stripped, prefixes)) {
        names.add(stripped)
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}
