import { useState, type FormEvent } from "react";
import { errorMessage, signIn } from "./api.ts";

type Props = {
  /** No accounts yet: say how to create the first one instead of showing the form. */
  hasAccounts: boolean;
  onSignedIn: (username: string) => void;
};

export function SignIn({ hasAccounts, onSignedIn }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(username, password);
      onSignedIn(result.username);
    } catch (err) {
      setError(errorMessage(err));
      setPassword(""); // keep the username, retype the password
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <img src="/logo.svg" alt="" width={56} height={56} />
        <h1>Sign in to Lab Notes</h1>
        {hasAccounts ? (
          <form className="auth-form" onSubmit={submit}>
            <label>
              Username
              <input
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button type="submit" className="button-primary auth-submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </form>
        ) : (
          <div className="auth-setup">
            <p>No accounts yet. On the server, create one with:</p>
            <pre>
              <code>docker compose exec app node server/users.ts add &lt;name&gt;</code>
            </pre>
          </div>
        )}
      </div>
    </main>
  );
}
