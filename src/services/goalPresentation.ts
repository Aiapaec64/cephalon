import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown } from 'discord.js';
import type { Goal, GoalCheckin } from '../db/schema.js';
import { dateRange, dayStatus, localClock, parseDate, progressSummary, type CheckinStatus } from './goalLogic.js';
import { goalButton, goalColors, goalEmbed } from '../ui/goalTheme.js';

export const DAY_VISUALS = {
  yes: { icon: '✓', label: 'Fait' }, no: { icon: '×', label: 'Non' },
  missed: { icon: '—', label: 'Sans réponse' }, pending: { icon: '·', label: 'Aujourd’hui' },
  future: { icon: '', label: 'À venir' },
} as const;

export function frenchDate(date: string, style: 'short' | 'full' | 'long' = 'full'): string {
  return parseDate(date).setLocale('fr').toFormat(style === 'short' ? 'dd/MM' : style === 'long' ? 'd LLLL yyyy' : 'dd/MM/yyyy');
}

export function goalDuration(goal: Pick<Goal, 'startDate' | 'endDate'>): number {
  return Math.round(parseDate(goal.endDate).diff(parseDate(goal.startDate), 'days').days) + 1;
}

export function goalDayNumber(goal: Pick<Goal, 'startDate' | 'endDate'>, date: string): number {
  return Math.max(0, Math.min(goalDuration(goal), Math.round(parseDate(date).diff(parseDate(goal.startDate), 'days').days) + 1));
}

export function goalDayLabel(goal: Goal, today: string): string {
  if (today > goal.endDate) return `Terminé · ${goalDuration(goal)} jours`;
  const label = today < goal.startDate ? `Début le ${frenchDate(goal.startDate)}` : `Jour ${goalDayNumber(goal, today)} sur ${goalDuration(goal)}`;
  return goal.active ? label : `Arrêté · ${label}`;
}

export function goalProgress(goal: Goal, checkins: GoalCheckin[], today: string) {
  const dates = dateRange(goal.startDate, goal.endDate);
  const records = new Map(checkins.map((row) => [row.checkinDate, row.status]));
  return { dates, ...progressSummary(dates.map((date) => dayStatus(date, today, records.get(date)))) };
}

export function streakDays(goal: Goal, checkins: GoalCheckin[], today: string): number {
  if (today < goal.startDate) return 0;
  const records = new Map(checkins.map((row) => [row.checkinDate, row.status]));
  let cursor = parseDate(today > goal.endDate ? goal.endDate : today);
  // An unanswered current day does not break yesterday's streak before the day is over.
  if (today <= goal.endDate && !['yes', 'no', 'missed'].includes(records.get(today) ?? 'pending')) cursor = cursor.minus({ days: 1 });
  let count = 0;
  while (cursor.toISODate()! >= goal.startDate && records.get(cursor.toISODate()!) === 'yes') {
    count++;
    cursor = cursor.minus({ days: 1 });
  }
  return count;
}

export function unansweredPastDates(goal: Goal, checkins: GoalCheckin[], now = new Date()): string[] {
  const today = localClock(goal.timezone, now).date;
  const answered = new Set(checkins.filter((row) => row.status === 'yes' || row.status === 'no').map((row) => row.checkinDate));
  return dateRange(goal.startDate, goal.endDate).filter((date) => date < today && !answered.has(date));
}

export function recapButton(id: number, label = 'Récapitulatif', style = ButtonStyle.Secondary): ButtonBuilder {
  return goalButton(`goal:recap:${id}`, label, style);
}

export function historyButton(id: number): ButtonBuilder {
  return goalButton(`goal:history:${id}`, 'Compléter l’historique');
}

export function creationPayload(goal: Goal, now = new Date()) {
  const embed = goalEmbed('Objectif créé', escapeMarkdown(goal.title)).addFields(
    { name: 'Cible', value: `<@${goal.targetUserId}>`, inline: true },
    { name: 'Créateur', value: `<@${goal.creatorUserId}>`, inline: true },
    { name: 'Période', value: `${frenchDate(goal.startDate)} → ${frenchDate(goal.endDate)}` },
    { name: 'Rappel', value: `${goal.reminderTime} · ${goal.timezone}` },
    { name: 'Progression', value: `0 / ${goalDuration(goal)} jours` },
  ).setFooter({ text: `Objectif #${goal.id}` });
  if (!goal.active) embed.addFields({ name: 'État', value: 'Terminé. Aucun rappel ne sera envoyé.' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(recapButton(goal.id, 'Voir le récapitulatif', ButtonStyle.Primary));
  if (unansweredPastDates(goal, [], now).length) row.addComponents(historyButton(goal.id));
  return { content: '', embeds: [embed], components: [row], allowedMentions: { parse: [] as [] } };
}

export function reminderEmbed(goal: Goal, date: string, status: CheckinStatus = 'pending', checkins: GoalCheckin[] = []) {
  const title = status === 'yes' ? 'Objectif validé' : status === 'no' ? 'Objectif non validé'
    : status === 'missed' ? 'Journée sans réponse' : 'Objectif du jour';
  const embed = goalEmbed(title, escapeMarkdown(goal.title), status === 'yes' ? goalColors.success : status === 'no' ? goalColors.negative : goalColors.accent);
  if (status === 'pending') embed.addFields(
    { name: 'Aujourd’hui', value: `Jour ${goalDayNumber(goal, date)} sur ${goalDuration(goal)}`, inline: true },
    { name: 'Date', value: frenchDate(date), inline: true },
    { name: 'Question', value: 'As-tu réalisé ton objectif aujourd’hui ?' },
  );
  else {
    const progress = goalProgress(goal, checkins, date);
    embed.addFields({ name: 'Progression', value: `${progress.completed} / ${progress.dates.length} jours`, inline: true });
    if (status === 'yes') embed.addFields({ name: 'Série actuelle', value: `${streakDays(goal, checkins, date)} jours`, inline: true });
    embed.addFields({ name: 'Date', value: frenchDate(date) });
    embed.addFields({ name: 'Bilan', value: status === 'yes' ? 'Bien joué. Continue comme ça.'
      : status === 'no' ? 'Une journée manquée ne remet pas en cause ta progression.' : 'Cette journée est terminée.' });
  }
  return embed.setFooter({ text: `Objectif #${goal.id} · ${goal.timezone}` });
}
