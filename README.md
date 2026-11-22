# TaskerBay

Your personal and team planner: daily routine, planner, tasks with steps inside steps, workflows, status updates, automations, focus timer and money, in one installable app.

- **Works on every device.** Sign in on your phone, tablet and computer, and everything syncs live.
- **Installs like an app.** On iPhone use Safari → Share → *Add to Home Screen*. On Android use Chrome → *Install app*. It opens full-screen and works offline.
- **Private by default.** Shared workspaces hold tasks, workflows and updates. Money, routine, journal and focus history are only ever visible to you.

---

## What's inside

| Area | What it does |
|---|---|
| **Today** | Progress ring, focus list, today's routine, productivity score, mood and win of the day, team pulse, AI day planner |
| **Planner** | Week strip, a timeline that mixes timed tasks with routine items and shows a "now" line, a list of unscheduled tasks, and a 7-day drag-and-drop board on a computer |
| **Tasks** | List or Kanban board per workflow, quick add with shortcuts (`tomorrow 3pm #work !high @sara * every week`), swipe to finish or delete |
| **Task detail** | Stages, steps nested any number of levels deep with progress roll-up, owner, dates, repeat, estimate, notes, status updates and an activity log |
| **Workflows** | Your own stage pipelines. *Simple*, *Approval* and *Payroll cycle* are included |
| **Automations** | "When … then …" rules, e.g. *when all steps are done → move to next stage*, *when moved to In review → notify everyone*, *when overdue → High priority* |
| **Team & updates** | Workspaces, invites by email, roles, workload per person, an updates feed and an inbox of notifications |
| **Routine** | Daily habits with times and weekdays, streaks and a 30-day heatmap |
| **Money** | Expenses and income, budgets with alerts, month-end forecast, category donut, 6-month trend, CSV export |
| **Focus** | 25/5 timer linked to a task, with focus minutes tracked |
| **AI (Claude)** | Plan my day, break a task into steps, turn a messy note into tasks and expenses, explain my month |

Built-in rules that are always on:
- Every stage change is logged on the task.
- Finishing a repeating task creates the next one, with its steps reset.
- When you assign a task, the assignee gets a notification.
- Completing a task completes its open steps.

---

## Try it now (demo mode)

With no keys in `js/config.js`, TaskerBay runs in **demo mode** with sample data saved in your browser.

```bash
cd taskerbay
python3 -m http.server 8080
# open http://localhost:8080
```

---

## Go live at app.taskerbay.com

Allow about 30–45 minutes. Everything below is free to start.

### 1. Create the database (Supabase)
1. Sign up at **supabase.com** and click **New project**. Pick the region closest to the UAE, and save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**. It should finish with "Success".
3. Go to **Authentication → URL Configuration**:
   - **Site URL:** `https://app.taskerbay.com`
   - **Redirect URLs:** add `https://app.taskerbay.com/**` and `http://localhost:8080/**`
4. Optional: in **Authentication → Emails** you can customise the sign-up email. Supabase's built-in email has low limits, so for a team, add your own email sender (SMTP) under **Project Settings → Authentication**.

### 2. Connect the app
Open **Project Settings → API** and copy the **Project URL** and the **anon public** key into `js/config.js`:

```js
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

The anon key is meant to be public. Your data is protected by the row-level security rules in `schema.sql`.

### 3. Put it online (Vercel or Netlify)
**Vercel**
1. Sign up at **vercel.com**.
2. Either upload the `taskerbay` folder with *Add New → Project → Deploy from your computer*, or push it to GitHub and import the repository.
3. Framework preset: **Other**. Leave the build command empty and set the output directory to `.`.
4. Deploy, and you get a link like `taskerbay.vercel.app`.

> Vercel's free *Hobby* plan is for personal, non-commercial use. If TaskerBay becomes a business tool, use **Netlify** or **Cloudflare Pages** (both have free tiers and the same steps), or upgrade to Vercel Pro.

### 4. Connect your domain (Squarespace)
1. In Vercel go to **Project → Settings → Domains** and add `app.taskerbay.com`. Vercel shows you a **CNAME** record, usually `cname.vercel-dns.com`.
2. In Squarespace go to **Domains → taskerbay.com → DNS settings** and add a custom record:
   - Type **CNAME**, Host **app**, Data **cname.vercel-dns.com** (or whatever Vercel shows).
3. Wait 5–60 minutes. Vercel sets up HTTPS automatically.
4. Your main `taskerbay.com` site stays on Squarespace. To link to the app, add a button there called "Open TaskerBay" pointing to `https://app.taskerbay.com`.

### 5. Turn on AI (optional)
1. Get an API key at **console.anthropic.com**. Usage is billed by Anthropic and is typically a few fils per request.
2. Install the Supabase CLI (`npm i -g supabase`), then from the `taskerbay` folder run:
   ```bash
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy ai
   ```
3. Reload the app. The ✨ buttons appear when you're signed in.

To change the AI models, set the `AI_MODEL_SMART` and `AI_MODEL_FAST` secrets.

### 6. Google sign-in (optional)
1. In Supabase go to **Authentication → Providers → Google**, turn it on, and follow its guide to create Google OAuth keys.
2. Set `ENABLE_GOOGLE = true` in `js/config.js`.

### 7. Invite your family or team
1. Open **Team & updates → Invite** and enter their email.
2. They sign up at `app.taskerbay.com` with that email and join your workspace automatically.
3. Create separate workspaces (e.g. *Family*, *HR Team*) from the workspace switcher at the top.

---

## Overdue automations
"Overdue" rules run when anyone opens the app, and then every hour while it's open. If you want them to run even when nobody has the app open, ask for a scheduled job (Supabase `pg_cron`). It's a small addition.

## Project layout
```
index.html               app shell
css/app.css              design system & animations
js/config.js             your keys & switches
js/store.js              data layer (Supabase + demo), live sync, optimistic saves
js/engine.js             workflows, steps roll-up, repeats, notifications, automations
js/app.js                all screens and interactions
sw.js, manifest…         installable app + offline
icons/                   app icons
supabase/schema.sql      tables, security rules, defaults
supabase/functions/ai    Claude AI endpoint
```

## Updating later
Edit the files and redeploy (with GitHub this happens on every push). Phones pick up the new version the next time the app opens. If you ever change `sw.js`, bump the `VERSION` value at its top.
