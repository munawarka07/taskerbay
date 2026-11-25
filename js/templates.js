// TaskerBay task templates: ready-made checklists for work, personal life and people admin, plus the person's own saved ones.
// A template is a parent task and steps placed relative to one key date (pay date, joining date, last day, expiry).
// Offsets are in working days (Mon–Fri) when unit is "wd", otherwise calendar days.
import { addDays, dkey, parseKey, isWorkday, nextRepeat } from "./engine.js";

export const CATS = ["Work", "Personal", "HR & people"];
export const BUILT_IN = [
  // ---------- Work ----------
  {
    key: "project", cat: "Work", icon: "🚀", name: "Project kickoff to launch", anchor: "Launch date", unit: "wd",
    title: "Project: {name}", nameLabel: "Project name", priority: "High",
    blurb: "Scope, owners, milestones, review and launch, timed back from the launch date.",
    steps: [
      [-20, "Write the goal, scope and success measure"], [-19, "List stakeholders and who decides"], [-18, "Kickoff meeting"],
      [-17, "Break the work into milestones with owners"], [-10, "Mid-point check: on track?"], [-5, "Review with stakeholders"],
      [-2, "Final checks and go / no-go"], [0, "Launch"], [3, "Follow-up: what's working, what's not"], [5, "Retrospective and lessons learned"]
    ]
  },
  {
    key: "monthly-report", cat: "Work", icon: "📊", name: "Monthly report", anchor: "Report due", rule: "monthly:lastwd", unit: "wd", repeat: true,
    title: "Monthly report {month}", priority: "Medium",
    blurb: "Collect, draft, review and send, every month.",
    steps: [[-4, "Collect the numbers and updates"], [-3, "Draft the report"], [-2, "Review and fix"], [-1, "Get sign-off"], [0, "Send the report"], [1, "File it and note next month's actions"]]
  },
  {
    key: "client", cat: "Work", icon: "🤝", name: "New client / customer", anchor: "Start date", unit: "wd",
    title: "Client: {name}", nameLabel: "Client name", priority: "High",
    blurb: "From signed agreement to the first check-in.",
    steps: [[-5, "Send agreement / proposal for signature"], [-3, "Collect details and contacts"], [-2, "Set up accounts, folders and access"], [-1, "Share the plan and timeline"], [0, "Kickoff call"], [5, "First delivery"], [10, "Check-in: are they happy?"], [20, "Send invoice / review billing"]]
  },
  {
    key: "event", cat: "Work", icon: "🎉", name: "Event or meeting", anchor: "Event date", unit: "d",
    title: "Event: {name}", nameLabel: "Event name", priority: "Medium",
    blurb: "Budget, venue, invites and follow-up for any event.",
    steps: [[-30, "Set date, budget and guest list"], [-25, "Book the venue"], [-21, "Send invitations"], [-14, "Arrange food, equipment and decor"], [-7, "Confirm numbers and send reminders"], [-2, "Final run-through"], [0, "Event day"], [2, "Send thank-yous and photos"], [3, "Settle payments"]]
  },
  {
    key: "weekly-review", cat: "Work", icon: "🗓️", name: "Weekly review", anchor: "Review day", rule: "weekly:5", unit: "d", repeat: true,
    title: "Weekly review", priority: "Medium",
    blurb: "Fifteen minutes every Friday to close the week and plan the next.",
    steps: [[0, "Tick off what got done"], [0, "Move or drop anything stuck"], [0, "Clear the inbox"], [0, "Pick next week's top 3"]]
  },
  // ---------- Personal ----------
  {
    key: "trip", cat: "Personal", icon: "✈️", name: "Trip / travel", anchor: "Travel date", unit: "d",
    title: "Trip: {name}", nameLabel: "Destination", priority: "Medium",
    blurb: "Bookings, documents and packing, so nothing is forgotten.",
    steps: [[-45, "Book flights"], [-40, "Book hotel / stay"], [-30, "Check passport and visa"], [-21, "Get travel insurance"], [-7, "Plan airport transfer"], [-3, "Make the packing list"], [-1, "Online check-in and pack"], [0, "Travel day"]]
  },
  {
    key: "move", cat: "Personal", icon: "🏠", name: "Moving home", anchor: "Moving day", unit: "d",
    title: "Move to {name}", nameLabel: "New address / area", priority: "High",
    blurb: "Movers, utilities and address changes.",
    steps: [[-30, "Get mover quotes and book"], [-21, "Give notice / sign the new lease"], [-14, "Book utilities and internet at the new place"], [-10, "Start packing room by room"], [-3, "Confirm movers"], [0, "Moving day"], [3, "Update address with bank, work and services"], [7, "Unpack the last boxes"]]
  },
  {
    key: "bills", cat: "Personal", icon: "💳", name: "Monthly bills & budget", anchor: "Payday", rule: "monthly:25", unit: "d", repeat: true,
    title: "Bills & budget {month}", priority: "Medium",
    blurb: "Pay everything on time and check the month's spending.",
    steps: [[0, "Move savings"], [1, "Pay rent / mortgage"], [2, "Pay utilities and phone"], [3, "Pay credit card"], [5, "Review last month's spending"]]
  },
  {
    key: "car", cat: "Personal", icon: "🚗", name: "Car renewal & service", anchor: "Renewal date", unit: "d",
    title: "Car renewal", priority: "Medium",
    blurb: "Service, insurance and registration before the deadline.",
    steps: [[-21, "Book the service"], [-14, "Renew insurance"], [-10, "Get the vehicle test done"], [-7, "Renew registration"], [0, "Registration expires"]]
  },
  // ---------- HR & people ----------
  {
    key: "onboard", cat: "HR & people", icon: "👋", name: "New team member", anchor: "Joining date", unit: "wd",
    title: "Onboarding: {name}", nameLabel: "Person's name", priority: "High",
    blurb: "Paperwork, accounts, equipment and first-month check-ins.",
    steps: [
      [-10, "Collect signed offer and documents"], [-7, "Prepare contract and any permits"], [-4, "Create email, system and building access"],
      [-2, "Prepare workstation and equipment"], [0, "Welcome and induction"], [0, "Add to payroll and HR system"],
      [1, "Enrol in benefits / insurance"], [22, "First-month check-in"], [60, "Probation review reminder"]
    ]
  },
  {
    key: "exit", cat: "HR & people", icon: "🚪", name: "Team member leaving", anchor: "Last working day", unit: "wd",
    title: "Exit: {name}", nameLabel: "Person's name", priority: "High",
    blurb: "Handover, final pay, clearance and paperwork.",
    steps: [
      [-15, "Confirm resignation / termination in writing"], [-10, "Agree handover plan"], [-6, "Calculate final pay and dues"],
      [-4, "Get final pay approved", "approval"], [-2, "Clearance from IT, admin and finance"], [0, "Exit interview"],
      [0, "Collect equipment; switch off access"], [3, "Pay final settlement"], [5, "Issue experience letter and close the file"]
    ]
  },
  {
    key: "payroll", cat: "HR & people", icon: "💰", name: "Monthly payroll", anchor: "Salary date", rule: "monthly:lastwd", unit: "wd", repeat: true,
    title: "Payroll {month}", priority: "High",
    blurb: "Inputs to payslips, timed back from salary day.",
    steps: [
      [-8, "Collect attendance, leave and changes"], [-7, "Collect overtime, allowances and deductions"], [-5, "Run payroll and check against last month"],
      [-3, "Get payroll approval", "approval"], [-2, "Prepare bank / salary file"], [-1, "Upload salary file and confirm"],
      [0, "Confirm salaries are paid"], [0, "Send payslips"], [1, "Post payroll journal"]
    ]
  },
  {
    key: "visa", cat: "HR & people", icon: "🛂", name: "Visa / permit renewal", anchor: "Expiry date", unit: "d",
    title: "Renewal: {name}", nameLabel: "Person's name", priority: "Medium",
    blurb: "Starts 30 days before expiry so nothing runs late.",
    steps: [[-30, "Tell the person and collect documents"], [-25, "Renew contract / work permit"], [-20, "Book medical test if needed"], [-15, "Submit the renewal"], [-10, "Biometrics / ID appointment"], [-5, "Update records and expiry dates"]]
  }
];

// move a date by n working days (or calendar days)
export function shiftDate(d, n, unit) {
  if (unit !== "wd") return addDays(d, n);
  let x = new Date(d), left = Math.abs(n), dir = n < 0 ? -1 : 1;
  if (n === 0) { while (!isWorkday(x)) x = addDays(x, -1); return x; }
  while (left > 0) { x = addDays(x, dir); if (isWorkday(x)) left--; }
  return x;
}
export function defaultAnchor(tpl) {
  if (tpl.rule) return dkey(nextRepeat(tpl.rule, new Date(), true));
  // far enough ahead that the first step is today, not already late
  const first = Math.min(0, ...tpl.steps.map(s => s[0]));
  return dkey(shiftDate(new Date(), -first, tpl.unit));
}
export function fillTitle(tpl, anchorKey, name) {
  const d = parseKey(anchorKey);
  const month = d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  return tpl.title.replace("{month}", month).replace("{name}", name || "").replace(/[:\s]+$/, "").trim();
}
// the plan: [{ title, due, approval }]
export function planSteps(tpl, anchorKey) {
  const a = parseKey(anchorKey);
  return tpl.steps.map(([off, title, kind]) => ({ title, offset: off, due: dkey(shiftDate(a, off, tpl.unit)), approval: kind === "approval" }));
}
// turn a task with steps into a saved template (offsets in calendar days from the task's due date)
export function fromTask(t, kids) {
  const base = t.due_date ? parseKey(t.due_date) : null;
  return {
    name: t.title, icon: "📋", anchor: "Due date", unit: "d", title: t.title, priority: t.priority,
    steps: kids.map(k => [base && k.due_date ? Math.round((parseKey(k.due_date) - base) / 864e5) : 0, k.title])
  };
}
