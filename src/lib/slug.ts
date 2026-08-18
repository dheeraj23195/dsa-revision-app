// Question id generation — must stay byte-identical to scripts/generate-seed.mjs's
// `slugify`/id logic, since CSV import (§7) matches existing questions by this
// same id. That script is a plain Node CLI tool (no TS transpile step), so
// the two copies can't share one module directly; slug.test.ts is the
// concrete guard against them drifting apart — it recomputes every one of
// the ~455 real seed questions' ids from their own title+step and asserts
// they match exactly, rather than this comment just asserting it.

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function questionId(step: number, title: string): string {
  return `step${step}-${slugify(title)}`;
}
