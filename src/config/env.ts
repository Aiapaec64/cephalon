import { config } from 'dotenv';

export interface DiscordEnvironment {
  DISCORD_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_GUILD_ID: string;
}

export interface Environment extends DiscordEnvironment {
  DATABASE_URL: string;
}

export function validateDatabaseUrl(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length <= 1) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL including a hostname and database name.');
  }
}

export function loadDiscordEnvironment(): DiscordEnvironment {
  config({ quiet: true });
  function required(name: keyof DiscordEnvironment): string {
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

export function loadEnvironment(): Environment {
  const discord = loadDiscordEnvironment();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('Missing required environment variable: DATABASE_URL');
  validateDatabaseUrl(url);
  return { ...discord, DATABASE_URL: url };
}
