import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
import type { Goal, GoalCheckin } from '../db/schema.js';
import { parseDate, type CheckinStatus } from './goalLogic.js';

export const DAY_VISUALS = {
  yes: { icon: '✅', label: 'Fait' },
  no: { icon: '❌', label: 'Non' },
  missed: { icon: '⚪', label: 'Sans réponse' },
  pending: { icon: '⏳', label: 'Aujourd’hui' },
  future: { icon: '⬜', label: 'À venir' },
} as const;

export function frenchDate(date: string, style: 'short' | 'full' | 'long' = 'full'): string {
  return parseDate(date).setLocale('fr').toFormat(style === 'short' ? 'dd/MM' : style === 'long' ? 'd LLLL yyyy' : 'dd/MM/yyyy');
}

export function goalDuration(goal: Pick<Goal, 'startDate' | 'endDate'>): number {
  return Math.round(parseDate(goal.endDate).diff(parseDate(goal.startDate), 'days').days) + 1;
}

export function goalDayNumber(goal: Pick<Goal, 'startDate' | 'endDate'>, date: string): number {
  const day = Math.round(parseDate(date).diff(parseDate(goal.startDate), 'days').days) + 1;
  return Math.max(0, Math.min(goalDuration(goal), day));
}

export function goalDayLabel(goal: Goal, today: string): string {
  const total = goalDuration(goal);
  if (today > goal.endDate) return `Terminé · ${total} jours`;
  const label = today < goal.startDate ? `Début le ${frenchDate(goal.startDate)}` : `Jour ${goalDayNumber(goal, today)} sur ${total}`;
  return goal.active ? label : `Arrêté · ${label}`;
}

export function completionBar(completed: number, total: number): string {
  const percent = total ? Math.max(0, Math.min(100, completed / total * 100)) : 0;
  const filled = Math.round(percent / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${Math.round(percent)} %`;
}

export function recapButton(id: number, label = '📊 Récapitulatif'): ButtonBuilder {
  return new ButtonBuilder().setCustomId(`goal:recap:${id}`).setLabel(label).setStyle(ButtonStyle.Primary);
}

export function creationPayload(goal: Goal) {
  const duration = goalDuration(goal);
  const embed = new EmbedBuilder().setTitle('✅ Objectif créé').setColor(0x57f287)
    .setDescription([
      `🎯 **${escapeMarkdown(goal.title)}**`,
      `👤 Cible : <@${goal.targetUserId}>`,
      `✍️ Créateur : <@${goal.creatorUserId}>`,
      `📅 ${frenchDate(goal.startDate)} → ${frenchDate(goal.endDate)}`,
      `⏰ Rappel : ${goal.reminderTime}`,
      `🌍 ${goal.timezone}`,
      `📆 Durée : ${duration} ${duration === 1 ? 'jour' : 'jours'}`,
      ...(goal.active ? [] : ['\nCet objectif est terminé ; aucun rappel ne sera envoyé.']),
    ].join('\n'))
    .setFooter({ text: `Objectif #${goal.id}` });
  return { content: '', embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(recapButton(goal.id, '📊 Voir le récapitulatif'))],
    allowedMentions: { parse: [] as [] },
  };
}

const yesMessages = ['Continue comme ça 💪', 'Une journée de plus, bravo !', 'Excellent, garde le rythme !'];
const noMessages = ['Ce n’est pas grave. Demain est une nouvelle occasion 💪', 'Une journée manquée ne détruit pas ta progression.', 'Le plus important est de continuer.'];

export function reminderEmbed(goal: Goal, date: string, status: CheckinStatus = 'pending', checkins: GoalCheckin[] = []): EmbedBuilder {
  const total = goalDuration(goal);
  const completed = checkins.filter((row) => row.status === 'yes' && row.checkinDate >= goal.startDate && row.checkinDate <= goal.endDate).length;
  const pool = status === 'yes' ? yesMessages : noMessages;
  const encouragement = pool[Math.floor(Math.random() * pool.length)]!;
  const title = status === 'yes' ? '✅ Objectif validé' : status === 'no' ? '❌ Objectif non validé aujourd’hui'
    : status === 'missed' ? '⚪ Journée sans réponse' : '🎯 Objectif du jour';
  const body = status === 'yes'
    ? `Bien joué <@${goal.targetUserId}> 💪\n${completed} ${completed === 1 ? 'jour complété' : 'jours complétés'} sur ${total}.\n${encouragement}`
    : status === 'no' ? encouragement : status === 'missed' ? 'Cette journée est terminée. Continue à ton rythme.'
      : 'As-tu réalisé ton objectif aujourd’hui ?';
  return new EmbedBuilder().setTitle(title).setColor(status === 'yes' ? 0x57f287 : status === 'no' ? 0xfee75c : 0x5865f2)
    .setDescription(`**${escapeMarkdown(goal.title)}**\n\nJour ${goalDayNumber(goal, date)} sur ${total}\n📅 ${frenchDate(date, 'long')}\n\n${body}`)
    .setFooter({ text: `Objectif #${goal.id} · ${goal.timezone}` });
}
