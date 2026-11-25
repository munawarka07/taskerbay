// TaskerBay task templates: ready-made HR checklists plus the person's own saved ones.
// A template is a parent task and steps placed relative to one key date (pay date, joining date, last day, expiry).
// Offsets are in working days (Mon–Fri) when unit is "wd", otherwise calendar days.
import { addDays, dkey, parseKey, isWorkday, nextRepeat } from "./engine.js";

export const BUILT_IN = [
  {
    key: "payroll", icon: "💰", name: "Monthly payroll (WPS)", anchor: "Salary date", rule: "monthly:lastwd", unit: "wd", repeat: true,
    title: "Payroll {month}", priority: "High",
    blurb: "The full monthly cycle from inputs to payslips and journal, timed back from salary day.",
    steps: [
      [-8, "Collect attendance, leave and absence for the month"],
      [-8, "Collect joiners, leavers and salary changes"],
      [-7, "Collect overtime, allowances and one-off payments"],
      [-6, "Update loans, advances and deductions"],
      [-5, "Run payroll and check variance against last month"],
      [-4, "Prepare payroll summary and reconciliation"],
      [-3, "Get payroll approval", "approval"],
      [-2, "Prepare WPS salary file (SIF)"],
      [-1, "Upload WPS file to the bank and confirm"],
      [0, "Confirm salaries are credited"],
      [0, "Send payslips"],
      [1, "Post payroll journal and accruals (gratuity, leave)"],
      [2, "File payroll reports and close the month"]
    ]
  },
  {
    key: "onboard", icon: "👋", name: "New joiner onboarding", anchor: "Joining date", unit: "wd",
    title: "Onboarding: {name}", priority: "High",
    blurb: "From signed offer to first-month check-in, timed around the joining date.",
    steps: [
      [-10, "Collect signed offer letter and documents (passport, photos, certificates)"],
      [-8, "Prepare MOHRE offer and contract"],
      [-7, "Apply for entry permit / work permit"],
      [-4, "Create email, system and building access"],
      [-2, "Prepare workstation, laptop and ID card"],
      [0, "Welcome and induction"],
      [0, "Add to payroll, WPS and HR system"],
      [1, "Enrol in medical insurance"],
      [3, "Book medical fitness test and Emirates ID biometrics"],
      [5, "Help open a salary bank account"],
      [10, "Stamp residence visa"],
      [22, "First-month check-in"],
      [60, "Probation review reminder"]
    ]
  },
  {
    key: "exit", icon: "🚪", name: "Employee exit & final settlement", anchor: "Last working day", unit: "wd",
    title: "Exit: {name}", priority: "High",
    blurb: "Resignation to final settlement, clearance and visa cancellation.",
    steps: [
      [-15, "Send resignation / termination acceptance letter"],
      [-10, "Agree handover plan with the manager"],
      [-6, "Calculate final settlement (gratuity, leave, notice, deductions)"],
      [-4, "Get final settlement approval", "approval"],
      [-2, "Clearance from IT, admin and finance"],
      [0, "Exit interview"],
      [0, "Collect laptop, ID card and access; switch off accounts"],
      [1, "Cancel work permit and residence visa"],
      [3, "Pay final settlement through WPS"],
      [4, "Cancel medical insurance"],
      [5, "Issue experience / service certificate"],
      [5, "Remove from payroll and archive the file"]
    ]
  },
  {
    key: "visa", icon: "🛂", name: "Visa & Emirates ID renewal", anchor: "Expiry date", unit: "d",
    title: "Visa renewal: {name}", priority: "Medium",
    blurb: "Starts 30 days before expiry so nothing runs late.",
    steps: [
      [-30, "Tell the employee and collect passport, photo and current visa"],
      [-26, "Renew labour contract / work permit"],
      [-22, "Book medical fitness test"],
      [-18, "Submit residence visa renewal"],
      [-14, "Emirates ID biometrics"],
      [-10, "Renew medical insurance if needed"],
      [-5, "Update HR records and expiry dates"]
    ]
  },
  {
    key: "monthend", icon: "📊", name: "HR month-end close", anchor: "Month end", rule: "monthly:last", unit: "wd", repeat: true,
    title: "HR month-end {month}", priority: "Medium",
    blurb: "Leave balances, accruals and the monthly HR report.",
    steps: [
      [-3, "Update leave balances"],
      [-2, "Calculate gratuity and leave accruals"],
      [-1, "Prepare headcount and movement report"],
      [0, "Send HR MIS report"],
      [1, "Share accruals with finance"]
    ]
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
