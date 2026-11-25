import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'

export const SEB_KEY_REGEX = /^[a-f0-9]{64}$/i

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildSebConfigPlist({ assessment, startUrl, quitUrl }) {
  const sendExamKey = assessment.seb_browser_exam_key || assessment.seb_config_key || ''
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>startURL</key>',
    `  <string>${escapeXml(startUrl)}</string>`,
    '  <key>sendBrowserExamKey</key>',
    '  <true/>',
    '  <key>allowQuit</key>',
    '  <true/>',
    '  <key>quitURL</key>',
    `  <string>${escapeXml(quitUrl)}</string>`,
    '  <key>browserViewMode</key>',
    '  <integer>1</integer>',
    '  <key>showTaskBar</key>',
    '  <true/>',
    '  <key>allowSwitchToApplications</key>',
    '  <false/>',
    '  <key>enableURLFilter</key>',
    '  <false/>',
    '  <key>examSessionClearCookiesOnEnd</key>',
    '  <false/>',
    '  <key>munaAssessmentId</key>',
    `  <string>${escapeXml(assessment.id)}</string>`,
    '  <key>munaConfigKey</key>',
    `  <string>${escapeXml(assessment.seb_config_key || '')}</string>`,
    ...(sendExamKey
      ? ['  <key>browserExamKey</key>', `  <string>${escapeXml(sendExamKey)}</string>`]
      : []),
    '</dict>',
    '</plist>',
  ].join('\n')
}

function requestCandidateUrls(req) {
  const host = req.get('host') || '127.0.0.1'
  const forwardedProto = typeof req.get('x-forwarded-proto') === 'string'
    ? req.get('x-forwarded-proto').split(',')[0].trim()
    : ''
  const protos = new Set([req.protocol || 'http', ...(forwardedProto ? [forwardedProto] : [])])
  const fullPath = req.originalUrl || req.url || '/'
  const cleanPath = fullPath.split('?')[0]
  const urls = new Set()
  for (const proto of protos) {
    urls.add(`${proto}://${host}${fullPath}`)
    urls.add(`${proto}://${host}${cleanPath}`)
  }
  return urls
}

function sebHashMatches(headerValue, candidateUrls, secretKey) {
  if (typeof headerValue !== 'string' || !secretKey) return false
  const received = headerValue.trim().toLowerCase()
  if (!SEB_KEY_REGEX.test(received)) return false
  const receivedBuf = Buffer.from(received, 'hex')
  for (const url of candidateUrls) {
    const expected = createHash('sha256').update(`${url}${secretKey}`).digest()
    if (expected.length === receivedBuf.length && timingSafeEqual(expected, receivedBuf)) {
      return true
    }
  }
  return false
}

/** Validate Safe Exam Browser request headers against the assessment's keys. */
export function verifySebRequest(req, assessment) {
  if (assessment.security_mode !== 'seb') {
    return { ok: true, method: 'not_required' }
  }
  const urls = requestCandidateUrls(req)
  const configHash = req.get('x-safeexambrowser-configkeyhash')
  if (sebHashMatches(configHash, urls, assessment.seb_config_key)) {
    return { ok: true, method: 'config_key' }
  }
  const requestHash = req.get('x-safeexambrowser-requesthash')
  if (sebHashMatches(requestHash, urls, assessment.seb_browser_exam_key)) {
    return { ok: true, method: 'browser_exam_key' }
  }
  if (sebHashMatches(requestHash, urls, assessment.seb_config_key)) {
    return { ok: true, method: 'config_request_hash' }
  }
  return {
    ok: false,
    error: 'Safe Exam Browser is required for this assessment. Launch it using the downloaded Muna .seb configuration file.',
  }
}
