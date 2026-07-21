// Deterministic PII scrub for cross-tenant "brain" lessons. A lesson is injected
// into EVERY store's prompt, so it must carry no verbatim identifiers. Beyond the
// reflection prompt's "no names" instruction, DROP any lesson containing a dollar
// figure, phone, VIN, email, or grouped large number — the structured PII most
// likely to leak a specific store/customer across tenants (SOC 2 C1.1; audit M-7).
// Kept dependency-free so it's unit-testable in isolation.
const BRAIN_PII_PATTERNS: RegExp[] = [
  /\$\s?\d/, // dollar amounts
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // phone numbers
  /\b[A-HJ-NPR-Z0-9]{17}\b/i, // VIN
  /[\w.+-]+@[\w-]+\.\w{2,}/, // email
  /\b\d{1,3}(?:,\d{3})+\b/, // grouped thousands (gross figures)
];

export function isBrainSafeLesson(lesson: string): boolean {
  return !BRAIN_PII_PATTERNS.some((re) => re.test(lesson));
}
