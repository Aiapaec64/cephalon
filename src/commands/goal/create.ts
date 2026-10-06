import { DiscordAPIError, MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { goalContext } from './context.js';
import { GoalInputError, validateGoal } from '../../services/goalLogic.js';
import { goalService } from '../../services/goalService.js';
import { recapPayload } from '../../services/goalRecap.js';

export async function createGoal(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = goalContext(interaction);
  const input = {
    title: interaction.options.getString('title', true), startDate: interaction.options.getString('start_date', true),
    reminderTime: interaction.options.getString('reminder_time', true),
    durationDays: interaction.options.getInteger('duration_days'), durationMonths: interaction.options.getInteger('duration_months'),
    timezone: interaction.options.getString('timezone'),
  };
  validateGoal(input);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const target = interaction.options.getUser('user', true);
  if (target.bot) throw new GoalInputError('Choisis un membre humain.');
  const guild = await interaction.client.guilds.fetch(context.guildId);
  try { await guild.members.fetch(target.id); } catch (error) {
    if (error instanceof DiscordAPIError && error.code === 10007) throw new GoalInputError('Ce membre n’est pas dans le serveur.');
    throw error;
  }
  const channel = await guild.channels.fetch(interaction.channelId);
  if (!channel?.isSendable() || channel.isThread() && (channel.archived || channel.locked)) {
    throw new GoalInputError('Choisis un canal de discussion accessible et ouvert.');
  }
  const permissions = channel.permissionsFor(await guild.members.fetchMe());
  const sendPermission = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, sendPermission, PermissionFlagsBits.ReadMessageHistory])) {
    throw new GoalInputError('Cephalon a besoin de Voir le salon, Envoyer des messages et Voir les anciens messages ici.');
  }
  const service = goalService();
  const goal = await service.create({ ...input,
    guildId: context.guildId, channelId: interaction.channelId, creatorUserId: context.actorId, targetUserId: target.id,
  });
  await interaction.editReply({ content: `Objectif #${goal.id} créé.${goal.active ? '' : ' Cet objectif est déjà terminé ; aucun rappel ne sera envoyé.'}`, ...recapPayload(goal, []) });
}
