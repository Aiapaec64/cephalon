import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { GoalInputError, parseGoalId } from '../../services/goalLogic.js';

export function goalContext(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild()) throw new GoalInputError('Cette commande doit être utilisée dans un serveur.');
  return {
    guildId: interaction.guildId, actorId: interaction.user.id,
    administrator: interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
  };
}

export function goalIdOption(interaction: ChatInputCommandInteraction): number {
  return parseGoalId(interaction.options.getString('goal_id', true));
}
