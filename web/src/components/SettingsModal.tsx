import { useEffect, useState } from "react";

interface SettingsData {
  APP_PORT: string;
  ADMIN_PORT: string;
  M2EE_ADMIN_PASS: string;
  MX_LOG_LEVEL: string;
  DB_MODE: string;       // "local" | "external"
  DB_PORT: string;       // local container host port
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
  EXT_DB_HOST: string;  // external db host
  EXT_DB_PORT: string;  // external db port
  EXT_DB_SSL: string;   // "true" | "false"
  [key: string]: string;
}

interface SettingsResponse {
  settings: SettingsData;
  env_path: string | null;
  editable: boolean;
}

const LOG_LEVELS = ["debug", "info", "warning", "error", "critical"];

const DEFAULTS: SettingsData = {
  APP_PORT: "8080",
  ADMIN_PORT: "8090",
  M2EE_ADMIN_PASS: "AdminPassword1!",
  MX_LOG_LEVEL: "info",
  DB_MODE: "local",
  DB_PORT: "5432",
  DB_NAME: "mendix",
  DB_USER: "mendix",
  DB_PASSWORD: "mendix",
  EXT_DB_HOST: "",
  EXT_DB_PORT: "5432",
  EXT_DB_SSL: "false",
};

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [editable, setEditable] = useState(false);
  const [envPath, setEnvPath] = useState<string | null>(null);
  const [vals, setVals] = useState<SettingsData>({ ...DEFAULTS });
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean }>();

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json() as Promise<SettingsResponse>)
      .then((d) => {
        setEditable(d.editable);
        setEnvPath(d.env_path);
        setVals({ ...DEFAULTS, ...d.settings });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = (k: string, v: string) => setVals((prev) => ({ ...prev, [k]: v }));
  const toggleSecret = (k: string) => setShowSecrets((s) => ({ ...s, [k]: !s[k] }));

  const handleSave = async () => {
    setSaving(true);
    setMessage(undefined);
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(vals),
      });
      const body = (await r.json()) as { ok?: boolean; message?: string; error?: string };
      setMessage({ text: body.message ?? body.error ?? "Saved.", ok: r.ok });
    } catch {
      setMessage({ text: "Request failed.", ok: false });
    } finally {
      setSaving(false);
    }
  };

  const isExternal = vals.DB_MODE === "external";

  const secretField = (key: string, placeholder?: string) => (
    <div className="login-pat-row">
      <input
        type={showSecrets[key] ? "text" : "password"}
        value={vals[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      <button type="button" className="ai-key-toggle" onClick={() => toggleSecret(key)}>
        {showSecrets[key] ? "◎" : "●"}
      </button>
    </div>
  );

  const field = (key: string, placeholder?: string) => (
    <input
      type="text"
      value={vals[key]}
      onChange={(e) => set(key, e.target.value)}
      placeholder={placeholder}
    />
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Project Settings</div>

        {loading && <p className="muted">Loading…</p>}

        {!loading && !editable && (
          <p className="muted">
            No <code>.docker/.env</code> found. Open a project with a Docker setup to configure it.
          </p>
        )}

        {!loading && editable && (
          <>
            {envPath && (
              <div className="settings-path">
                <span className="muted">File:</span>{" "}
                <code className="settings-path-val">{envPath}</code>
              </div>
            )}

            {/* Application */}
            <div className="settings-section">
              <div className="settings-section-title">Application</div>
              <div className="settings-grid">
                <div className="modal-field">
                  <label>App port</label>
                  {field("APP_PORT", "8080")}
                </div>
                <div className="modal-field">
                  <label>Admin port</label>
                  {field("ADMIN_PORT", "8090")}
                </div>
                <div className="modal-field">
                  <label>Log level</label>
                  <select value={vals.MX_LOG_LEVEL} onChange={(e) => set("MX_LOG_LEVEL", e.target.value)}>
                    {LOG_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div className="modal-field">
                  <label>Admin password</label>
                  {secretField("M2EE_ADMIN_PASS")}
                </div>
              </div>
            </div>

            {/* Database */}
            <div className="settings-section">
              <div className="settings-section-title">Database</div>

              <div className="settings-db-mode">
                <button
                  className={`settings-mode-btn ${!isExternal ? "on" : ""}`}
                  onClick={() => set("DB_MODE", "local")}
                >
                  Local Docker
                </button>
                <button
                  className={`settings-mode-btn ${isExternal ? "on" : ""}`}
                  onClick={() => set("DB_MODE", "external")}
                >
                  External (Azure / Cloud)
                </button>
              </div>

              {!isExternal ? (
                <div className="settings-grid">
                  <div className="modal-field">
                    <label>Host port</label>
                    {field("DB_PORT", "5432")}
                  </div>
                  <div className="modal-field">
                    <label>Database name</label>
                    {field("DB_NAME", "mendix")}
                  </div>
                  <div className="modal-field">
                    <label>User</label>
                    {field("DB_USER", "mendix")}
                  </div>
                  <div className="modal-field">
                    <label>Password</label>
                    {secretField("DB_PASSWORD")}
                  </div>
                </div>
              ) : (
                <>
                  <p className="settings-ext-hint muted">
                    The local PostgreSQL container will be skipped. Mendix will connect directly to your external database.
                  </p>
                  <div className="settings-grid">
                    <div className="modal-field settings-host-field">
                      <label>Host</label>
                      {field("EXT_DB_HOST", "mydb.postgres.database.azure.com")}
                    </div>
                    <div className="modal-field">
                      <label>Port</label>
                      {field("EXT_DB_PORT", "5432")}
                    </div>
                    <div className="modal-field">
                      <label>Database name</label>
                      {field("DB_NAME", "mendix")}
                    </div>
                    <div className="modal-field">
                      <label>User</label>
                      {field("DB_USER", "mendix")}
                    </div>
                    <div className="modal-field">
                      <label>Password</label>
                      {secretField("DB_PASSWORD")}
                    </div>
                    <div className="modal-field">
                      <label>
                        <input
                          type="checkbox"
                          checked={vals.EXT_DB_SSL === "true"}
                          onChange={(e) => set("EXT_DB_SSL", e.target.checked ? "true" : "false")}
                          style={{ marginRight: 6 }}
                        />
                        Use SSL
                      </label>
                    </div>
                  </div>
                </>
              )}
            </div>

            {message && (
              <div className={message.ok ? "git-notice" : "git-error"}>{message.text}</div>
            )}
            {message?.ok && (
              <p className="muted settings-ext-hint">
                Stop and restart the application for changes to take effect.
              </p>
            )}
          </>
        )}

        <div className="modal-actions">
          <button className="editor-secondary" onClick={onClose}>Close</button>
          {editable && (
            <button className="w-btn" disabled={saving} onClick={() => void handleSave()}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
