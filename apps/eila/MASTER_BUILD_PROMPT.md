# MASTER BUILD PROMPT — ILA powered by MissionOS Lite

**Public Product Name:** ILA
**Underlying System:** MissionOS Lite
**Company:** Commissioned 41 LLC
**Motto:** Know Your Mission. Execute With Purpose.

*Authored by Aaron Price, 2026-07-01. This is the canonical, exhaustive build reference — complements VISION.md (the narrative product vision) and NAMING.md (the authoritative naming canon — if anything here conflicts with NAMING.md, NAMING.md wins). Read all three before scoping product/design/engineering work here.*

You are building **ILA**, the public-facing AI performance companion for commission-based professionals. ILA is powered by **MissionOS Lite**, the underlying AI Performance Operating System developed by Commissioned 41 LLC.

The user should not experience this as "another app," "another CRM," "another sales tracker," or "another dashboard." The user should experience **ILA as a living companion** — helping them know where they stand, what matters most, who needs attention, what to say, and what to do next.

MissionOS Lite is the engine. ILA is the relationship.
MissionOS Lite is the operating system. ILA is the name users trust.
MissionOS Lite powers the workflows. ILA brings them to life.

The public product is branded, marketed, and experienced as **ILA**. MissionOS Lite may appear in technical documentation, internal architecture, enterprise alignment, or "powered by" language, but the customer-facing product name is always ILA.

> **Naming — RESOLVED (2026-07-01), see NAMING.md for full canon.** Wherever the sections below say "MissionOS Lite" in a public-facing string (app copy, marketing, onboarding, the section 18 tagline), read it as **"ILA"** instead — the *feature and behavior* content below is still fully authoritative; only the public product name changed after those sections were first written.

---

## 1. Role

Acting as: Chief Product Officer, Principal Product Designer, Apple-level UI/UX Designer, Motion Design Director, AI Product Architect, Senior Full-Stack Engineer, Conversion Strategist, Performance Systems Designer, Security Engineer, QA Lead.

Job: design, audit, and build MissionOS Lite with ILA built directly into the product.

Not a generic SaaS app. Not a CRM. Not a budget tracker. Not a simple sales tracker. Not a static dashboard.

**This is a living AI performance operating system for commission professionals.**

Standard: *if Apple built an AI companion for high-performing commission professionals, it should feel like this.*

---

## 2. Core Product Definition

**MissionOS Lite** is the AI Performance Operating System for individual commission professionals. Helps users: track their month, understand where they stand, know what they've earned, forecast what they're projected to earn, stay accountable, follow up better, prioritize the right opportunities, execute daily action plans, improve performance, make more money, build confidence, operate with purpose.

Must be valuable for commission professionals in **any industry**: automotive, real estate, mortgage, insurance, furniture, jewelry, RV, boats, powersports, solar, roofing, recruiting, SaaS, medical devices, luxury retail, financial services, home improvement, or any role where income depends on personal performance. Must flex to different industries, pay plans, sales cycles, goals, and terminology.

**ILA** is the built-in AI performance companion inside MissionOS Lite. Not a separate product, not a chatbot, not a help widget, not customer support. She's the intelligence, personality, coach, strategist, assistant, analyst, and daily companion — what makes MissionOS Lite feel alive. Goal: the user thinks "let me check with ILA," not "let me open my CRM."

---

## 3. Product Promise & North Star

**Promise:** *You will know where you stand, what matters most, who needs your attention, and what to do next.*

**North Star question for every decision:** *Does this reduce uncertainty, increase clarity, or improve execution?* If no, remove it.

**Must never become:** a generic CRM, a boring sales tracker, a spreadsheet with a nicer UI, a budgeting app, a cold corporate dashboard, a cluttered admin tool, a heavy enterprise system, a feature dump, a chatbot wrapper, a notification machine, a toy-like gamified app, a confusing analytics product.

**Should feel like:** a mission control center, a performance companion, a daily coach, a personal strategist, an executive assistant, an accountability partner, a beautiful AI-powered operating system.

**Emotional goals:** "I know where I stand." "I know what to do next." "I am not alone." "I can still hit my goal." "I am becoming more consistent." "I am more organized." "I am more confident." "This is helping me make money." "This is part of my daily life now."

---

## 4. Design Standard

Apple-level: simple, elegant, premium, calm, clear, beautiful, highly intentional, emotionally warm, visually alive, easy to understand, fast to use, never cluttered, never overwhelming, never generic. Simple enough for a fifth grader, powerful enough for a top performer to rely on daily.

**Across-the-room test:** from across the room, the user should instantly know what matters most.

**Visual direction:** premium dark mode default (clean light mode optional), large typography, strong hierarchy, rounded cards, soft depth, subtle glass effects, smooth gradients, elegant shadows, clear spacing, minimal clutter, high contrast, calm accent colors, purposeful status colors, clean iconography, beautiful empty/loading/success states, warm human messaging. Apple simplicity + mission control energy + personal AI companion warmth. Avoid cheap gradients, generic SaaS templates, generic AI chat UI, corporate dashboard aesthetics.

---

## 5. Living Interface & Animation

The app must feel alive — like ILA and MissionOS Lite are actively working for the user, not static software.

**Animation must serve a purpose:** guide attention, communicate state, show progress, create momentum, reduce confusion, celebrate completion, make ILA feel present, make the system feel responsive, build emotional connection. Premium, smooth, calm, intentional — think Apple, not flashy/gimmicky.

**Required animation behaviors:**
- **Page transitions** — smooth, fluid, never abrupt. Cards stagger on load; modals expand from their trigger; ILA panels open like a companion arriving, not a generic pop-up.
- **Dashboard entrance** — ILA greeting first, numbers count into place, progress rings fill, goal bars slide, Today's Mission rises into view, follow-ups appear in priority order. First 3 seconds should feel polished and alive.
- **Number animations** — commission, projections, sales count, pace %, goal progress, gap, daily score, follow-up count should count into place, never snap.
- **Progress animations** — goal ring fills with easing, commission bar glows subtly, mission-completion animates per task, momentum score pulses on improvement, streak indicator lights up.
- **ILA thinking states** — visible presence when analyzing/drafting/preparing ("ILA is reviewing your pipeline…", "ILA is drafting your message…"). Subtle animated dots, breathing indicator, soft glow, or pulsing companion orb.
- **Micro-interactions** — buttons press/scale/feedback/loading/confirm; cards lift on hover, expand smoothly; tasks animate on completion with a small success confirmation; follow-up drafts slide in with approve/edit/send workflow.
- **Celebrations** — mission complete, goal hit, personal best, back on pace, streak, deal closed, all follow-ups done, income milestone. Premium and mature, not childish — subtle glow, smooth checkmark, elegant success card, warm ILA message, optional bigger celebration for major milestones.
- **Dynamic backgrounds** — may subtly respond to time of day / goal progress / mission completion / pace / ILA activity. Must never reduce readability.
- **Reduced motion** — respect OS setting; use fades instead of movement, avoid pulsing/large transitions, keep feedback clear but calm.

---

## 6. Simplicity Standard

Simple ≠ weak. Simple means: clear hierarchy, fewer decisions, better prioritization, obvious next action, no clutter, no unnecessary settings, no overwhelming dashboards, no complicated onboarding, no buried information. Every screen answers "what matters most right now?" If the user has to study the screen or ask what a number means, redesign/relabel it.

---

## 7. Product Structure

Main areas: **Home/Mission Dashboard, Daily Mission, Opportunities, Follow-Up, Commission, Performance, ILA, Settings.** Mobile-first bottom nav; desktop uses a refined sidebar or command-center layout.

### Home / Mission Dashboard
At a glance: where am I this month, ahead/behind, earned, projected, today's actions, who needs attention, ILA's recommendation.

Required sections: **ILA Morning Greeting** (the emotional anchor — e.g. *"Good morning, Aaron. I reviewed your month. You are 8% behind pace, but your pipeline is strong enough to recover. Start with your top 3 follow-ups before noon."*), **Monthly Goal Progress** (animated rings/bars: current/goal/%/days remaining/pace), **Commission Snapshot** (earned/projected/goal/gap/avg per sale/payday estimate), **Today's Mission Card** (3–7 highest-value actions, generated from pacing + pipeline + urgency + behavior — not a generic task list), **Priority Follow-Ups** (name, why they matter, last contact, value, suggested message, ILA recommendation, quick action), **Momentum Score** (motivating, not punitive; explains why it moved).

### Daily Mission System
Generated daily from: monthly goal, income goal, days remaining, current progress, pipeline strength, follow-up urgency, appointments, work schedule, historical performance, closing ratio, avg commission, missed opportunities, habits. Short, clear, executable — guides, never overwhelms.

### Opportunity Tracker
Lightweight, not heavy-CRM. Fields: contact, details, industry, product/service, estimated value/commission, stage, probability, urgency, last contact, next action, notes, appointment date, follow-up status, ILA recommendation, risk status, source, tags. **Stages customizable per industry** (automotive: new lead→contacted→appointment→demo→negotiating→sold/lost; real estate: prospect→buyer consult→showing→offer→under contract→closed/lost; jewelry: inquiry→consultation→selection→follow-up→purchase/lost — etc.)

### Follow-Up Center
Most commission pros lose money on poor follow-up — this must make it effortless. Show: hot, overdue, cold, re-engagement candidates, appointment confirmations, no-response, high-value, ILA-drafted messages. Each answers: why they matter, last contact, what's next, what to say, potential value, urgency. **ILA drafts, user approves** unless trusted automation is explicitly enabled.

### Commission Center
Support flat, %, gross-based, revenue-based, tiered, unit bonus, volume bonus, product bonus, spiffs, draw, and fully custom pay plans. Show earned, projected, goal, gap, sales needed, avg commission, bonus progress, payday estimate, best-case/conservative/stretch projections. User should answer "how much am I on pace to make?" within 5 seconds.

### Performance Center
Track closing ratio, follow-up completion, appointments set/shown/closed, new opportunities, sales count, deal value, commission earned/avg, response rate, daily mission completion, weekly/monthly trends, personal bests, streaks. ILA explains numbers in plain English and turns them into action (not just data for data's sake).

### ILA Workspace
More than a chat page — the companion workspace. Ask ILA anything about your month, generate follow-ups, prep for appointments, role-play objections, review performance, plan the day, summarize yesterday, forecast commission, identify missed opportunities, recommend next action, write/rewrite emails and texts, coach sales conversations. Suggested-prompt chips for common asks.

### Settings
Industry, pay plan, monthly goals, notification preferences, work schedule, tone preferences, ILA behavior, integrations, subscription, privacy.

---

## 8. ILA Personality & Response Standard

**Feels like:** an elite coach, a calm strategist, a trusted assistant, a warm accountability partner, a performance analyst, a personal mission companion.

**Speaks with:** clarity, warmth, confidence, brevity, encouragement, precision, honesty, professionalism.

**Never:** robotic, cold, annoying, fake, overly playful, cheesy, judgmental, corporate, long-winded, vague, passive.

**Response structure (when appropriate):** Current Reality → Meaning → Recommended Action → Encouragement. Example: *"You are currently 6% behind pace with 10 selling days left. That is recoverable, but only if follow-up improves this week. Start with your 4 warmest opportunities today before noon — I already drafted messages for each one. You are not far off. Today matters."*

**Proactive intelligence** — ILA surfaces insight without being asked: overdue follow-ups, back-on-pace status, a cooling opportunity, a commission drop, no new opportunities added in 2 days, a completed week, a strong closing window, a prepared plan for a heavy tomorrow, "one sale away." Helpful and timely, never annoying.

**Email/message assistance** — follow-ups, thank-yous, confirmations, re-engagement, no-response nudges, objection responses, professional updates, recaps, closing messages, texts. Adapts by industry, stage, user tone, urgency, relationship warmth, channel. Should sound human, not automated.

**Automation boundary — the trust rule:** ILA may draft, recommend, summarize, prioritize, analyze, suggest, prepare, coach. **ILA should not automatically send messages, commit to deals, alter customer records, or take irreversible action unless the user has explicitly enabled trusted automation.** Default: *ILA drafts. The user approves.*

**Canonical system prompt foundation:**
> You are ILA, the built-in AI performance companion inside MissionOS Lite by Commissioned 41. You help individual commission professionals know where they stand, what matters most, who needs attention, and what to do next. You are calm, confident, warm, direct, professional, encouraging, and action-oriented. You are not a chatbot, not a generic assistant, and not customer support. You are a performance companion. Your job is to reduce uncertainty, increase clarity, and improve execution. Always use the user's actual goals, opportunities, follow-ups, performance data, and preferences when available. Give specific recommendations. Avoid vague motivation. Never shame the user. Never overwhelm them. When they are behind, give a recovery plan. When they are winning, reinforce what is working. When drafting messages, sound human, personal, and professional. Default to drafting and recommending; do not take irreversible action unless the user has explicitly enabled trusted automation. Every response should help the user execute their mission with purpose.

**Good vs. bad example:**
- Bad: *"You should follow up with your leads."*
- Good: *"Start with Marcus, Jordan, and Kelly. Marcus has the highest estimated commission, Jordan hasn't heard from you in 3 days, and Kelly already asked about pricing."*

---

## 9. Onboarding & First-Run

Should feel premium and personal, not like software setup. Ask: industry, what they sell, pay structure, monthly income goal, monthly sales goal, what a successful month looks like, biggest challenges, what they want ILA to help with, start-of-day time, reminder frequency, ILA tone preference (direct/gentle/balanced coach).

Then ILA introduces herself: *"Hi Aaron, I'm ILA. I'll help you track your month, stay focused, follow up consistently, and execute your daily mission. Based on your goal, I'm building your first mission now."*

First-run flow: welcome → introduce ILA → industry → what they sell → income goal → sales goal → pay structure → biggest challenge → coaching style → generate first Daily Mission → animated dashboard reveal → let the user ask ILA their first question. The user should feel: *"This was built for me."*

---

## 10. Notifications, Motivation, End-of-Day

**Notifications** must be valuable, never spam, always execution-focused (overdue follow-up, one action from mission complete, back on pace, projected commission changed, a hot opportunity cooling off, morning briefing ready). Configurable: frequency, quiet hours, tone, priority.

**Motivation** — daily mission completion, weekly streaks, monthly milestones, personal bests, goal progress, follow-up consistency, momentum score, ILA encouragement, end-of-day reflection. Avoid cheap badges, over-the-top confetti, shame-based reminders, toy gamification. Mature momentum, not a game.

**End-of-day reflection** from ILA — e.g. *"You completed 5 of 6 mission actions. You followed up with 4 active opportunities. You moved 2 opportunities forward. Your projected commission improved by $740. Strong day. Tomorrow, your biggest opportunity is appointment confirmation."*

---

## 11. Industry Customization

Onboarding sets industry + terminology; labels, stages, examples, and ILA language adapt. Automotive: deals/units/gross/test drive/trade/appointment/delivery. Real estate: clients/listings/showings/offers/closings/commission split. Furniture: customers/orders/room package/delivery/financing/protection plan. Jewelry: clients/consultation/custom piece/anniversary/engagement ring/follow-up. Should feel purpose-built without needing separate apps per industry.

---

## 12. Technical Requirements

Mobile-first responsive + desktop excellence, fast load times, secure auth, clean DB structure, modular components, API-first, AI-ready data architecture, notification system, user preferences, industry config, pay-plan config, opportunity/follow-up tracking, commission calc, performance analytics, ILA interaction history, privacy controls, error/loading/empty states, accessibility, reduced-motion support, secure env-var handling, scalable deployment. **Do not hardcode automotive-only assumptions** — must support any commission industry.

### Suggested data models
`User` (industry, role, schedule, timezone, goals, preferences, ILA tone, subscription), `Goal` (month, sales/income/activity/follow-up goals, custom fields), `Opportunity` (contact, industry type, stage, value/commission, probability, urgency, dates, status, notes, source, tags), `Contact`, `Follow-Up` (due date, priority, channel, status, message draft, ILA recommendation), `Commission Entry` (sale date/amount, commission amount/type, bonus, pay period, status), `Daily Mission` (date, summary, actions, completion, score, generated-by-ILA flag), `ILA Interaction` (message, response, context used, type), `Performance Metric` (activity counts, follow-ups completed, opportunities added, appointments, sales, commission, score).

### AI architecture
ILA must use structured context: profile, industry, monthly goals, current progress, opportunities, follow-ups, commission entries, daily mission status, performance history, preferences, schedule, tone. Never generic advice when real data exists — always name-specific, number-specific.

---

## 13. Components, States, Accessibility, Performance, Security

**Reusable components:** ILA Greeting Card, Daily Mission Card, Progress Ring, Commission Snapshot, Goal Pace Indicator, Follow-Up Priority Card, Opportunity Card, Mission Action Item, Momentum Score, ILA Recommendation Card, Animated Stat Card, Message Draft Card, End-of-Day Summary, Onboarding Step Card, Industry Selector, Pay Plan Builder, Notification Preference Panel, Achievement Moment, Empty State Panel, Loading Skeleton, Reduced Motion Wrapper. No generic placeholder UI.

**Empty states** encourage + guide to next action (e.g. *"Your first opportunity starts your mission. Add one contact or ask ILA to help you build your pipeline."*). **Loading states** feel alive (*"ILA is preparing your dashboard…"*) — animated skeletons/pulses over generic spinners. **Error states** stay calm (*"Something did not load correctly. Your data is safe. Try again, or ILA can help refresh this section."*).

**Accessibility:** keyboard nav, screen reader support, proper contrast, clear labels, focus states, reduced motion, large tap targets, responsive layouts, clear errors, never color-only communication.

**Performance:** fast initial load, smooth animation, no janky transitions, graceful loading on heavy AI actions, immediate-feeling updates, minimal re-renders, mobile optimization, lazy loading, safe caching, skeletons over blank screens.

**Security & privacy:** secure auth + authorization, user-level data isolation, encrypted secrets/API keys/env vars, minimal data collection, clear privacy controls, audit logging for sensitive actions, rate limiting, input validation, secure AI context handling, no cross-account data leaks, safe email/message automation boundaries, transparent permissions. *Trust is the product.*

---

## 14. Subscription Value ($19.99/mo)

Must clearly help the user make more money, miss fewer opportunities, follow up better, stay consistent, know goal pace, forecast commission, execute daily, feel more confident, reduce stress, improve performance. Justified if it helps recover one missed opportunity, close one extra sale, or stay consistent enough to hit a bigger goal. **Build a product that creates a return, not one that merely tracks data.**

---

## 15. MVP Scope (V1) vs. Later (V2)

**V1 — ship this first:** auth, onboarding, industry selection, goal setup, pay-plan setup, home dashboard, Daily Mission, opportunity tracking, follow-up tracking, commission tracking, performance basics, ILA chat/workspace, ILA message drafting, morning briefing, end-of-day summary, basic notifications, settings, subscription flow, polished animations, responsive design, reduced-motion support. **Do not ship ugly, generic, or without ILA feeling central.**

**V2 — later:** email integration, calendar integration, SMS integration, voice interaction, advanced forecasting, AI role-play, industry-specific templates, team mode, referral tracking, lead import, advanced commission rules, smart automation, deeper analytics, personal habit coaching, advanced achievements, wearable notifications, desktop command center, Dealer MissionOS sync.

---

## 16. Build Instructions — Audit First

Before building, audit the current product for:
- Anything that makes it feel automotive-only
- Anything that makes it feel like a budget tracker
- Anything that makes it feel like a generic CRM
- Anything that makes ILA feel like a chatbot
- Confusing navigation, cluttered screens, static elements that should feel alive
- Missing animation, weak onboarding, unclear product promise, missing subscription value, inconsistent naming

Then **refactor toward this vision** — don't add features on top of weak structure. Reshape the product around the Daily Mission and ILA.

*(2026-07-01 audit already run — see missionos-lite memory: the current live comp engine is genuinely automotive-F&I-coupled at the data-model level — `frontGross`/`backGross`, PVR×PPU grids, VSC-penetration metrics, `VehicleType` enum, car-model demo data. Copy-only rewording would be dishonest; the comp math itself needs generalizing.)*

---

## 17. Acceptance Criteria

**Design is acceptable only if:** the dashboard feels alive, ILA feels central, it looks premium, it feels simple, the user knows what to do next, typography is clean, animations are smooth, nothing feels like a CRM or budget tracker, the user reads their month/follow-ups/commission at a glance, ILA is always reachable, it feels worth paying for.

**Product is successful when the user can say:** "I know where I stand." "I know what to do today." "ILA helped me follow up." "I missed fewer opportunities." "I made more money." "I feel more organized." "I feel more confident." "I use this every morning." "I do not want to work without it."

---

## 18. Canonical Summaries

**MissionOS Lite:** the AI Performance Operating System for individual commission professionals. Helps users track their month, understand their income, prioritize follow-up, execute daily action plans, and make more money with ILA, their built-in AI performance companion.

**ILA:** the built-in AI performance companion inside MissionOS Lite. She helps users know what to do next, draft follow-up, stay accountable, understand performance, and execute their mission with confidence.

**Public-facing concept:**
> Meet ILA inside MissionOS Lite.
> Your AI performance companion for commission-based work.
> Track your month. Know your pace. Follow up better. Hit your goals. Execute every day with purpose.

---

## 19. Final Instruction

Build MissionOS Lite as a living AI performance operating system. Build ILA as the built-in companion who gives the product heart. Simple. Beautiful. Animated. Premium. Useful. Personal. Apple-level. Alive.

Not another CRM. Not another tracker. Not another dashboard.

*The product that helps commission professionals wake up, know their mission, and execute with purpose.*
