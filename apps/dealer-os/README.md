# Commissioned 41 OS

Kennesaw Mazda Commissioned 41 operating system.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Run for store network access

```bash
npm run build
npm run start:store
```

See `DEPLOYMENT.md` for how to share the local network link.

## Hosted access

Use `supabase/schema.sql`, `.env.example`, and `DEPLOYMENT.md` to connect the app to Supabase and deploy through Vercel.

## Screens

- Mission Control
- Deal Entry Console
- Employee Profile
- Digital Business Card
- Finance Command
- New / Used / Wholesale Command
- Recognition Feed
- Deal Center
- Deal Scorecard
- RDR Center
- My Scorecard
- Private Chat
- Admin

## Core logic

- Store goal: 130 delivered units
- PVR total goal: $3,000
- Back-end goal: $1,800
- Front-end goal: $1,200
- PPU minimum: 2.0
- PPU elite: 2.5
- Classified opportunities count toward F&I
- Not Classified and DNQ do not hurt F&I
- Cash deals count normally unless marked Not Classified
- Product values: VSC, GAP, Maintenance, Permaplate, and TWS count as 1 each; UTP counts as 5
