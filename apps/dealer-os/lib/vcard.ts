// vCard 3.0 — "Save to Contacts" for the digital business card. A data URL the
// browser downloads as a .vcf; iOS/Android open it straight into Add Contact,
// so a customer keeps the rep in their phone from one tap. This is the thing a
// paper card can't do.
export function buildVCard(input: {
  name: string;
  title?: string;
  org?: string;
  phone?: string;
  email?: string;
  url?: string;
}): string {
  const esc = (v: string) => v.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${esc(input.name)}`, `N:${esc(input.name)};;;;`];
  if (input.org) lines.push(`ORG:${esc(input.org)}`);
  if (input.title) lines.push(`TITLE:${esc(input.title)}`);
  if (input.phone) lines.push(`TEL;TYPE=CELL,VOICE:${input.phone.replace(/[^0-9+]/g, "")}`);
  if (input.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(input.email)}`);
  if (input.url) lines.push(`URL:${esc(input.url)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export function vCardHref(input: Parameters<typeof buildVCard>[0]): string {
  return `data:text/vcard;charset=utf-8,${encodeURIComponent(buildVCard(input))}`;
}

export function vCardFileName(name: string): string {
  return `${name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")}.vcf`;
}
