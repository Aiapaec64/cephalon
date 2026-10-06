import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../index.js';
import { createGoal } from './create.js';
import { listGoals } from './list.js';
import { showGoal } from './show.js';
import { stopGoal } from './stop.js';
import { setGoalDay } from './set-day.js';

export const goal: Command = {
  data: new SlashCommandBuilder().setName('goal').setDescription('Objectifs quotidiens et rappels persistants.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub.setName('create').setDescription('Créer un objectif quotidien.')
      .addUserOption((option) => option.setName('user').setDescription('Membre concerné.').setRequired(true))
      .addStringOption((option) => option.setName('title').setDescription('Titre de l’objectif.').setMaxLength(200).setRequired(true))
      .addStringOption((option) => option.setName('start_date').setDescription('YYYY-MM-DD, y compris dans le passé.').setRequired(true))
      .addStringOption((option) => option.setName('reminder_time').setDescription('HH:mm, dans le fuseau choisi.').setRequired(true))
      .addIntegerOption((option) => option.setName('duration_days').setDescription('Durée en jours (choisir jours OU mois).').setMinValue(1).setMaxValue(3660))
      .addIntegerOption((option) => option.setName('duration_months').setDescription('Durée en mois calendaires.').setMinValue(1).setMaxValue(120))
      .addStringOption((option) => option.setName('timezone').setDescription('Fuseau IANA, Europe/Brussels par défaut.').setMaxLength(100)))
    .addSubcommand((sub) => sub.setName('list').setDescription('Tes objectifs actifs.'))
    .addSubcommand((sub) => sub.setName('show').setDescription('Détails et progression d’un objectif.')
      .addStringOption((option) => option.setName('goal_id').setDescription('ID de l’objectif.').setRequired(true)))
    .addSubcommand((sub) => sub.setName('stop').setDescription('Arrêter les rappels futurs.')
      .addStringOption((option) => option.setName('goal_id').setDescription('ID de l’objectif.').setRequired(true)))
    .addSubcommand((sub) => sub.setName('set-day').setDescription('Corriger une journée passée ou actuelle (créateur / admin).')
      .addStringOption((option) => option.setName('goal_id').setDescription('ID de l’objectif.').setRequired(true))
      .addStringOption((option) => option.setName('date').setDescription('YYYY-MM-DD.').setRequired(true))
      .addStringOption((option) => option.setName('status').setDescription('Résultat.').setRequired(true)
        .addChoices({ name: 'Oui', value: 'yes' }, { name: 'Non', value: 'no' }))),
  async execute(interaction) {
    const handlers = { create: createGoal, list: listGoals, show: showGoal, stop: stopGoal, 'set-day': setGoalDay };
    const name = interaction.options.getSubcommand() as keyof typeof handlers;
    const handler = handlers[name];
    if (!handler) throw new Error('Unknown goal subcommand.');
    await handler(interaction);
  },
};
