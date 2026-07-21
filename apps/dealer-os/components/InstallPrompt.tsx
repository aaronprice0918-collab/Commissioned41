"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> };

// A tasteful, dismissible "install Dealer Mission OS to your home screen" prompt.
// Android/desktop Chrome: captures beforeinstallprompt → one-tap install button.
// iOS Safari (no programmatic install): shows the Share → Add to Home Screen hint.
// Hidden when already installed or after the user dismisses it.
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return; // already installed — nothing to do
    if (localStorage.getItem("missionos-install-dismissed") === "1") return;

    const ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !/crios|fxios/i.test(window.navigator.userAgent);
    setIsIos(ios);

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS never fires beforeinstallprompt — show the manual hint after a beat.
    let t: ReturnType<typeof setTimeout> | undefined;
    if (ios) t = setTimeout(() => setShow(true), 1200);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      if (t) clearTimeout(t);
    };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    localStorage.setItem("missionos-install-dismissed", "1");
  };
  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
    setShow(false);
  };

  return (
    <div style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }} className="fixed inset-x-0 top-0 z-[55] flex justify-center px-3">
      <div className="lg-glass living-border flex w-full max-w-lg items-center gap-3 rounded-[16px] px-4 py-3 shadow-[0_14px_40px_rgba(0,0,0,0.5)]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mission-green/15 text-mission-green">
          <Download className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-white">Put Dealer Mission OS on your home screen</div>
          {isIos ? (
            <div className="mt-0.5 flex items-center gap-1 text-xs leading-5 text-white/55">
              Tap <Share className="mx-0.5 inline h-3.5 w-3.5 text-mission-green" /> then <span className="font-bold text-white/80">Add to Home Screen</span>
            </div>
          ) : (
            <div className="mt-0.5 text-xs leading-5 text-white/55">Install it like a real app — full screen, its own icon.</div>
          )}
        </div>
        {!isIos && (
          <button type="button" onClick={install} className="shrink-0 rounded-full bg-mission-green px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-navy transition hover:brightness-110">
            Install
          </button>
        )}
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
