// The first touch — the message that answers a fresh up inside the 5:00
// window. This template is the INSTANT draft (no API round-trip, works with
// the AI off) and the floor EILA's live draft has to beat: personal, specific
// to what the customer asked about, one easy question, zero dealer-speak.
// The opt-out notice is appended by the send pipeline (lib/comms.ts), not
// here — this is just the human part.

type FirstTouchLead = {
  customerFirstName?: string;
  customer?: string;
  vehicle?: string;
  source?: string;
};

function firstName(lead: FirstTouchLead): string {
  const first = String(lead.customerFirstName || "").trim();
  if (first) return first;
  return String(lead.customer || "").trim().split(/\s+/)[0] || "";
}

// How the lead came in changes the opener — a web lead asked about a specific
// car, a phone up called us, a referral knows someone we know.
function opener(lead: FirstTouchLead): string {
  const vehicle = String(lead.vehicle || "").trim();
  const source = String(lead.source || "").trim().toLowerCase();
  const about = vehicle ? `the ${vehicle}` : "the car you asked about";
  if (source.includes("referral")) return `heard you might be looking for ${vehicle ? `a ${vehicle}` : "your next car"}`;
  if (source.includes("phone")) return `following up on your call about ${about}`;
  if (source.includes("walk") || source.includes("showroom")) return `great meeting you — following up on ${about}`;
  // Web/internet/OEM leads and everything else: they raised their hand online.
  return `just saw your note about ${about}`;
}

export function firstTouchDraft(lead: FirstTouchLead, repName: string, storeName: string): string {
  const name = firstName(lead);
  const rep = String(repName || "").trim().split(/\s+/)[0] || "your contact";
  const store = String(storeName || "").trim() || "the store";
  const vehicle = String(lead.vehicle || "").trim();
  const question = vehicle ? `Want me to have it pulled up front so it's ready when you come by?` : `What are you hoping to find — I'll line up the right ones before you come in?`;
  return `${name ? `Hi ${name}, ` : "Hi, "}this is ${rep} at ${store} — ${opener(lead)}. ${question}`;
}
