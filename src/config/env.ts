import { config } from 'dotenv';

export interface Environment {
  DISCORD_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_GUILD_ID: string;
}

export function loadEnvironment(): Environment {
  config({ quiet: true });
  function required(name: keyof Environment): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
  }
  return {
    DISCORD_TOKEN: required('DISCORD_TOKEN'),
    DISCORD_CLIENT_ID: required('DISCORD_CLIENT_ID'),
    DISCORD_GUILD_ID: required('DISCORD_GUILD_ID'),
  };
}
