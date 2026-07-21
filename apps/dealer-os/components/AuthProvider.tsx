"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { LoginPanel } from "@/components/LoginPanel";
import { MfaChallenge } from "@/components/MfaChallenge";
import { isOwnerEmail, normalizeAccessRole } from "@/lib/access";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

export type AuthRole = "Admin" | "Manager" | "F&I" | "Sales" | "BDC";

export type UserProfile = {
  email: string;
  displayName: string;
  role: AuthRole;
  employeeName: string;
};

type AuthContextValue = {
  session: Session | null;
  profile: UserProfile | null;
  secureMode: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isOwner: boolean;
  signOut: () => Promise<void>;
  canAccess: (path: string) => boolean;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  profile: null,
  secureMode: false,
  isAdmin: true,
  isManager: true,
  isOwner: true,
  signOut: async () => {},
  canAccess: () => true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(Boolean(supabase));
  // Hydration gate: the dev-preview bypass below reads localStorage, which only
  // exists on the client. Applying it during the first render would diverge from
  // the server HTML, so we defer it until after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Two-factor gate (Safeguards Rule): "pending" while we ask Supabase whether
  // this session still owes an MFA code, "challenge" renders the code screen
  // instead of the app. Fails OPEN on errors — a broken AAL check must never
  // lock a store out of its own data; users without a factor sail through.
  const [mfaGate, setMfaGate] = useState<"pending" | "challenge" | "clear">("pending");

  useEffect(() => {
    if (!supabase || !session) {
      setMfaGate("pending");
      return;
    }
    let cancelled = false;
    supabase.auth.mfa
      .getAuthenticatorAssuranceLevel()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) setMfaGate("clear");
        else setMfaGate(data.nextLevel === "aal2" && data.currentLevel === "aal1" ? "challenge" : "clear");
      })
      .catch(() => {
        if (!cancelled) setMfaGate("clear");
      });
    return () => {
      cancelled = true;
    };
  }, [session, supabase]);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(async ({ data }) => {
      let next = data.session;
      // Cold open after hours away: the stored pass may be expired or seconds
      // from it. Renew it BEFORE the app mounts, so the first wave of data
      // fetches never goes out with a dead token (the "opens on zeros" bug).
      const expiresAt = (next?.expires_at ?? 0) * 1000;
      if (next && expiresAt && expiresAt < Date.now() + 60_000) {
        try {
          const { data: refreshed } = await supabase.auth.refreshSession();
          if (refreshed.session) next = refreshed.session;
        } catch {
          // Keep the stored session; the store client's 401-retry is the net.
        }
      }
      setSession(next);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setProfile(null);
    });

    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !session?.user) return;

    supabase
      .from("user_profiles")
      .select("email, display_name, role, employee_name")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setProfile(normalizeProfile(data, session.user.email || ""));
      });
  }, [session, supabase]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError("Secure login is not connected yet.");
      return;
    }

    setError("");
    setSigningIn(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(
        /invalid api key/i.test(signInError.message)
          ? "Secure login key is not valid yet. Check the Supabase publishable key in Vercel."
          : signInError.message
      );
    }
    setSigningIn(false);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  const signedInEmail = profile?.email || session?.user.email || "";
  const owner = isOwnerEmail(signedInEmail);
  const role = owner ? "Admin" : profile?.role || "Sales";

  if (isPublicPath(pathname)) {
    return (
      <AuthContext.Provider value={{ ...publicAuthValue }}>
        {children}
      </AuthContext.Provider>
    );
  }

  // DEV-ONLY local preview — NEVER production (NODE_ENV guard) and off unless the
  // localStorage flag is set by hand. Lets me load the logged-in screens as an
  // admin to verify layout/interaction. Toggle: localStorage.__dev_preview = "1".
  const devBypass =
    mounted &&
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    window.localStorage.getItem("__dev_preview") === "1";
  if (devBypass && !session) {
    return (
      <AuthContext.Provider value={{ session: { user: { id: "dev", email: "dev@local" } } as any, profile: { email: "dev@local", displayName: "Dev", role: "Admin", employeeName: "Dev" } as any, secureMode: false, isAdmin: true, isManager: true, isOwner: true, signOut, canAccess: () => true }}>
        {children}
      </AuthContext.Provider>
    );
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-mission-navy text-white">
        <div className="font-display text-2xl font-black">Loading Mission...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <LoginPanel
        email={email}
        password={password}
        error={error}
        isReady={Boolean(supabase)}
        isSubmitting={signingIn}
        showPassword={showPassword}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onShowPasswordChange={setShowPassword}
        onSubmit={signIn}
      />
    );
  }

  // Two-factor: password alone is only half a sign-in for enrolled users.
  // Hold at a loading shell while the AAL check answers (it reads the local
  // JWT, so this is quick), then demand the code.
  if (supabase && mfaGate === "pending") {
    return (
      <div className="grid min-h-screen place-items-center bg-mission-navy text-white">
        <div className="font-display text-2xl font-black">Loading Mission...</div>
      </div>
    );
  }
  if (supabase && mfaGate === "challenge") {
    return <MfaChallenge supabase={supabase} onVerified={() => setMfaGate("clear")} onSignOut={() => void signOut()} />;
  }

  return (
    <AuthContext.Provider value={{
      session,
      profile,
      secureMode: true,
      isAdmin: owner || role === "Admin",
      isManager: owner || role === "Admin" || role === "Manager",
      isOwner: owner,
      signOut,
      canAccess: (path) => (owner ? true : canRoleAccess(role, path)),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Owner-ONLY surfaces — Aaron's private command screens. These are for the
// product owner alone; a store's own Admin must never reach them (or even know
// they exist). Gated above role checks so even role "Admin" is blocked.
const ownerOnlyPaths = ["/waitlist", "/mission-core", "/ila-brain"];
export function isOwnerOnlyPath(path: string) {
  return ownerOnlyPaths.some((p) => path === p || path.startsWith(`${p}/`));
}

export function canRoleAccess(role: AuthRole, path: string) {
  if (isOwnerOnlyPath(path)) return false; // owner is allowed via the owner short-circuit in canAccess
  if (role === "Admin") return true;
  const normalized = path === "/command" ? "/commands" : path;
  const access = roleAccess[role] ?? roleAccess.Sales;
  return access.some((allowed) => normalized === allowed || normalized.startsWith(`${allowed}/`));
}

const commonAccess = [
  "/",
  "/login",
  "/employee-profile",
  "/team-command",
  "/business-card",
  "/recognition-feed",
  "/my-scorecard",
  "/private-chat",
  "/follow-up",
  "/appointments",
  "/equity",
  "/security",
  "/service",
  "/parts",
];

const managerAccess = [
  ...commonAccess,
  "/crm-desk",
  "/desking",
  "/finance-desk",
  "/lease",
  "/deal-entry",
  "/goals",
  "/finance-command",
  "/commands",
  "/deal-center",
  "/deal-scorecard",
  "/rdr-center",
  "/archive",
];

const roleAccess: Record<AuthRole, string[]> = {
  Admin: ["*"],
  Manager: managerAccess,
  // F&I (finance managers) get the same access as sales managers, including
  // Deal Entry and the 6% holdback readout. GM Command stays Admin-only.
  "F&I": managerAccess,
  Sales: [...commonAccess, "/crm-desk"],
  BDC: [...commonAccess, "/crm-desk"],
};

const publicAuthValue: AuthContextValue = {
  session: null,
  profile: null,
  secureMode: false,
  isAdmin: false,
  isManager: false,
  isOwner: false,
  signOut: async () => {},
  canAccess: (path) => isPublicPath(path),
};

function isPublicPath(path: string) {
  // The customer-facing "Your Deal" page — public by design. `/deal-view` (fragment
  // link, current) and `/deal-view/<token>` (legacy path link).
  return path.startsWith("/card/") || path.startsWith("/c/") || path === "/deal-view" || path.startsWith("/deal-view/") || path === "/welcome" || path === "/terms" || path === "/privacy" || path === "/signup";
}

function normalizeRole(value?: string | null): AuthRole {
  return normalizeAccessRole(value);
}

function normalizeProfile(data: any, fallbackEmail: string): UserProfile {
  const email = data?.email || fallbackEmail;
  const displayName = data?.display_name || data?.employee_name || email.split("@")[0] || "Employee";
  const role = isOwnerEmail(email) ? "Admin" : normalizeRole(data?.role);
  const employeeName = data?.employee_name || displayName;

  return { email, displayName, role, employeeName };
}
