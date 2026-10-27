import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { authStatus, setTabUser, type AuthStatus } from "./api.ts";
import { SignIn } from "./SignIn.tsx";

const UsernameContext = createContext("");

/** Who's signed in (only used inside the signed-in app). */
export const useUsername = () => useContext(UsernameContext);

type State = { kind: "checking" } | { kind: "unreachable" } | { kind: "known"; status: AuthStatus };

/** Signed out: the sign-in page. Signed in: the app. The URL is left alone either way. */
export function Auth({ router }: { router: ReturnType<typeof createBrowserRouter> }) {
  const [state, setState] = useState<State>({ kind: "checking" });

  const signedIn = useCallback((status: AuthStatus) => {
    if (status.username) setTabUser(status.username);
    setState({ kind: "known", status });
  }, []);

  const check = useCallback(() => {
    setState({ kind: "checking" });
    authStatus().then(signedIn, () => setState({ kind: "unreachable" }));
  }, [signedIn]);

  useEffect(check, [check]);

  // A page brought back by Back/Forward from the browser's cache would show whatever was on it
  // (after signing out, the old notes): reload instead, which asks the server again.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  if (state.kind === "checking") return <main className="auth-screen" />;
  if (state.kind === "unreachable") {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <img src="/logo.svg" alt="" width={56} height={56} />
          <p role="alert">Couldn't reach Lab Notes.</p>
          <button type="button" className="button-primary auth-submit" onClick={check}>
            Retry
          </button>
        </div>
      </main>
    );
  }
  const { username, hasAccounts } = state.status;
  if (!username) {
    return <SignIn hasAccounts={hasAccounts} onSignedIn={(name) => signedIn({ username: name, hasAccounts: true })} />;
  }
  return (
    <UsernameContext.Provider value={username}>
      <RouterProvider router={router} />
    </UsernameContext.Provider>
  );
}
