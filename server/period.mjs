import { check } from './security.mjs';

export function todayInZone(timeZone, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const dayCount = (start, end) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
const endOfMonth = (start) =>
  new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);

export function validatePeriod(config, type, start, end, termId, today) {
  check(start >= today, 400, '开始日期不能早于今天');
  check(end >= start, 400, '结束日期不能早于开始日期');
  if (type === 'flexible')
    check(
      dayCount(start, end) <= config.seatTypes.flexible.maxDays,
      400,
      `流动工位最多使用 ${config.seatTypes.flexible.maxDays} 天`,
    );
  if (type === 'rotating')
    check(end <= endOfMonth(start), 400, '轮流工位不能超过开始日期所在月份的月底');
  if (type === 'fixed') {
    const term = config.terms.find((t) => t.id === termId);
    check(
      term && start >= term.start && end === term.end,
      400,
      '固定工位须在所选学期内申请，结束日期为学期末',
    );
  }
  return { start, end, termId: type === 'fixed' ? termId : null };
}
