import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRoleArchive, inspectRoleArchive, roleDigest, safeRolePath } from './role-package-protocol.mjs'

/** Package only declared content. Build credentials and repository files are never swept in. */
export async function packCharacter(source, destination, { official = false } = {}) {
  const root = await realpath(source), files = new Map()
  const read = async path => {
    safeRolePath(path)
    const absolute = join(root, path)
    for (let cursor = absolute; cursor !== root; cursor = dirname(cursor)) {
      const part = relative(root, cursor)
      if (!part || part.startsWith('..') || isAbsolute(part) || (await lstat(cursor)).isSymbolicLink()) throw Error('Package content must be regular files inside the source directory')
    }
    if (!(await lstat(absolute)).isFile()) throw Error(`Not a package file: ${path}`)
    files.set(path, await readFile(absolute))
  }
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
  if (manifest.protocolVersion !== 2) throw Error('pack-character requires protocolVersion 2')
  const roleId = manifest.character?.id
  if (official && (roleId !== 'react-native-mobile'
    || manifest.packageId !== 'blueprint-' + roleId || manifest.publisher !== 'Blueprint Studio'))
    throw Error('Official mode requires a registered Blueprint Studio professional role identity')
  await read(manifest.character?.prompt)
  await read('LICENSE.txt')
  for (const image of manifest.image?.files ?? []) await read(image)
  for (const resource of manifest.resources ?? []) await read(resource.path)
  const walk = async path => {
    for (const name of (await readdir(join(root, path))).sort()) {
      const entry = `${path}/${name}`, stat = await lstat(join(root, entry))
      if (stat.isSymbolicLink()) throw Error('Symbolic links are not package resources')
      if (stat.isDirectory()) await walk(entry)
      else await read(entry)
    }
  }
  for (const skill of manifest.skills ?? []) {
    if (!/^skills\/[a-z][a-z0-9-]+\/SKILL\.md$/.test(skill.path)) throw Error('Invalid Skill root')
    await walk(skill.path.slice(0, -'/SKILL.md'.length))
  }
  manifest.files = [...files].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([path, bytes]) => ({ path, size: bytes.length, sha256: roleDigest(bytes) }))
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))
  const archive = createRoleArchive(files)
  inspectRoleArchive(archive, { builtin: official })
  const filename = `${manifest.packageId}-${manifest.version}.blueprint`
  await mkdir(destination, { recursive: true })
  const target = resolve(destination, filename)
  await writeFile(target, archive)
  return { filename, path: target, packageId: manifest.packageId, version: manifest.version, sha256: roleDigest(archive), bytes: archive.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const official = process.argv[2] === '--official'
  const [source, destination = 'dist', ...extra] = process.argv.slice(official ? 3 : 2)
  if (!source || extra.length) throw Error('Usage: node tools/pack-character.mjs [--official] <blueprint-directory> [output-directory]')
  const result = await packCharacter(resolve(source), resolve(destination), { official })
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}
