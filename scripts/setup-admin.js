import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

function quoteEnv(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

const contents = [
  `SESSION_SECRET=${randomBytes(48).toString('base64url')}`,
  `SETUP_CODE=${quoteEnv(randomBytes(32).toString('base64url'))}`,
  'DATABASE_PATH=./data/muna.sqlite',
  'PORT=3001',
  'HOST=127.0.0.1',
  '',
].join('\n')
await writeFile(new URL('../.env', import.meta.url), contents, { flag: 'wx', mode: 0o600 })
console.log('Created .env with a session secret and one-time admin setup code. Read SETUP_CODE from .env to create the account.')
