/**
 * pi's model providers, read from and written to pi's own config files.
 *
 * There is no RPC for this. pi's RPC surface covers a running *session* —
 * switching the model it talks to, listing what is available, and so on — but
 * the provider definitions and their credentials are read from `models.json`
 * and `auth.json` once at startup, before any session exists. So this module
 * edits those two files directly.
 *
 * Layout, per `ModelsJsonProvider` in pi's `core/model-config.d.ts`:
 *
 *   models.json  { providers: { <id>: { name, baseUrl, api, apiKey?, models: [...] } } }
 *   auth.json    { <id>: { type: "api_key", key: "..." } }
 *
 * pi accepts a credential in either place (`apiKey` inline, or `auth.json`
 * under the provider id) and treats them as equivalent. We read both, and
 * write `auth.json`, because that is where pi's own login flow stores them and
 * keeping every secret in one 0600 file is easier to reason about than secrets
 * scattered through a definition file the user is likely to paste into a chat.
 *
 * Everything here preserves fields it does not understand. The provider schema
 * is large — `compat`, `modelOverrides`, `thinkingLevelMap`, per-model `cost`,
 * `inputLimits` — and a save that rebuilt a provider from only the fields this
 * UI renders would silently delete the rest of the user's configuration.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Both paths are resolved per call rather than cached at module load, because
 * pi reads `PI_CODING_AGENT_DIR` on every `getAgentDir()`. Tests point that
 * variable at a scratch directory; a cached path would escape the sandbox and
 * write to the user's real config.
 */
export function modelsPath(): string {
  return join(getAgentDir(), "models.json");
}

export function authPath(): string {
  return join(getAgentDir(), "auth.json");
}

/**
 * pi's built-in providers, from `KnownProvider` in `@earendil-works/pi-ai`.
 *
 * This is what "自定义" means in the UI: a provider id outside this list is one
 * the user invented, and only they know its endpoint and protocol. A known id
 * still needs a key, but pi supplies the base URL and wire protocol, so the
 * editor can leave those alone.
 *
 * Kept as a literal instead of imported because `pi-ai` is a transitive
 * dependency of the pi launcher and pnpm's strict layout does not expose it. If
 * pi adds a provider, the worst case is one that could have been recognised is
 * labelled 自定义 — a cosmetic miss, not a wrong write.
 */
export const KNOWN_PROVIDERS: readonly string[] = [
  "amazon-bedrock",
  "ant-ling",
  "anthropic",
  "google",
  "google-vertex",
  "openai",
  "azure-openai-responses",
  "openai-codex",
  "radius",
  "nvidia",
  "deepseek",
  "github-copilot",
  "xai",
  "groq",
  "cerebras",
  "openrouter",
  "vercel-ai-gateway",
  "zai",
  "zai-coding-cn",
  "mistral",
  "minimax",
  "minimax-cn",
  "moonshotai",
  "moonshotai-cn",
  "huggingface",
  "fireworks",
  "together",
  "baseten",
  "opencode",
  "opencode-go",
  "kimi-coding",
  "meta",
  "cloudflare-workers-ai",
  "cloudflare-ai-gateway",
  "qwen-token-plan",
  "qwen-token-plan-cn",
  "qwen-token-plan-individual",
  "xiaomi",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-sgp",
];

/**
 * Wire protocols pi can speak, from the `Api` union in `@earendil-works/pi-ai`.
 * `radius` is OAuth-only and has no key to enter, but it is a valid value for
 * the field, so the editor offers it rather than rejecting a hand-edited file.
 */
export const API_PROTOCOLS: readonly string[] = [
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "google-generative-ai",
  "google-vertex",
  "azure-openai-responses",
  "amazon-bedrock",
  "radius",
];

/** Provider ids are lowercase, start with a letter, and may use digits/dashes. */
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A model's `thinkingLevelMap`, narrowed to the shape the composer reads.
 *
 * pi validates this file itself, so a malformed value here is one the runtime
 * would reject too; dropping it only costs the `xhigh`/`max` distinction, which
 * is the safe direction (fewer offered levels, never an invented one).
 */
function isThinkingLevelMap(value: unknown): value is Record<string, string | null> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => entry === null || typeof entry === "string");
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    // A missing file is the normal state before the first provider is added,
    // not an error. Anything else (permissions, a directory in the way) is.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new ModelConfigError(`cannot read ${path}: ${(err as Error).message}`);
  }
  if (raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ModelConfigError(`${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (!isRecord(parsed)) throw new ModelConfigError(`${path} must contain a JSON object`);
  return parsed;
}

/**
 * A model entry inside a provider. pi only requires `id`.
 *
 * The three optional fields are the ones the settings page edits directly. They
 * all follow the same convention: absent means "say nothing", so pi falls back
 * to the provider's own catalog entry for this model (or to its built-in
 * defaults). That is why the editor can leave a field blank without inventing a
 * value — a wrong context window is worse than an unstated one.
 */
export interface ProviderModelEntry {
  id: string;
  name?: string;
  /** Tokens the model can hold in one conversation. */
  contextWindow?: number;
  /** Tokens the model may generate in one reply. */
  maxTokens?: number;
  /** Modalities the model accepts, from pi's `input` union. */
  input?: string[];
  /**
   * True when the model can be asked to think before it answers.
   *
   * This is the one capability no catalog endpoint reports in a standard field:
   * OpenAI and Anthropic answer with an id and nothing else, so discovery can
   * only ever guess it from whatever a gateway chose to add (see
   * `catalogReasons`). The editor carries a checkbox for it precisely because a
   * guess is not always available and is not always right.
   *
   * Absent means "say nothing": pi falls back to its own catalog entry for this
   * model, and a model it does not know gets no thinking levels at all.
   */
  reasoning?: boolean;
  /**
   * Which of pi's thinking levels this model maps to; `null` disables one.
   *
   * Only `xhigh` and `max` have to be named here — every level below them exists
   * as soon as `reasoning` is true — which is why the editor offers exactly
   * those two as checkboxes and leaves the rest of the map untouched. A value is
   * the effort name the provider expects, which for most endpoints is the level
   * name itself.
   */
  thinkingLevelMap?: Record<string, string | null>;
}

/** pi's `input` field admits exactly these two modalities. */
const INPUT_MODALITIES: readonly string[] = ["text", "image"];

/** A token count pi would accept: a finite, positive number. */
function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Read an `input` array, or nothing when it declares no usable modality.
 *
 * pi's schema for this field is a list of `text`/`image` literals, so anything
 * else in the file is a value pi itself would refuse; dropping it keeps the
 * rest of the entry readable instead of failing the whole page.
 */
function readInputModalities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && INPUT_MODALITIES.includes(item) && !out.includes(item)) {
      out.push(item);
    }
  }
  return out.length > 0 ? out : undefined;
}

/** What the settings page renders for one provider. Never carries a secret. */
export interface ModelProviderView {
  id: string;
  name: string;
  baseUrl: string | null;
  api: string | null;
  /** A credential exists in `auth.json` or inline in `models.json`. */
  configured: boolean;
  /**
   * Where that credential lives. `auth.json` entries are the ones this UI
   * writes; `inline` is a key pasted straight into `models.json`, which we
   * report but do not manage.
   */
  keySource: "auth" | "inline" | null;
  /** True when the id is not in pi's built-in catalog, i.e. user-invented. */
  custom: boolean;
  models: ProviderModelEntry[];
}

function readModels(provider: Record<string, unknown>): ProviderModelEntry[] {
  const list = provider.models;
  if (!Array.isArray(list)) return [];
  const out: ProviderModelEntry[] = [];
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const input = readInputModalities(entry.input);
    out.push({
      id: entry.id,
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      ...(isTokenCount(entry.contextWindow) ? { contextWindow: entry.contextWindow } : {}),
      ...(isTokenCount(entry.maxTokens) ? { maxTokens: entry.maxTokens } : {}),
      ...(input === undefined ? {} : { input }),
      ...(typeof entry.reasoning === "boolean" ? { reasoning: entry.reasoning } : {}),
      ...(isThinkingLevelMap(entry.thinkingLevelMap)
        ? { thinkingLevelMap: entry.thinkingLevelMap }
        : {}),
    });
  }
  return out;
}

/** Read every configured provider, with credential state but no credentials. */
export async function readProviders(): Promise<ModelProviderView[]> {
  const models = await readJsonFile(modelsPath());
  const auth = await readJsonFile(authPath());
  const providers = isRecord(models.providers) ? models.providers : {};

  const out: ModelProviderView[] = [];
  for (const [id, value] of Object.entries(providers)) {
    if (!isRecord(value)) continue;
    const entry = auth[id];
    const hasAuthKey =
      isRecord(entry) && entry.type === "api_key" && typeof entry.key === "string" && entry.key.length > 0;
    const hasInlineKey = typeof value.apiKey === "string" && value.apiKey.length > 0;

    out.push({
      id,
      name: typeof value.name === "string" && value.name.length > 0 ? value.name : id,
      baseUrl: typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? value.baseUrl : null,
      api: typeof value.api === "string" && value.api.length > 0 ? value.api : null,
      configured: hasAuthKey || hasInlineKey,
      keySource: hasAuthKey ? "auth" : hasInlineKey ? "inline" : null,
      custom: !KNOWN_PROVIDERS.includes(id),
      models: readModels(value),
    });
  }

  // Insertion order from `models.json`, which `JSON.parse` preserves for
  // string keys. Sorting would fight the user: they add a provider and expect
  // it where they put it, not wherever its id falls alphabetically. It is also
  // the order dsh shows — its known provider first, then the user's own rows in
  // the order they were created.
  return out;
}

/**
 * One model definition, as far as the composer needs it.
 *
 * The settings page edits `id`, `name`, `contextWindow`, `maxTokens` and
 * `input`; the input bar also wants the display name and the context window, so
 * this keeps those fields in the shape a session's model picker asks for.
 * Everything else in the entry (`cost`, `compat`, …) is still ignored here.
 */
export interface CatalogModel {
  id: string;
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
  /**
   * Which of pi's thinking levels this model maps to; `null` disables one.
   * Only `xhigh`/`max` need it — every lower level is always available to a
   * reasoning model — but the whole map is kept so the composer can answer the
   * same list a running pi would (`get_available_thinking_levels`).
   */
  thinkingLevelMap?: Record<string, string | null>;
}

/** `models.json`'s model list, keyed by provider id then model id. */
export type ModelCatalog = Map<string, Map<string, CatalogModel>>;

/**
 * The provider/model definitions on disk, keyed for lookup.
 *
 * This is the same file and the same entries pi resolves at startup, which is
 * what makes it usable for the model the composer shows before any process
 * exists: the session's JSONL records a `model_change` entry, and this turns
 * that pair back into a name and a context window. Reading it is not inventing a
 * catalog — a model missing from here is one pi would not know either.
 */
export async function readModelCatalog(): Promise<ModelCatalog> {
  const models = await readJsonFile(modelsPath());
  const providers = isRecord(models.providers) ? models.providers : {};
  const catalog: ModelCatalog = new Map();
  for (const [providerId, value] of Object.entries(providers)) {
    if (!isRecord(value)) continue;
    const list = Array.isArray(value.models) ? value.models : [];
    const entries = new Map<string, CatalogModel>();
    for (const raw of list) {
      if (!isRecord(raw) || typeof raw.id !== "string") continue;
      entries.set(raw.id, {
        id: raw.id,
        ...(typeof raw.name === "string" ? { name: raw.name } : {}),
        ...(typeof raw.contextWindow === "number" ? { contextWindow: raw.contextWindow } : {}),
        ...(typeof raw.reasoning === "boolean" ? { reasoning: raw.reasoning } : {}),
        ...(isThinkingLevelMap(raw.thinkingLevelMap)
          ? { thinkingLevelMap: raw.thinkingLevelMap }
          : {}),
      });
    }
    catalog.set(providerId, entries);
  }
  return catalog;
}

export interface ProviderInput {
  id: string;
  name?: string;
  baseUrl?: string;
  api?: string;
  /**
   * Write-only. `undefined` leaves the stored key untouched, which is what the
   * editor sends when the user did not retype it — the page never receives the
   * current key, so it cannot echo one back. An empty string clears it.
   */
  apiKey?: string;
  models?: ProviderModelEntry[];
}

export function validateProviderId(id: string): string {
  if (!PROVIDER_ID_PATTERN.test(id)) {
    throw new ModelConfigError("需以小写字母开头，之后可用小写字母、数字和短横线。");
  }
  return id;
}

// --- asking a provider what models it offers --------------------------------

/** How long to wait on a provider before giving up, in milliseconds. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Where a provider lists its models.
 *
 * Anthropic's listing endpoint hangs off the version prefix, which lives in the
 * path rather than the host (`https://api.anthropic.com/v1/models`) while its
 * message endpoint is reached as `{baseUrl}/v1/messages`. So the prefix is
 * appended only when the user has not already typed it — plenty of people paste
 * a base URL that already ends in `/v1`, and doubling it asks for a path the
 * provider does not serve.
 */
function modelsEndpoint(baseUrl: string, api: string | null): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (api === "anthropic-messages") {
    return /\/v\d+$/.test(trimmed) ? `${trimmed}/models` : `${trimmed}/v1/models`;
  }
  return `${trimmed}/models`;
}

/**
 * Credential headers, chosen by wire protocol.
 *
 * Anthropic takes the key in `x-api-key` and requires a version header; every
 * OpenAI-shaped endpoint takes a bearer token. pi's own `anthropic-messages`
 * transport accepts either `x-api-key` or `authorization`, but a proxy that
 * mirrors only the documented form is common enough that sending the canonical
 * one is the safer default.
 */
export function authHeaders(api: string | null, apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey === undefined || apiKey.length === 0) return headers;
  if (api === "anthropic-messages") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

/**
 * Read a model list out of whatever shape came back.
 *
 * OpenAI and Anthropic both answer `{ data: [{ id, … }] }`, which is the common
 * case. `{ models: [...] }` and a bare string array are also seen in the wild
 * from self-hosted gateways, and accepting them costs one branch.
 */
function parseModelList(body: unknown): ProviderModelEntry[] {
  // A bare array is the list itself; otherwise it is nested under a key.
  const list = Array.isArray(body)
    ? body
    : isRecord(body)
      ? Array.isArray(body.data)
        ? body.data
        : Array.isArray(body.models)
          ? body.models
          : null
      : null;
  if (list === null) {
    throw new ModelConfigError(
      isRecord(body) || Array.isArray(body)
        ? "无法从提供方的响应里找到模型列表。"
        : "提供方的响应不是 JSON 对象。",
    );
  }

  const seen = new Set<string>();
  const out: ProviderModelEntry[] = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      if (entry.length === 0 || seen.has(entry)) continue;
      seen.add(entry);
      out.push({ id: entry });
      continue;
    }
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    // Anthropic calls it `display_name`; OpenAI-shaped catalogs use `name`.
    const label =
      typeof entry.display_name === "string" && entry.display_name.length > 0
        ? entry.display_name
        : typeof entry.name === "string" && entry.name.length > 0
          ? entry.name
          : undefined;
    const parsed: ProviderModelEntry = label === undefined ? { id: entry.id } : { id: entry.id, name: label };
    // Capabilities ride along when the endpoint volunteers them: an id and a
    // label are all OpenAI and Anthropic ever send, but a gateway fronting many
    // models usually knows more, and dropping it would mean the user retypes a
    // context window the provider just handed us.
    const contextWindow = firstCount(entry, CATALOG_CONTEXT_PATHS);
    if (contextWindow !== undefined) parsed.contextWindow = contextWindow;
    const maxTokens = firstCount(entry, CATALOG_MAX_TOKENS_PATHS);
    if (maxTokens !== undefined) parsed.maxTokens = maxTokens;
    const modalities = catalogModalities(entry);
    if (modalities !== undefined) parsed.input = modalities;
    // `reasoning` is the exception to "copy what is there": see catalogReasons.
    if (catalogReasons(entry)) parsed.reasoning = true;
    out.push(parsed);
  }
  return out;
}

/**
 * Where a catalog entry might keep the size of its context window.
 *
 * Spellings differ by vendor rather than by protocol: OpenRouter answers
 * `context_length` (and repeats it under `top_provider`), LiteLLM
 * `max_input_tokens`, vLLM `max_model_len`. None of them is authoritative for
 * `models.json` — the editor can correct whatever this picks up — but taking the
 * first one that is present beats making the user look it up.
 */
const CATALOG_CONTEXT_PATHS: readonly string[] = [
  "contextWindow",
  "context_window",
  "context_length",
  "max_context_length",
  "max_input_tokens",
  "max_model_len",
  "top_provider.context_length",
];

/** The same idea for the reply cap, which is offered even less often. */
const CATALOG_MAX_TOKENS_PATHS: readonly string[] = [
  "maxTokens",
  "max_tokens",
  "max_output_tokens",
  "max_completion_tokens",
  "top_provider.max_completion_tokens",
];

/** Read a dotted path out of nested records; anything else reads as absent. */
function readPath(entry: Record<string, unknown>, path: string): unknown {
  let value: unknown = entry;
  for (const step of path.split(".")) {
    if (!isRecord(value)) return undefined;
    value = value[step];
  }
  return value;
}

/**
 * The first positive count among `paths`, or nothing.
 *
 * A count that arrives as a string is accepted (`/^\d+$/` only, so `"128k"` is
 * not guessed at) because some gateways serialize their numbers that way. A
 * zero or a negative is not a claim about a model, it is a placeholder, and a
 * value pi would reject stops the whole provider from loading.
 */
function firstCount(entry: Record<string, unknown>, paths: readonly string[]): number | undefined {
  for (const path of paths) {
    const value = readPath(entry, path);
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) {
      const parsed = Number(value);
      if (parsed > 0) return parsed;
    }
  }
  return undefined;
}

/**
 * The modalities an entry declares, in pi's vocabulary.
 *
 * `input` is pi's own field name, `input_modalities` and
 * `architecture.input_modalities` are OpenRouter's, and a `capabilities` map or
 * list carrying `vision` means the same thing. Only `text` and `image` survive:
 * they are the whole of pi's union, so an `audio` this endpoint accepts would be
 * a value pi refuses.
 */
function catalogModalities(entry: Record<string, unknown>): string[] | undefined {
  const out: string[] = [];
  for (const path of ["input", "input_modalities", "architecture.input_modalities"]) {
    const value = readPath(entry, path);
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && INPUT_MODALITIES.includes(item) && !out.includes(item)) {
        out.push(item);
      }
    }
  }
  if (catalogCapabilityNames(entry).includes("vision") && !out.includes("image")) out.push("image");
  return out.length > 0 ? out : undefined;
}

/**
 * True when an entry *affirms* that the model can think.
 *
 * Only an affirmation is copied, never a denial. A gateway's `reasoning: false`
 * can mean "this model returns no reasoning text" as easily as "this model
 * cannot reason", and pi would take the first as the second and hide the effort
 * ladder on a model that has one. Saying nothing leaves pi's own catalog in
 * charge, which is the safe direction: fewer levels offered, never an invented
 * one.
 */
function catalogReasons(entry: Record<string, unknown>): boolean {
  for (const path of [
    "reasoning",
    "capabilities.reasoning",
    "model_info.supports_reasoning",
    "model_info.supports_reasoning_effort",
  ]) {
    if (readPath(entry, path) === true) return true;
  }
  if (catalogCapabilityNames(entry).includes("reasoning")) return true;
  // OpenRouter lists `reasoning` and `reasoning_effort` among the parameters a
  // model accepts, which is the same statement in a different shape.
  const parameters = readPath(entry, "supported_parameters");
  return (
    Array.isArray(parameters) &&
    parameters.some((name) => typeof name === "string" && name.startsWith("reasoning"))
  );
}

/**
 * Capability names from whichever shape a `capabilities` field arrived in.
 *
 * Both are seen: a list of names (`["reasoning", "vision"]`) and a map of
 * booleans (`{ reasoning: true }`).
 */
function catalogCapabilityNames(entry: Record<string, unknown>): string[] {
  const capabilities = readPath(entry, "capabilities");
  if (Array.isArray(capabilities)) {
    return capabilities.filter((name): name is string => typeof name === "string");
  }
  if (isRecord(capabilities)) {
    return Object.entries(capabilities)
      .filter(([, on]) => on === true)
      .map(([name]) => name);
  }
  return [];
}

export interface FetchModelsInput {
  /** Used only to fall back to the stored credential when none is supplied. */
  id?: string;
  baseUrl: string;
  api?: string;
  /** A key typed but not yet saved. Absent means "use the stored one". */
  apiKey?: string;
}

/** The credential to use: what the caller typed, else what is on disk. */
async function resolveApiKey(input: FetchModelsInput): Promise<string | undefined> {
  if (input.apiKey !== undefined) {
    return input.apiKey.length > 0 ? input.apiKey : undefined;
  }
  if (input.id === undefined) return undefined;

  const auth = await readJsonFile(authPath());
  const entry = auth[input.id];
  if (isRecord(entry) && entry.type === "api_key" && typeof entry.key === "string") {
    return entry.key;
  }
  const models = await readJsonFile(modelsPath());
  const providers = isRecord(models.providers) ? models.providers : {};
  const provider = providers[input.id];
  if (isRecord(provider) && typeof provider.apiKey === "string") return provider.apiKey;
  return undefined;
}

/**
 * One provider's address, protocol, credential and model list: everything a
 * side call needs, and nothing about a session.
 */
export interface ProviderConnection {
  id: string;
  /** Base URL with any trailing slashes removed. */
  baseUrl: string;
  /** Wire protocol from `models.json`; `null` means an OpenAI-shaped endpoint. */
  api: string | null;
  /** Resolved credential, if one is configured. Never logged or returned to the browser. */
  apiKey: string | undefined;
  models: ProviderModelEntry[];
}

/**
 * Read one provider's connection facts, for a caller that is not the settings
 * page — `composer.ts` and the title service both need to call a provider
 * without a pi process.
 *
 * @param id - provider key from `models.json`.
 * @returns the connection, or `undefined` when the id is unknown or has no URL.
 */
export async function readProviderConnection(id: string): Promise<ProviderConnection | undefined> {
  const models = await readJsonFile(modelsPath());
  const providers = isRecord(models.providers) ? models.providers : {};
  const provider = providers[id];
  if (!isRecord(provider)) return undefined;
  const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.replace(/\/+$/, "") : "";
  if (baseUrl.length === 0) return undefined;
  return {
    id,
    baseUrl,
    api: typeof provider.api === "string" && provider.api.length > 0 ? provider.api : null,
    apiKey: await resolveApiKey({ id, baseUrl }),
    models: readModels(provider),
  };
}

/**
 * Ask a provider which models it serves.
 *
 * This is not something pi can answer for us. `get_available_models` reports the
 * models already configured, and `refreshModels` is a per-provider method on
 * pi-ai's provider objects — it is not exported and each provider implements its
 * own. So the request is made from here, against the provider's own catalog
 * endpoint.
 *
 * The parameters are deliberately unsaved ones: a provider being created has no
 * id yet and no file to read from, and asking which models exist is exactly how
 * a user finds out what to type into 模型目录.
 */
export async function fetchProviderModels(input: FetchModelsInput): Promise<ProviderModelEntry[]> {
  const baseUrl = validateBaseUrl(input.baseUrl);
  const api = input.api !== undefined && input.api.length > 0 ? input.api : null;
  const url = modelsEndpoint(baseUrl, api);
  const apiKey = await resolveApiKey(input);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: authHeaders(api, apiKey),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (err) {
    const cause = (err as Error).name === "TimeoutError" ? "请求超时" : (err as Error).message;
    throw new ModelConfigError(`无法连接 ${url}：${cause}`);
  }

  if (!response.ok) {
    // The status is the useful part (401 for a bad key, 404 for a wrong path);
    // the body may be an HTML error page, so it is truncated rather than
    // forwarded whole.
    const text = await response.text().catch(() => "");
    const detail = text.replace(/\s+/g, " ").trim().slice(0, 200);
    throw new ModelConfigError(
      `提供方返回 ${response.status}${detail.length > 0 ? `：${detail}` : ""}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new ModelConfigError(`${url} 的响应不是 JSON：${(err as Error).message}`);
  }
  return parseModelList(body);
}

function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ModelConfigError("请输入有效的 HTTP 或 HTTPS 地址。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ModelConfigError("请输入有效的 HTTP 或 HTTPS 地址。");
  }
  return value;
}

/**
 * Timestamped backup before a write, matching the `.bak.<suffix>` files pi's
 * own tooling leaves behind. Renaming is atomic and the old contents are small,
 * so this is cheap insurance against a bug in the merge below.
 */
async function backup(path: string): Promise<void> {
  let existing: string;
  try {
    existing = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new ModelConfigError(`cannot back up ${path}: ${(err as Error).message}`);
  }
  const stamp = Math.floor(Date.now() / 1000);
  await writeFile(`${path}.bak.pi-web-simple-${stamp}`, existing, "utf8");
}

/** Temp file + rename, so a crash mid-write cannot truncate the config. */
async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(getAgentDir(), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

/**
 * Merge the model list the editor sent into the one already stored, matching by
 * id.
 *
 * The editor renders `id`, `name`, the two capacities, the modality list,
 * `reasoning` and `thinkingLevelMap`, but a model entry carries far more —
 * `cost`, `compat`, `inputLimits`. Rebuilding the array from the rendered
 * fields would drop all of it: a provider whose model declared a per-token
 * price would come back without one, and pi would fall back to defaults that
 * are wrong for that endpoint.
 *
 * The rendered fields are set from what the editor sent, where an absent value
 * means "remove it" rather than "leave it" — the editor holds the entire entry's
 * worth of these fields in its state, so a cleared field is a deliberate one,
 * and keeping the old number would make clearing impossible. `reasoning` and
 * `thinkingLevelMap` are the exception, because pi may have been reading them
 * from a hand-written entry all along: see the note at the end of this
 * function.
 *
 * Entries the editor no longer lists are removed, so deleting a model from the
 * dialog still deletes it.
 */
function mergeModels(
  previous: unknown,
  incoming: ProviderModelEntry[],
): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  if (Array.isArray(previous)) {
    for (const entry of previous) {
      if (isRecord(entry) && typeof entry.id === "string") byId.set(entry.id, entry);
    }
  }
  return incoming.map((model) => {
    const merged: Record<string, unknown> = { ...(byId.get(model.id) ?? {}) };
    merged.id = model.id;
    // An empty name means "use the id", which pi expresses by omitting the
    // field — storing `name: ""` would leave a blank label in its model picker.
    if (model.name === undefined || model.name.length === 0) delete merged.name;
    else merged.name = model.name;
    // Same rule for the numeric capacities: blank is inheritance, not zero. A
    // stored 0 would be a claim about the model rather than the absence of one,
    // and a count pi's schema refuses is dropped rather than written to a file
    // pi would then refuse to load.
    for (const field of ["contextWindow", "maxTokens"] as const) {
      const value = model[field];
      if (isTokenCount(value)) merged[field] = value;
      else delete merged[field];
    }
    // And for `input`: an empty list is not "accepts nothing", it is "ask the
    // provider's own catalog".
    const input = readInputModalities(model.input);
    if (input === undefined) delete merged.input;
    else merged.input = input;
    // The thinking pair is the one place a missing field is not a clearing.
    // These two can be hand-written into `models.json` — pi's own catalog may
    // not describe the model at all — so a caller that stays silent about them
    // keeps whatever pi has been reading. The editor is never silent: it sends
    // `false` (this model does not think, which is a statement of its own) or
    // an empty map (no extra levels) when the user asks for one.
    if (typeof model.reasoning === "boolean") merged.reasoning = model.reasoning;
    if (model.thinkingLevelMap !== undefined) {
      if (Object.keys(model.thinkingLevelMap).length === 0) delete merged.thinkingLevelMap;
      else merged.thinkingLevelMap = model.thinkingLevelMap;
    }
    return merged;
  });
}

/**
 * Create or update one provider, merging into whatever is already there.
 *
 * `mode` decides the failure when the id already exists: the "添加提供方" flow
 * passes `create` so a collision is reported instead of quietly overwriting a
 * provider the user forgot about. The editor passes `update`.
 */
export async function saveProvider(
  input: ProviderInput,
  mode: "create" | "update",
): Promise<ModelProviderView> {
  const id = validateProviderId(input.id);
  const models = await readJsonFile(modelsPath());
  const providers = isRecord(models.providers) ? { ...models.providers } : {};
  const existing = isRecord(providers[id]) ? (providers[id] as Record<string, unknown>) : undefined;

  if (mode === "create" && existing !== undefined) {
    throw new ModelConfigError("已有提供方使用了这个 ID。");
  }
  if (mode === "update" && existing === undefined) {
    throw new ModelConfigError(`没有找到提供方 ${id}。`);
  }

  // Spread the existing entry first: unknown fields survive an edit.
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  next.name = input.name !== undefined && input.name.length > 0 ? input.name : (existing?.name ?? id);
  if (input.baseUrl !== undefined) {
    if (input.baseUrl.length > 0) next.baseUrl = validateBaseUrl(input.baseUrl);
    else delete next.baseUrl;
  }
  if (input.api !== undefined) {
    if (input.api.length > 0) next.api = input.api;
    else delete next.api;
  }
  if (input.models !== undefined) {
    next.models = mergeModels(existing?.models, input.models);
  }

  // A key stored inline in models.json would shadow the one we are about to
  // write, and the editor cannot show it to let the user decide. Clearing it
  // matters only when the user is actually setting a key here; a save that
  // leaves `apiKey` untouched would look correct and change nothing.
  if (input.apiKey !== undefined && input.apiKey.length > 0) delete next.apiKey;

  providers[id] = next;
  models.providers = providers;

  await backup(modelsPath());
  await writeJsonAtomic(modelsPath(), models);

  if (input.apiKey !== undefined) {
    const auth = await readJsonFile(authPath());
    if (input.apiKey.length > 0) {
      auth[id] = { type: "api_key", key: input.apiKey };
    } else {
      delete auth[id];
    }
    await backup(authPath());
    await writeJsonAtomic(authPath(), auth);
  }

  const all = await readProviders();
  const saved = all.find((p) => p.id === id);
  if (saved === undefined) throw new ModelConfigError(`无法读回提供方 ${id}。`);
  return saved;
}

/**
 * Remove a provider and the credential this UI is responsible for.
 *
 * A key in `auth.json` is ours to delete — we wrote it and nothing else reads
 * that entry. An inline `models.json.apiKey` disappears with the provider
 * because it lives inside it. Credentials from the environment were never
 * ours, so they are untouched by definition.
 */
export async function deleteProvider(id: string): Promise<void> {
  const models = await readJsonFile(modelsPath());
  const providers = isRecord(models.providers) ? { ...models.providers } : {};
  if (!(id in providers)) throw new ModelConfigError(`没有找到提供方 ${id}。`);
  delete providers[id];
  models.providers = providers;

  await backup(modelsPath());
  await writeJsonAtomic(modelsPath(), models);

  const auth = await readJsonFile(authPath());
  if (id in auth) {
    delete auth[id];
    await backup(authPath());
    await writeJsonAtomic(authPath(), auth);
  }
}
