import { GoalInputError, parseDate, parseGoalId } from '../services/goalLogic.js';

export type GoalComponent =
  | { action: 'yes' | 'no'; id: number; date: string }
  | { action: 'recap'; id: number; page: number }
  | { action: 'list'; page: number };

function pageNumber(value: string): number {
  if (!/^\d{1,5}$/.test(value)) throw new GoalInputError('Page invalide.');
  return Number(value);
}

export function parseGoalComponent(value: string): GoalComponent | null {
  if (!value.startsWith('goal:')) return null;
  const parts = value.split(':');
  const action = parts[1];
  if ((action === 'yes' || action === 'no') && parts.length === 4) {
    const date = parts[3]!;
    parseDate(date);
    return { action, id: parseGoalId(parts[2]!), date };
  }
  if (action === 'recap' && (parts.length === 3 || parts.length === 4)) {
    return { action, id: parseGoalId(parts[2]!), page: pageNumber(parts[3] ?? '0') };
  }
  if (action === 'list' && parts.length === 3) return { action, page: pageNumber(parts[2]!) };
  throw new GoalInputError('Bouton d’objectif invalide.');
}
