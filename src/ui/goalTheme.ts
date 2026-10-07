import { ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export const goalColors = { accent: 0x64748b, success: 0x527a64, negative: 0x9a6262 } as const;

export function goalEmbed(title: string, description: string, color: number = goalColors.accent): EmbedBuilder {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
}

export function goalButton(id: string, label: string, style = ButtonStyle.Secondary, disabled = false): ButtonBuilder {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}
