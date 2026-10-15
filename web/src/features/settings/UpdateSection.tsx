import { useEffect, useState } from "react";
import clsx from "clsx";
import { actions, appStore, useT } from "../../lib/app-state.ts";
import { useStore } from "../../lib/store.ts";
import { versionStatus } from "../../lib/updates.ts";
import { SettingsGroup, SettingsRow } from "./SettingsRow.tsx";
import styles from "./UpdateSection.module.css";

/**
 * The version notices, at the bottom of 通用设置.
 *
 * Two rows, because they are two different facts — and the one that used to be
 * a bare number is now the fuller of the two.
 *
 * **This project** is the copy of pi-web-simple answering this page. npm owns
 * answering it (the registry's `latest` tag), and — unlike the other row — npm
 * can also carry the update out, so this is the only row with a button that
 * changes anything. What the button cannot do is make the new files be what is
 * running, so a success says "restart" instead of implying the page is already
 * the new version.
 *
 * **pi itself** is an npm dependency of this server: a newer release moves with
 * the lockfile and takes a server restart, so its row reports the version and
 * offers its command to copy rather than a button that would have to half-do
 * the job.
 *
 * Only the server checks anything. The check is not run from the browser: the
 * server owns it, and its short cache means visiting the page does not spawn a
 * check. The 检查更新 button is the explicit "ask upstream again".
 */
export function UpdateSection({ projectPath }: { projectPath: string | null }) {
  const t = useT();
  const state = useStore(appStore);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Same slot the plugins page writes, so both pages agree and neither refetches
  // on switch. Keyed by workspace: the user-scope answer lives under "".
  const view = state.updates[projectPath ?? ""] ?? null;
  const info = view?.pi ?? null;
  const app = view?.app ?? null;

  useEffect(() => {
    if (view === null) void actions.loadUpdates(projectPath);
  }, [projectPath, view]);

  useEffect(() => {
    if (copied === null) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const check = (): void => {
    setChecking(true);
    void actions.loadUpdates(projectPath, { force: true }).finally(() => setChecking(false));
  };

  const copy = (command: string): void => {
    if (command.length === 0) return;
    // The clipboard API rejects on a non-secure origin; the shell is served
    // over plain http on localhost, which browsers do treat as secure, but the
    // rejection is still handled so a failure is not a silent no-op.
    void navigator.clipboard
      .writeText(command)
      .then(() => setCopied(command))
      .catch(() => actions.setNotice(command));
  };

  /**
   * Move this deployment forward.
   *
   * `latest` is read before the call because it is the version being installed
   * — the answer that comes back has already stopped being "an update is
   * available", so it can no longer say which version that was.
   */
  const update = (): void => {
    const target = app?.latest ?? null;
    setUpdating(true);
    setUpdateError(null);
    setUpdateNote(null);
    void actions
      .updateApp(projectPath)
      .then(() => setUpdateNote(t("settings.updates.updatedRestart", { version: target ?? "" })))
      .catch((err: Error) => setUpdateError(err.message))
      .finally(() => setUpdating(false));
  };

  // An attempted update outranks the server's status: whatever the check says,
  // this row just did something and has to report how it went.
  const appStatus = updateError ?? updateNote ?? versionStatus(app, t);
  const appBad = updateError !== null || (app !== null && app.error !== null);

  return (
    <SettingsGroup title={t("settings.updates.about")}>
      <SettingsRow
        title={t("settings.updates.piVersion")}
        description={t("settings.updates.piVersionDescription", {
          package: info?.packageName ?? "@earendil-works/pi-coding-agent",
        })}
      >
        <div className={styles.control}>
          <span className={styles.version}>{info?.current ?? "—"}</span>
          <span
            className={clsx(
              styles.status,
              info !== null && info.available && styles.statusNew,
              info !== null && info.error !== null && styles.statusError,
            )}
          >
            {versionStatus(info, t)}
          </span>
          {info !== null && info.available ? (
            <button
              type="button"
              className={styles.action}
              title={info.updateCommand}
              onClick={() => copy(info.updateCommand)}
            >
              {copied === info.updateCommand
                ? t("common.copied")
                : t("settings.updates.copyCommand")}
            </button>
          ) : null}
          <button type="button" className={styles.ghost} disabled={checking} onClick={check}>
            {checking ? t("settings.updates.checking") : t("settings.updates.check")}
          </button>
        </div>
      </SettingsRow>

      {/*
        The build-time constant is the fallback for the one answer the server
        cannot give: a `package.json` it could not read. Both numbers come from
        the same file, so they only ever differ while that read is failing.
      */}
      <SettingsRow
        title={t("settings.updates.appVersion")}
        description={t("settings.updates.appVersionDescription", {
          package: app?.packageName ?? "pi-web-simple",
        })}
      >
        <div className={styles.control}>
          <span className={styles.version}>{app?.current ?? __APP_VERSION__}</span>
          <span
            className={clsx(
              styles.status,
              ((app !== null && app.available) || updateNote !== null) && styles.statusNew,
              appBad && styles.statusError,
            )}
          >
            {appStatus}
          </span>
          {app !== null && app.available ? (
            app.managed ? (
              <>
                <button
                  type="button"
                  className={styles.action}
                  title={app.updateCommand}
                  disabled={updating}
                  onClick={update}
                >
                  {updating ? t("settings.updates.updating") : t("settings.updates.updateNow")}
                </button>
                <button
                  type="button"
                  className={styles.ghost}
                  title={app.updateCommand}
                  onClick={() => copy(app.updateCommand)}
                >
                  {copied === app.updateCommand
                    ? t("common.copied")
                    : t("settings.updates.copyCommand")}
                </button>
              </>
            ) : (
              // The desktop shell's bundle is not in any `node_modules` this
              // could install into, so the only honest action is handing over
              // the release page.
              <button
                type="button"
                className={styles.action}
                title={app.updateCommand}
                onClick={() => copy(app.updateCommand)}
              >
                {copied === app.updateCommand
                  ? t("common.copied")
                  : t("settings.updates.copyDownload")}
              </button>
            )
          ) : null}
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}
