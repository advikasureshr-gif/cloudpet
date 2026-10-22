// How good is the check-in prediction?  Run:  npm run ml:report
// For each pretend person, the last 7 days are hidden, the model learns from the 3 weeks before, and we check whether
// its most likely half hour lands within 30 minutes of a real visit. The "average time" column is the simple baseline.
process.env.DYNAMO_ENDPOINT ??= "http://localhost:8000";
const { evaluate } = await import("../src/services/prediction.js");
const { makeHistory } = await import("../src/services/synthetic.js");

const now = new Date(Date.UTC(2026, 9, 23, 15, 30));
const people = [
  ["Same time every evening",                 { weekdayMin: 1200, weekendMin: 1200 }],
  ["Evenings on weekdays, mornings at weekends", { weekdayMin: 1200, weekendMin: 600 }],
  ["Lunchtime on weekdays, late nights at weekends", { weekdayMin: 750, weekendMin: 1380 }],
  ["Night owl (just after midnight)",        { weekdayMin: 20, weekendMin: 20 }],
  ["Irregular (visits can be 1 hour off)",    { weekdayMin: 1140, weekendMin: 660, jitterMin: 60 }]
];

console.log("Person".padEnd(52), "Days".padStart(5), "Forest".padStart(8), "Average".padStart(9));
for (const [label, opts] of people) {
  const times = makeHistory({ now, offsetMin: 330, days: 28, ...opts });
  const s = evaluate(times, now, 330, 7);
  console.log(label.padEnd(52), String(s.days).padStart(5), (Math.round(s.forest * 100) + "%").padStart(8), (Math.round(s.average * 100) + "%").padStart(9));
}
