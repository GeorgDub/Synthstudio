/**
 * Synthstudio – useApiSettingsStore
 *
 * Speichert API-Keys und KI-Einstellungen (localStorage, niemals in Git).
 *
 * Post-v1.25.0: Multi-Provider-Support.
 * Aktuell unterstützt: Anthropic (Claude) + OpenAI (ChatGPT/GPT).
 * Jede Provider-Implementierung hat ihren eigenen Key + Modell.
 * Das `activeProvider`-Feld bestimmt, welcher in AI-Features genutzt wird.
 *
 * Backward-compat: Altes `anthropicApiKey`+`aiModel`-Schema wird beim
 * ersten Laden in das neue `providers.{anthropic,openai}`-Schema migriert.
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-api-settings:v1";

/** Liste unterstützter AI-Provider. Erweiterbar (zukünftig: gemini, mistral, ...). */
export type AiProvider = "anthropic" | "openai";

export const AI_PROVIDERS: ReadonlyArray<AiProvider> = ["anthropic", "openai"];

/**
 * Embed-Verhalten bei Project-Save (v3.138).
 * - "auto":   nur Blob-URL-Samples (transformierte) einbetten — Default.
 * - "always": ALLE Samples einbetten (auch File-Path-Samples).
 * - "never":  KEIN Embed (kompakte .synth-Files, Data-Loss-Risiko bei Blob-URLs).
 */
export type EmbedBehavior = "auto" | "always" | "never";

export const EMBED_BEHAVIORS: ReadonlyArray<EmbedBehavior> = ["auto", "always", "never"];

function isEmbedBehavior(v: unknown): v is EmbedBehavior {
  return v === "auto" || v === "always" || v === "never";
}

/**
 * v3.151: WAV-Export Bit-Depth — Default 16 (DAW-Standard, kleinste Files),
 * Optional 24 (höhere Dynamic Range, ~50% mehr Dateigröße, Mastering-Standard).
 * Betrifft alle Live-Recorder, AudioInputRecorder, Channel-Bounce-Exports.
 */
export type WavBitDepth = 16 | 24;

export const WAV_BIT_DEPTHS: ReadonlyArray<WavBitDepth> = [16, 24];

function isWavBitDepth(v: unknown): v is WavBitDepth {
  return v === 16 || v === 24;
}

/** Default-Modell pro Provider. */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
};

/** Verfügbare Modelle pro Provider — zeigt der Settings-UI als Picker. */
export const AVAILABLE_MODELS: Record<AiProvider, Array<{ id: string; label: string }>> = {
  anthropic: [
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — schnell & günstig" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — kreativ & ausgewogen" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8 — maximal kreativ" },
  ],
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o Mini — schnell & günstig" },
    { id: "gpt-4o", label: "GPT-4o — kreativ & ausgewogen" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo — maximal kreativ" },
  ],
};

/** Per-Provider-State: API-Key + Modell. */
export interface ProviderConfig {
  apiKey: string;
  model: string;
}

interface ApiSettings {
  /** Welcher Provider ist gerade aktiv? */
  activeProvider: AiProvider;
  /** Per-Provider-Konfiguration (Key + Modell). */
  providers: Record<AiProvider, ProviderConfig>;
  /** AI aktiviert (true wenn aktiver Provider einen Key hat). */
  aiEnabled: boolean;

  /**
   * @deprecated Backward-compat: zeigt direkt auf providers.anthropic.apiKey.
   * Wird beim Schreiben automatisch mitsynchronisiert. Nicht direkt nutzen.
   */
  anthropicApiKey: string;
  /**
   * @deprecated Backward-compat: zeigt auf das Modell des AKTIVEN Providers.
   * Wird beim Schreiben automatisch mitsynchronisiert. Nicht direkt nutzen.
   */
  aiModel: string;

  /** Auto-Save aktiv (Projekt alle 3 Min. cachen) */
  autoSaveEnabled: boolean;
  /** Version-Snapshots aktiv (alle 5 Min.) */
  snapshotsEnabled: boolean;
  /** Auto-Save-Intervall in Minuten */
  autoSaveIntervalMin: number;

  /**
   * Embed-Verhalten bei Project-Save (v3.138). Steuert ob/wann Samples in das
   * .synth-File eingebettet werden.
   *  - "auto"   (default): nur Blob-URL-Samples einbetten (v3.137-Verhalten).
   *  - "always": ALLE Samples einbetten (Sicherer Round-Trip).
   *  - "never":  Keine Einbettung (kompakte Files, Data-Loss-Risiko bei Blob-URLs).
   */
  embedBehavior: EmbedBehavior;

  /**
   * v3.151: WAV-Export Bit-Depth. Default 16 (DAW-Standard), Optional 24
   * (höhere Dynamic Range fürs Mastering, ~50% mehr Dateigröße).
   */
  wavBitDepth: WavBitDepth;
}

type Listener = () => void;

function defaults(): ApiSettings {
  const providers: Record<AiProvider, ProviderConfig> = {
    anthropic: { apiKey: "", model: DEFAULT_MODELS.anthropic },
    openai: { apiKey: "", model: DEFAULT_MODELS.openai },
  };
  return withDerivedFields({
    activeProvider: "anthropic",
    providers,
    aiEnabled: false,
    anthropicApiKey: "",
    aiModel: DEFAULT_MODELS.anthropic,
    autoSaveEnabled: true,
    snapshotsEnabled: true,
    autoSaveIntervalMin: 3,
    embedBehavior: "auto",
    wavBitDepth: 16,
  });
}

/**
 * Synchronisiert die derived/back-compat Felder (`anthropicApiKey`, `aiModel`,
 * `aiEnabled`) mit der primären `providers` + `activeProvider`-Quelle.
 */
function withDerivedFields(s: ApiSettings): ApiSettings {
  const active = s.providers[s.activeProvider];
  return {
    ...s,
    aiEnabled: active.apiKey.length > 0,
    anthropicApiKey: s.providers.anthropic.apiKey,
    aiModel: active.model,
  };
}

/**
 * Migriert alte Storage-Payloads (anthropicApiKey + aiModel direkt) auf das
 * neue Schema mit `providers.{anthropic,openai}`. Behält ALLE existierenden
 * User-Werte.
 */
function migrateFromLegacy(raw: Record<string, unknown>): ApiSettings {
  const base = defaults();

  // Falls Storage bereits im neuen Format ist (providers-Feld vorhanden) →
  // einfach mergen.
  if (raw && typeof raw === "object" && "providers" in raw) {
    const inProviders = raw.providers as Record<string, ProviderConfig> | undefined;
    const provs: Record<AiProvider, ProviderConfig> = {
      anthropic: {
        apiKey: inProviders?.anthropic?.apiKey ?? "",
        model: inProviders?.anthropic?.model ?? DEFAULT_MODELS.anthropic,
      },
      openai: {
        apiKey: inProviders?.openai?.apiKey ?? "",
        model: inProviders?.openai?.model ?? DEFAULT_MODELS.openai,
      },
    };
    const activeProvider: AiProvider =
      raw.activeProvider === "openai" || raw.activeProvider === "anthropic"
        ? (raw.activeProvider as AiProvider)
        : "anthropic";
    return withDerivedFields({
      ...base,
      activeProvider,
      providers: provs,
      autoSaveEnabled: typeof raw.autoSaveEnabled === "boolean" ? raw.autoSaveEnabled : base.autoSaveEnabled,
      snapshotsEnabled: typeof raw.snapshotsEnabled === "boolean" ? raw.snapshotsEnabled : base.snapshotsEnabled,
      autoSaveIntervalMin:
        typeof raw.autoSaveIntervalMin === "number"
          ? Math.max(1, Math.min(60, raw.autoSaveIntervalMin))
          : base.autoSaveIntervalMin,
      embedBehavior: isEmbedBehavior(raw.embedBehavior) ? raw.embedBehavior : base.embedBehavior,
      wavBitDepth: isWavBitDepth(raw.wavBitDepth) ? raw.wavBitDepth : base.wavBitDepth,
    });
  }

  // Legacy-Format: anthropicApiKey + aiModel direkt.
  const legacyKey = typeof raw.anthropicApiKey === "string" ? raw.anthropicApiKey : "";
  const legacyModel = typeof raw.aiModel === "string" ? raw.aiModel : DEFAULT_MODELS.anthropic;
  const provs: Record<AiProvider, ProviderConfig> = {
    anthropic: { apiKey: legacyKey, model: legacyModel },
    openai: { apiKey: "", model: DEFAULT_MODELS.openai },
  };
  return withDerivedFields({
    ...base,
    activeProvider: "anthropic",
    providers: provs,
    autoSaveEnabled: typeof raw.autoSaveEnabled === "boolean" ? raw.autoSaveEnabled : base.autoSaveEnabled,
    snapshotsEnabled: typeof raw.snapshotsEnabled === "boolean" ? raw.snapshotsEnabled : base.snapshotsEnabled,
    autoSaveIntervalMin:
      typeof raw.autoSaveIntervalMin === "number"
        ? Math.max(1, Math.min(60, raw.autoSaveIntervalMin))
        : base.autoSaveIntervalMin,
    embedBehavior: isEmbedBehavior(raw.embedBehavior) ? raw.embedBehavior : base.embedBehavior,
  });
}

function load(): ApiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrateFromLegacy(JSON.parse(raw));
  } catch { /* ignore */ }
  return defaults();
}

function persist(s: ApiSettings) {
  try {
    // Wir persistieren das primäre Schema (ohne derived-Felder doppelt).
    const payload = {
      activeProvider: s.activeProvider,
      providers: s.providers,
      autoSaveEnabled: s.autoSaveEnabled,
      snapshotsEnabled: s.snapshotsEnabled,
      autoSaveIntervalMin: s.autoSaveIntervalMin,
      embedBehavior: s.embedBehavior,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch { /* ignore */ }
}

let _state: ApiSettings = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

// ─── Setter (primary API) ─────────────────────────────────────────────────────

export function setActiveProvider(provider: AiProvider): void {
  if (provider !== "anthropic" && provider !== "openai") return;
  _state = withDerivedFields({ ..._state, activeProvider: provider });
  persist(_state);
  notify();
}

/** Setzt den Key des aktuell aktiven Providers. */
export function setApiKey(key: string): void {
  setProviderKey(_state.activeProvider, key);
}

/** Setzt den Key eines spezifischen Providers (Multi-Provider Support). */
export function setProviderKey(provider: AiProvider, key: string): void {
  if (provider !== "anthropic" && provider !== "openai") return;
  const trimmed = key.trim();
  _state = withDerivedFields({
    ..._state,
    providers: {
      ..._state.providers,
      [provider]: { ..._state.providers[provider], apiKey: trimmed },
    },
  });
  persist(_state);
  notify();
}

/** Setzt das Modell des aktuell aktiven Providers. */
export function setAiModel(model: string): void {
  setProviderModel(_state.activeProvider, model);
}

/** Setzt das Modell eines spezifischen Providers. */
export function setProviderModel(provider: AiProvider, model: string): void {
  if (provider !== "anthropic" && provider !== "openai") return;
  if (typeof model !== "string" || model.length === 0) return;
  _state = withDerivedFields({
    ..._state,
    providers: {
      ..._state.providers,
      [provider]: { ..._state.providers[provider], model },
    },
  });
  persist(_state);
  notify();
}

export function setAutoSaveEnabled(enabled: boolean): void {
  _state = withDerivedFields({ ..._state, autoSaveEnabled: enabled });
  persist(_state);
  notify();
}

export function setSnapshotsEnabled(enabled: boolean): void {
  _state = withDerivedFields({ ..._state, snapshotsEnabled: enabled });
  persist(_state);
  notify();
}

export function setAutoSaveInterval(minutes: number): void {
  _state = withDerivedFields({
    ..._state,
    autoSaveIntervalMin: Math.max(1, Math.min(60, minutes)),
  });
  persist(_state);
  notify();
}

/**
 * Setzt das Embed-Verhalten beim Project-Save (v3.138).  Invalid-Inputs werden
 * silent ignoriert (keine State-Mutation), defensive gegen accidental cast.
 */
export function setEmbedBehavior(behavior: EmbedBehavior): void {
  if (!isEmbedBehavior(behavior)) return;
  _state = withDerivedFields({ ..._state, embedBehavior: behavior });
  persist(_state);
  notify();
}

/**
 * Setzt die WAV-Export Bit-Depth (v3.151). Invalid-Inputs werden silent
 * ignoriert (defensive gegen accidental cast).
 */
export function setWavBitDepth(depth: WavBitDepth): void {
  if (!isWavBitDepth(depth)) return;
  _state = withDerivedFields({ ..._state, wavBitDepth: depth });
  persist(_state);
  notify();
}

export function getApiSettings(): ApiSettings { return _state; }

/** Liefert die Config des aktuell aktiven Providers (Key + Modell). */
export function getActiveProviderConfig(): ProviderConfig & { provider: AiProvider } {
  const cfg = _state.providers[_state.activeProvider];
  return { provider: _state.activeProvider, ...cfg };
}

export function useApiSettingsStore(): ApiSettings {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
