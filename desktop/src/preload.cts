/**
 * Preload for the desktop window.
 *
 * The web UI is the same bundle the browser gets, so nothing here may be
 * required for it to work — the bridge only *adds* what the UI can read
 * (`window.piWebDesktop`) if it ever wants to branch on being wrapped: a couple
 * of flags, the absolute path behind a dropped file (`webUtils`, a string
 * lookup), and the two halves of the notification feature — raising a system
 * notice with a session's name on it, and mirroring the unread count onto the
 * icon.
 *
 * The notification pair is the one place that needs a channel: a notice and the
 * badge belong to the OS, so the main process shows them, and a click on that
 * notice has to come back. `ipcRenderer` stays in this file — the page gets
 * three functions, never the renderer handle or Node.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";

/**
 * The renderer's `File`, spelled through `webUtils` rather than the DOM type:
 * this package compiles without the DOM lib, so `File` is not a name here.
 */
type DroppedFile = Parameters<typeof webUtils.getPathForFile>[0];

/**
 * The channel names, spelled out here and in `main.cts`. They are the only
 * string two isolated worlds have to agree on.
 */
const NOTIFY_CHANNEL = "piweb:notify";
const BADGE_CHANNEL = "piweb:badge";
const NOTIFICATION_CLICK_CHANNEL = "piweb:notification-click";

/** What the page hands over for one system notification. */
export interface PiWebDesktopNotification {
  readonly title: string;
  readonly body: string;
  /** The session path, which also identifies the notice. */
  readonly tag: string;
}

export interface PiWebDesktopBridge {
  readonly isDesktop: true;
  readonly platform: NodeJS.Platform;
  readonly electronVersion: string;
  /**
   * The absolute path of a `File` the user dropped on the page — something a
   * plain browser cannot report for a dragged folder (and never reports for a
   * dragged file either). Empty when Electron has no path to give.
   *
   * The parameter type is spelled through `webUtils` rather than as `File`
   * because this package compiles without the DOM lib; the shape the renderer
   * passes is the same `File` from its `DataTransfer`.
   */
  getPathForFile(file: DroppedFile): string;
  /**
   * Ask the shell to show a system notification. A click on it arrives through
   * `onNotificationClick` rather than a per-call callback, because the notice
   * outlives the call that raised it — the page may even have reloaded in the
   * meantime.
   */
  notify(payload: PiWebDesktopNotification): void;
  /**
   * The number on the Dock / taskbar icon: sessions that finished while the
   * user was elsewhere. Zero clears it.
   */
  setBadge(count: number): void;
  /** Listen for a click on a shell notification; returns the unsubscribe. */
  onNotificationClick(listener: (sessionPath: string) => void): () => void;
}

const bridge: PiWebDesktopBridge = Object.freeze({
  isDesktop: true,
  platform: process.platform,
  electronVersion: process.versions.electron ?? "unknown",
  getPathForFile: (file: DroppedFile): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      // A transparently-crossed argument (or a platform without the API) is not
      // worth failing a drop over; the caller falls back to the folder's name.
      return "";
    }
  },
  notify: (payload: PiWebDesktopNotification): void => {
    // The page is our own bundle, but the argument crosses an isolated world,
    // and an unvalidated object would reach the main process's IPC handler.
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof payload.title !== "string" ||
      typeof payload.body !== "string" ||
      typeof payload.tag !== "string"
    ) {
      return;
    }
    ipcRenderer.send(NOTIFY_CHANNEL, {
      title: payload.title,
      body: payload.body,
      tag: payload.tag,
    });
  },
  setBadge: (count: number): void => {
    if (typeof count !== "number" || !Number.isFinite(count)) return;
    ipcRenderer.send(BADGE_CHANNEL, Math.max(0, Math.floor(count)));
  },
  onNotificationClick: (listener: (sessionPath: string) => void): (() => void) => {
    const handler = (_event: unknown, sessionPath: unknown): void => {
      if (typeof sessionPath === "string") listener(sessionPath);
    };
    ipcRenderer.on(NOTIFICATION_CLICK_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(NOTIFICATION_CLICK_CHANNEL, handler);
    };
  },
});

contextBridge.exposeInMainWorld("piWebDesktop", bridge);
