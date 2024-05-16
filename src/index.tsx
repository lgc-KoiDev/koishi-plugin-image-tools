import { MemoryImage } from 'image-in-browser'
import { Computed, Context, HTTP, Schema, h } from 'koishi'

import { name } from './const'
import * as ops from './operations'

import zhCNLocale from './locales/zh-CN.yml'

import type {} from '@koishijs/canvas'

export { name }
export const inject = ['http', 'canvas']

export interface Config {
  maxImagePerMessage: Computed<number>
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    maxImagePerMessage: Schema.computed(Schema.number()).default(9),
  }),
]).i18n({
  'zh-CN': zhCNLocale._config,
  zh: zhCNLocale._config,
})

export const errorHandle = async <R extends any, F extends () => Promise<R>>(
  func: F,
): Promise<R | h> => {
  try {
    return await func()
  } catch (e) {
    if (e instanceof ops.OperationError) {
      return <i18n path={e.i18nPath}>{e.i18nParams}</i18n>
    }
    throw e
  }
}

export function apply(ctx: Context, config: Config) {
  ctx.i18n.define('zh-CN', zhCNLocale)
  ctx.i18n.define('zh', zhCNLocale)

  const readImgElem = async (elem: JSX.ResourceElement[]) => {
    const elemSrc = elem.filter((v) => v.src).map((v) => v.src!)
    try {
      return await Promise.all(elemSrc.map((v) => ops.readImage(ctx.http, v)))
    } catch (e) {
      ctx.logger.warn(e)
      throw new ops.OperationError(
        HTTP.Error.is(e) ? '.fetch-image-failed' : '.invalid-image',
      )
    }
  }
  const blobsToSendable = (blobs: Blob[]) => {
    return Promise.all(
      blobs.map(async (v) => h.image(await v.arrayBuffer(), v.type)),
    )
  }

  const cmd = ctx.command(name)

  const registerImageCmd = (imgCmd: ops.ImageCommand) => {
    const externalArgs =
      imgCmd.args && imgCmd.args.length ? ` ${imgCmd.args.join(' ')}` : ''
    const subCmd = cmd.subcommand(
      `${imgCmd.name}${externalArgs} <...image:image>`,
    )
    if (imgCmd.aliases) {
      subCmd.alias(...imgCmd.aliases)
    }
    if (imgCmd.options) {
      for (const opt of imgCmd.options) subCmd.option(...opt)
    }
    subCmd.action(({ session, options: cmdOptions }, ...cmdArgs) => {
      if (!session) return
      return errorHandle(async () => {
        const argsLen = imgCmd.args?.length ?? 0
        const args = argsLen ? cmdArgs.slice(0, argsLen) : []
        const imageElements = cmdArgs.slice(imgCmd.args?.length ?? 0)
        const options = cmdOptions ?? {}
        if (!imageElements.length) {
          throw new ops.OperationError('.missing-image')
        }
        const images = await readImgElem(imageElements)
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
        return blobsToSendable(results)
      }) as Promise<h.Fragment>
    })
  }

  for (const x of ops.registeredCommands) {
    registerImageCmd(x)
  }
}
