"use client";

/**
 * Who the app is signed in as.
 *
 * There is no client-held token any more: the session lives in an httpOnly cookie the
 * browser attaches automatically, which is exactly why page JavaScript cannot read it.
 * That means this module cannot "know" whether it is signed in without asking — every
 * load starts by calling `GET /auth/me` and believing the answer.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, getCurrentUser, signIn, signOut } from "./api-client";
import type { User } from "./types";

interface SessionValue {
  user: User | null;
  /** True until the first `/auth/me` settles, so the UI can avoid flashing a login form. */
  loading: boolean;
  signingIn: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function restore() {
      try {
        setUser(await getCurrentUser(controller.signal));
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // A 401 here is the normal "not signed in" case, not a failure worth showing.
        setUser(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void restore();
    return () => controller.abort();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setSigningIn(true);
    setError(null);
    try {
      const result = await signIn(email, password);
      setUser(result.user);
      return true;
    } catch (err) {
      // The API deliberately says the same thing for a wrong password and an unknown
      // address; passing its message straight through keeps it that way.
      setError((err as ApiError).userMessage);
      setUser(null);
      return false;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut();
    } finally {
      // Clear locally even if the call failed: the user asked to sign out, and the
      // cookie is cleared server-side on any outcome worth caring about.
      setUser(null);
      setError(null);
    }
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ user, loading, signingIn, error, login, logout }),
    [user, loading, signingIn, error, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside a SessionProvider");
  }
  return context;
}
