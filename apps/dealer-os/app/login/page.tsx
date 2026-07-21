"use client";

import { LogOut, ShieldCheck } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useAuth } from "@/components/AuthProvider";

export default function LoginPage() {
  const { profile, secureMode, session, signOut } = useAuth();

  return (
    <div>
      <SectionHeader title="Login" kicker="Secure employee access" />
      <section className="glass-card mx-auto max-w-2xl rounded-[12px] p-8 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[12px] border border-mission-gold/35 bg-mission-gold/10 text-mission-gold">
          <ShieldCheck className="h-8 w-8" />
        </div>
        <div className="readable-text mt-5 font-display text-3xl font-black text-white">
          {session ? "You are signed in." : "Sign in required."}
        </div>
        <p className="readable-text mx-auto mt-3 max-w-xl text-sm leading-6 text-white/60">
          {session
            ? "Your secure session is active. Use the navigation above to continue working."
            : secureMode
              ? "Enter your email and password to access Mission."
              : "Secure login activates when Supabase is connected."}
        </p>
        {profile && (
          <div className="mt-5 flex justify-center">
            <StatusPill tone={profile.role === "Admin" ? "gold" : "blue"}>
              {profile.employeeName} | {profile.role}
            </StatusPill>
          </div>
        )}
        {session && (
          <button
            type="button"
            onClick={signOut}
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-black uppercase tracking-[0.08em] text-white/72 transition hover:border-mission-gold/40 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        )}
      </section>
    </div>
  );
}
