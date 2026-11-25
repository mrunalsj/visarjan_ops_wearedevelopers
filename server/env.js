// Loads KEY=VALUE pairs from a local .env file (if present) without overriding variables already set.
// Imported first by server/index.js so every module sees the same configuration. Works on Node 20+.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.cwd(), '.env');
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith('#') || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
