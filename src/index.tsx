import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { MemoryImage } from 'image-in-browser'
import { Command, Computed, Context, HTTP, Schema, Session, h } from 'koishi'

import {
  AcceptImageCommand,
  IgnoreImageCommand,
  ImageCommand,
  registeredCommands,
} from './commands'
import * as ou from './op-utils'
import {
  AvailableZipType,
  ZIP_MIME_TYPES,
  chunks,
  is7zExist,
  name,
  tmpDir,
  zipBlobs,
} from './utils'

import enUSLocale from './locales/en-US.yml'
import zhCNLocale from './locales/zh-CN.yml'

import type {} from '@koishijs/plugin-notifier'
import type {} from '@ltxhhz/koishi-plugin-skia-canvas'

export { name }
export const inject = ['http', 'skia']

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
    'en-US': enUSLocale._config,
    en: enUSLocale._config,
  }),
  HTTP.createConfig(),
])

export const errorHandle = async <
  R extends h.Fragment,
  F extends () => Promise<R>,
>(
  func: F,
): Promise<R> => {
  try {
    return await func()
  } catch (e) {
    if (e instanceof ou.OperationError) {
      return <i18n path={e.i18nPath}>{e.i18nParams}</i18n>
    }
    throw e
  }
}

export async function apply(ctx: Context, config: Config) {
  ctx.i18n.define('zh-CN', zhCNLocale)
  ctx.i18n.define('zh', zhCNLocale)
  ctx.i18n.define('en-US', enUSLocale)
  ctx.i18n.define('en', enUSLocale)

  if (existsSync(tmpDir)) {
    await rm(tmpDir, { recursive: true, force: true })
    // await mkdir(tmpDir, { recursive: true })
  }

  const cmd = ctx.command(name)

  const fetchSources = async (sources: string[]) => {
    try {
      return await Promise.all(sources.map((v) => ou.readImage(ctx.http, v)))
    } catch (e) {
      ctx.logger.warn(e)
      throw new ou.OperationError(
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
          throw new ou.OperationError('.zip-failed')
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

  const registerImageCmd = (imgCmd: ImageCommand) => {
    const ignoreImages = 'ignoreImages' in imgCmd && imgCmd.ignoreImages
    const externalArgs =
      imgCmd.args && imgCmd.args.length ? ` ${imgCmd.args.join(' ')}` : ''
    const subCmd = cmd.subcommand(
      `${imgCmd.name}${externalArgs}${ignoreImages ? '' : ' [elements: el]'}`,
    )
    if (imgCmd.aliases) {
      subCmd.alias(...imgCmd.aliases)
    }
    if (imgCmd.options) {
      for (const opt of imgCmd.options) subCmd.option(...opt)
    }
    subCmd.action((({ session, options: cmdOptions }, ...cmdArgs) => {
      if (!session) return
      if (!cmdArgs.length) return session.execute(`${imgCmd.name} -h`)

      // koishi will automatically use quoted message as command arg
      const lastArg = cmdArgs[cmdArgs.length - 1]
      const lastArgValid = lastArg instanceof Array
      const args =
        ignoreImages || !lastArgValid ? cmdArgs : cmdArgs.slice(0, -1)
      const options = cmdOptions ?? {}

      const handleIgnoreImageCmd = async (imgCmd: IgnoreImageCommand) => {
        const r = await imgCmd.func(undefined, ctx.skia, { args, options })
        return blobsToSendable(session, r instanceof Array ? r : [r])
      }

      const handleAcceptImageCmd = async (imgCmd: AcceptImageCommand) => {
        const imageArgs = (
          lastArgValid ? lastArg.filter((v) => 'src' in v.attrs) : []
        ) as (h & { attrs: { src: string } })[]
        if (!imageArgs.length) {
          throw new ou.OperationError('.missing-image')
        }
        const images = await fetchSources(imageArgs.map((v) => v.attrs.src))

        const processOne = async (v: MemoryImage | MemoryImage[]) => {
          const r = await imgCmd.func(v as any, ctx.skia, { args, options })
          if (r instanceof Array) return r
          return [r]
        }
        const results: Blob[] = (
          await Promise.all(
            imgCmd.multiImages ? [processOne(images)] : images.map(processOne),
          )
        ).flatMap((v) => v)
        return blobsToSendable(session, results)
      }

      return errorHandle(async () => {
        if (ignoreImages) return handleIgnoreImageCmd(imgCmd)
        return handleAcceptImageCmd(imgCmd)
      })
    }) as Command.Action<never, never, any[]>)
  }

  for (const x of registeredCommands) {
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
