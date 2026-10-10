import { useState } from "react";
import clsx from "clsx";
import { Glyph } from "../../components/dsh-icons.tsx";
import { actions, appStore, useT } from "../../lib/app-state.ts";
// Aliased: `api` is also the name of this form's wire-protocol field, which is
// dsh's label for it (API 协议) and not worth renaming.
import { api as apiClient } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import type { ModelProvider, ProviderModelEntry } from "../../lib/types.ts";
import { Dialog } from "./Dialog.tsx";
import { FetchModelsDialog } from "./FetchModelsDialog.tsx";
import { formatCapacity, parseCapacity } from "./model-capacity.ts";
import styles from "./ProviderEditor.module.css";

type EditorMode = "edit" | "create-known" | "create-custom";

/** The two token counts a model row edits behind its disclosure. */
type CapacityField = "contextWindow" | "maxTokens";

/** pi's `input` union, in the order the row offers it. */
const INPUT_MODALITIES = ["text", "image"] as const;
type InputModality = (typeof INPUT_MODALITIES)[number];

/**
 * The two levels a model has to name explicitly.
 *
 * `off` through `high` exist for any reasoning model; `xhigh` and `max` name
 * provider-specific efforts, so pi offers them only when `thinkingLevelMap`
 * names them. That makes these two the whole of what a checkbox can add — and
 * the reason the editor edits a map rather than owning one: a hand-written
 * entry for any other level, including the `null` that disables one, survives.
 */
const TOP_THINKING_LEVELS = ["xhigh", "max"] as const;
type TopThinkingLevel = (typeof TOP_THINKING_LEVELS)[number];

/**
 * What a row with no declared `input` shows instead: pi treats a model with no
 * `input` as taking text, and an unchecked box would read as "this model accepts
 * nothing", which is not a state pi has.
 */
const DEFAULT_MODALITIES: readonly InputModality[] = ["text"];

/**
 * One provider's editor, ported from dsh's `ProviderEditor`.
 *
 * Three choices carry over from dsh and are worth stating, because each one is
 * a place a naive editor would do something convenient and wrong:
 *
 * The API key is **write-only**. The page never receives the current key, so it
 * cannot show or echo one; a save that leaves the field untouched sends no key
 * at all and the stored one survives. t("settings.provider.apiKeyConfigured") is the placeholder
 * for exactly that state.
 *
 * The **API address and protocol live in a collapsed 自定义设置 area**. pi knows
 * the endpoint and wire protocol for its built-in providers, so most edits only
 * need a key, and putting the two technical fields next to it would make the
 * common case look like it required them.
 *
 * **Reasoning is a per-model checkbox, not a provider-wide setting** — dsh's
 * reason for leaving it out altogether still holds: the capability belongs to
 * the model, and models under one provider disagree about it, so a
 * provider-scoped control could only offer values some of them reject. Putting
 * it on the row is the narrow version of the same conclusion, and the only
 * place it can be said at all: no catalog endpoint reports it (the server tries
 * anyway — see `catalogReasons`), and without it the model gets no thinking
 * levels in the composer.
 */
export function ProviderEditor({
  mode,
  provider,
  knownProviders,
  apiProtocols,
  onClose,
}: {
  mode: EditorMode;
  provider: ModelProvider | null;
  knownProviders: string[];
  apiProtocols: string[];
  onClose: () => void;
}) {
  const t = useT();
  const state = useStore(appStore);
  const existing = new Set((state.models?.providers ?? []).map((p) => p.id));

  const [id, setId] = useState(provider?.id ?? "");
  const [name, setName] = useState(provider?.name ?? "");
  // Always empty: the current key is not ours to prefill.
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [api, setApi] = useState(provider?.api ?? "");
  const [models, setModels] = useState<ProviderModelEntry[]>(provider?.models ?? []);
  // Which rows show their capacity and input-type fields. Kept per index rather
  // than per model id, because a row being typed into has no id yet.
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<number>>(new Set());
  // Capacity fields are edited as text, so a field's keystrokes are held here
  // rather than re-derived from the parsed count on every change — that would
  // rewrite `1000000` to `1M` mid-word. Unreadable text is kept past blur so the
  // refusal names a row the user can still see, which is why this is one entry
  // PER FIELD: a single buffer would be displaced by editing any other field,
  // and the abandoned one would render its stored NaN as the literal `NaN`.
  const [capacityDrafts, setCapacityDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  // Open when the provider already has something in there, or when the user is
  // creating one by hand and cannot get a working provider without it.
  const [advancedOpen, setAdvancedOpen] = useState(
    mode === "create-custom" || provider?.baseUrl != null || (provider?.models.length ?? 0) > 0,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Model discovery runs against the values currently in the form, not a saved
  // provider, so it works while creating one too.
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<ProviderModelEntry[] | null>(null);

  const creating = mode !== "edit";
  const known = mode === "create-known";
  const idLocked = !creating || known;

  const idProblem = ((): string | null => {
    if (id.length === 0) return creating ? t("settings.provider.idRequired") : null;
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      return t("settings.provider.idRule");
    }
    if (creating && existing.has(id)) return t("settings.provider.idTaken");
    return null;
  })();

  /**
   * Ask the provider what it serves, then offer the results for selection.
   *
   * The credential sent is the one currently typed, or — when the field is
   * untouched — whatever is on disk under this provider's id, which the server
   * resolves. The key itself never comes back.
   */
  const discoverModels = (): void => {
    const trimmed = baseUrl.trim();
    if (trimmed.length === 0) {
      setFetchError(t("settings.provider.needBaseUrl"));
      return;
    }
    setFetching(true);
    setFetchError(null);
    void apiClient
      .fetchProviderModels({
        ...(creating ? {} : { id }),
        baseUrl: trimmed,
        ...(api.length > 0 ? { api } : {}),
        ...(apiKey.length > 0 ? { apiKey } : {}),
      })
      .then(({ models: found }) => {
        setFetching(false);
        if (found.length === 0) {
          setFetchError(t("settings.provider.noModels"));
          return;
        }
        setFetched(found);
      })
      .catch((err: Error) => {
        setFetching(false);
        setFetchError(err.message);
      });
  };

  const submit = (): void => {
    if (idProblem !== null) {
      setError(idProblem);
      return;
    }
    // An unreadable capacity is held in the row as `NaN` so the user can see and
    // fix it; it must not reach the wire, where JSON turns it into `null`.
    if (models.some((model) => hasUnreadableCapacity(model))) {
      setError(t("settings.provider.modelCapacityInvalid"));
      return;
    }
    setBusy(true);
    setError(null);

    // A key is only sent when the user typed one. `undefined` tells the server
    // to leave the stored credential alone.
    const key = apiKey.length > 0 ? { apiKey } : {};
    const payload = {
      name,
      baseUrl,
      api,
      models,
      ...key,
    };

    const request = creating
      ? actions.createProvider({ id, ...payload })
      : actions.updateProvider(id, payload);

    void request
      .then(() => onClose())
      .catch((err: Error) => {
        setError(err.message);
        setBusy(false);
      });
  };

  /** Replace one row's editable fields, dropping any the caller cleared. */
  const patchModel = (index: number, next: Partial<ProviderModelEntry>): void => {
    setModels((list) =>
      list.map((entry, at) => (at === index ? cleanedEntry({ ...entry, ...next }) : entry)),
    );
  };

  /**
   * Turn one of the two levels pi cannot infer on or off.
   *
   * Only the named level changes. The map may also carry entries for the levels
   * below — a custom effort name, or the `null` that disables one — and
   * rebuilding it from these checkboxes would drop every one of them.
   */
  const toggleThinkingLevel = (index: number, level: TopThinkingLevel, on: boolean): void => {
    setModels((list) =>
      list.map((entry, at) => {
        if (at !== index) return entry;
        const map = { ...(entry.thinkingLevelMap ?? {}) };
        // Re-ticking a level keeps whatever effort it was mapped to.
        if (on) map[level] = map[level] ?? level;
        else delete map[level];
        return cleanedEntry({ ...entry, thinkingLevelMap: map });
      }),
    );
  };

  /**
   * What a capacity field shows: the buffer while it is being typed into, else
   * the stored count.
   */
  const capacityText = (model: ProviderModelEntry, index: number, field: CapacityField): string =>
    capacityDrafts.get(capacityKeyOf(index, field)) ?? capacitySpelling(model[field]);

  /**
   * Hold the keystrokes and put the parsed count in the row at the same time, so
   * the entry is never behind the field the user is looking at. Unreadable text
   * lands as `NaN`, which is what the save refuses.
   */
  const editCapacity = (index: number, field: CapacityField, text: string): void => {
    setCapacityDrafts((current) => new Map(current).set(capacityKeyOf(index, field), text));
    const parsed = parseCapacity(text);
    patchModel(index, field === "contextWindow" ? { contextWindow: parsed } : { maxTokens: parsed });
  };

  const settleCapacity = (index: number, field: CapacityField): void => {
    const key = capacityKeyOf(index, field);
    const typed = capacityDrafts.get(key);
    if (typed === undefined) return;
    // Unreadable text stays on screen: the save-time rejection names a row the
    // user can still see and correct.
    const parsed = parseCapacity(typed);
    if (parsed !== undefined && Number.isNaN(parsed)) return;
    setCapacityDrafts((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };

  const toggleRow = (index: number): void => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  };

  const removeModel = (index: number): void => {
    setModels((list) => list.filter((_, at) => at !== index));
    // Both row-keyed maps shift with the list, or the row below the deleted one
    // would inherit its half-typed text and its open disclosure.
    setExpandedRows((current) => reindexRows(current, index));
    setCapacityDrafts((current) => reindexDrafts(current, index));
  };

  const title =
    mode === "edit"
      ? t("settings.provider.editTitle", { name: provider?.name ?? id })
      : mode === "create-custom"
        ? t("settings.provider.customTitle")
        : t("settings.provider.addTitle");

  return (
    <Dialog onClose={busy ? undefined : onClose} label={title}>
      <h2 className={styles.title}>{title}</h2>

      <div className={styles.body}>
        {known ? (
          <Field label={t("settings.provider.fieldLabel")} hint={t("settings.provider.fieldHint")}>
            <select
              className={styles.input}
              value={id}
              aria-label={t("settings.provider.fieldLabel")}
              onChange={(event) => {
                setId(event.target.value);
                setName(event.target.value);
              }}
            >
              <option value="">{t("settings.provider.none")}</option>
              {knownProviders
                .filter((candidate) => !existing.has(candidate))
                .map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {candidate}
                  </option>
                ))}
            </select>
          </Field>
        ) : (
          <Field label={t("settings.provider.idLabel")} hint={idLocked ? undefined : t("settings.provider.fieldHint")}>
            <input
              className={styles.input}
              value={id}
              readOnly={idLocked}
              aria-label={t("settings.provider.idLabel")}
              placeholder="my-provider"
              onChange={(event) => setId(event.target.value)}
            />
          </Field>
        )}

        {!known && (
          <Field label={t("settings.provider.displayName")} hint={t("settings.provider.displayNameHint")}>
            <input
              className={styles.input}
              value={name}
              aria-label={t("settings.provider.displayName")}
              placeholder={id}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        )}

        <Field
          label={t("settings.provider.apiKey")}
          hint={
            provider?.configured === true
              ? t("settings.provider.apiKeyConfigured")
              : t("settings.provider.apiKeyHint")
          }
        >
          <input
            className={styles.input}
            type="password"
            value={apiKey}
            aria-label={t("settings.provider.apiKey")}
            autoComplete="off"
            placeholder={provider?.configured === true ? t("settings.provider.apiKeyConfigured") : t("settings.provider.apiKeyPlaceholder")}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </Field>

        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={advancedOpen}
          data-disclosure-row
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <Glyph
            name="chevronDown"
            size={14}
            className={advancedOpen ? styles.caretOpen : styles.caret}
          />{t("settings.provider.customSettings")}</button>

        {advancedOpen && (
          <div className={styles.advanced}>
            <Field
              label={t("settings.provider.baseUrl")}
              hint={t("settings.provider.baseUrlHint")}
            >
              <input
                className={styles.input}
                value={baseUrl}
                aria-label={t("settings.provider.baseUrl")}
                placeholder="https://api.example.com/v1"
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </Field>

            <Field label={t("settings.provider.apiProtocol")} hint={t("settings.provider.apiProtocolHint")}>
              <select
                className={styles.input}
                value={api}
                aria-label={t("settings.provider.apiProtocol")}
                onChange={(event) => setApi(event.target.value)}
              >
                <option value="">{t("settings.provider.none")}</option>
                {apiProtocols.map((protocol) => (
                  <option key={protocol} value={protocol}>
                    {protocol}
                  </option>
                ))}
              </select>
            </Field>

            <div className={styles.modelsHeader}>
              <span className={styles.modelsLabel}>{t("settings.provider.modelCatalog")}</span>
              <button
                type="button"
                className={styles.smallButton}
                disabled={fetching}
                onClick={discoverModels}
              >
                {fetching ? t("settings.provider.fetching") : t("settings.provider.fetchModels")}
              </button>
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => setModels((list) => [...list, { id: "" }])}
              >
                <Glyph name="plus" size={14} />{t("settings.provider.addModel")}</button>
            </div>
            {fetchError !== null && <p className={styles.fetchError}>{fetchError}</p>}
            {models.length === 0 && (
              <p className={styles.modelsEmpty}>{t("settings.provider.catalogHint")}</p>
            )}
            {models.map((model, index) => (
              <ModelRow
                key={index}
                model={model}
                index={index}
                expanded={expandedRows.has(index)}
                contextWindow={capacityText(model, index, "contextWindow")}
                maxTokens={capacityText(model, index, "maxTokens")}
                onToggle={() => toggleRow(index)}
                onIdChange={(value) => patchModel(index, { id: value })}
                onNameChange={(value) => patchModel(index, { name: value })}
                onCapacityChange={(field, text) => editCapacity(index, field, text)}
                onCapacitySettle={(field) => settleCapacity(index, field)}
                onModalitiesChange={(input) => patchModel(index, { input })}
                onReasoningChange={(value) => patchModel(index, { reasoning: value })}
                onThinkingLevelChange={(level, on) => toggleThinkingLevel(index, level, on)}
                onRemove={() => removeModel(index)}
              />
            ))}
          </div>
        )}

        {error !== null && <p className={styles.error}>{error}</p>}
      </div>

      {fetched !== null && (
        <FetchModelsDialog
          models={fetched}
          existing={models.map((entry) => entry.id).filter((value) => value.length > 0)}
          onAdopt={(selected) => {
            // Existing entries are left exactly as they are; the dialog does not
            // let them be selected, so a hand-edited contextWindow survives a
            // discovery round.
            setModels((list) => {
              const byId = new Map(
                list.filter((entry) => entry.id.length > 0).map((entry) => [entry.id, entry]),
              );
              for (const entry of selected) byId.set(entry.id, entry);
              return [...byId.values()];
            });
            setFetched(null);
          }}
          onClose={() => setFetched(null)}
        />
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.ghostButton} onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
        <button
          type="button"
          className={clsx(styles.primaryButton)}
          onClick={submit}
          disabled={busy || idProblem !== null}
        >
          {busy ? (creating ? t("settings.provider.creating") : t("settings.provider.saving")) : creating ? t("settings.provider.create") : t("common.save")}
        </button>
      </div>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {hint !== undefined && <span className={styles.fieldHint}>{hint}</span>}
      {children}
    </label>
  );
}

/**
 * One model in a provider's catalog: identity on the top line, the capacities
 * and input types behind a disclosure.
 *
 * The disclosure exists because those fields are the exception rather than the
 * rule. Most models need nothing typed here — pi's built-in catalog already
 * describes the ones it knows, and a wrong context window is worse than an
 * unstated one — so showing five controls per row would make the common edit
 * (a name) look like it required all of them.
 *
 * Ported from dsh's `ModelRow`. What is added here is the translation between
 * its text fields and pi's numeric ones (`model-capacity.ts`), and the narrower
 * modality set: pi's schema admits `text` and `image`, nothing else.
 */
function ModelRow({
  model,
  index,
  expanded,
  contextWindow,
  maxTokens,
  onToggle,
  onIdChange,
  onNameChange,
  onCapacityChange,
  onCapacitySettle,
  onModalitiesChange,
  onReasoningChange,
  onThinkingLevelChange,
  onRemove,
}: {
  model: ProviderModelEntry;
  index: number;
  expanded: boolean;
  /** Field text, which is the typed buffer while the user is in it. */
  contextWindow: string;
  maxTokens: string;
  onToggle: () => void;
  onIdChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onCapacityChange: (field: CapacityField, text: string) => void;
  onCapacitySettle: (field: CapacityField) => void;
  onModalitiesChange: (input: string[]) => void;
  onReasoningChange: (value: boolean) => void;
  onThinkingLevelChange: (level: TopThinkingLevel, on: boolean) => void;
  onRemove: () => void;
}) {
  const t = useT();
  // A model with no declared `input` shows what pi would assume for it. The
  // distinction matters on save rather than on screen: untouched, the entry
  // keeps no `input` field at all.
  const selected: readonly string[] = model.input ?? DEFAULT_MODALITIES;
  const onlySelected = selected.length === 1 ? selected[0] : undefined;
  return (
    <div className={styles.modelEntry}>
      <div className={styles.modelRow}>
        <input
          className={styles.input}
          value={model.id}
          aria-label={t("settings.provider.modelIdLabel", { index: index + 1 })}
          placeholder={t("settings.provider.modelId")}
          onChange={(event) => onIdChange(event.target.value)}
        />
        <input
          className={styles.input}
          value={model.name ?? ""}
          aria-label={t("settings.provider.modelNameLabel", { index: index + 1 })}
          placeholder={t("settings.provider.modelNamePlaceholder")}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <button
          type="button"
          className={styles.iconToggle}
          aria-expanded={expanded}
          aria-label={t("settings.provider.modelAdvancedLabel", { index: index + 1 })}
          title={t("settings.provider.modelAdvanced")}
          onClick={onToggle}
        >
          <Glyph
            name="chevronDown"
            size={14}
            className={expanded ? styles.caretOpen : styles.caret}
          />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t("settings.provider.removeModel", { index: index + 1 })}
          onClick={onRemove}
        >
          <Glyph name="trash" size={16} />
        </button>
      </div>

      {expanded && (
        <div className={styles.modelAdvanced}>
          {/*
            The placeholders are the sizes a person sees quoted most often, not
            a claim about this model: a blank field means pi decides, which is
            why the text is set as an example to type rather than a default that
            is already in effect.
          */}
          <label className={styles.modelField}>
            <span className={styles.modelFieldLabel}>{t("settings.provider.contextWindow")}</span>
            <input
              className={styles.input}
              inputMode="numeric"
              value={contextWindow}
              placeholder="256K"
              aria-label={t("settings.provider.contextWindowLabel", { index: index + 1 })}
              onChange={(event) => onCapacityChange("contextWindow", event.target.value)}
              onBlur={() => onCapacitySettle("contextWindow")}
            />
          </label>
          <label className={styles.modelField}>
            <span className={styles.modelFieldLabel}>{t("settings.provider.maxTokens")}</span>
            <input
              className={styles.input}
              inputMode="numeric"
              value={maxTokens}
              placeholder="32K"
              aria-label={t("settings.provider.maxTokensLabel", { index: index + 1 })}
              onChange={(event) => onCapacityChange("maxTokens", event.target.value)}
              onBlur={() => onCapacitySettle("maxTokens")}
            />
          </label>
          <fieldset className={styles.modelInputTypes}>
            <legend className={styles.modelFieldLabel}>
              {t("settings.provider.modelInputTypes")}
            </legend>
            <div className={styles.modelInputChoices}>
              {INPUT_MODALITIES.map((modality) => (
                <label key={modality} className={styles.modelInputChoice}>
                  <input
                    type="checkbox"
                    checked={selected.includes(modality)}
                    // The last remaining type cannot be unchecked: a model that
                    // accepts nothing is not a state pi can express, so the
                    // refusal is here rather than in a save-time error.
                    disabled={onlySelected === modality}
                    onChange={(event) => {
                      onModalitiesChange(
                        INPUT_MODALITIES.filter((value) =>
                          value === modality ? event.target.checked : selected.includes(value),
                        ),
                      );
                    }}
                  />
                  <span>
                    {t(
                      modality === "text"
                        ? "settings.provider.modelInputText"
                        : "settings.provider.modelInputImage",
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.modelInputTypes}>
            <legend className={styles.modelFieldLabel}>
              {t("settings.provider.modelThinking")}
            </legend>
            <div className={styles.modelInputChoices}>
              <label
                className={styles.modelInputChoice}
                title={t("settings.provider.modelReasoningHint")}
              >
                <input
                  type="checkbox"
                  checked={model.reasoning === true}
                  aria-label={t("settings.provider.modelReasoningLabel", { index: index + 1 })}
                  onChange={(event) => onReasoningChange(event.target.checked)}
                />
                <span>{t("settings.provider.modelReasoning")}</span>
              </label>
              {TOP_THINKING_LEVELS.map((level) => (
                <label
                  key={level}
                  className={styles.modelInputChoice}
                  title={t("settings.provider.modelTopLevelsHint")}
                >
                  <input
                    type="checkbox"
                    // A string is what makes a level exist; the map also spells
                    // `null` for one the model has but pi must not offer, and a
                    // tick there would say the opposite of what it says.
                    checked={typeof model.thinkingLevelMap?.[level] === "string"}
                    // No ladder to climb without reasoning: the two belong to
                    // the same statement, so the boxes move together.
                    disabled={model.reasoning !== true}
                    aria-label={t("settings.provider.modelLevelLabel", {
                      level,
                      index: index + 1,
                    })}
                    onChange={(event) => onThinkingLevelChange(level, event.target.checked)}
                  />
                  <span>
                    {t(
                      level === "xhigh"
                        ? "settings.provider.modelLevelXhigh"
                        : "settings.provider.modelLevelMax",
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}

/** A capacity the row is holding as `NaN` because its text could not be read. */
function hasUnreadableCapacity(model: ProviderModelEntry): boolean {
  return (["contextWindow", "maxTokens"] as const).some((field) => {
    const value = model[field];
    return typeof value === "number" && !Number.isFinite(value);
  });
}

/** Buffer key for one row's capacity field; the row half moves when rows do. */
function capacityKeyOf(index: number, field: CapacityField): string {
  return `${String(index)}:${field}`;
}

/**
 * One entry rebuilt from the fields this editor owns, minus the blank ones: pi
 * spells "unset" as the field's absence, so an empty string or a zero would be
 * a value where the UI meant silence.
 */
function cleanedEntry(entry: ProviderModelEntry): ProviderModelEntry {
  const next: ProviderModelEntry = { id: entry.id };
  if (entry.name !== undefined && entry.name.length > 0) next.name = entry.name;
  if (typeof entry.contextWindow === "number") next.contextWindow = entry.contextWindow;
  if (typeof entry.maxTokens === "number") next.maxTokens = entry.maxTokens;
  if (entry.input !== undefined && entry.input.length > 0) next.input = entry.input;
  // `false` is a value here, not an absence: pi reads it as "this model does not
  // think", which is what an unticked box asks for, and that is a different
  // statement from leaving the field out for pi's own catalog to answer.
  if (typeof entry.reasoning === "boolean") next.reasoning = entry.reasoning;
  // An empty map is sent as one rather than omitted: it is how the row says
  // "no extra levels", and a missing field would leave the stored map in place.
  if (entry.thinkingLevelMap !== undefined) next.thinkingLevelMap = entry.thinkingLevelMap;
  return next;
}

/** What a capacity field shows for a stored count; blank when unset or unreadable. */
function capacitySpelling(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "" : formatCapacity(value);
}

/** Drop one row's entry and shift the rows after it down. */
function reindexRows(current: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set<number>();
  for (const at of current) {
    if (at < index) next.add(at);
    else if (at > index) next.add(at - 1);
  }
  return next;
}

/** The same shift for the capacity buffers, whose keys carry the row number. */
function reindexDrafts(current: ReadonlyMap<string, string>, index: number): Map<string, string> {
  const next = new Map<string, string>();
  for (const [key, value] of current) {
    const at = Number(key.slice(0, key.indexOf(":")));
    if (at === index) continue;
    // Only the row number moves; the field half of the key is untouched.
    next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, value);
  }
  return next;
}
