// EILA's hands — the fixes she can make herself, live in the chat. The app's
// data lives on the USER'S device (and their synced cloud row), so tools
// execute CLIENT-side: the API streams her words, then hands any tool calls
// back to the client, which applies them through the store and returns the
// results for her to confirm. Settings and data are hers to fix on the fly;
// the pay-math engine is not a tool on purpose — that only changes through
// the tested deploy pipeline.

export const TOOL_MARKER = "\n@@ILA_TOOLS@@"; // separates spoken text from tool calls in the stream

export interface IlaToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// Anthropic tool definitions (server passes these when the client allows tools).
export const ILA_TOOLS = [
  {
    name: "set_days_off",
    description:
      "Set which weekdays the user does NOT work (store closed or scheduled day off). This drives pace math — the month is extrapolated over working days. Use when the user says their pace is wrong because of their schedule, or tells you their days off.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: {
          type: "array",
          items: { type: "integer", minimum: 0, maximum: 6 },
          description: "Weekday numbers they DON'T work: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday. Full replacement list.",
        },
      },
      required: ["days"],
    },
  },
  {
    name: "update_products",
    description:
      "Replace the user's F&I product menu (names, unit weights toward products-per-deal, flat spiff $ per sale). Use when they want to add/rename/remove a product, change how many units a bundle counts for, or change a spiff. Always send the COMPLETE menu (existing products plus changes).",
    input_schema: {
      type: "object" as const,
      properties: {
        products: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Keep the existing id when editing; omit for new products." },
              label: { type: "string" },
              units: { type: "number", description: "Product units one sale counts for (bundles can be >1)." },
              spiff: { type: "number", description: "Flat $ paid per sale of this product." },
            },
            required: ["label", "units", "spiff"],
          },
        },
      },
      required: ["products"],
    },
  },
  {
    name: "log_deal",
    description:
      "Log a NEW deal — the app's core action. Use whenever the user tells you about a deal that isn't on the board yet: 'just closed the Hendersons, 2 grand front 1,500 back', 'put in an appointment for Tony Vega Saturday', 'add a prospect named Ruiz'. Defaults to a delivered deal dated today; pass status for pipeline adds and date only if it happened another day. Logging their first real deal automatically clears any sample data.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer: { type: "string", description: "Customer name (required)." },
        status: { type: "string", enum: ["prospect", "appointment", "working", "pending", "finance", "delivered"], description: "Defaults to delivered." },
        item: { type: "string", description: "What they bought / are looking at (e.g. 'CX-5')." },
        amount: { type: "number", description: "Primary/front money channel in dollars." },
        secondary: { type: "number", description: "Secondary/back money channel (F&I back gross)." },
        reserve: { type: "number" },
        products: { type: "array", items: { type: "string" }, description: "Product names from their menu sold on this deal (F&I)." },
        salesperson: { type: "string" },
        salesperson2: { type: "string", description: "50/50 split partner." },
        bank: { type: "string" },
        deal_number: { type: "string" },
        phone: { type: "string" },
        note: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD if not today." },
        follow_up_date: { type: "string", description: "YYYY-MM-DD for the next touch (pipeline deals)." },
        product_only: { type: "boolean", description: "Backend products sold with NO vehicle (walk-in VSC etc.) — counts toward PVR/PPU but NOT as a unit." },
      },
      required: ["customer"],
    },
  },
  {
    name: "import_deals",
    description:
      "Bulk-import a whole month of deals from the user's spreadsheet ('THE LOGG') in one shot. Use when the user pastes tabular deal rows or asks to import their LOGG / sheet / month. Pass the pasted text verbatim as `csv` INCLUDING the header row — EILA maps the columns (customer, date, salesperson, front/F&I gross, and per-product columns like VSC/GAP/Combo/Maintenance) to the right fields and lands each deal individually. Deals import as delivered + funded. Prefer this over many log_deal calls when they give you more than a couple rows at once. For a single deal they describe in words, use log_deal.",
    input_schema: {
      type: "object" as const,
      properties: {
        csv: { type: "string", description: "The pasted spreadsheet text (CSV or tab-separated), header row first, then one row per deal. Paste it exactly as given." },
      },
      required: ["csv"],
    },
  },
  {
    name: "add_life_item",
    description:
      "Add a non-deal item to the user's EILA Day board: appointments, errands, reminders, habits, family commitments, workouts, calls they need to make, or tasks outside the CRM. This does NOT contact anyone, send messages, or add to an external calendar; it only adds the item inside EILA so she can protect it in the day plan. Do not use this for customer follow-up dates tied to a deal — use update_deal follow_up_date for those.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Short human title, e.g. 'Dentist appointment', 'Call mom', 'Pick up dry cleaning'." },
        kind: { type: "string", enum: ["appointment", "task", "personal"], description: "appointment for scheduled places/meetings, task for to-dos, personal for family/habit/life commitments. Defaults to task." },
        date: { type: "string", description: "Local YYYY-MM-DD. If they say today, use today's date; if tomorrow, compute tomorrow's date. If no date is clear, default to today." },
        time: { type: "string", description: "Optional local HH:mm 24-hour time, e.g. 09:30 or 17:00." },
        note: { type: "string", description: "Optional short private note." },
      },
      required: ["title"],
    },
  },
  {
    name: "delete_deal",
    description:
      "Permanently delete ONE deal — for duplicates and mistaken entries only. A deal that fell through should be marked status 'dead' with update_deal instead (dead keeps the history; delete erases it). This is a TWO-STEP tool: call it FIRST without confirm to get back the exact deal that would be deleted, read that back to the user, and only call it again with confirm=true once they say yes. It cannot be undone. Identify by customer name or deal number.",
    input_schema: {
      type: "object" as const,
      properties: {
        deal: { type: "string", description: "Customer name (partial ok) or deal number." },
        confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the exact deal shown in the preview. Omit/false to preview." },
      },
      required: ["deal"],
    },
  },
  {
    name: "update_deal",
    description:
      "Fix a deal's data: status, money, products sold, salesperson, bank, funding, customer reminder date, phone, note, no-qualify flag, product-only flag. Identify the deal by customer name or deal number. If the result says multiple or no matches, ask the user which deal they mean.",
    input_schema: {
      type: "object" as const,
      properties: {
        deal: { type: "string", description: "Customer name (partial ok) or deal number to find the deal." },
        changes: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["prospect", "appointment", "working", "pending", "finance", "delivered", "dead"] },
            amount: { type: "number", description: "Primary/front money channel." },
            secondary: { type: "number", description: "Secondary/back money channel." },
            reserve: { type: "number" },
            products_add: { type: "array", items: { type: "string" }, description: "Product names or ids to mark sold on this deal." },
            products_remove: { type: "array", items: { type: "string" } },
            salesperson: { type: "string" },
            salesperson2: { type: "string", description: "50/50 split partner; empty string clears." },
            bank: { type: "string" },
            funded: { type: "boolean" },
            no_qualify: { type: "boolean" },
            product_only: { type: "boolean", description: "Backend products sold with NO vehicle — counts toward PVR/PPU but not as a unit." },
            deal_number: { type: "string" },
            phone: { type: "string" },
            follow_up_date: { type: "string", description: "YYYY-MM-DD for the next customer reminder; empty string clears." },
            note: { type: "string" },
            customer: { type: "string", description: "Correct the customer's name." },
          },
        },
      },
      required: ["deal", "changes"],
    },
  },
  {
    name: "update_money",
    description:
      "Update the user's Money picture basics: current checking balance, payday (day of month the commission check lands), or monthly essentials (everyday must-spend outside named bills). Only send the fields being changed. Use when they tell you a new balance ('I've got $6,400 in checking now'), their payday, or what a normal month costs them.",
    input_schema: {
      type: "object" as const,
      properties: {
        checking_balance: { type: "number", description: "Current checking balance in dollars." },
        payday: { type: "integer", minimum: 1, maximum: 31, description: "Day of month the commission check lands (single-check reps)." },
        paydays: { type: "array", items: { type: "integer", minimum: 1, maximum: 31 }, description: "ALL days of month checks land, for reps paid more than once (semi-monthly, wash checks) — e.g. [1, 10, 15]. These recur EVERY month. Prefer this over payday when they mention multiple checks." },
        check_net: { type: "number", description: "The rep's typical NET check amount (take-home per check), when every check is about the same. Their real number always beats the forecast." },
        check_nets: { type: "array", items: { type: "number" }, description: "NET amount of EACH check, aligned one-to-one with `paydays` in the same order — e.g. paydays [1, 10, 15] with check_nets [3000, 800, 3000] means $800 lands on the 10th. Use when their checks differ; send paydays in the same call." },
        monthly_essentials: { type: "number", description: "Average monthly everyday spend outside named bills." },
        cushion: { type: "number", description: "The never-go-below floor: dollars that must ALWAYS remain available in checking after bills and savings (default 1000). Use when they say 'never let me go under $X'." },
        savings_balance: { type: "number", description: "Total across their savings/reserve accounts — its own bucket, shown separately; NOT added to checking and NOT spendable in safe-to-spend/daily budget. Use when they tell you what's in savings." },
      },
    },
  },
  {
    name: "sync_bank",
    description:
      "Platinum VIP: pull their LIVE bank balances and last 30 days of transactions right now (Plaid). Use when they ask you to sync/refresh their bank, ask if a deposit or charge landed, or when their balance is stale and they're VIP with a bank connected. If they're not VIP it returns that — mention the $9.99/mo upgrade on the Money tab, warmly, once.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "upsert_bill",
    description:
      "Add, correct, or remove ONE recurring bill in the user's Money picture. Match an existing bill by name (partial ok) to edit or remove it; a new name adds it. Use when they say 'add my $210 insurance bill', 'rent went up to $1,900', or 'I canceled Netflix'.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Bill name — matches an existing bill (partial ok) or names a new one." },
        match_amount: { type: "number", description: "When several bills share the name (two 'Rent' entries), the CURRENT amount of the one to target. Only for disambiguation — use `amount` for the new value." },
        match_day: { type: "integer", minimum: 1, maximum: 31, description: "When several bills share the name, the CURRENT day-of-month of the one to target. Only for disambiguation — use `day_of_month` for the new value." },
        amount: { type: "number", description: "Dollar amount per occurrence." },
        day_of_month: { type: "integer", minimum: 1, maximum: 31, description: "Day it typically lands." },
        cadence: { type: "string", enum: ["monthly", "weekly", "biweekly", "quarterly", "yearly"], description: "Defaults to monthly." },
        is_subscription: { type: "boolean" },
        is_debt: { type: "boolean", description: "True when it's a debt payment (truck note, credit card, loan) — it shows in the Money dashboard's DEBT panel instead of BILLS." },
        is_savings: { type: "boolean", description: "True when this is PAYING YOURSELF — a monthly savings transfer treated as a mandatory bill in every calculation (the pay-yourself-first rule)." },
        remove: { type: "boolean", description: "True to delete this bill instead of adding/editing." },
      },
      required: ["name"],
    },
  },
  {
    name: "update_goal",
    description:
      "Add, update, or remove ONE savings goal, or record money put toward it. Match an existing goal by name (partial ok). Use when they say 'I put $500 toward the trip', 'add a $10k emergency fund goal', or 'drop the boat goal'. add_to_saved ADDS to the current saved amount; saved REPLACES it.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Goal name — matches existing (partial ok) or names a new one." },
        target: { type: "number", description: "Target dollar amount (required when creating)." },
        saved: { type: "number", description: "REPLACE the saved-so-far amount with this." },
        add_to_saved: { type: "number", description: "ADD this much to the saved-so-far amount." },
        emoji: { type: "string", description: "One emoji for the goal (optional, e.g. ✈️ 🛡️ 🚗)." },
        remove: { type: "boolean", description: "True to delete this goal." },
      },
      required: ["name"],
    },
  },
  {
    name: "log_spend",
    description:
      "Log a real-world purchase against the user's monthly budget (the ACTUAL side of budget vs actual). Use whenever they mention spending money — 'spent 60 on gas', 'grabbed lunch, 18 bucks', 'dropped $200 at the mall' — even in passing. Defaults to today; pass a date only when they say it was another day.",
    input_schema: {
      type: "object" as const,
      properties: {
        amount: { type: "number", description: "Dollars spent." },
        category: { type: "string", description: "Budget category (Food, Gas, Fun, Shopping…). Match one of their existing budget categories when it fits; a new name creates an unplanned line." },
        note: { type: "string", description: "Optional short note ('lunch with Tony')." },
        date: { type: "string", description: "YYYY-MM-DD if not today." },
      },
      required: ["amount", "category"],
    },
  },
  {
    name: "remove_spend",
    description:
      "Take a logged purchase back OUT of the spend log — they returned it, it was a test entry, or it was logged wrong (to fix an amount: remove it, then log_spend the right one). Match by whatever they give you: amount, category, note words, date. If several match, the result lists them — ask which. Use when they say 'I returned that', 'take that back out', or 'those were test entries, delete them'.",
    input_schema: {
      type: "object" as const,
      properties: {
        amount: { type: "number", description: "Dollar amount of the entry to remove." },
        category: { type: "string", description: "Its category (partial ok)." },
        note_contains: { type: "string", description: "A word from its note ('golf', 'test')." },
        date: { type: "string", description: "YYYY-MM-DD it was logged for, if they say." },
        entry_id: { type: "string", description: "Exact entry id from a previous remove_spend result — use to disambiguate." },
      },
    },
  },
  {
    name: "set_budget",
    description:
      "Set, change, or remove ONE monthly budget category (the PLAN side of budget vs actual — variable spend like Food, Gas, Fun; bills are tracked separately and are NOT budget categories). Use when they say 'set my food budget to 350', 'budget 200 a month for fun', or 'drop the golf budget'.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: { type: "string", description: "Category name — matches an existing budget (case-insensitive) or creates it." },
        monthly: { type: "number", description: "Planned dollars per month for this category." },
        remove: { type: "boolean", description: "True to delete this budget category instead." },
      },
      required: ["category"],
    },
  },
  {
    name: "reclassify_spending",
    description:
      "Teach the app what a SYNCED bank merchant really is, so it's fixed for every past AND future charge (the app remembers). Use when they say a synced line is mislabeled — 'that Flexible Finance charge is my rent', 'Ford Credit is my car payment, not everyday', 'those transfers to myself aren't spending', 'file Costco under groceries'. kind: 'everyday' = real spending (optionally set category), 'bill' = a recurring bill, 'debt' = a loan/card payment, 'ignore' = not spending at all (a transfer between their own accounts), 'remove' = forget the rule and go back to automatic. Paying another PERSON still counts as everyday spending — only their own-account transfers are 'ignore'.",
    input_schema: {
      type: "object" as const,
      properties: {
        merchant: { type: "string", description: "The merchant name as it appears on the synced line (e.g. 'Flexible Finance', 'Ford Credit', 'Costco')." },
        kind: { type: "string", enum: ["everyday", "bill", "debt", "ignore", "remove"], description: "What this merchant's charges really are." },
        category: { type: "string", description: "For kind 'everyday' only: the bucket (Groceries, Gas, Dining, Shopping, Fun, Other)." },
      },
      required: ["merchant", "kind"],
    },
  },
  {
    name: "set_transaction_account",
    description:
      "Tell the app which account/bank a purchase came out of — answers 'that Costco charge was on my LGE checking', 'put Netflix on the BofA card', 'which account did my gas come from? the Bank of America one'. For a synced merchant the app remembers it for every past AND future charge from them; for a hand-logged purchase it sets just that one. Pass account as a plain description that matches one of their linked accounts (e.g. 'LGE checking', 'Bank of America card', '7334', 'BofA savings'). Set account to 'none' to clear it. Only works once they've added their accounts on the Money tab.",
    input_schema: {
      type: "object" as const,
      properties: {
        merchant: { type: "string", description: "The merchant/purchase name as it appears on the line (e.g. 'Costco', 'Netflix', 'Shell')." },
        account: { type: "string", description: "Which account it came from — match a linked account by bank, name, type, or last-4 (e.g. 'LGE checking', 'BofA card', '7334'). Use 'none' to clear the account." },
      },
      required: ["merchant", "account"],
    },
  },
  {
    name: "evaluate_purchase",
    description:
      "Run the real can-I-afford-this math on a purchase the user is considering — the ONLY correct way to answer 'can I afford to spend $500 today?' / 'should I buy X'. The verdict is judged against their never-go-below floor across every projected day ahead (clear / tight / wait-for-the-check / no), plus what's left after, deals-of-work cost, and the month's low point. Never estimate this by hand — run it, then deliver the verdict in your own voice, straight.",
    input_schema: {
      type: "object" as const,
      properties: {
        amount: { type: "number", description: "Purchase price in dollars." },
        label: { type: "string", description: "What they're buying (for your reply, e.g. 'the new golf clubs')." },
      },
      required: ["amount"],
    },
  },
  {
    name: "set_pay_goal",
    description:
      "Set the rep's MONTHLY pay-plan goals: a take-home DOLLAR goal (takeHome, $ after tax — 'set my goal to 20k' → 20000) and/or a vehicle/unit COUNT goal (units). Use when they say 'set my monthly goal to $20k take-home', 'I want to make 20 grand this month', or 'set my goal to 50 cars'. This is the paycheck/Climb goal on the Home page — NOT a savings goal (that's update_goal). takeHome of 0 clears the take-home goal.",
    input_schema: {
      type: "object" as const,
      properties: {
        takeHome: { type: "number", description: "Monthly take-home ($ after tax) target, e.g. 20000. Omit to leave unchanged; 0 clears it." },
        units: { type: "number", description: "Monthly vehicle/unit count goal, e.g. 50. Omit to leave unchanged." },
      },
    },
  },
  {
    name: "update_plan_config",
    description:
      "Correct the user's pay-plan SETTINGS — tax %, monthly draw, draw balance carried in, guarantee floor, commission percents, flat $ per unit/product, salary. Only send the fields being changed. Use when they tell you a plan fact ('my draw is $8k', 'I'm taxed at 24%', 'we get 25% of front'). This edits the same fields as Settings' plan editor — it does NOT touch the pay-math engine itself. If their whole plan changed, suggest re-uploading the plan document in Settings instead.",
    input_schema: {
      type: "object" as const,
      properties: {
        tax_rate: { type: "number", description: "Estimated tax % withheld (0–60). Drives take-home numbers." },
        draw: { type: "number", description: "Monthly draw/advance in dollars. 0 removes the draw." },
        draw_carried_in: { type: "number", description: "Draw balance carried IN from prior months (the existing hole). 0 clears." },
        guarantee: { type: "number", description: "Monthly guarantee floor in dollars. 0 clears." },
        front_pct: { type: "number", description: "Commission % on the primary/front channel." },
        back_pct: { type: "number", description: "Commission % on the secondary/back channel." },
        per_unit: { type: "number", description: "Flat $ per unit sold." },
        per_product: { type: "number", description: "Flat $ per add-on/product." },
        salary: { type: "number", description: "Monthly base salary in dollars." },
      },
    },
  },
  {
    name: "clear_sample_data",
    description:
      "Clear the seeded SAMPLE month (the demo deals shown so the dashboard isn't empty before real data). Use when the user says 'clear the sample data', 'get rid of the fake deals', or asks why customers they never met are on their board. Their profile, plan, and any real deals are untouched. Logging a first real deal also clears it automatically.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "forget_memory",
    description:
      "Delete ONE of your own memory notes about the user — when they say you've got something wrong about them ('that's not true, forget that', 'stop assuming I work Saturdays'). Match by words the note contains, or by the exact id a previous result gave you. If several match, the result lists them — ask which.",
    input_schema: {
      type: "object" as const,
      properties: {
        contains: { type: "string", description: "Words from the note to forget, or an exact note id." },
      },
      required: ["contains"],
    },
  },
  {
    name: "report_issue",
    description:
      "File a problem you cannot fix yourself (a number that looks mathematically wrong, something broken or confusing in the app) to Aaron's team. This forwards the report to the team's alert channel. Include exactly what the user saw, what they expected, and the relevant numbers. Report the result HONESTLY from the tool's response: if it confirms delivery, tell the user it's filed and in front of Aaron's team; if it says delivery is unconfirmed, tell them it's logged but to also flag it to Aaron directly. NEVER claim a message reached anyone that the tool did not confirm, and never invent details about how the routing works (you do not know the channel internals — just relay the tool result).",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "One-line description of the problem." },
        details: { type: "string", description: "What the user saw vs expected, with the specific numbers/screens involved." },
      },
      required: ["summary", "details"],
    },
  },
];

// System-prompt guidance injected alongside the tool definitions.
export const ILA_TOOLS_GUIDANCE = `
YOUR HANDS — you don't just talk, you fix:
- You have tools to LOG new deals, change the user's settings (days off, product menu, pay-plan config), set their monthly goals, correct their deals, and manage their Money picture (balance, bills, goals), right now, mid-conversation. When the fix is clear, DO it, then confirm in one sentence what changed and what number it moved. Don't ask permission for exactly what they just asked for.
- You can add everyday-life items to the EILA Day board with add_life_item: appointments, errands, reminders, family commitments, habits, calls, and tasks outside the dealership CRM. If the user says "don't let me forget", "put this on my day", "remind me", or names an appointment/task, add it. This is in-app only; never imply you contacted anyone or wrote to an external calendar.
- LOGGING DEALS: when they tell you about a deal that isn't on the board ("just closed the Hendersons — 2k front, 1,500 back, VSC and GAP"), log_deal it right then, then tell them what it pays and where the month stands. That's the core of the job — never make them open a form for something they just told you.
- PRODUCT-ONLY DEALS: if a "deal" is backend products / warranty with NO vehicle sold — a walk-in buying a VSC + appearance package, a product-only F&I sale, anything they describe as "no car / just products / product only" — you MUST set product_only:true on log_deal. It still counts its back gross toward PVR/PPU, but it is NOT a unit and must NOT count toward the vehicle goal or dilute front PVR. Do NOT infer product-only just because front gross is $0 — an F&I user logs plenty of REAL car deals with only back gross; only flag it when there is genuinely no vehicle.
- IMPORTING A MONTH: when they paste a block of spreadsheet rows or say "import my LOGG / my sheet / the month", use import_deals with the pasted text (header row included) — it lands every deal at once, front/F&I/products on the right deal. Don't hand-log dozens of rows one at a time. After it runs, tell them the count, total F&I gross, and where the pay picture stands.
- A deal that FELL THROUGH → update_deal status "dead" (keeps history). delete_deal is ONLY for duplicates/mistakes, is permanent, and ALWAYS needs the user's explicit confirmation first.
- PLAN FACTS ("my draw is 8k", "I'm taxed at 24%", "we're on 25% of front") → update_plan_config, then quote the recalculated number. If the whole plan changed, point them at Settings → upload the new plan document.
- Fake customers on the board = the seeded sample month → clear_sample_data (their real deals and plan are untouched).
- If they say you've got something WRONG about them ("forget that", "that's not true about me") → forget_memory. Getting corrected and updating instantly is how trust is built.
- MONTHLY GOALS: "set my goal to $20k take-home" / "I want to make 20 grand this month" / "make my goal 50 cars" → set_pay_goal (takeHome dollars and/or units). BOTH a take-home DOLLAR target and a vehicle-COUNT target can be set, and both drive The Climb + the pace tracker on the Home page. This is the pay goal, NOT a savings goal. Never file this as an issue — you can just do it.
- Your current hands can update in-app data only. You cannot send texts, send emails, contact customers, move money, spend money, cancel services, make public posts, delete external records, or commit the user to a meeting or contract. If the user asks for one of those, draft or prepare it and say plainly that they must approve/send it.
- High-risk life-companion actions require explicit confirmation even when future tools exist: sending messages, contacting customers, spending or moving money, canceling anything, changing financial records, sharing private information, deleting data, making public posts, or committing the user to a meeting, purchase, promise, contract, or deadline.
- If a deal reference is ambiguous, ask which one — never guess between two customers.
- "Can I afford X?" → run evaluate_purchase and deliver the verdict straight, in your voice: lead with yes/tight/no, the number that decides it, and what it costs in deals of work. If their Money picture isn't set up, the tool will say so — invite them to the Money tab instead of guessing.
- When they mention money moves in passing ("just paid off the truck", "put 500 toward the trip"), update the Money picture right then — that's what a companion does. Same for spending: "spent 60 on gas" → log_spend, then tell them what's left in that category and for the month. Budget questions ("how am I doing this month?") get answered from the BUDGET line in your snapshot — left to spend, days left, the category that's running hot.
- Wrong or fake spend entries ("I returned that", "those were tests") → remove_spend, then confirm what the budget reads now. Never try negative log_spend amounts — removal is the tool.
- "What can I spend today?" → the DAILY BUDGET line has it (today's daily spending allowance, the steady per-day, the one-shot ceiling, the floor). Give the number straight, then what protects it. If their balance is days old, get today's balance FIRST (update_money) — then the number is real. Paying yourself is a BILL (upsert_bill is_savings) and the floor is sacred: never coach spending that breaks either.
- What you must NOT do: invent or hand-alter commission math. The pay engine is tested code. If a calculation itself seems wrong (not a settings/data issue), use report_issue with the specifics — tell the user it's filed with Aaron's team and they'll have it fixed fast. Never leave a problem unlogged.
- After a fix, the app recalculates instantly — the numbers you quote after a tool result are already the updated ones.
- Tapped-number explains: all over the app, tapping a number opens you with "Explain my …". Walk the REAL math from your snapshot in plain words — short sentences, their numbers, no jargon. If they say a number is wrong, don't defend it: find which input is off (a deal's money, a payday, a bill, unlogged spend, days off) and fix it with your tools on the spot.`;
