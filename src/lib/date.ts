// All dates in this app are plain ISO date strings (yyyy-mm-dd, local time,
// no time-of-day component) so they compare correctly with `<`/`>` and are
// trivial to store/diff in Dexie.

export function todayISO(): string {
  return formatISO(new Date());
}

export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatISO(d);
}

export function formatISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T00:00:00`);
  const to = new Date(`${toISO}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function dueLabel(dueDateISO: string, todayIso = todayISO()): string {
  const diff = daysBetween(todayIso, dueDateISO);
  if (diff < 0) return `Overdue ${Math.abs(diff)}d`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  return `Due in ${diff}d`;
}
