"use client";

import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";

type Status = "idle" | "loading" | "done" | "error";

const INTERESTS = [
  { value: "lite", label: "EILA" },
  { value: "dealer", label: "Dealer Mission OS" },
  { value: "general", label: "General Commissioned 41 Inquiry" },
] as const;

export function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", interest: "general", message: "" });
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("failed");
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Something went wrong — please try again in a moment.");
    }
  }

  if (status === "done") {
    return (
      <div className="glass living-border flex items-center gap-4 px-6 py-7" role="status">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-mission-green/15 text-mission-green">
          <Check size={20} />
        </span>
        <div>
          <p className="font-semibold text-white">Message received.</p>
          <p className="mt-1 text-sm text-white/55">
            Thanks for reaching out. We&apos;ll be in touch soon.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="glass living-border space-y-5 p-6 sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name">
          <input
            required
            value={form.name}
            onChange={set("name")}
            placeholder="Your name"
            className="c41-input"
          />
        </Field>
        <Field label="Email">
          <input
            required
            type="email"
            value={form.email}
            onChange={set("email")}
            placeholder="you@email.com"
            className="c41-input"
          />
        </Field>
      </div>

      <Field label="Product interest">
        <select value={form.interest} onChange={set("interest")} className="c41-input">
          {INTERESTS.map((o) => (
            <option key={o.value} value={o.value} className="bg-mission-deep text-white">
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Message">
        <textarea
          required
          value={form.message}
          onChange={set("message")}
          placeholder="How can we help?"
          rows={5}
          className="c41-input resize-none"
        />
      </Field>

      {status === "error" && <p className="text-sm text-mission-crimson">{error}</p>}

      <button type="submit" className="btn btn-primary w-full" disabled={status === "loading"}>
        {status === "loading" ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Sending…
          </>
        ) : (
          <>
            Send message <ArrowRight size={16} />
          </>
        )}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/60">
        {label}
      </span>
      {children}
    </label>
  );
}
