import type CanvasService from '@koishijs/canvas'
import type { Canvas, Image } from '@koishijs/canvas'
import {
  ChannelOrder,
  decodeImageByMimeType,
  decodePng,
  Draw,
  encodeGif,
  encodePng,
  MemoryImage,
  Transform,
} from 'image-in-browser'
import { HTTP } from 'koishi'
import { GifReader } from 'omggif'

export interface ImageCommandBase {
  name: string
  aliases?: string[]
}

export interface SingleImageCommand<O = any> extends ImageCommandBase {
  multiImages?: false
  func: (
    image: MemoryImage,
    canvasSv: CanvasService,
    options: O,
  ) => Promise<Blob | Blob[]>
}

export interface MultiImageCommand<O = any> extends ImageCommandBase {
  multiImages: true
  func: (
    images: MemoryImage[],
    canvasSv: CanvasService,
    options: O,
  ) => Promise<Blob | Blob[]>
}

export type ImageCommand<O = any> = SingleImageCommand<O> | MultiImageCommand<O>

export const registeredCommands: ImageCommand[] = []

export class OperationError extends Error {
  readonly name = 'OperationError'
  readonly i18nPath: string

  constructor(
    i18nPath: string,
    public readonly i18nParams: any[] = [],
  ) {
    if (i18nPath.startsWith('.')) {
      i18nPath = `image-tools.errors${i18nPath}`
    }
    super(i18nPath)
    this.i18nPath = i18nPath
  }
}

export async function readGifRawFrames(buf: Uint8Array): Promise<MemoryImage> {
  const reader = new GifReader(buf)
  const { width, height } = reader
  const loopCount = reader.loopCount()
  const frameCount = reader.numFrames()
  if (!frameCount) {
    throw new TypeError('gif has no frames')
  }
  let image: MemoryImage | null = null
  for (let i = 0; i < frameCount; i++) {
    const raw = Buffer.alloc(width * height * 4)
    reader.decodeAndBlitFrameRGBA(i, raw)
    const info = reader.frameInfo(i)
    const frame = MemoryImage.fromBytes({
      width,
      height,
      bytes: raw.buffer,
      channelOrder: ChannelOrder.rgba,
      frameDuration: info.delay * 10,
    })
    if (!image) {
      frame.loopCount = loopCount
      image = frame
    } else {
      image.addFrame(frame)
    }
  }
  return image!
}

export async function readGif(data: Uint8Array): Promise<MemoryImage> {
  const image = await readGifRawFrames(data)
  const { frames } = image
  const lastCombinedFrame = MemoryImage.from(image, true)
  const finalImage = lastCombinedFrame.clone()
  for (let i = 1; i < frames.length; i += 1) {
    const frame = frames[i]
    Draw.compositeImage({ src: frame, dst: lastCombinedFrame })
    const cloned = lastCombinedFrame.clone()
    cloned.frameDuration = frame.frameDuration
    finalImage.addFrame(cloned)
  }
  return finalImage
}

export async function readImage(http: HTTP, src: string): Promise<MemoryImage> {
  const blob = await http.get(src, { responseType: 'blob' })
  const data = new Uint8Array(await blob.arrayBuffer())
  if (blob.type === 'image/gif') return readGif(data)
  const img = decodeImageByMimeType({ data, mimeType: blob.type })
  if (!img) throw new TypeError('decode image failed')
  return img
}

export async function canvasSavePng(canvas: Canvas): Promise<Blob> {
  return new Blob([await canvas.toBuffer('image/png')], { type: 'image/png' })
}

export async function canvasSaveGif(
  canvasList: (readonly [Canvas, number])[],
): Promise<Blob> {
  if (!canvasList.length) throw new Error('Empty canvasList')
  const [frame0, ...restFrames] = await Promise.all(
    canvasList.map(async ([c]) => {
      const r = decodePng({ data: await c.toBuffer('image/png') })
      if (!r) throw TypeError('invalid image')
      return r
    }),
  )
  for (let i = 1; i < canvasList.length; i += 1) {
    const frame = restFrames[i - 1]
    const frameDuration = canvasList[i][1]
    frame.frameDuration = frameDuration
    frame0.addFrame(frame)
  }
  const bytes = encodeGif({ image: frame0 })
  return new Blob([bytes], { type: 'image/gif' })
}

export async function imageSavePng(image: MemoryImage): Promise<Blob> {
  const b = encodePng({ image, singleFrame: true })
  return new Blob([b], { type: 'image/png' })
}

export async function imageSaveGif(image: MemoryImage): Promise<Blob> {
  const b = encodeGif({ image })
  return new Blob([b], { type: 'image/gif' })
}

export async function imageSave(image: MemoryImage): Promise<Blob> {
  if (image.hasAnimation) return imageSaveGif(image)
  return imageSavePng(image)
}

export async function gifHelper(
  sv: CanvasService,
  image: MemoryImage,
  process: (img: Image) => Promise<Canvas>,
): Promise<Blob> {
  const processFrame = async (frameRaw: MemoryImage) => {
    const b = encodePng({ image: frameRaw, singleFrame: true })
    const img = await sv.loadImage(b)
    return process(img)
  }
  const frameCanvases = await Promise.all(
    image.frames.map(
      async (v) => [await processFrame(v), v.frameDuration] as const,
    ),
  )
  if (frameCanvases.length > 1) return canvasSaveGif(frameCanvases)
  return canvasSavePng(frameCanvases[0][0])
}

export function ensureAnimation(image: MemoryImage): void {
  if (!image.hasAnimation) throw new OperationError('.image-must-animated')
}

export async function flipHorizontal(image: MemoryImage): Promise<Blob> {
  Transform.flipHorizontal({ image })
  return imageSave(image)
}

export async function flipVertical(image: MemoryImage): Promise<Blob> {
  Transform.flipVertical({ image })
  return imageSave(image)
}

export async function flipBoth(image: MemoryImage): Promise<Blob> {
  Transform.flipHorizontalVertical({ image })
  return imageSave(image)
}

export async function gifSplit(image: MemoryImage): Promise<Blob[]> {
  ensureAnimation(image)
  return Promise.all(image.frames.map((x) => imageSavePng(x)))
}

export async function gifReverse(image: MemoryImage): Promise<Blob> {
  ensureAnimation(image)
  const { frames } = image
  const firstFrame = MemoryImage.from(frames[0], true)
  const newImage = frames[frames.length - 1]
  newImage.frames.push(...frames.slice(1, -1).reverse(), firstFrame)
  return imageSave(newImage)
}
