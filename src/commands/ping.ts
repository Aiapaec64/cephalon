import { SlashCommandBuilder } from 'discord.js';
import type { Command } from './index.js';

export const ping: Command = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check Discord websocket latency.'),
  async execute(interaction) {
    const latency = interaction.client.ws.ping;
    await interaction.reply(latency < 0 ? 'Pong! Latency is not available yet.' : `Pong! ${Math.round(latency)}ms`);
  },
};
