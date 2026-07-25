import { useEffect, useState } from "react";

interface AuthStatus {
  logged_in: boolean;
  username: string | null;
}

async function getAuthStatus(): Promise<AuthStatus> {
  const r = await fetch("/api/auth/status");
  return r.json() as Promise<AuthStatus>;
}

async function login(username: string, password: string): Promise<{ ok: boolean; message: string }> {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = (await r.json()) as { ok?: boolean; message?: string; error?: string };
  return { ok: body.ok === true, message: body.message ?? body.error ?? "Unknown error" };
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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean }>();

  useEffect(() => {
    getAuthStatus().then((s) => {
      setStatus(s);
      if (s.username) setUsername(s.username);
    }).catch(() => setStatus({ logged_in: false, username: null }));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setMessage(undefined);
    const result = await login(username.trim(), password);
    setLoading(false);
    if (result.ok) {
      const next = { logged_in: true, username: username.trim() };
      setStatus(next);
      onAuthChange(next);
      setMessage({ text: result.message, ok: true });
      setPassword("");
    } else {
      setMessage({ text: result.message, ok: false });
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    await logout();
    const next = { logged_in: false, username: null };
    setStatus(next);
    onAuthChange(next);
    setUsername("");
    setPassword("");
    setMessage({ text: "Logged out.", ok: true });
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal login-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          {status?.logged_in ? "Mendix Account" : "Log in to Mendix"}
        </div>

        {status === null && <p className="muted">Loading…</p>}

        {status?.logged_in ? (
          <>
            <div className="login-info">
              <span className="login-avatar">👤</span>
              <div>
                <div className="login-name">{status.username}</div>
                <div className="login-sub">Logged in — marketplace access enabled</div>
              </div>
            </div>
            {message && (
              <div className={message.ok ? "git-notice" : "git-error"}>{message.text}</div>
            )}
            <div className="modal-actions">
              <button className="editor-secondary" onClick={onClose}>Close</button>
              <button className="w-btn danger" disabled={loading} onClick={() => void handleLogout()}>
                {loading ? "Logging out…" : "Log out"}
              </button>
            </div>
          </>
        ) : status !== null ? (
          <>
            <p className="login-hint">
              Log in with your Mendix account to access marketplace widgets that require authentication.
            </p>
            <form onSubmit={(e) => void handleLogin(e)} className="login-form">
              <div className="modal-field">
                <label>Email</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="modal-field">
                <label>Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              {message && (
                <div className={message.ok ? "git-notice" : "git-error"}>{message.text}</div>
              )}
              <div className="modal-actions">
                <button type="button" className="editor-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="w-btn" disabled={loading || !username.trim() || !password.trim()}>
                  {loading ? "Logging in…" : "Log in"}
                </button>
              </div>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
