import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Random } from 'koishi'

export const name = 'image-tools'
export const tmpDir = path.join(process.cwd(), 'temp', name)

export type AvailableZipType = 'zip' | '7z'
export const ZIP_MIME_TYPES: Record<AvailableZipType, string> = {
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
}

export function* chunks<T>(arr: T[], n: number): Generator<T[], void> {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n)
  }
}

export class CommandExecuteError extends Error {
  readonly name = 'CommandExecuteError'

  constructor(public readonly code: number) {
    super(`Process exited with code ${code}`)
  }
}

export async function runCmd(cmd: string[], options?: { cwd: string }) {
  return await new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd[0], cmd.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: options?.cwd,
    })
    proc.on('error', reject)
    proc.on('exit', (code: number) => {
      if (code) reject(new CommandExecuteError(code))
      else resolve()
    })
  })
}

export async function is7zExist() {
  try {
    await runCmd(['7z'])
    return true
  } catch (e) {
    return false
  }
}

export async function zipBlobs(
  blobs: Blob[],
  fileType?: AvailableZipType,
): Promise<string> {
  const folderId = Random.id()
  const tmpImagesDir = path.join(tmpDir, folderId)
  if (!existsSync(tmpImagesDir)) {
    await mkdir(tmpImagesDir, { recursive: true })
  }
  await Promise.all(
    blobs.map(async (v, i) => {
      const sfx = v.type.split('/')[1]
      const tmpPath = path.join(tmpImagesDir, `${i}.${sfx}`)
      await writeFile(tmpPath, Buffer.from(await v.arrayBuffer()))
    }),
  )

  const tmpZipDir = path.join(tmpDir, 'compressed')
  const tmpZipPath = path.join(tmpZipDir, `${name}-${folderId}.${fileType ?? 'zip'}`)
  try {
    if (!existsSync(tmpZipDir)) {
      await mkdir(tmpZipDir, { recursive: true })
    }
    await runCmd(['7z', 'a', tmpZipPath, '*'], { cwd: tmpImagesDir })
  } finally {
    await rm(tmpImagesDir, { recursive: true, force: true })
  }
  return tmpZipPath
}
