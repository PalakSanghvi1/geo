/**
 * Minimal .env loader for standalone scripts and the worker.
 *
 * Next.js loads .env itself for the web app, but `tsx scripts/*.ts` and the pm2
 * worker do not. Importing this module first fills process.env from ./.env if the
 * file exists. No dependency, no Node flag forwarding to get wrong on the VPS.
 */
import fs from 'node:fs';
import path from 'node:path';

function load(file: string) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue; // real env always wins
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

load(path.join(process.cwd(), '.env'));

export {};
