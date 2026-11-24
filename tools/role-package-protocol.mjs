import { createHash } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { ProjectError } from './errors.mjs'

export const ROLE_PACKAGE_LIMITS = Object.freeze({ archive: 48 * 1024 * 1024, expanded: 96 * 1024 * 1024, file: 16 * 1024 * 1024, files: 512, manifest: 512 * 1024 })
export const ROLE_CAPABILITIES = Object.freeze(['ensure-role-environment', 'terminal', 'browser', 'file-search', 'git', 'manager-orchestration'])
export const ROLE_ENVIRONMENTS = Object.freeze(['node', 'npm', 'python', 'git', 'browser'])
export const PROTECTED_ROLE_IDS = Object.freeze(['manager', 'frontend-engineer', 'backend-engineer', 'fullstack-engineer', 'testing-engineer', 'devops-engineer', 'technical-architect', 'security-engineer', 'ux-designer', 'data-analyst', 'technical-writer'])
const ID = /^[a-z][a-z0-9-]{1,62}$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/
const protectedSkills = new Set(['blueprint-manager', 'blueprint-node', 'blueprint-main-responder', 'work-item-governance', 'software-delivery-planning', 'find-skills'])
export const roleDigest = data => createHash('sha256').update(data).digest('hex')
const fail = message => { throw new ProjectError('INVALID_ROLE_PACKAGE', message) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
function keys(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`${label}: unsupported fields or invalid object`)
}
function text(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail(`${label}: invalid text`)
  return value
}
function strings(value, label, max = 24) {
  if (!Array.isArray(value) || value.length > max) fail(`${label}: expected a bounded array`)
  value.forEach(item => text(item, label))
}
export function safeRolePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || value !== value.normalize('NFC') || /[\\:<>"|?*\x00-\x1f\x7f]/.test(value) || value.startsWith('/') || value.endsWith('/')) fail('Unsafe package path')
  if (value.split('/').some(part => !part || part === '.' || part === '..' || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('Unsafe package path')
  return value
}

const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let n = i
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
const crc32 = bytes => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function checkExtra(bytes) {
  let cursor = 0
  while (cursor < bytes.length) {
    if (cursor + 4 > bytes.length) fail('Invalid ZIP extra metadata')
    const id = bytes.readUInt16LE(cursor), size = bytes.readUInt16LE(cursor + 2)
    if (id === 1 || cursor + 4 + size > bytes.length) fail('ZIP64 or malformed extra metadata is unsupported')
    cursor += 4 + size
  }
}

/** A deliberately small ZIP profile: regular UTF-8 files, stored or raw-deflate, no encryption/ZIP64/descriptors. */
export function readRoleArchive(input, { only = null } = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input)
  const L = ROLE_PACKAGE_LIMITS
  if (bytes.length < 22 || bytes.length > L.archive) fail('Role archive exceeds bounds')
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) fail('Invalid or split ZIP')
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), centralOffset = bytes.readUInt32LE(end + 16)
  if (!count || count > L.files || count !== bytes.readUInt16LE(end + 8) || centralOffset + centralSize !== end) fail('Invalid ZIP directory')
  const files = new Map(), names = new Set(), spans = []
  let cursor = centralOffset, expanded = 0
  const utf8 = new TextDecoder('utf-8', { fatal: true })
  for (let entry = 0; entry < count; entry++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail('Invalid ZIP entry')
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16)
    const compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32)
    const attributes = bytes.readUInt32LE(cursor + 38), local = bytes.readUInt32LE(cursor + 42), unixType = (attributes >>> 16) & 0xf000
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength
    if (entryEnd > end || flags & ~0x800 || ![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34) || (unixType && unixType !== 0x8000) || attributes & 0x10) fail('Unsupported ZIP entry (links/directories/encryption/descriptors are not accepted)')
    checkExtra(bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength))
    let name
    try { name = utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)) } catch { fail('ZIP filenames must be UTF-8') }
    safeRolePath(name)
    const canonical = name.toLowerCase()
    if (names.has(canonical)) fail('Duplicate package filename')
    names.add(canonical)
    if (size > L.file || (expanded += size) > L.expanded || compressed > L.archive) fail('Expanded archive exceeds bounds')
    if (local + 30 > centralOffset || bytes.readUInt32LE(local) !== 0x04034b50) fail('Invalid ZIP local header')
    const localName = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28), start = local + 30 + localName + localExtra, finish = start + compressed
    if (finish > centralOffset || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== size || !bytes.subarray(local + 30, local + 30 + localName).equals(bytes.subarray(cursor + 46, cursor + 46 + nameLength))) fail('ZIP local/central metadata mismatch')
    checkExtra(bytes.subarray(local + 30 + localName, start))
    for (const [a, b] of spans) if (local < b && finish > a) fail('Overlapping ZIP entries')
    spans.push([local, finish])
    if (only && !only.has(name)) { cursor = entryEnd; continue }
    let content
    try {
      if (method === 0) content = Buffer.from(bytes.subarray(start, finish))
      else {
        const inflated = inflateRawSync(bytes.subarray(start, finish), { maxOutputLength: Math.max(1, size), info: true })
        if (inflated.engine.bytesWritten !== compressed) fail('Trailing deflate data')
        content = inflated.buffer
      }
    } catch { fail('Invalid or excessive compressed payload') }
    if (content.length !== size || crc32(content) !== crc) fail('ZIP size/checksum mismatch')
    files.set(name, content)
    cursor = entryEnd
  }
  if (cursor !== end) fail('Unexpected ZIP directory data')
  for (const name of names) {
    const parts = name.split('/')
    for (let i = 1; i < parts.length; i++) if (names.has(parts.slice(0, i).join('/'))) fail('Package file/directory collision')
  }
  return files
}

/** Deterministic ZIP bytes make export fingerprints stable across platforms and restarts. */
export function createRoleArchive(entries) {
  const files = entries instanceof Map ? entries : new Map(Object.entries(entries))
  if (files.size > ROLE_PACKAGE_LIMITS.files) fail('Too many role files')
  const local = [], central = []
  let offset = 0, expanded = 0
  for (const [path, input] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    safeRolePath(path)
    const name = Buffer.from(path), content = Buffer.from(input), compressed = deflateRawSync(content, { level: 6 }), crc = crc32(content)
    if (content.length > ROLE_PACKAGE_LIMITS.file || (expanded += content.length) > ROLE_PACKAGE_LIMITS.expanded) fail('Role files exceed bounds')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12)
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(content.length, 22); header.writeUInt16LE(name.length, 26)
    local.push(header, name, compressed)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x314, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(33, 14)
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(content.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(0x81a40000, 38); directory.writeUInt32LE(offset, 42)
    central.push(directory, name); offset += header.length + name.length + compressed.length
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16)
  const result = Buffer.concat([...local, centralBytes, end])
  if (result.length > ROLE_PACKAGE_LIMITS.archive) fail('Compressed role archive exceeds bounds')
  return result
}

/** Normalize only the in-memory view; archive bytes and their fingerprint never change. */
export function normalizeRoleManifest(manifest) {
  if (manifest?.protocolVersion !== 2) return manifest
  const character = manifest.character ?? {}
  return { ...manifest, role: { ...character, instructions: character.prompt, responsibilities: [], nonGoals: [], acceptance: [] },
    environment: [], capabilities: manifest.capabilities ?? [],
    artwork: { portrait: manifest.image?.portrait ?? '', files: manifest.image?.files ?? [], ...manifest.image },
    skills: manifest.skills?.map(skill => ({ ...skill, kind: skill.kind ?? 'support' })) }
}

function validateCharacter(manifest) {
  keys(manifest, ['protocolVersion', 'packageId', 'version', 'publisher', 'license', 'character', 'skills', 'image', 'capabilities', 'resources', 'depends', 'settings', 'update', 'files', 'codingAgent'], 'character manifest')
  if(manifest.codingAgent!==undefined&&!['codex','claude','deepseek','jcode'].includes(manifest.codingAgent))fail('Invalid Character Coding Agent preference')
  keys(manifest.character, ['id', 'name', 'nameEn', 'description', 'prompt', 'aliases'], 'character')
  if (manifest.image !== undefined) keys(manifest.image, ['portrait', 'files'], 'image')
  if (!Array.isArray(manifest.files)) fail('Missing character file inventory')
  const inventory = new Set(manifest.files.map(file => file.path))
  if (manifest.resources !== undefined && (!Array.isArray(manifest.resources) || manifest.resources.length > 64)) fail('Invalid character resources')
  const paths = new Set()
  for (const resource of manifest.resources ?? []) {
    keys(resource, ['path', 'kind', 'description', 'platform', 'arch'], 'resource')
    safeRolePath(resource.path)
    if (!inventory.has(resource.path) || paths.has(resource.path) || !['environment', 'workflow', 'script', 'binary'].includes(resource.kind)) fail('Invalid or duplicate character resource')
    paths.add(resource.path); text(resource.description, 'resource.description')
    if (resource.platform !== undefined && !['win32', 'linux', 'darwin', 'any'].includes(resource.platform)) fail('Invalid resource platform')
    if (resource.arch !== undefined && !['x64', 'arm64', 'any'].includes(resource.arch)) fail('Invalid resource architecture')
  }
  if (manifest.depends !== undefined && (!Array.isArray(manifest.depends) || manifest.depends.length > 24)) fail('Invalid character dependencies')
  for (const dependency of manifest.depends ?? []) {
    keys(dependency, ['packageId', 'version', 'relation'], 'dependency')
    if (!ID.test(dependency.packageId) || dependency.packageId === manifest.packageId || typeof dependency.version !== 'string' || dependency.version.length > 80 || !SEMVER.test(dependency.version)
      || !['reference', 'collaboration'].includes(dependency.relation)) fail('Invalid fixed character dependency')
  }
  if (manifest.settings !== undefined && (!Array.isArray(manifest.settings) || manifest.settings.length > 24)) fail('Invalid character settings')
  const settingIds = new Set()
  for (const setting of manifest.settings ?? []) {
    keys(setting, ['id', 'label', 'kind', 'required', 'default'], 'setting')
    if (!ID.test(setting.id) || ['constructor', 'prototype', '__proto__'].includes(setting.id) || settingIds.has(setting.id) || !['text', 'environment-reference'].includes(setting.kind)
      || setting.required !== undefined && typeof setting.required !== 'boolean') fail('Invalid character setting')
    text(setting.label, 'setting.label', 100); settingIds.add(setting.id)
    if (setting.default !== undefined) {
      if (setting.kind !== 'text') fail('Secret references have no packaged values')
      text(setting.default, 'setting.default', 2000)
    }
  }
  if (manifest.update !== undefined) {
    keys(manifest.update, ['url'], 'update')
    text(manifest.update.url, 'update.url', 4096)
    let url
    try { url = new URL(manifest.update.url) } catch { fail('Invalid release URL') }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('Release URL must be HTTPS without credentials')
  }
}

export function validateRoleManifest(input, { builtin = false } = {}) {
  const v2 = input?.protocolVersion === 2
  if (v2) validateCharacter(input)
  const manifest = normalizeRoleManifest(input)
  if (!v2) keys(manifest, ['protocolVersion', 'packageId', 'version', 'publisher', 'license', 'role', 'skills', 'environment', 'capabilities', 'artwork', 'files'], 'manifest')
  if (![1, 2].includes(manifest.protocolVersion) || !ID.test(manifest.packageId) || typeof manifest.version !== 'string' || manifest.version.length > 80 || !SEMVER.test(manifest.version)) fail('Invalid package protocol, ID or version')
  text(manifest.publisher, 'publisher', 120); text(manifest.license, 'license', 120)
  const r = manifest.role
  if (!v2) keys(r, ['id', 'name', 'nameEn', 'description', 'instructions', 'responsibilities', 'nonGoals', 'acceptance', 'aliases'], 'role')
  if (!ID.test(r.id) || !builtin && (PROTECTED_ROLE_IDS.includes(r.id) || /^(blueprint|manager|main)(-|$)/i.test(r.id) || /^(blueprint|manager|main)(-|$)/i.test(manifest.packageId))) fail('Reserved or invalid role identity')
  text(r.name, 'role.name', 100); text(r.description, 'role.description'); if (r.nameEn !== undefined) text(r.nameEn, 'role.nameEn', 100)
  if (!builtin && /^(main|manager|blueprint manager|管理者|管理节点|项目管理者)$/i.test(r.name.trim())) fail('Protected Manager name')
  strings(r.responsibilities, 'responsibilities'); strings(r.nonGoals, 'nonGoals'); strings(r.acceptance, 'acceptance'); strings(r.aliases ?? [], 'aliases')
  safeRolePath(r.instructions)
  if (!Array.isArray(manifest.files) || manifest.files.length < 3 || manifest.files.length >= ROLE_PACKAGE_LIMITS.files) fail('Invalid file inventory')
  const inventory = new Map()
  for (const file of manifest.files) {
    keys(file, ['path', 'size', 'sha256'], 'inventory')
    safeRolePath(file.path)
    if (['manifest.json', '.archive.blueprint'].includes(file.path.toLowerCase()) || inventory.has(file.path.toLowerCase()) || !Number.isInteger(file.size) || file.size < 0 || file.size > ROLE_PACKAGE_LIMITS.file || !/^[a-f0-9]{64}$/.test(file.sha256)) fail('Invalid inventory member')
    inventory.set(file.path.toLowerCase(), file)
  }
  const requireFile = path => { safeRolePath(path); if (!inventory.has(path.toLowerCase()) || inventory.get(path.toLowerCase()).path !== path) fail(`Missing declared file: ${path}`) }
  requireFile(r.instructions); requireFile('LICENSE.txt')
  if (!Array.isArray(manifest.skills) || !manifest.skills.length || manifest.skills.length > 24 || manifest.skills.filter(skill => skill.kind === 'core').length !== 1) fail('One core Skill is required')
  const skillNames = new Set()
  for (const skill of manifest.skills) {
    keys(skill, ['name', 'kind', 'description', 'path', 'source', 'license'], 'skill')
    if (!ID.test(skill.name) || skillNames.has(skill.name) || !['core', 'support'].includes(skill.kind) || !builtin && (protectedSkills.has(skill.name) || skill.name.startsWith('blueprint-'))) fail('Invalid or protected Skill')
    skillNames.add(skill.name); text(skill.description, 'skill.description'); text(skill.source, 'skill.source', 1000); text(skill.license, 'skill.license', 120)
    if (skill.path !== `skills/${skill.name}/SKILL.md`) fail('Skill path must match its name')
    requireFile(skill.path)
  }
  if (!Array.isArray(manifest.environment) || manifest.environment.length > 12) fail('Invalid environment requirements')
  const environments = new Set()
  for (const env of manifest.environment) {
    keys(env, ['id', 'kind', 'required', 'minVersion', 'label'], 'environment')
    if (!ID.test(env.id) || environments.has(env.id) || !['runtime', 'tool'].includes(env.kind) || typeof env.required !== 'boolean') fail('Invalid declarative environment requirement')
    environments.add(env.id); text(env.label, 'environment.label', 100)
    if (env.minVersion !== undefined && !/^\d+\.\d+(?:\.\d+)?$/.test(env.minVersion)) fail('Invalid minimum runtime version')
  }
  strings(manifest.capabilities, 'capabilities', 16)
  if (!v2 && !manifest.capabilities.includes('ensure-role-environment') || new Set(manifest.capabilities).size !== manifest.capabilities.length || manifest.capabilities.some(capability => !ID.test(capability) || !builtin && /^(manager|main|admin|platform)(-|$)/.test(capability))) fail('Invalid or privileged role capability')
  keys(manifest.artwork, ['portrait', 'files', 'source'], 'artwork')
  if (!Array.isArray(manifest.artwork.files) || !v2 && !manifest.artwork.files.length || manifest.artwork.files.length > 160) fail('Role artwork is required')
  for (const path of manifest.artwork.files) {
    if (!(v2 ? /^images\/.+\.(png|jpe?g|webp)$/i : /^artwork\/.+\.(png|jpe?g|webp)$/i).test(path)) fail('Only raster role artwork is accepted')
    requireFile(path)
  }
  if ((manifest.artwork.files.length || manifest.artwork.portrait) && !manifest.artwork.files.includes(manifest.artwork.portrait)) fail('Portrait must be declared artwork')
  if (manifest.artwork.source !== undefined) text(manifest.artwork.source, 'artwork.source', 1000)
  return input
}

export function verifyRoleFiles(files, options = {}) {
  const raw = files.get('manifest.json')
  if (!raw || raw.length > ROLE_PACKAGE_LIMITS.manifest) fail('Missing or oversized manifest')
  let manifest
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) } catch { fail('Invalid UTF-8 JSON manifest') }
  validateRoleManifest(manifest, options)
  if (manifest.protocolVersion === 2) {
    const prompt = files.get(manifest.character.prompt)
    if (!prompt || prompt.length > 512 * 1024) fail('Missing or oversized character prompt')
    try { new TextDecoder('utf-8', { fatal: true }).decode(prompt) } catch { fail('Character prompt must be UTF-8') }
  }
  if (files.size !== manifest.files.length + 1) fail('Unlisted files in role archive')
  for (const item of manifest.files) {
    const bytes = files.get(item.path)
    if (!bytes || bytes.length !== item.size || roleDigest(bytes) !== item.sha256) fail(`Inventory digest mismatch: ${item.path}`)
  }
  for (const skill of manifest.skills) {
    const body = files.get(skill.path).toString('utf8')
    if (!body.startsWith('---\n') && !body.startsWith('---\r\n')) fail('Skill must contain YAML frontmatter')
    const head = body.split(/\r?\n---(?:\r?\n|$)/)[0]
    if (!new RegExp(`(?:^|\\n)name: ?${skill.name}(?:\\r?\\n|$)`).test(head) || !/(?:^|\n)description: \S/.test(head) || body.length > 131072) fail('Skill name/description frontmatter is invalid')
  }
  const normalized = normalizeRoleManifest(manifest)
  if (manifest.protocolVersion === 2) for (const path of normalized.artwork.files) assertStaticRoleImage(files.get(path), path)
  return { manifest: normalized, files, digest: roleDigest(raw) }
}

/** Extension checks alone also accept APNG and animated WebP. Inspect their chunks. */
export function assertStaticRoleImage(bytes, path) {
  if (/\.png$/i.test(path)) {
    if (!bytes?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('Invalid PNG image')
    let offset = 8, ended = false
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8)
      if (offset + 12 + length > bytes.length || ['acTL', 'fcTL', 'fdAT'].includes(kind)) fail('Only static portraits are supported')
      offset += 12 + length
      if (kind === 'IEND') { ended = true; break }
    }
    if (!ended || offset !== bytes.length) fail('Invalid PNG structure')
  } else if (/\.webp$/i.test(path)) {
    if (bytes?.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) fail('Invalid WebP image')
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4)
      if (offset + 8 + length > bytes.length || ['ANIM', 'ANMF'].includes(kind) || kind === 'VP8X' && bytes[offset + 8] & 2) fail('Only static portraits are supported')
      offset += 8 + length + length % 2
    }
    if (offset !== bytes.length) fail('Invalid WebP structure')
  } else if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) fail('Invalid JPEG image')
}

export function inspectRoleArchive(bytes, options = {}) { return verifyRoleFiles(readRoleArchive(bytes), options) }
export function decodeRoleBase64(value) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(ROLE_PACKAGE_LIMITS.archive / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('Invalid or oversized archive base64')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) fail('Noncanonical archive base64')
  return bytes
}
