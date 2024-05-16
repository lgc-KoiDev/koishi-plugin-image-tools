import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { MemoryImage } from 'image-in-browser'
import { Computed, Context, HTTP, Random, Schema, Session, h } from 'koishi'

import * as ops from './operations'

import zhCNLocale from './locales/zh-CN.yml'

import type {} from '@koishijs/canvas'
import type {} from '@koishijs/plugin-notifier'

export const name = 'image-tools'
export const inject = ['http', 'canvas']

export type AvailableZipType = 'zip' | '7z'
export interface Config {
  sendOneByOne: Computed<boolean>
  overflowThreshold: Computed<number>
  overflowSendType: Computed<'multi' | 'forward' | 'file'>
  oneByOneInForward: Computed<boolean>
  zipFileType: AvailableZipType
  useBase64SendFile: boolean
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.intersect([
    Schema.object({
      sendOneByOne: Schema.computed(Schema.boolean().default(false)).default(
        false,
      ),
      overflowThreshold: Schema.computed(Schema.number().default(9)).default(9),
      overflowSendType: Schema.computed(
        Schema.union(['multi', 'forward', 'file']).default('forward'),
      ).default('forward'),
      oneByOneInForward: Schema.computed(
        Schema.boolean().default(false),
      ).default(false),
      zipFileType: Schema.union(['zip', '7z']).default('7z'),
      useBase64SendFile: Schema.boolean().default(false),
    }),
  ]).i18n({
    'zh-CN': zhCNLocale._config,
    zh: zhCNLocale._config,
  }),
  HTTP.createConfig(),
])

const ZIP_MIME_TYPES: Record<AvailableZipType, string> = {
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
}
const tmpDir = path.join(process.cwd(), 'temp', name)

export const errorHandle = async <
  R extends h.Fragment,
  F extends () => Promise<R>,
>(
  func: F,
): Promise<R> => {
  try {
    return await func()
  } catch (e) {
    if (e instanceof ops.OperationError) {
      return <i18n path={e.i18nPath}>{e.i18nParams}</i18n>
    }
    throw e
  }
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

export function runCmd(cmd: string[], options?: { cwd: string }) {
  return new Promise<void>((resolve, reject) => {
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
    if (e instanceof CommandExecuteError) return false
    throw e
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
  const tmpZipPath = path.join(
    tmpZipDir,
    `${name}-${folderId}.${fileType ?? 'zip'}`,
  )
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

export async function apply(ctx: Context, config: Config) {
  ctx.i18n.define('zh-CN', zhCNLocale)
  ctx.i18n.define('zh', zhCNLocale)

  if (existsSync(tmpDir)) {
    await rm(tmpDir, { recursive: true, force: true })
    // await mkdir(tmpDir, { recursive: true })
  }

  const cmd = ctx.command(name)

  const fetchSources = async (sources: string[]) => {
    try {
      return await Promise.all(sources.map((v) => ops.readImage(ctx.http, v)))
    } catch (e) {
      ctx.logger.warn(e)
      throw new ops.OperationError(
        HTTP.Error.is(e) ? '.fetch-image-failed' : '.invalid-image',
      )
    }
  }

  const blobsToSendable = async (
    session: Session,
    blobs: Blob[],
  ): Promise<h.Fragment> => {
    const toImageElem = async (v: Blob) =>
      h.image(await v.arrayBuffer(), v.type)
    const splitToMessages = (): Promise<h[]> =>
      Promise.all(
        [...chunks(blobs, overflowThreshold)].map(async (v) => (
          <message>{await Promise.all(v.map(toImageElem))}</message>
        )),
      )

    const overflowThreshold = session.resolve(config.overflowThreshold)
    if (blobs.length <= overflowThreshold) {
      const elements = await Promise.all(blobs.map(toImageElem))
      const sendOneByOne = session.resolve(config.sendOneByOne)
      if (sendOneByOne) return elements.map((v) => <message>{v}</message>)
      return elements
    }

    const sendType = session.resolve(config.overflowSendType)
    switch (sendType) {
      case 'multi': {
        return splitToMessages()
      }
      case 'forward': {
        return (
          <message forward>
            {session.resolve(config.oneByOneInForward)
              ? await Promise.all(blobs.map(toImageElem))
              : await splitToMessages()}
          </message>
        )
      }
      case 'file': {
        let zipPath: string
        try {
          zipPath = await zipBlobs(blobs, config.zipFileType)
        } catch (e) {
          ctx.logger.warn(e)
          throw new ops.OperationError('.zip-failed')
        }
        const fileName = path.basename(zipPath)
        return (
          <file
            src={
              config.useBase64SendFile
                ? `data:${ZIP_MIME_TYPES[config.zipFileType]};base64,` +
                  `${(await readFile(zipPath)).toString('base64')}`
                : pathToFileURL(zipPath).href
            }
            title={fileName}
          />
        )
      }
    }
  }

  const registerImageCmd = (imgCmd: ops.ImageCommand) => {
    const externalArgs =
      imgCmd.args && imgCmd.args.length ? ` ${imgCmd.args.join(' ')}` : ''
    const subCmd = cmd.subcommand(`${imgCmd.name}${externalArgs} [...rest:el]`)
    if (imgCmd.aliases) {
      subCmd.alias(...imgCmd.aliases)
    }
    if (imgCmd.options) {
      for (const opt of imgCmd.options) subCmd.option(...opt)
    }
    subCmd.action(({ session, options: cmdOptions }, ...cmdArgs) => {
      if (!session) return
      return errorHandle(async () => {
        const optArgsLen = imgCmd.args?.length ?? 0
        // koishi will automatically use quoted message as command arg
        const imageElements = cmdArgs
          .slice(optArgsLen)
          .flatMap((v) => v)
          .filter((v) => 'src' in v.attrs) as (h & { attrs: { src: string } })[]
        if (!imageElements.length) {
          throw new ops.OperationError('.missing-image')
        }

        const images = await fetchSources(imageElements.map((v) => v.attrs.src))
        const args = optArgsLen ? cmdArgs.slice(0, optArgsLen) : []
        const options = cmdOptions ?? {}
        const processOne = async (v: MemoryImage | MemoryImage[]) => {
          const r = await imgCmd.func(v as any, ctx.canvas, { args, options })
          if (r instanceof Array) return r
          return [r]
        }
        const results: Blob[] = (
          await Promise.all(
            imgCmd.multiImages ? [processOne(images)] : images.map(processOne),
          )
        ).flatMap((v) => v)
        return blobsToSendable(session, results)
      })
    })
  }

  for (const x of ops.registeredCommands) {
    registerImageCmd(x)
  }

  if (!(await is7zExist())) {
    ctx.logger.warn(
      '7z not found, there will be an error when overflowSendType sets to file',
    )
    ctx.inject(['notifier'], (ctx) => {
      ctx.notifier.create({
        type: 'warning',
        content: (
          <div>
            <p>
              未检测到 7z 命令，当 <code>overflowSendType</code> 设为{' '}
              <code>file</code> 时将会出错！
              <br />
              7z command not found, there will be an error when{' '}
              <code>overflowSendType</code> sets to <code>file</code>!
            </p>
            <p>下载 7z (Download 7z): https://sparanoid.com/lab/7z/</p>
          </div>
        ),
      })
    })
  }
}
