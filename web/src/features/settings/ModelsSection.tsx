import { useEffect, useId, useState } from "react";
import clsx from "clsx";
import { Glyph } from "../../components/dsh-icons.tsx";
import { actions, appStore, useT } from "../../lib/app-state.ts";
import { useStore } from "../../lib/store.ts";
import type { ModelProvider } from "../../lib/types.ts";
import { ProviderEditor } from "./ProviderEditor.tsx";
import { Dialog } from "./Dialog.tsx";
import { SegmentedControl } from "./SegmentedControl.tsx";
import styles from "./ModelsSection.module.css";

/**
 * The model provider list, ported from dsh's `settings-models` section.
 *
 * What differs is where the data comes from. dsh has its own provider registry
 * and a `settings.yaml` it mutates through a controller; pi keeps providers in
 * `models.json` with credentials in `auth.json` and exposes no RPC for either,
 * so the server edits those files directly.
 *
 * The shape of the page is dsh's: a card per configured provider carrying its
 * credential state and its own inline editor, one card open at a time, and ONE
 * add button whose card switches between adopting a provider from pi's
 * built-in catalog and declaring a custom model API. Both panels stay mounted
 * once visited, so switching modes discards neither draft, and the switch
 * locks while a panel has a write or an endpoint interrogation in flight.
 *
 * dsh's first-run posture — an unconfigured provider rendered as its open
 * setup card — has no counterpart here: pi requires an explicit `models.json`
 * entry for every provider, so a provider that is not configured is not in the
 * list at all (see docs/design-notes.md).
 */
export function ModelsSection({ className }: { className?: string }) {
  const t = useT();
  const state = useStore(appStore);
  const models = state.models;

  /** The id of the provider whose inline editor is open, if any. */
  const [editing, setEditing] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("catalog");
  /** Modes whose panel has been shown; they stay mounted from then on. */
  const [visited, setVisited] = useState<ReadonlySet<AddMode>>(new Set());
  /** The catalog provider the add card is currently editing. */
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [customBusy, setCustomBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<ModelProvider | null>(null);
  const addId = useId();

  useEffect(() => {
    // The list is a file read, but the first one happens after a cold start of
    // the API server, so it still lands a tick late.
    if (state.models === null) void actions.loadModels();
  }, [state.models]);

  const providers = models?.providers ?? [];
  const knownProviders = models?.knownProviders ?? [];
  const apiProtocols = models?.apiProtocols ?? [];
  const taken = providers.map((provider) => provider.id);
  /** Known providers pi ships that this file has not declared yet. */
  const addable = knownProviders.filter((id) => !taken.includes(id));
  const catalogOffered = addable.length > 0;
  const customOffered = apiProtocols.length > 0;
  const bothOffered = catalogOffered && customOffered;
  // A mode that cannot be offered is never shown; a mode that can is only
  // shown when the owner picked it.
  const mode: AddMode = bothOffered ? addMode : customOffered ? "custom" : "catalog";
  const mounted = (candidate: AddMode): boolean =>
    mode === candidate || visited.has(candidate);
  const switchLocked = catalogBusy || customBusy;
  // The select keeps the draft for the provider it is showing; a provider that
  // stopped being addable (it was just created) falls back to the first one.
  const draftId =
    catalogId !== null && addable.includes(catalogId) ? catalogId : addable[0];

  const openAdd = (): void => {
    const initial: AddMode = catalogOffered ? "catalog" : "custom";
    setEditing(null);
    setCatalogId(addable[0] ?? null);
    setAddMode(initial);
    setVisited(new Set<AddMode>([initial]));
    setAddOpen(true);
  };

  const closeAdd = (): void => {
    setAddOpen(false);
    setCatalogBusy(false);
    setCustomBusy(false);
    setCatalogId(null);
  };

  return (
    <div className={clsx(styles.section, className)}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t("model.label")}</h1>
        {/*
          dsh's button says 打开配置文件 because it is a desktop app that can
          hand the path to the OS. A browser cannot, so the label names what
          this actually does instead of promising a reveal that will not happen.
          The path is shown next to it so the copy target is never a mystery.
        */}
        <button
          type="button"
          className={styles.configPath}
          title={models === null ? undefined : models.modelsPath}
          onClick={() => {
            if (models === null) return;
            void navigator.clipboard
              .writeText(models.modelsPath)
              .then(() => actions.setNotice(t("settings.models.copyNotice", { path: models.modelsPath })))
              .catch(() => actions.setNotice(models.modelsPath));
          }}
        >{t("settings.models.copyPath")}</button>
      </div>

      <p className={styles.intro}>{t("settings.models.lead")}</p>

      {models === null ? (
        <p className={styles.loading}>{t("settings.models.loading")}</p>
      ) : (
        <>
          <ul className={styles.rows}>
            {providers.map((provider) => (
              <li key={provider.id} className={styles.rowCard}>
                <div className={styles.rowHead}>
                  <span className={styles.rowIdentity}>
                    <span className={styles.rowName}>{provider.name}</span>
                    {provider.custom && (
                      <span className={styles.rowTag}>{t("settings.models.customBadge")}</span>
                    )}
                    {/*
                      The dot reports a credential in the config files, which is
                      where a provider configured on this page keeps it. A key
                      supplied through the environment is not visible here —
                      saying "未配置" for it would be wrong, so the tooltip names
                      the scope: this is what the files hold.
                    */}
                    <span
                      role="img"
                      className={clsx(
                        styles.credentialDot,
                        provider.configured
                          ? styles.credentialDotConfigured
                          : styles.credentialDotMissing,
                      )}
                      aria-label={
                        provider.configured
                          ? t("settings.models.credentialConfigured")
                          : t("settings.models.credentialMissing")
                      }
                      title={
                        provider.configured
                          ? provider.keySource === "auth"
                            ? t("settings.models.keyInAuth")
                            : t("settings.models.keyInline")
                          : t("settings.models.keyMissing")
                      }
                    />
                  </span>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      aria-label={t("settings.provider.editTitle", { name: provider.name })}
                      onClick={() => {
                        // One card at a time: opening a row's editor closes the
                        // add card without touching what it holds.
                        setAddOpen(false);
                        setEditing(editing === provider.id ? null : provider.id);
                      }}
                    >{t("common.edit")}</button>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      aria-label={t("settings.models.removeLabel", { id: provider.id })}
                      onClick={() => setConfirmingDelete(provider)}
                    >{t("common.delete")}</button>
                  </div>
                </div>

                {!addOpen && editing === provider.id && (
                  <ProviderEditor
                    mode="edit"
                    provider={provider}
                    taken={taken}
                    apiProtocols={apiProtocols}
                    onClose={() => setEditing(null)}
                  />
                )}
              </li>
            ))}
          </ul>

          {addOpen ? (
            <div className={styles.addCard}>
              <div className={styles.addModes}>
                {bothOffered ? (
                  <SegmentedControl
                    id={addId}
                    label={t("settings.models.addMode")}
                    value={mode}
                    disabled={switchLocked}
                    options={[
                      {
                        value: "catalog",
                        label: t("settings.models.addCatalog"),
                        disabled: !catalogOffered,
                        title: catalogOffered
                          ? undefined
                          : t("settings.models.addCatalogExhausted"),
                      },
                      {
                        value: "custom",
                        label: t("settings.models.addCustom"),
                        disabled: !customOffered,
                        title: customOffered
                          ? undefined
                          : t("settings.models.addCustomUnavailable"),
                      },
                    ]}
                    onChange={(next) => {
                      setAddMode(next);
                      setVisited((current) => new Set(current).add(next));
                    }}
                  />
                ) : (
                  <div className={styles.editorHeader}>
                    <span className={styles.editorTitle}>
                      {t(mode === "catalog" ? "settings.models.addCatalog" : "settings.models.addCustom")}
                    </span>
                  </div>
                )}
              </div>

              <p className={styles.advancedHint}>
                {t(mode === "catalog" ? "settings.models.addCatalogHint" : "settings.models.addCustomHint")}
              </p>

              {mounted("catalog") && draftId !== undefined && (
                <div
                  id={`${addId}-catalog-panel`}
                  className={styles.addPanel}
                  role={bothOffered ? "tabpanel" : undefined}
                  aria-labelledby={bothOffered ? `${addId}-catalog` : undefined}
                  hidden={mode !== "catalog"}
                >
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>{t("settings.provider.fieldLabel")}</span>
                    <select
                      className={clsx(styles.input, styles.selectInput)}
                      value={draftId}
                      disabled={switchLocked}
                      onChange={(event) => setCatalogId(event.target.value)}
                    >
                      {addable.map((id) => (
                        <option key={id} value={id}>{id}</option>
                      ))}
                    </select>
                  </label>
                  {/* Keyed by the route so switching providers starts a fresh
                      draft instead of carrying the previous one's fields. */}
                  <ProviderEditor
                    key={draftId}
                    mode="create-known"
                    knownId={draftId}
                    taken={taken}
                    apiProtocols={apiProtocols}
                    onBusyChange={setCatalogBusy}
                    onClose={closeAdd}
                  />
                </div>
              )}

              {mounted("custom") && customOffered && (
                <div
                  id={`${addId}-custom-panel`}
                  className={styles.addPanel}
                  role={bothOffered ? "tabpanel" : undefined}
                  aria-labelledby={bothOffered ? `${addId}-custom` : undefined}
                  hidden={mode !== "custom"}
                >
                  <ProviderEditor
                    mode="create-custom"
                    taken={taken}
                    apiProtocols={apiProtocols}
                    onBusyChange={setCustomBusy}
                    onClose={closeAdd}
                  />
                </div>
              )}
            </div>
          ) : (
            (catalogOffered || customOffered) && (
              <div className={styles.addActions}>
                <button type="button" className={styles.addButton} onClick={openAdd}>
                  <Glyph name="plus" size={14} />{t("settings.models.addProvider")}
                </button>
              </div>
            )
          )}
        </>
      )}

      {confirmingDelete !== null && (
        <DeleteProviderDialog
          provider={confirmingDelete}
          onClose={() => setConfirmingDelete(null)}
        />
      )}
    </div>
  );
}

/** The two ways to add a provider: adopt one from pi's catalog, or declare one. */
type AddMode = "catalog" | "custom";

/**
 * Deletion is the one irreversible action here, so the consequence is spelled
 * out with dsh's wording — including which credentials survive. A key in
 * `auth.json` is ours and goes with the provider; one from the environment was
 * never ours to remove.
 */
function DeleteProviderDialog({
  provider,
  onClose,
}: {
  provider: ModelProvider;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = (): void => {
    setBusy(true);
    setError(null);
    void actions
      .deleteProvider(provider.id)
      .then(() => onClose())
      .catch((err: Error) => {
        setError(err.message);
        setBusy(false);
      });
  };

  return (
    <Dialog
      className={clsx(styles.modalPanel, styles.deleteDialog)}
      onClose={busy ? undefined : onClose}
      label={t("settings.models.removeTitle", { name: provider.name })}
    >
      <div className={styles.modalHeader}>
        <h2 className={styles.modalTitle}>{t("settings.models.removeTitle", { name: provider.name })}</h2>
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          disabled={busy}
          aria-label={t("common.close")}
        >
          <Glyph name="closeOutline" size={14} />
        </button>
      </div>
      <p className={styles.modalDescription}>
        {provider.keySource === "auth"
          ? t("settings.models.removeWithKey", { name: provider.name })
          : t("settings.models.removeKeepKey", { name: provider.name })}
      </p>
      {error !== null && (
        <div className={styles.modalBody}>
          <p className={styles.dialogError}>{error}</p>
        </div>
      )}
      <div className={styles.modalFooter}>
        <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className={clsx(styles.secondaryButton, styles.deleteConfirm)}
          onClick={remove}
          disabled={busy}
        >{busy ? t("settings.models.removing", { name: provider.name }) : t("common.delete")}</button>
      </div>
    </Dialog>
  );
}
