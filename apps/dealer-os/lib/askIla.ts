// Tap-to-explain law (app-wide): any computed number on a primary screen can be
// questioned — tapping it hands the user off to EILA with a specific "Explain my
// <number>" prompt, and EILA walks the real math in plain words. This helper is
// the handoff: fire it from anywhere and the Command Deck (mounted on every
// screen via AppShell) expands and sends the prompt as if the user asked it.
export const ASK_EILA_EVENT = "ila:ask";

export function askIla(prompt: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(ASK_EILA_EVENT, { detail: prompt }));
}
