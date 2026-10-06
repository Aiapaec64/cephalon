import { DateTime, IANAZone } from 'luxon';

export const DEFAULT_TIMEZONE = 'Europe/Brussels';
export const RECAP_PAGE_SIZE = 30;

export class GoalInputError extends Error {}

export function parseDate(value: string): DateTime {
  const date = DateTime.fromISO(value, { zone: 'UTC' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !date.isValid || date.year < 1 || date.toISODate() !== value) {
    throw new GoalInputError('La date doit être une date valide au format YYYY-MM-DD.');
  }
  return date;
}

export function isoDate(date: DateTime): string {
  const value = date.toISODate();
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new GoalInputError('La date de fin dépasse la plage de dates autorisée.');
  }
  return value;
}

export interface GoalInput {
  title: string;
  startDate: string;
  durationDays?: number | null;
  durationMonths?: number | null;
  reminderTime: string;
  timezone?: string | null;
}

export function validateGoal(input: GoalInput) {
  const title = input.title.trim().replace(/\s+/g, ' ');
  if (title.length < 1 || title.length > 200) throw new GoalInputError('Le titre doit contenir entre 1 et 200 caractères.');
  const start = parseDate(input.startDate);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.reminderTime)) {
    throw new GoalInputError('L’heure doit être au format HH:mm, de 00:00 à 23:59.');
  }
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  if (!IANAZone.isValidZone(timezone)) throw new GoalInputError('Utilise un fuseau IANA valide, par exemple Europe/Brussels.');
  const hasDays = input.durationDays != null;
  const hasMonths = input.durationMonths != null;
  if (hasDays === hasMonths) throw new GoalInputError('Choisis exactement une durée : duration_days OU duration_months.');
  const duration = hasDays ? input.durationDays! : input.durationMonths!;
  if (!Number.isInteger(duration) || duration < 1 || duration > (hasDays ? 3660 : 120)) {
    throw new GoalInputError('La durée doit être de 1 à 3660 jours, ou de 1 à 120 mois.');
  }
  // End dates are inclusive. Calendar months clamp to the last day of the month.
  const end = start.plus(hasDays ? { days: duration } : { months: duration }).minus({ days: 1 });
  return { title, startDate: isoDate(start), endDate: isoDate(end), reminderTime: input.reminderTime, timezone };
}

export function localClock(timezone: string, now = new Date()) {
  const local = DateTime.fromJSDate(now, { zone: timezone });
  if (!local.isValid) throw new GoalInputError('Fuseau horaire invalide.');
  return { date: isoDate(local), time: local.toFormat('HH:mm') };
}

export interface ScheduledGoal {
  active: boolean;
  startDate: string;
  endDate: string;
  reminderTime: string;
  timezone: string;
}

export function reminderDate(goal: ScheduledGoal, now = new Date()): string | null {
  const local = localClock(goal.timezone, now);
  return goal.active && local.date >= goal.startDate && local.date <= goal.endDate && local.time >= goal.reminderTime
    ? local.date : null;
}

export type CheckinStatus = 'pending' | 'yes' | 'no' | 'missed';
export type DeliveryState = 'queued' | 'sending' | 'sent' | 'uncertain' | 'skipped';

export function canAttemptDelivery(state: DeliveryState, retryAt: Date | null, now: Date): boolean {
  return state === 'queued' && (!retryAt || retryAt <= now);
}

export function dayStatus(date: string, today: string, recorded?: CheckinStatus): CheckinStatus | 'future' {
  if (recorded === 'yes' || recorded === 'no') return recorded;
  if (date < today) return 'missed';
  if (date > today) return 'future';
  return recorded === 'missed' ? 'missed' : 'pending';
}

export function dateRange(startDate: string, endDate: string): string[] {
  const end = parseDate(endDate);
  let cursor = parseDate(startDate);
  const dates: string[] = [];
  while (cursor <= end) {
    if (dates.length >= 3700) throw new GoalInputError('Objectif trop long.');
    dates.push(isoDate(cursor));
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

export function progressSummary(statuses: ReturnType<typeof dayStatus>[]) {
  const completed = statuses.filter((status) => status === 'yes').length;
  const declined = statuses.filter((status) => status === 'no').length;
  const unanswered = statuses.filter((status) => status === 'missed').length;
  const missed = declined + unanswered;
  const remaining = statuses.length - completed - missed;
  const denominator = completed + missed;
  return { completed, declined, unanswered, missed, remaining, successRate: denominator ? completed / denominator * 100 : 0 };
}

export function parseGoalId(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2147483647) throw new GoalInputError('ID d’objectif invalide.');
  return Number(value);
}
