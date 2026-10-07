import { GoalInputError, parseDate, parseGoalId } from '../services/goalLogic.js';

export type GoalComponent =
  | { action: 'yes' | 'no'; id: number; date: string }
  | { action: 'recap'; id: number; page: number | 'today' }
  | { action: 'list'; page: number }
  | { action: 'history'; id: number; date?: string; choice?: 'yes' | 'no' | 'skip' };

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
    const page = parts[3] ?? 'today';
    return { action, id: parseGoalId(parts[2]!), page: page === 'today' ? 'today' : pageNumber(page) };
  }
  if (action === 'list' && parts.length === 3) return { action, page: pageNumber(parts[2]!) };
  if (action === 'history' && parts.length === 3) return { action, id: parseGoalId(parts[2]!) };
  if (action === 'history' && parts.length === 5 && ['yes', 'no', 'skip'].includes(parts[4]!)) {
    parseDate(parts[3]!);
    return { action, id: parseGoalId(parts[2]!), date: parts[3]!, choice: parts[4] as 'yes' | 'no' | 'skip' };
  }
  throw new GoalInputError('Bouton d’objectif invalide.');
}
