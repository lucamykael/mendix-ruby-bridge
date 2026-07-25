import { useEffect, useState } from "react";

interface AuthStatus {
  logged_in: boolean;
  username: string | null;
}

async function getAuthStatus(): Promise<AuthStatus> {
  const r = await fetch("/api/auth/status");
  return r.json() as Promise<AuthStatus>;
}

async function loginPAT(pat: string): Promise<{ ok: boolean; message: string; username?: string }> {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pat }),
  });
  const body = (await r.json()) as { ok?: boolean; message?: string; username?: string; error?: string };
  return { ok: body.ok === true, message: body.message ?? body.error ?? "Unknown error", username: body.username };
}

async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

interface Props {
  onClose: () => void;
  onAuthChange: (status: AuthStatus) => void;
}

export default function LoginModal({ onClose, onAuthChange }: Props) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean }>();

  useEffect(() => {
    getAuthStatus()
      .then(setStatus)
      .catch(() => setStatus({ logged_in: false, username: null }));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pat.trim()) return;
    setLoading(true);
    setMessage(undefined);
    const result = await loginPAT(pat.trim());
    setLoading(false);
    if (result.ok) {
      const next: AuthStatus = { logged_in: true, username: result.username ?? null };
      setStatus(next);
      onAuthChange(next);
      setMessage({ text: result.message, ok: true });
      setPat("");
    } else {
      setMessage({ text: result.message, ok: false });
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    await logout();
    const next: AuthStatus = { logged_in: false, username: null };
    setStatus(next);
    onAuthChange(next);
    setMessage({ text: "PAT removed.", ok: true });
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal login-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          {status?.logged_in ? "Mendix Account" : "Connect Mendix Account"}
        </div>

        {status === null && <p className="muted">Checking credentials…</p>}

        {status?.logged_in ? (
          <>
            <div className="login-info">
              <span className="login-avatar">👤</span>
              <div>
                <div className="login-name">{status.username ?? "Authenticated"}</div>
                <div className="login-sub">PAT active — marketplace access enabled</div>
              </div>
            </div>
            {message && (
              <div className={message.ok ? "git-notice" : "git-error"}>{message.text}</div>
            )}
            <div className="modal-actions">
              <button className="editor-secondary" onClick={onClose}>Close</button>
              <button className="w-btn danger" disabled={loading} onClick={() => void handleLogout()}>
                {loading ? "Removing…" : "Remove PAT"}
              </button>
            </div>
          </>
        ) : status !== null ? (
          <>
            <p className="login-hint">
              A <strong>Personal Access Token (PAT)</strong> gives mxcli access to the Mendix Marketplace for installing authenticated widgets.
            </p>
            <a
              className="login-pat-link"
              href="https://user-settings.mendix.com/"
              target="_blank"
              rel="noreferrer"
            >
              Create a PAT at user-settings.mendix.com →
            </a>
            <form onSubmit={(e) => void handleLogin(e)} className="login-form">
              <div className="modal-field">
                <label>Personal Access Token</label>
                <div className="login-pat-row">
                  <input
                    type={showPat ? "text" : "password"}
                    placeholder="Paste your PAT here…"
                    value={pat}
                    onChange={(e) => setPat(e.target.value)}
                    autoComplete="off"
                    required
                  />
                  <button
                    type="button"
                    className="ai-key-toggle"
                    onClick={() => setShowPat((v) => !v)}
                    title={showPat ? "Hide" : "Show"}
                  >
                    {showPat ? "◎" : "●"}
                  </button>
                </div>
              </div>
              {message && (
                <div className={message.ok ? "git-notice" : "git-error"}>{message.text}</div>
              )}
              <div className="modal-actions">
                <button type="button" className="editor-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="w-btn" disabled={loading || !pat.trim()}>
                  {loading ? "Validating…" : "Save PAT"}
                </button>
              </div>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
