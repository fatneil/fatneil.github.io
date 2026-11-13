// Zones, dates and the maintenance math. No truck data lives in this repo.

export const ZONES = [
  { id: 'engine', name: 'Engine', blurb: 'Block, valves, ignition, belts, oil' },
  { id: 'cooling', name: 'Cooling', blurb: 'Radiator, thermostat, hoses, fan clutch, water pump' },
  { id: 'fuel', name: 'Fuel & emissions', blurb: 'Tank, filter, lines, O2 sensors, smog' },
  { id: 'exhaust', name: 'Exhaust', blurb: 'Manifold, catalytic converter, muffler, pipe' },
  { id: 'transmission', name: 'Transmission', blurb: 'A440F automatic, cooler, kickdown cable' },
  { id: 'transfer', name: 'Transfer case & 4WD', blurb: 'Transfer case, vacuum solenoids, switches' },
  { id: 'driveshafts', name: 'Driveshafts', blurb: 'U-joints, slip yokes' },
  { id: 'frontaxle', name: 'Front axle', blurb: 'Knuckles, birfields, front diff, hubs, wheel bearings' },
  { id: 'rearaxle', name: 'Rear axle', blurb: 'Rear diff, pinion seal, axle seals' },
  { id: 'brakes', name: 'Brakes', blurb: 'Pads, rotors, drums, wheel cylinders, hoses, fluid' },
  { id: 'tires', name: 'Wheels & tires', blurb: 'Tires, spare, rotation, lug nuts' },
  { id: 'steering', name: 'Steering', blurb: 'Steering box, tie rods, drag link, power steering' },
  { id: 'suspension', name: 'Suspension', blurb: 'Leaf springs, shocks, bushings, U-bolts' },
  { id: 'electrical', name: 'Electrical', blurb: 'Battery, fusible links, starter, lights' },
  { id: 'body', name: 'Body', blurb: 'Roof gutters, rust spots, drains, bumpers' },
  { id: 'interior', name: 'Interior', blurb: 'Seats, seat belts, A/C, heater, recalls' },
];
export const ZONE = Object.fromEntries(ZONES.map(z => [z.id, z]));

// Level: 3 critical, 2 overdue/no record, 1 due soon, 0 ok
export const LEVEL_NAMES = ['OK', 'Due soon', 'Overdue', 'Critical'];
export const STATUS_LABEL = { critical: 'Critical', overdue: 'Overdue', norecord: 'No record', soon: 'Due soon', ok: 'OK', done: 'Done' };
export const STATUS_LEVEL = { critical: 3, overdue: 2, norecord: 2, soon: 1, ok: 0, done: 0 };

const DAY = 86400000;
export function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function isoDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
export function addMonths(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(d.getDate(), last));
  return r;
}
export function fmtDate(s) {
  const d = typeof s === 'string' ? parseDate(s) : s;
  if (!d) return '—';
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}
export const fmtMiles = n => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
export const fmtMoney = n => (n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const fmtMoney0 = n => '$' + Math.round(n).toLocaleString('en-US');

export function latestReading(state) {
  let best = null;
  for (const r of state.odometer || []) {
    if (r.miles == null) continue;
    if (!best || r.date > best.date || (r.date === best.date && r.miles > best.miles)) best = r;
  }
  for (const e of state.log || []) {
    if (e.miles == null || e.approx) continue;
    if (!best || e.date > best.date) best = { date: e.date, miles: e.miles };
  }
  return best;
}

export function estimateMiles(state, at = today()) {
  const r = latestReading(state);
  if (!r) return null;
  const mpy = state.settings?.milesPerYear ?? 3000;
  const days = Math.max(0, (at - parseDate(r.date)) / DAY);
  return r.miles + mpy * days / 365.25;
}

function dateWhenMiles(state, miles) {
  const r = latestReading(state);
  if (!r) return null;
  const mpy = state.settings?.milesPerYear ?? 3000;
  if (mpy <= 0) return null;
  return new Date(parseDate(r.date).getTime() + (miles - r.miles) / mpy * 365.25 * DAY);
}

export function lastDone(state, taskId) {
  let best = null;
  for (const e of state.log) {
    if (!e.tasks?.includes(taskId)) continue;
    if (!best || e.date > best.date) best = e;
  }
  return best;
}

export function evalTask(state, task, est, now = today()) {
  const last = lastDone(state, task.id);
  const soonDays = state.settings?.soonDays ?? 60;
  const out = { ...task, last, nextMiles: null, dueDate: null, status: 'ok', milesOver: 0, daysOver: 0 };
  if (task.once) {
    out.status = last ? 'done' : (task.critical ? 'critical' : 'norecord');
    return finish(out);
  }
  if (!last) {
    out.status = task.critical ? 'critical' : 'norecord';
    return finish(out);
  }
  const lastDate = parseDate(last.date);
  const candidates = [];
  if (task.everyMonths) candidates.push(addMonths(lastDate, task.everyMonths));
  if (task.everyMiles && last.miles != null) {
    out.nextMiles = last.miles + task.everyMiles;
    const reading = latestReading(state);
    if (est != null && est >= out.nextMiles) out.milesOver = est - out.nextMiles;
    else if (reading && out.nextMiles > reading.miles) {
      // Project the calendar date the odometer should reach the next-due mileage.
      const d = dateWhenMiles(state, out.nextMiles);
      if (d) candidates.push(d);
    }
  }
  if (!candidates.length && !out.milesOver) { out.status = 'norecord'; return finish(out); }
  out.dueDate = candidates.length ? new Date(Math.min(...candidates.map(d => d.getTime()))) : null;
  const days = out.dueDate ? (out.dueDate - now) / DAY : -1;
  if (days < 0 || out.milesOver > 0) {
    out.status = task.critical ? 'critical' : 'overdue';
    out.daysOver = Math.max(0, -days);
  } else if (days <= soonDays) out.status = 'soon';
  else out.status = 'ok';
  return finish(out);
}
function finish(t) { t.level = STATUS_LEVEL[t.status]; return t; }

export function compute(state) {
  const now = today();
  const est = estimateMiles(state, now);
  const tasks = state.tasks.map(t => evalTask(state, t, est, now));
  const zoneLevel = Object.fromEntries(ZONES.map(z => [z.id, 0]));
  const zoneCounts = Object.fromEntries(ZONES.map(z => [z.id, { critical: 0, overdue: 0, soon: 0 }]));
  for (const t of tasks) {
    if (!(t.zone in zoneLevel)) continue;
    zoneLevel[t.zone] = Math.max(zoneLevel[t.zone], t.level);
    if (t.level === 3) zoneCounts[t.zone].critical++;
    else if (t.level === 2) zoneCounts[t.zone].overdue++;
    else if (t.level === 1) zoneCounts[t.zone].soon++;
  }
  const order = { critical: 0, overdue: 1, norecord: 2, soon: 3, ok: 4, done: 5 };
  tasks.sort((a, b) => order[a.status] - order[b.status]
    || (a.dueDate && b.dueDate ? a.dueDate - b.dueDate : (a.dueDate ? 1 : b.dueDate ? -1 : 0))
    || a.name.localeCompare(b.name));
  const counts = { critical: 0, overdue: 0, norecord: 0, soon: 0, ok: 0, done: 0 };
  for (const t of tasks) counts[t.status]++;
  const spend = state.log.reduce((s, e) => s + (Number(e.cost) || 0), 0);
  return { now, est, reading: latestReading(state), tasks, zoneLevel, zoneCounts, counts, spend };
}

export function dueText(t, est) {
  if (t.status === 'done') return t.last ? `Done ${fmtDate(t.last.date)}` : 'Done';
  if (!t.last) return t.once ? 'Not on record — do once' : 'No record — treat as due now';
  const parts = [];
  if (t.nextMiles != null) parts.push(`${fmtMiles(t.nextMiles)} mi`);
  if (t.dueDate) parts.push(fmtDate(t.dueDate));
  let s = 'Due ' + parts.join(' or ');
  if (t.milesOver > 0) s += ` · ${fmtMiles(t.milesOver)} mi over`;
  else if (t.daysOver > 0) s += ` · ${Math.round(t.daysOver / 30.4)} mo over`;
  return s;
}

export function intervalText(t) {
  if (t.once) return 'One time';
  const p = [];
  if (t.everyMiles) p.push(`${fmtMiles(t.everyMiles)} mi`);
  if (t.everyMonths) p.push(t.everyMonths === 1 ? 'monthly' : `${t.everyMonths} mo`);
  return 'Every ' + p.join(' / ');
}

export function uid(prefix = 'x') {
  const r = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  return prefix + '-' + r.replace(/-/g, '').slice(0, 12);
}

export function emptyState() {
  return {
    app: 'fj62-garage', schema: 1,
    meta: { created: new Date().toISOString() },
    settings: { milesPerYear: 3000, soonDays: 60, soonMiles: 500 },
    vehicle: { nickname: 'My truck', year: '', make: '', model: '' },
    odometer: [], tasks: [], log: [], watch: [], checks: [], mods: [], specs: [], parts: [], gaps: [],
  };
}

export function validate(data) {
  if (!data || typeof data !== 'object') return 'Not a data file.';
  if (data.app !== 'fj62-garage') return 'This file is not an FJ62 Garage data file.';
  for (const k of ['tasks', 'log']) if (!Array.isArray(data[k])) return `Missing "${k}" list.`;
  return null;
}
