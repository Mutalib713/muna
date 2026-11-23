import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { writeFile } from 'node:fs/promises'

function quoteEnv(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('Run setup in an interactive terminal so the password can be entered without echo.'))
      return
    }

    stdout.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()
    let value = ''
    const cleanup = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
    }
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          cleanup()
          reject(new Error('Setup cancelled.'))
          return
        }
        if (character === '\r' || character === '\n') {
          cleanup()
          resolve(value)
          return
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += character
      }
    }
    stdin.on('data', onData)
  })
}

const prompt = createInterface({ input: stdin, output: stdout })
try {
  const email = (await prompt.question('Admin email: ')).trim()
  const name = (await prompt.question('Admin display name: ')).trim() || 'Administrator'
  prompt.close()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === 'admin@example.com') {
    throw new Error('Enter a valid administrator email address.')
  }
  const password = await readHidden('Admin password (at least 14 characters): ')
  const confirmation = await readHidden('Confirm admin password: ')
  if (password !== confirmation) {
    throw new Error('The passwords did not match.')
  }
  if (password.length < 14) {
    throw new Error('The admin password must be at least 14 characters.')
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('The admin password must be no more than 72 UTF-8 bytes.')
  }

  const contents = [
    `ADMIN_EMAIL=${quoteEnv(email)}`,
    `ADMIN_NAME=${quoteEnv(name)}`,
    `ADMIN_PASSWORD=${quoteEnv(password)}`,
    `SESSION_SECRET=${randomBytes(48).toString('base64url')}`,
    'DATABASE_PATH=./data/muna.sqlite',
    'PORT=3001',
    'HOST=127.0.0.1',
    '',
  ].join('\n')
  await writeFile(new URL('../.env', import.meta.url), contents, { flag: 'wx', mode: 0o600 })
  console.log('Created .env with your administrator account and a generated session secret.')
} finally {
  prompt.close()
}
