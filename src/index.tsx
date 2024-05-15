import {} from '@koishijs/canvas'
import { Context, h, HTTP, Schema } from 'koishi'

import { name } from './const'
import zhCNLocale from './locales/zh-CN.yml'
import * as ops from './operations'

export { name }
export const inject = ['http', 'canvas']

export interface Config {}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({}),
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
  // TODO: 打包上传 / 合并转发
  const blobsToSendable = (blobs: Blob[]) =>
    Promise.all(blobs.map(async (v) => h.image(await v.arrayBuffer(), v.type)))

  const cmd = ctx.command(name)

  cmd.subcommand('flip-h <image:image>').action(({ session }, image) => {
    if (!session) return
    return errorHandle(async () => {
      if (!image) throw new ops.OperationError('.missing-image')
      const [memImg] = await readImgElem([image])
      const res = await ops.flipHorizontal(memImg)
      return blobsToSendable([res])
    })
  })

  cmd.subcommand('gif-reverse <image:image>').action(({ session }, image) => {
    if (!session) return
    return errorHandle(async () => {
      if (!image) throw new ops.OperationError('.missing-image')
      const [memImg] = await readImgElem([image])
      const res = await ops.gifReverse(memImg)
      return blobsToSendable([res])
    })
  })
}
