import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import clsx from "clsx";
import { CheckIcon, RefreshIcon } from "../../components/icons.tsx";
import { Glyph } from "../../components/dsh-icons.tsx";
import type { ComposerModel } from "../../lib/types.ts";
import type { MessageKey } from "../../lib/i18n/index.ts";
import styles from "./ModelThinkingPicker.module.css";
import { useT } from "../../lib/app-state.ts";

export interface ModelThinkingPickerProps {
  /** The model the session is on; null when it has not chosen one yet. */
  model: ComposerModel | null;
  /** null means "not known" — only a running pi can enumerate the choices. */
  models: ComposerModel[] | null;
  /** The thinking level in effect; null when nothing has recorded one. */
  level: string | null;
  /**
   * The levels the current model accepts. null is "not known" — only a running
   * pi can enumerate them for a model `models.json` does not describe. A single
   * `["off"]` is a model that does not reason, and draws no slider.
   */
  levels: string[] | null;
  /** A live fetch is in flight (the cold start that learns the lists). */
  loading: boolean;
  /** The card was opened; fetch the model list if it is still unknown. */
  onRequest(): void;
  onSelectModel(provider: string, id: string): void;
  onSelectThinking(level: string): void;
}

/**
 * pi's thinking-level names, as i18n keys.
 *
 * A map rather than `thinking.level.${level}` concatenation because the message
 * table is typed: a template literal key would need a cast, and a cast is what
 * lets a renamed key go unnoticed until runtime.
 */
const LEVEL_KEYS: Record<string, MessageKey> = {
  off: "thinking.level.off",
  minimal: "thinking.level.minimal",
  low: "thinking.level.low",
  medium: "thinking.level.medium",
  high: "thinking.level.high",
  xhigh: "thinking.level.xhigh",
  max: "thinking.level.max",
};

/** The travelling disc's diameter. The track is inset from it vertically, so
 * the disc never overhangs the pill. */
const THUMB_SIZE = 28;
/**
 * Half a disc, and the whole of the inset at either end of the travel.
 *
 * The disc's centre runs from one half-disc in from the left to one half-disc
 * in from the right, so at either end the disc sits flush with the pill — the
 * first stop against its left cap, the last against its right. Anything more
 * than that shows up as a gap the user can see: an earlier version held the
 * travel back by 8px at the top end, and at `max` the track read as unfinished.
 */
const THUMB_INSET = THUMB_SIZE / 2;

interface Item {
  model: ComposerModel;
  index: number;
}

interface Group {
  provider: string;
  items: Item[];
}

/**
 * The model and thinking-effort control, in the shape Codex's composer menu
 * takes: one card naming the current model over a provider mark and a refresh
 * affordance, with an effort slider underneath.
 *
 * It replaces the pair of dropdowns (`ModelPicker` and `ThinkingPicker`) that
 * used to sit side by side in the toolbar. Two nested menus for what is really
 * one question — which model, thinking how hard — cost two opens and two
 * outside-click targets, and neither showed what the other was set to. The
 * slider is the reason the two are merged: pi's effort names are an ordered
 * ladder (`off` … `max`), so a position on a track carries the word plus two
 * facts a word cannot — which end is stronger, and how much room is left. The
 * model row above it stays a list, because models have no order to lay on a
 * line.
 *
 * Both lists can only come from a running pi (`get_available_models` is the
 * runtime's resolved view), so opening the card on a session read from disk
 * pays one cold start — deliberately, at the moment the user asked, rather
 * than on every session switch.
 */
export function ModelThinkingPicker({
  model,
  models,
  level,
  levels,
  loading,
  onRequest,
  onSelectModel,
  onSelectThinking,
}: ModelThinkingPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** True once the user moved the highlight themselves; the model list landing
   * later must not yank the selection away from them. */
  const navigatedRef = useRef(false);

  const flat = useMemo(() => models ?? [], [models]);
  const groups = useMemo(() => groupByProvider(flat), [flat]);
  const levelName = (value: string): string => {
    const key = LEVEL_KEYS[value];
    return key === undefined ? value : t(key);
  };
  // Close on an outside pointer, and put focus back where it came from so the
  // keyboard user is not dropped at the top of the page.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Arrow keys only reach the model list if it has focus; the card itself takes
  // focus otherwise, so Escape works without a trip through the tab order.
  useEffect(() => {
    if (!open) return;
    if (listOpen) listRef.current?.focus();
    else panelRef.current?.focus();
  }, [open, listOpen]);

  useEffect(() => {
    if (!open || !listOpen) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${String(highlight)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, listOpen, highlight]);

  // The list usually arrives *after* the card opens (a live fetch), so the
  // current model is marked once it lands — unless the user has already started
  // navigating, in which case moving the highlight would be a bug.
  useEffect(() => {
    if (!open || !listOpen) return;
    if (navigatedRef.current || flat.length === 0) return;
    const index = flat.findIndex((entry) => isCurrent(entry, model));
    if (index >= 0) setHighlight(index);
  }, [open, listOpen, flat, model]);

  const openCard = (): void => {
    const next = !open;
    setOpen(next);
    setListOpen(false);
    if (!next) return;
    navigatedRef.current = false;
    setHighlight(Math.max(0, flat.findIndex((entry) => isCurrent(entry, model))));
    // One fetch answers both halves of the card: the switchable model list and
    // the current model's effort ladder arrive on the same live read. The
    // ladder can be the one that is missing here — a session read from disk
    // has a model from `models.json` but no levels for one it does not describe
    // — and opening the card is the moment the user asked, so it is the moment
    // to ask.
    if (models === null || levels === null) onRequest();
  };

  const choose = (entry: ComposerModel): void => {
    setListOpen(false);
    panelRef.current?.focus();
    if (isCurrent(entry, model)) return;
    onSelectModel(entry.provider, entry.id);
  };

  const closeCard = (): void => {
    setOpen(false);
    setListOpen(false);
    buttonRef.current?.focus();
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // The list owns Escape while it is open — it backs out one level rather
    // than throwing the whole card away.
    if (event.key === "Escape" && !listOpen) {
      event.preventDefault();
      closeCard();
    }
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      setListOpen(false);
      return;
    }
    if (flat.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      navigatedRef.current = true;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => (current + delta + flat.length) % flat.length);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const entry = flat[highlight];
      if (entry) choose(entry);
    }
  };

  const stops = useMemo(() => levels ?? [], [levels]);
  // `off` is not the bottom rung of the ladder — it is the absence of one, and
  // pi reads it the same way. It stays on the track as a position you can drag
  // to, because "stop thinking" is a setting the user changed, not a state the
  // control forgets how to show; what it must not be is a *word* sitting on the
  // blue fill, which is what the mark above is for.
  //
  // So the track is the whole ladder (`stops`), not the ladder minus `off`.
  // Deriving a second array here was worse than it looked: `effortIndex` came
  // out as an index into one array while the disc was placed by the other, so
  // every level sat one stop to the left of itself, and a session on `medium`
  // drew its disc on `low`.
  const last = stops.length - 1;
  // Which stop the disc sits on. `null` is "off" — a real position at the left
  // end, which is also why the disc's position is `number | null` rather than
  // `number | undefined`: React reads `undefined` as "not passed", and the
  // position would come out `NaN` instead of at stop 0.
  //
  // A recorded level the ladder does not carry (a model swapped underneath the
  // session, say) is treated as unknown rather than silently snapped to the
  // first stop, which would claim the user had chosen `off`.
  const effortIndex: number | null =
    level === null || level === "off" ? null : stops.includes(level) ? stops.indexOf(level) : null;

  const label = model === null ? t("model.choose") : (model.name ?? model.id);
  // A single stop is a model that cannot think, and naming it would dress a
  // fixed setting up as a choice the user made. An unknown ladder is the
  // opposite case: naming what is in effect is never wrong, so it still shows.
  const showEffortWord = level !== null && stops.length !== 1;
  // Anything with a stop before and a stop after has something to draw.
  const showSlider = last > 0;
  // The mark states the effort in effect, the way the Codex card does. The
  // provider is already named on the row below and on the trigger, so a second
  // initial there would only repeat what the reader just saw.
  // The effort in effect, stated in plain words above the track that sets it.
  // This used to be a tinted square holding the level's short form — and before
  // that, the provider's initial — but a badge there competed with the model
  // name for the card's one line of emphasis, when all it has to do is answer
  // "thinking how hard".
  const mark = level === null ? t("thinking.choose") : levelName(level);

  return (
    <span className={styles.anchor} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("model.currentLabel", { name: label })}
        title={model === null ? t("model.choose") : `${model.provider}/${model.id}`}
        onClick={openCard}
      >
        <span className={styles.triggerLabel}>{label}</span>
        {showEffortWord ? <span className={styles.triggerEffort}>{levelName(level)}</span> : null}
        <Glyph name="chevronDown" size={12} />
      </button>

      {open ? (
        <div
          ref={panelRef}
          className={styles.panel}
          role="dialog"
          aria-label={t("model.label")}
          tabIndex={-1}
          onKeyDown={onPanelKeyDown}
        >
          <div className={styles.head}>
            <span className={styles.effortMark} aria-hidden>
              {mark}
            </span>
            <button
              type="button"
              className={styles.refresh}
              aria-label={t("common.refresh")}
              title={t("common.refresh")}
              onClick={onRequest}
            >
              <RefreshIcon width={14} height={14} />
            </button>
          </div>

          <button
            type="button"
            className={styles.modelRow}
            aria-expanded={listOpen}
            title={model === null ? t("model.choose") : `${model.provider}/${model.id}`}
            onClick={() => {
              const next = !listOpen;
              setListOpen(next);
              if (next) {
                navigatedRef.current = false;
                setHighlight(Math.max(0, flat.findIndex((entry) => isCurrent(entry, model))));
                if (models === null || levels === null) onRequest();
              }
            }}
          >
            <span className={styles.modelName}>{label}</span>
            <Glyph
              name="caretRight"
              size={12}
              className={clsx(styles.modelCaret, listOpen && styles.modelCaretOpen)}
            />
          </button>

          {listOpen ? (
            <div
              ref={listRef}
              className={styles.list}
              role="listbox"
              aria-label={t("model.label")}
              tabIndex={-1}
              onKeyDown={onListKeyDown}
            >
              {models === null ? (
                <div className={styles.empty}>
                  {loading ? t("model.loading") : t("model.unavailable")}
                </div>
              ) : flat.length === 0 ? (
                <div className={styles.empty}>{t("model.empty")}</div>
              ) : (
                groups.map((group) => (
                  <Fragment key={group.provider}>
                    <div className={styles.groupTitle}>{group.provider}</div>
                    {group.items.map(({ model: entry, index }) => (
                      <button
                        key={`${entry.provider}/${entry.id}`}
                        type="button"
                        role="option"
                        aria-selected={index === highlight}
                        data-index={index}
                        className={clsx(styles.item, index === highlight && styles.itemActive)}
                        title={`${entry.provider}/${entry.id}`}
                        onMouseEnter={() => {
                          navigatedRef.current = true;
                          setHighlight(index);
                        }}
                        onClick={() => choose(entry)}
                      >
                        <span className={styles.itemName}>{entry.name ?? entry.id}</span>
                        <span className={styles.itemMeta}>
                          {entry.contextWindow > 0 ? formatWindow(entry.contextWindow) : null}
                          {isCurrent(entry, model) ? <CheckIcon width={14} height={14} /> : null}
                        </span>
                      </button>
                    ))}
                  </Fragment>
                ))
              )}
            </div>
          ) : showSlider ? (
            <EffortSlider
              stops={stops}
              index={effortIndex}
              label={levelName}
              placeholder={t("thinking.choose")}
              unknown={level === null}
              ariaLabel={t("thinking.label")}
              onSelect={onSelectThinking}
            />
          ) : (
            // No ladder to draw: either nobody has answered yet or the model
            // does not think. Saying so is the difference between an empty card
            // and a card that looks broken.
            <div className={styles.empty}>
              {loading ? t("thinking.loading") : t("thinking.unavailable")}
            </div>
          )}
        </div>
      ) : null}
    </span>
  );
}

interface EffortSliderProps {
  stops: string[];
  /** null when nothing has recorded a level: the disc parks at the first stop
   * but the readout says "default" rather than naming it. */
  index: number | null;
  label(value: string): string;
  /** What the readout says while `index` is null. */
  placeholder: string;
  /** True when the null above means "nothing has said yet" rather than a
   * recorded `off`, which the readout *can* name. */
  unknown: boolean;
  ariaLabel: string;
  onSelect(level: string): void;
}

/**
 * The effort ladder as a track with a travelling disc.
 *
 * It behaves like a native range input — click anywhere to jump, drag the disc,
 * arrows/Home/End from the keyboard — but is built from a div because the stops
 * are discrete names rather than a number line, and because the artwork (the
 * fill stopping under the disc, the unselected stops drawn as pips) has no
 * native equivalent.
 *
 * Dragging previews locally and commits on release: a drag across five stops
 * is one selection, not five round trips to pi.
 */
function EffortSlider({
  stops,
  index,
  label,
  placeholder,
  unknown,
  ariaLabel,
  onSelect,
}: EffortSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  /**
   * The stop a drag is sitting on, held past the release.
   *
   * The commit is asynchronous — `onSelect` posts the change and the parent
   * only reports the new level once the server confirmed it — so clearing the
   * preview on `pointerup` would drop the disc back onto the old stop for the
   * length of the round trip. That round trip *is* the flicker: one frame drawn
   * at the old position, then another at the new one. Holding the value until
   * `index` catches up keeps the disc where the user let go, which is where it
   * is about to land anyway. If the server refuses or clamps, `index` lands
   * somewhere else and this simply steps aside — never later than the next
   * time that level changes.
   */
  const [preview, setPreview] = useState<number | null>(null);

  // `null` is "off" and is a real position at the left end, so this is keyed on
  // a sentinel that distinguishes "off" from "the first stop" — the two are
  // one and the same index otherwise, and a level landing there would not
  // retire the preview.
  const current = index === null ? "off" : (stops[index] ?? null);
  const level = current === "off" ? "\u0000off" : current;
  useEffect(() => {
    setPreview(null);
  }, [level]);

  const last = stops.length - 1;
  const shown = preview ?? index ?? 0;
  /*
   * The blue fill is the *travelled* part of the ladder, and "off" has not
   * travelled anywhere — it is the answer "no ladder at all". Filling to the
   * disc there would draw a progress bar for a setting that has no progress,
   * which is exactly what the disc sitting at the far left already says. The
   * track stays, so the control can still be dragged out of it.
   */
  const shownStop = stops[shown];
  const filled = shownStop !== undefined && shownStop !== "off";
  /*
   * The disc's centre line, as the *track's* box minus half a disc at each end.
   *
   * Half a disc is the whole inset: it is what lets the disc sit flush with the
   * pill at position 0 instead of hanging off its left cap, and flush again at
   * the top stop instead of stopping short of the right one. Everything the eye
   * sees and the finger aims at shares this one line.
   */
  const travel = `${String(THUMB_SIZE)}px`;
  const at = (position: number): string =>
    `calc(${String(THUMB_INSET)}px + (100% - (${travel})) * ${String(
      last === 0 ? 0 : position / last,
    )})`;

  /** The stop nearest a pointer x, measured against the same line. */
  const indexAt = (clientX: number): number => {
    const element = trackRef.current;
    if (element === null || last === 0) return 0;
    const rect = element.getBoundingClientRect();
    // The pixel form of `travel`: `rect.width` is the same `100%` the disc is
    // placed against, because the track draws no border.
    const usable = rect.width - THUMB_SIZE;
    if (usable <= 0) return 0;
    // `offset` is measured from the line's left edge, where stop 0 sits; `last`
    // steps of `usable / last` reach the line's right edge, which is stop `last`.
    // The rounding is what makes the two ends reachable: the left half of the
    // first step and the right half of the last one both round to their end, and
    // the clamp is only there for a pointer that left the track entirely.
    const offset = clientX - rect.left - THUMB_INSET;
    return Math.min(last, Math.max(0, Math.round((offset / usable) * last)));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setPreview(indexAt(event.clientX));
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return;
    setPreview(indexAt(event.clientX));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const next = indexAt(event.clientX);
    const stop = stops[next];
    // The preview deliberately outlives the release (see `preview` above): it
    // is cleared only when `index` reports the stop the user just chose.
    if (stop !== undefined && next !== (index ?? -1)) onSelect(stop);
    else setPreview(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? Math.min(last, shown + 1)
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? Math.max(0, shown - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (target === null || target === shown) return;
    event.preventDefault();
    event.stopPropagation();
    const stop = stops[target];
    if (stop !== undefined) onSelect(stop);
  };

  return (
    <div
      ref={trackRef}
      className={styles.slider}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={shown}
      aria-valuetext={unknown ? placeholder : label(stops[shown] ?? "")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <span className={styles.sliderFill} style={{ width: filled ? at(shown) : "0px" }} />
      {stops.map((stop, position) => (
        <span
          key={stop}
          className={clsx(styles.sliderDot, position < shown && styles.sliderDotDone)}
          style={{ left: at(position) }}
        />
      ))}
      <span className={styles.sliderThumb} style={{ left: at(shown) }} />
    </div>
  );
}

function isCurrent(entry: ComposerModel, model: ComposerModel | null): boolean {
  return model !== null && entry.provider === model.provider && entry.id === model.id;
}

function groupByProvider(models: ComposerModel[]): Group[] {
  const groups: Group[] = [];
  models.forEach((model, index) => {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.provider === model.provider) {
      last.items.push({ model, index });
    } else {
      groups.push({ provider: model.provider, items: [{ model, index }] });
    }
  });
  return groups;
}

/** Context windows are big and round; `1M` reads better than `1000000`. */
function formatWindow(contextWindow: number): string {
  if (contextWindow >= 1_000_000) return `${String(Math.round(contextWindow / 100_000) / 10)}M`;
  if (contextWindow >= 1000) return `${String(Math.round(contextWindow / 1000))}K`;
  return String(contextWindow);
}
