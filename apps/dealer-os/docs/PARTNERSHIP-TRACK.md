# Partnership & Certification Track — opened July 11, 2026

The two Tier-A gaps from `COMPETITIVE-GAPS-2026-07.md` that are paperwork and
partnerships, not code. This is the working checklist; update it as calls
happen.

## 1. Mazda lead-handling certification (sell-blocker for Mazda store #2+)

Franchise stores route OEM leads only through certified CRM/lead handlers
(VinSolutions holds named certs per manufacturer, including a Mazda program).
Kennesaw works today because we're the house system; selling to another Mazda
store requires the program.

- [ ] Ask the Kennesaw GM/dealer principal for the Mazda dealer-systems
      contact (fastest path — Mazda tells its own dealers who to talk to).
- [ ] Request the Mazda lead-handling/CRM certification requirements doc.
- [ ] Map requirements against what already ships (speed-to-lead clock +
      response reporting, consent rail, statusHistory audit trail — likely
      most of the functional bar).
- [ ] Budget: OEM programs typically want a support commitment + testing
      window, sometimes a fee. Get the number before promising a date.

## 2. 700Credit partnership (compliance rails — integrate, don't build)

700Credit (21,000+ dealers) is the de-facto rail: credit pulls, soft-pull
prequal, OFAC + remediation, Red Flags, adverse-action letters, MLA,
synthetic-ID. One integration answers "where's your OFAC?" for every
franchise-store security/compliance questionnaire.

- [ ] Apply via 700Credit's integration-partner program (they certify
      CRM/desking vendors; Kennesaw is almost certainly already a 700Credit
      dealer — ask F&I whose credit portal they log into).
- [ ] First scope: soft-pull prequal + OFAC/Red Flags status pulled onto the
      lead card (read-only) — no bureau data stored in app_store, display
      passthrough only.
- [ ] Their partner agreement will require a security review — the MFA ship
      and security-policy docs are the head start; have them ready to send.

## 3. Dealertrack / RouteOne (later — F&I workflow depth, Tier B)

Partner-gated APIs; being an integration partner is the price of playing in
eContracting. Don't start until a store asks for it — but when the 700Credit
paperwork is moving, ask them which aggregator path they recommend; they sit
in the middle of both.
