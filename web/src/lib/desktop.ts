/**
 * The desktop shell's preload bridge, as the web bundle sees it.
 *
 * `desktop/src/preload.cts` freezes this object onto the window; a browser page
 * never has it, and the UI branches on that rather than making the shell a
 * dependency. Everything here is either preload-provided data or an action only
 * the shell can take: `getPathForFile` is a string lookup (a browser cannot
 * name the folder a user dragged in), while `notify` / `setBadge` /
 * `onNotificationClick` are the OS-facing half of notifications — a page can
 * raise its own toast, but only the shell can put a number on the Dock icon or
 * bring the window back when that toast is clicked.
 *
 * The interface is restated here rather than imported: the desktop package is a
 * separate build with its own tsconfig and no exported types entry, and a few
 * fields are cheaper to keep in step than a build ordering to maintain.
 */
export interface DesktopNotification {
  readonly title: string;
  readonly body: string;
  /** The session path, which also identifies the notice. */
  readonly tag: string;
}

export interface PiWebDesktopBridge {
  readonly isDesktop: true;
  /** `process.platform` of the machine running the shell: `darwin`, `win32`… */
  readonly platform: string;
  readonly electronVersion: string;
  /**
   * Absolute path of a dropped `File`. Optional because a shell older than the
   * feature ships the same bridge without it; see `pathForFile`.
   */
  readonly getPathForFile?: (file: File) => string;
  /**
   * Ask the shell for a system notification. Optional for the same reason as
   * `getPathForFile`: the fields are additive, so an older shell is a bridge
   * with fewer of them rather than a different shape.
   */
  readonly notify?: (payload: DesktopNotification) => void;
  /** The unread count on the Dock / taskbar icon; zero clears it. */
  readonly setBadge?: (count: number) => void;
  /** Listen for a click on a shell notification; returns the unsubscribe. */
  readonly onNotificationClick?: (listener: (sessionPath: string) => void) => () => void;
}

declare global {
  interface Window {
    /** Absent in a browser, and absent for a page that is not the shell's. */
    readonly piWebDesktop?: PiWebDesktopBridge;
  }
}

/** The bridge, or null when this page is not running inside the desktop window. */
export function desktopBridge(): PiWebDesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.piWebDesktop ?? null;
}

/**
 * Mirror the shell's platform onto `<html data-platform>` so stylesheets can
 * scope desktop-only presentation.
 *
 * CSS selectors cannot read `window.piWebDesktop`, so the one fact shortcut
 * detection takes from the bridge has to be republished as an attribute for
 * the one consumer that has no other way to see it: the macOS sidebar tint,
 * which is translucent so the window's vibrancy material shows through (see
 * `theme/index.css` and `layout/AppLayout.module.css`).
 *
 * A browser leaves the attribute off, which is exactly the condition those
 * rules test — the plain web bundle therefore keeps the opaque sidebar and
 * never grows a desktop-only branch. dsh's own preload stamps the same
 * attribute for the same reason; this one only sets it from the page because
 * the shell's preload is deliberately DOM-free (see `desktop/src/preload.cts`).
 */
export function markDocumentPlatform(): void {
  const bridge = desktopBridge();
  if (bridge === null || typeof document === "undefined") return;
  document.documentElement.dataset.platform = bridge.platform;
}

/**
 * The absolute path behind a dropped file, or null.
 *
 * Only the shell can answer this. A browser deliberately hides where a dragged
 * file or folder lives — `DataTransfer` carries bytes and a name, never a
 * location — which is the same wall the picker's server-side listing exists to
 * go around. Callers that get null fall back to whatever else the drop offers.
 */
export function pathForFile(file: File): string | null {
  const read = desktopBridge()?.getPathForFile;
  if (!read) return null;
  try {
    return read(file) || null;
  } catch {
    // The bridge call crosses an isolated world; a rejected argument is a miss,
    // not an error the drop handler should surface.
    return null;
  }
}
