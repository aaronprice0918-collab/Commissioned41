"use client";

import Image from "next/image";
import { AlertTriangle, Eye, EyeOff, LogIn, ShieldCheck } from "lucide-react";
import { MissionMark, MissionWordmark } from "@/components/BrandMarks";

type LoginPanelProps = {
  email: string;
  password: string;
  error: string;
  isReady: boolean;
  isSubmitting: boolean;
  showPassword: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onShowPasswordChange: (value: boolean) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

export function LoginPanel({
  email,
  password,
  error,
  isReady,
  isSubmitting,
  showPassword,
  onEmailChange,
  onPasswordChange,
  onShowPasswordChange,
  onSubmit,
}: LoginPanelProps) {
  // Host-aware branding: the company core (hq.*) shows Commissioned 41; the
  // product app shows Dealer Mission OS. LoginPanel only renders client-side (after the
  // auth loading state), so reading the hostname here is safe.
  const isHq = typeof window !== "undefined" && window.location.hostname.split(".")[0] === "hq";
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#070b16] px-4 py-10">
      {/* drifting liquid light — navy base with a living green/blue glow */}
      <div className="lg-blob" style={{ left: "-12%", top: "2%", width: "60%", height: "55%", background: "rgb(96 150 255 / 0.16)", animation: "lgBlob 11s ease-in-out infinite" }} />
      <div className="lg-blob" style={{ right: "-14%", bottom: "0%", width: "58%", height: "52%", background: "rgb(40 110 200 / 0.14)", animation: "lgBlob2 13s ease-in-out infinite" }} />
      <div className="pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 240px 60px rgba(0,0,0,0.72)" }} />

      <form
        onSubmit={onSubmit}
        className="living-border lg-glass relative z-10 w-full max-w-md rounded-[22px] p-8 shadow-[0_40px_120px_rgba(0,0,0,0.6)]"
      >
        <div className="mb-8 text-center">
          {isHq ? (
            <>
              <Image src="/brand/c41-logo-transparent.png" alt="Commissioned 41" width={1007} height={755} className="mx-auto h-32 w-auto select-none drop-shadow-[0_18px_50px_rgba(0,0,0,0.6)]" priority />
              <div className="mx-auto mt-5 h-px w-14 bg-gradient-to-r from-transparent via-mission-green/70 to-transparent" />
              <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.34em] text-white/45">Owner Access</div>
            </>
          ) : (
            <>
              <MissionMark className="relative mx-auto h-16 w-16" priority />
              <MissionWordmark className="mt-4 block text-[26px] tracking-[0.10em]" />
              <div className="mx-auto mt-5 h-px w-14 bg-gradient-to-r from-transparent via-mission-green/70 to-transparent" />
              <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.34em] text-white/45">Secure sign-in</div>
            </>
          )}
        </div>

        {!isReady && (
          <div className="mb-4 rounded-[12px] border border-mission-red/30 bg-mission-red/10 p-3 text-sm font-bold leading-6 text-mission-red">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Secure login is not connected yet.
            </div>
            <div className="mt-1 text-white/68">Supabase URL and publishable key must be set in Vercel.</div>
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">Email</span>
          <input
            className={inputClass}
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">Password</span>
          <div className="flex min-h-12 items-center rounded-[12px] border border-white/10 bg-[#0c1220]/80 transition focus-within:border-mission-green/70 focus-within:shadow-[0_0_0_3px_rgb(57_245_140_/_0.14)]">
            <input
              className="h-12 min-w-0 flex-1 bg-transparent px-4 text-sm text-white outline-none"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => onShowPasswordChange(!showPassword)}
              className="grid h-12 w-12 place-items-center text-white/50 transition hover:text-white"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>

        {error && (
          <div className="mt-4 rounded-[12px] border border-mission-red/30 bg-mission-red/10 p-3 text-sm font-bold leading-6 text-mission-red">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!isReady || isSubmitting}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-gradient-to-b from-[#f3f5f7] to-[#c2c9d0] px-5 py-3.5 text-sm font-black uppercase tracking-[0.14em] text-[#0a0b0d] shadow-[0_8px_30px_rgb(57_245_140_/_0.12)] transition hover:brightness-[1.06] hover:shadow-[0_10px_34px_rgb(57_245_140_/_0.26)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isSubmitting ? <ShieldCheck className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {isSubmitting ? "Signing In..." : "Sign In"}
        </button>

        <div className="mt-6 text-center text-[10px] font-semibold uppercase tracking-[0.22em] text-white/25">
          {isHq ? "Commissioned 41 · Owner Access" : "A Commissioned 41 product"}
        </div>
      </form>
    </div>
  );
}

const inputClass =
  "h-12 w-full rounded-[12px] border border-white/10 bg-[#0c1220]/80 px-4 text-sm text-white outline-none transition focus:border-mission-green/70 focus:shadow-[0_0_0_3px_rgb(57_245_140_/_0.14)]";
