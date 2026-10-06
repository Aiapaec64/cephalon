import { Events, type Client } from 'discord.js';

export const ready = {
  name: Events.ClientReady as const,
  execute(client: Client<true>): void {
    console.log(`Cephalon online as ${client.user.tag}`);
  },
};
