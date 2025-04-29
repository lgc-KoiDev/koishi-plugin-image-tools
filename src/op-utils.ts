import type { Canvas, Image, Skia } from '@ltxhhz/koishi-plugin-skia-canvas'
import {
  ChannelOrder,
  ColorUtils,
  MemoryImage,
  Rectangle,
  Transform,
  decodeImageByMimeType,
  decodePng,
  encodePng,
} from 'image-in-browser'
import { HTTP } from 'koishi'
import * as gif from 'modern-gif'

import { name } from './utils'

export class OperationError extends Error {
  readonly name = 'OperationError'
  readonly i18nPath: string

  constructor(
    i18nPath: string,
    public readonly i18nParams: any[] = [],
  ) {
    if (i18nPath.startsWith('.')) {
      i18nPath = `${name}.errors${i18nPath}`
    } else if (i18nPath.startsWith('^')) {
      i18nPath = i18nPath.replace('^', '.')
    }
    super(i18nPath)
    this.i18nPath = i18nPath
  }
}

export async function readGif(buf: ArrayBuffer): Promise<MemoryImage> {
  const gifFile = gif.decode(buf)
  const frames = gif.decodeFrames(buf, { gif: gifFile })
  if (!frames.length) throw new TypeError('gif has no frames')
  let image: MemoryImage | null = null
  for (const { width, height, delay, data } of frames) {
    const frame = MemoryImage.fromBytes({
      width,
      height,
      frameDuration: delay,
      bytes: data,
      channelOrder: ChannelOrder.rgba,
    })
    if (image) {
      image.addFrame(frame)
    } else {
      image = frame
    }
  }
  return image!
}

export async function readImage(http: HTTP, src: string): Promise<MemoryImage> {
  const blob = await http.get(src, { responseType: 'blob' })
  const buf = await blob.arrayBuffer()
  if (blob.type === 'image/gif') return readGif(buf)
  const img = decodeImageByMimeType({
    data: new Uint8Array(buf),
    mimeType: blob.type,
  })
  if (!img) throw new TypeError('decode image failed')
  return img
}

export async function imageSavePng(image: MemoryImage): Promise<Blob> {
  const b = encodePng({ image, singleFrame: true })
  return new Blob([b], { type: 'image/png' })
}

export async function imageSaveGif(image: MemoryImage): Promise<Blob> {
  const { width, height } = image
  return gif.encode({
    format: 'blob',
    width,
    height,
    frames: image.frames.map((f) => ({
      data: f.getBytes({ order: ChannelOrder.rgba })!,
      delay: f.frameDuration,
    })),
  })
}

export async function imageSave(image: MemoryImage): Promise<Blob> {
  if (image.hasAnimation) return imageSaveGif(image)
  return imageSavePng(image)
}

export async function canvasSavePng(canvas: Canvas): Promise<Blob> {
  return new Blob([await canvas.toBuffer('png')], { type: 'image/png' })
}

export async function canvasSaveGif(
  canvasList: (readonly [Canvas, number])[],
): Promise<Blob> {
  if (!canvasList.length) throw new Error('Empty canvasList')
  const [frame0, ...restFrames] = await Promise.all(
    canvasList.map(async ([c]) => {
      const r = decodePng({ data: await c.toBuffer('png') })
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
  return imageSaveGif(frame0)
}

export async function gifHelper(
  sv: Skia,
  image: MemoryImage,
  process: (img: Image) => Promise<Canvas>,
): Promise<Blob> {
  const processFrame = async (frameRaw: MemoryImage) => {
    const b = encodePng({ image: frameRaw, singleFrame: true })
    const img = await sv.loadImage(Buffer.from(b))
    return process(img)
  }
  const frameCanvases = await Promise.all(
    image.frames.map(async (v) => [await processFrame(v), v.frameDuration] as const),
  )
  if (frameCanvases.length > 1) return canvasSaveGif(frameCanvases)
  return canvasSavePng(frameCanvases[0][0])
}

export function ensureAnimation(image: MemoryImage): void {
  if (!image.hasAnimation) throw new OperationError('.image-must-animated')
}

export function ensureMinImageNum(images: MemoryImage[], num: number = 2) {
  if (images.length < num) {
    throw new OperationError('.image-not-enough', [num])
  }
}

export function warnAnimation(images: MemoryImage[], optForce?: boolean) {
  if (!optForce && images.some((v) => v.hasAnimation)) {
    throw new OperationError('.image-animated-warn')
  }
}

export function ensureBigger(value: number | undefined, min: number) {
  if (value !== undefined && value < min) {
    throw new OperationError('.value-too-small', [value, min])
  }
}

export function matchRegExps<
  T,
  R extends RegExp = RegExp,
  F extends (r: RegExpExecArray) => T = (r: RegExpExecArray) => T,
>(str: string, regexps: (readonly [R, F])[], errorThrower?: () => never): T {
  for (const [r, f] of regexps) {
    const m = r.exec(str)
    if (!m) continue
    return f(m)
  }
  if (errorThrower) errorThrower()
  throw new OperationError('.invalid-arg-format')
}

export const getSizeMatchReg = (width: number, height: number) =>
  [
    /^(?<w>(\d{1,4})?)[*xX, ](?<h>(\d{1,4})?)$/,
    (res: RegExpExecArray): [number, number] => {
      const { w, h } = res.groups!
      const wN = w ? parseInt(w) : width
      const hN = h ? parseInt(h) : height
      if (wN <= 0 || hN <= 0) throw new OperationError('.invalid-arg-format')
      return [wN, hN]
    },
  ] as const
export const getPercentMatchReg = (width: number, height: number) =>
  [
    /^(?<p>\d{1,3})%$/,
    (res: RegExpExecArray): [number, number] => {
      const p = parseInt(res.groups!.p)
      if (p <= 0) throw new OperationError('.invalid-arg-format')
      const pp = p / 100
      return [Math.floor(width * pp), Math.floor(height * pp)]
    },
  ] as const
export const getRatioMatchReg = (width: number, height: number) =>
  [
    /^(?<pw>\d{1,2})[:：比](?<ph>\d{1,2})$/,
    (res: RegExpExecArray): [number, number] => {
      const pw = parseInt(res.groups!.pw)
      const ph = parseInt(res.groups!.ph)
      if (pw <= 0 || ph <= 0) throw new OperationError('.invalid-arg-format')
      const size = Math.min(width / pw, width / ph)
      return [Math.floor(pw * size), Math.floor(ph * size)]
    },
  ] as const

export type RGBColorTuple = [number, number, number]
export type RGBAColorTuple = [number, number, number, number]
export type ColorTuple = RGBColorTuple | RGBAColorTuple

export function RGBA2RGB(rgba: RGBAColorTuple): RGBColorTuple {
  return rgba.slice(0, 3) as any
}

export function RGB2RGBA(rgb: RGBColorTuple): RGBAColorTuple {
  return [...rgb, 255]
}

export function colorTupleToWebColor(color: ColorTuple): string {
  if (color.length === 4) {
    return `rgba(${[...color.slice(0, 3), color[3] / 255].join(', ')})`
  }
  return `rgb(${color.join(', ')})`
}

export function parseColor(color: string): RGBAColorTuple {
  const errorThrower = () => {
    throw new OperationError('.invalid-color', [color])
  }
  return matchRegExps(
    color,
    [
      [
        /^#?(?<hex>(?:[0-9a-fA-F]{3,4}){1,2})$/,
        (match) => {
          const { hex } = match.groups!
          if (hex.length < 6) {
            const parseOneCharHex = (hex: string) => parseInt(hex.repeat(2), 16)
            return [
              parseOneCharHex(hex[0]),
              parseOneCharHex(hex[1]),
              parseOneCharHex(hex[2]),
              hex.length === 4 ? parseOneCharHex(hex[3]) : 255,
            ]
          }
          return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
            hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255,
          ]
        },
      ],
      [
        /^(rgba?)?\(?(?<r>\d{1,3})[,\s](?<g>\d{1,3})[,\s](?<b>\d{1,3})([,\s](?<a>\d{1,3}(\.\d)?))?\)?$/,
        (match) => {
          const checkVal = (val: number) => {
            if (val < 0 || val > 255) errorThrower()
            return val
          }
          const parsedA = match.groups!.a ? parseFloat(match.groups!.a) : null
          return [
            checkVal(parseInt(match.groups!.r)),
            checkVal(parseInt(match.groups!.g)),
            checkVal(parseInt(match.groups!.b)),
            parsedA ? checkVal(parsedA < 1 ? parsedA * 255 : parsedA) : 255,
          ]
        },
      ],
    ],
    errorThrower,
  )
}

export function parseAngle(angle: string): number {
  if (['上下', '竖直'].includes(angle)) return 90
  if (['左右', '水平'].includes(angle)) return 0
  const num = parseInt(angle)
  if (!Number.isNaN(num) && num >= 0 && num <= 360) return num
  throw new OperationError('.invalid-angle', [angle])
}

export interface CheckSizeOptions {
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  defaultWidth?: number
  defaultHeight?: number
}
export function checkSize(
  width: number | undefined,
  height: number | undefined,
  options?: CheckSizeOptions,
): [number, number] {
  width ??= options?.defaultWidth ?? 500
  height ??= options?.defaultHeight ?? 500
  const minWidth = options?.minWidth ?? 1
  const minHeight = options?.minHeight ?? 1
  const maxWidth = options?.maxWidth ?? 1920
  const maxHeight = options?.maxHeight ?? 1920
  if (width < minWidth || width > maxWidth) {
    throw new OperationError('.invalid-range', [width, minWidth, maxWidth])
  }
  if (height < minHeight || height > maxHeight) {
    throw new OperationError('.invalid-range', [height, minHeight, maxHeight])
  }
  return [width, height]
}

// gpt
export function calcGradientLinePos(
  angleDeg: number,
  width: number,
  height: number,
): [number, number, number, number] {
  const angleRad = (angleDeg * Math.PI) / 180
  const halfWidth = width / 2
  const halfHeight = height / 2

  // Calculate the endpoints of the gradient line
  let x0, y0, x1, y1

  // Determine the positions based on angle
  if (angleDeg % 180 === 0) {
    // Horizontal lines
    x0 = -halfWidth
    x1 = halfWidth
    y0 = y1 = 0
  } else if (angleDeg % 180 === 90) {
    // Vertical lines
    y0 = -halfHeight
    y1 = halfHeight
    x0 = x1 = 0
  } else {
    // Diagonal lines, we need to find intersection points
    const tanAngle = Math.tan(angleRad)
    const interceptWidth = halfWidth * tanAngle
    const interceptHeight = halfHeight / tanAngle

    if (angleDeg > 0 && angleDeg < 180) {
      x0 = -halfWidth
      y0 = -interceptWidth
      x1 = halfWidth
      y1 = interceptWidth
    } else {
      x0 = halfWidth
      y0 = -interceptWidth
      x1 = -halfWidth
      y1 = interceptWidth
    }

    if (Math.abs(tanAngle) > height / width) {
      if (angleDeg < 90 || (angleDeg > 180 && angleDeg < 270)) {
        x0 = interceptHeight
        y0 = -halfHeight
        x1 = -interceptHeight
        y1 = halfHeight
      } else {
        x0 = -interceptHeight
        y0 = halfHeight
        x1 = interceptHeight
        y1 = -halfHeight
      }
    }
  }

  return [x0 + halfWidth, y0 + halfHeight, x1 + halfWidth, y1 + halfHeight]
}

// gpt & bing
// export function usePillowFilter(
//   image: MemoryImage,
//   range: [number, number],
//   div: number,
//   offset: number,
//   kernel: number[][],
// ) {
//   const { width, height } = image
//   const [kxTotal, kyTotal] = range

//   if (kxTotal % 2 !== 1 || kyTotal % 2 !== 1) {
//     throw new TypeError('Invalid kernel range')
//   }

//   const kxHalf = Math.floor(kxTotal / 2)
//   const kyHalf = Math.floor(kyTotal / 2)

//   const procColorVal = (val: number) =>
//     Math.max(0, Math.min(255, Math.round(val / div + offset)))

//   const processFrame = (frame: MemoryImage) => {
//     const newImage = new MemoryImage({
//       width,
//       height,
//       frameDuration: frame.frameDuration,
//       numChannels: 4,
//     })

//     for (let y = 0; y < height; y++) {
//       for (let x = 0; x < width; x++) {
//         const a = frame.getPixel(x, y).a
//         if (!a) {
//           newImage.setPixelRgba(x, y, 0, 0, 0, 0)
//           continue
//         }

//         let r = 0
//         let g = 0
//         let b = 0
//         for (let ky = -kyHalf; ky <= kyHalf; ky++) {
//           for (let kx = -kxHalf; kx <= kxHalf; kx++) {
//             const na = frame.getPixel(x, y).aNormalized
//             if (!na) continue
//             const nx = x + kx
//             const ny = y + ky
//             if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
//               const pixel = frame.getPixel(nx, ny)
//               const weight = kernel[ky + kyHalf][kx + kxHalf]
//               r += pixel.r * na * weight
//               g += pixel.g * na * weight
//               b += pixel.b * na * weight
//             }
//           }
//         }
//         newImage.setPixelRgba(
//           x,
//           y,
//           procColorVal(r),
//           procColorVal(g),
//           procColorVal(b),
//           a,
//         )
//       }
//     }
//     return newImage
//   }

//   const newImage = processFrame(image)
//   for (const f of image.frames.slice(1)) {
//     newImage.addFrame(processFrame(f))
//   }
//   return newImage
// }

// gpt
export function colorMaskPilUtils(image: MemoryImage, color: [number, number, number]) {
  const { width, height } = image
  const [r, g, b] = color
  const rgbSum = r + g + b

  const processFrame = (frame: MemoryImage) => {
    const newImage = new MemoryImage({
      width,
      height,
      frameDuration: image.frameDuration,
      numChannels: 4,
    })

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = frame.getPixel(x, y)
        if (!pixel.a) {
          newImage.setPixelRgba(x, y, 0, 0, 0, 0)
          continue
        }
        // Calculate new color based on grayValue and target color
        const grayValue = ColorUtils.getLuminanceRgb(pixel.r, pixel.g, pixel.b)
        const newColor: [number, number, number] = rgbSum
          ? [
              Math.round((grayValue * r) / rgbSum),
              Math.round((grayValue * g) / rgbSum),
              Math.round((grayValue * b) / rgbSum),
            ]
          : [0, 0, 0]
        newImage.setPixelRgba(x, y, ...newColor, pixel.a)
      }
    }

    // Convert the new image to HSL and adjust hue
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = newImage.getPixel(x, y)
        if (!pixel.a) {
          newImage.setPixelRgba(x, y, 0, 0, 0, 0)
          continue
        }
        const [h, s] = ColorUtils.rgbToHsl(pixel.r, pixel.g, pixel.b)
        const originalPixel = frame.getPixel(x, y)
        const [, , originalL] = ColorUtils.rgbToHsl(
          originalPixel.r,
          originalPixel.g,
          originalPixel.b,
        )
        // Combine the new hue with the original lightness and saturation
        const [newR, newG, newB] = ColorUtils.hslToRgb(h, s, originalL)
        newImage.setPixelRgb(x, y, newR, newG, newB)
      }
    }

    return newImage
  }

  const newImage = processFrame(image)
  for (const f of image.frames.slice(1)) {
    newImage.addFrame(processFrame(f))
  }
  return newImage
}

export type GridBox = [number, number, number, number]
export function cropToGrids(
  image: MemoryImage,
  boxes: GridBox[] | ((size: number) => GridBox[]),
) {
  const size = Math.min(image.width, image.height)
  image = Transform.copyResizeCropSquare({ image, size })
  if (boxes instanceof Function) boxes = boxes(size)
  const imgs = boxes.map(([x, y, w, h]) =>
    Transform.copyCrop({ image, rect: new Rectangle(x, y, w, h) }),
  )
  return Promise.all(imgs.map((v) => imageSave(v)))
}
