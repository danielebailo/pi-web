import { useMemo, useState } from "react";
import clsx from "clsx";
import { useT } from "../../lib/app-state.ts";
import type { ProviderModelEntry } from "../../lib/types.ts";
import { Glyph } from "../../components/dsh-icons.tsx";
import { Dialog } from "./Dialog.tsx";
import styles from "./ModelsSection.module.css";

/**
 * Pick which of a provider's models to add to its catalog.
 *
 * Ported from dsh's fetch dialog, including the shape of its list: a search
 * field, a select-all that acts on the rows the search left visible, and one
 * checkbox row per candidate.
 *
 * The dialog is a picker, never a write. Nothing reaches the file from here —
 * the selection is handed back and the editor applies it — and a candidate that
 * is already in the catalog starts unticked, because re-adding one would
 * rewrite its entry. It stays tickable, and if it is ticked the entry already
 * in the catalog wins, so a hand-edited `contextWindow` is never replaced by
 * whatever the endpoint happened to report.
 */
export function FetchModelsDialog({
  models,
  existing,
  onAdopt,
  onClose,
}: {
  models: ProviderModelEntry[];
  existing: string[];
  onAdopt: (selected: ProviderModelEntry[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const already = useMemo(() => new Set(existing), [existing]);
  const [query, setQuery] = useState("");
  // dsh pre-ticks everything the catalog does not have yet: the usual reason to
  // open this dialog is "show me what I am missing", and the ones already in
  // the file are exactly the ones a re-add must not touch.
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(models.filter((model) => !already.has(model.id)).map((model) => model.id)),
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return models;
    return models.filter(
      (model) =>
        model.id.toLowerCase().includes(needle) ||
        (model.name ?? "").toLowerCase().includes(needle),
    );
  }, [models, query]);

  const visibleIds = filtered.map((model) => model.id);
  const allPicked = visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog
      className={clsx(styles.modalPanel, styles.fetchDialog)}
      onClose={onClose}
      label={t("settings.fetch.title")}
    >
      <div className={styles.modalHeader}>
        <h2 className={styles.modalTitle}>{t("settings.fetch.title")}</h2>
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <Glyph name="closeOutline" size={14} />
        </button>
      </div>
      <p className={styles.modalDescription}>{t("settings.fetch.description")}</p>

      <div className={styles.modalBody}>
        <div className={styles.candidateToolbar}>
          <input
            className={clsx(styles.input, styles.candidateSearch)}
            type="search"
            value={query}
            aria-label={t("settings.fetch.searchLabel")}
            placeholder={t("settings.fetch.searchLabel")}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className={styles.linkButton}
            disabled={visibleIds.length === 0}
            onClick={() =>
              setPicked((current) => {
                const next = new Set(current);
                // Acts on the visible rows: with a search typed, "全选" meaning
                // "everything, including what you filtered out" is a surprise the
                // user discovers after saving.
                if (allPicked) for (const id of visibleIds) next.delete(id);
                else for (const id of visibleIds) next.add(id);
                return next;
              })
            }
          >{allPicked ? t("settings.fetch.clearAll") : t("settings.fetch.selectAll")}</button>
        </div>

        {filtered.length === 0 ? (
          <p className={styles.candidateEmpty} role="status">{t("settings.fetch.empty")}</p>
        ) : (
          <ul className={styles.candidateList}>
            {filtered.map((model) => (
              <li key={model.id} className={styles.candidate}>
                <label className={styles.candidateLabel}>
                  <input
                    type="checkbox"
                    checked={picked.has(model.id)}
                    onChange={() => toggle(model.id)}
                  />
                  {/* The display name is a title rather than a second column: the
                      list has to stay scannable by the id the file stores. */}
                  <span
                    className={styles.candidateId}
                    title={already.has(model.id) ? t("settings.fetch.present") : model.name ?? model.id}
                  >{model.id}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.modalFooter}>
        <button type="button" className={styles.secondaryButton} onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={picked.size === 0}
          onClick={() => onAdopt(models.filter((model) => picked.has(model.id)))}
        >{t("settings.fetch.add")}</button>
      </div>
    </Dialog>
  );
}
