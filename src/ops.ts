import {
  ColorRgba8,
  Draw,
  Filter,
  Interpolation,
  MemoryImage,
  Rectangle,
  Transform,
} from 'image-in-browser'

import { ImageOperationOption } from './commands'
import * as ou from './op-utils'

import type { Skia } from '@ltxhhz/koishi-plugin-skia-canvas'

export async function flipHorizontal(image: MemoryImage): Promise<Blob> {
  return ou.imageSave(Transform.flipHorizontal({ image }))
}

export async function flipVertical(image: MemoryImage): Promise<Blob> {
  return ou.imageSave(Transform.flipVertical({ image }))
}

export async function flipBoth(image: MemoryImage): Promise<Blob> {
  return ou.imageSave(Transform.flipHorizontalVertical({ image }))
}

export async function grayScale(image: MemoryImage): Promise<Blob> {
  return ou.imageSave(Filter.grayscale({ image }))
}

export async function rotate(
  image: MemoryImage,
  _: Skia,
  { args: [angle] }: ImageOperationOption<[number]>,
): Promise<Blob> {
  image = image.convert({ numChannels: 4 })
  return ou.imageSave(
    Transform.copyRotate({ image, angle, interpolation: Interpolation.cubic }),
  )
}

export async function resize(
  image: MemoryImage,
  _: Skia,
  { args: [size] }: ImageOperationOption<[string]>,
): Promise<Blob> {
  const { width: iw, height: ih } = image
  const [width, height] = ou.matchRegExps<[number, number]>(size, [
    ou.getSizeMatchReg(iw, ih),
    ou.getPercentMatchReg(iw, ih),
  ])
  return ou.imageSave(
    Transform.copyResize({
      image,
      width,
      height,
      interpolation:
        (width ? width <= iw : true) && (height ? height <= ih : true)
          ? Interpolation.nearest
          : Interpolation.cubic,
    }),
  )
}

export async function crop(
  image: MemoryImage,
  _: Skia,
  { args: [size] }: ImageOperationOption<[string]>,
): Promise<Blob> {
  const { width: iw, height: ih } = image
  const [width, height] = ou.matchRegExps<[number, number]>(size, [
    ou.getSizeMatchReg(iw, ih),
    ou.getRatioMatchReg(iw, ih),
  ])
  const x = width > iw ? 0 : (iw - width) / 2
  const y = height > ih ? 0 : (ih - height) / 2
  return ou.imageSave(
    Transform.copyCrop({
      image,
      rect: Rectangle.fromXYWH(x, y, width, height),
      antialias: true,
    }),
  )
}

export async function invert(image: MemoryImage): Promise<Blob> {
  return ou.imageSave(Filter.invert({ image }))
}

export async function contour(image: MemoryImage): Promise<Blob> {
  return ou.imageSave(
    Filter.convolution({
      image,
      div: 1,
      offset: 255,
      // prettier-ignore
      filter: [
        -1, -1, -1,
        -1, 8, -1,
        -1, -1, -1,
      ],
    }),
  )
}

export async function emboss(image: MemoryImage): Promise<Blob> {
  return ou.imageSave(
    Filter.convolution({
      image,
      div: 1,
      offset: 128,
      // prettier-ignore
      filter: [
        -1, 0, 0,
        0, 1, 0,
        0, 0, 0,
      ],
    }),
  )
}

export async function blur(
  image: MemoryImage,
  _: Skia,
  { options: { radius } }: ImageOperationOption<any[], { radius?: number }>,
): Promise<Blob> {
  ou.ensureBigger(radius, 0)
  return ou.imageSave(Filter.gaussianBlur({ image, radius: radius ?? 5 }))
}

export async function sharpen(image: MemoryImage): Promise<Blob> {
  return ou.imageSave(
    Filter.convolution({
      image,
      div: 16,
      offset: 0,
      // prettier-ignore
      filter: [
        -2, -2, -2,
        -2, 32, -2,
        -2, -2, -2,
      ],
    }),
  )
}

export async function pixelate(
  image: MemoryImage,
  _: Skia,
  { options: { size } }: ImageOperationOption<any[], { size?: number }>,
): Promise<Blob> {
  ou.ensureBigger(size, 0)
  return ou.imageSave(Filter.pixelate({ image, size: size ?? 8 }))
}

export async function colorMask(
  image: MemoryImage,
  _: Skia,
  { args: [color] }: ImageOperationOption<[string]>,
): Promise<Blob> {
  const colorTuple = ou.parseColor(color)
  if (colorTuple[3] !== 255) throw new ou.OperationError('.alpha-not-supported')
  return ou.imageSave(ou.colorMaskPilUtils(image, ou.RGBA2RGB(colorTuple)))
}

export async function colorImage(
  _: any,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  __: Skia,
  {
    args: [color],
    options: { width, height },
  }: ImageOperationOption<[string], { width?: number; height?: number }>,
): Promise<Blob> {
  const colorTuple = ou.parseColor(color)
  ;[width, height] = ou.checkSize(width, height)
  const image = new MemoryImage({ width, height, numChannels: 4 })
  image.clear(new ColorRgba8(...colorTuple))
  return ou.imageSave(image)
}

export async function gradientImage(
  _: any,
  skia: Skia,
  {
    args: colors,
    options: { angle, width, height },
  }: ImageOperationOption<
    string[],
    { angle?: string; width?: number; height?: number }
  >,
): Promise<Blob> {
  const colorStrings = colors.map(ou.parseColor).map(ou.colorTupleToWebColor)
  ;[width, height] = ou.checkSize(width, height)
  const angleDeg = angle ? ou.parseAngle(angle) : 0
  const canvas = new skia.Canvas(width, height)
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createLinearGradient(
    ...ou.calcGradientLinePos(angleDeg, width, height),
  )
  const colorLen = colorStrings.length
  for (let i = 0; i < colorLen; i++) {
    gradient.addColorStop(i / (colorLen - 1), colorStrings[i])
  }
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  return ou.canvasSavePng(canvas)
}

export async function gifReverse(image: MemoryImage): Promise<Blob> {
  ou.ensureAnimation(image)
  const { frames } = image
  const firstFrame = MemoryImage.from(frames[0], true)
  const newImage = frames[frames.length - 1]
  newImage.frames.push(...frames.slice(1, -1).reverse(), firstFrame)
  return ou.imageSave(newImage)
}

export async function gifObverseReverse(image: MemoryImage): Promise<Blob> {
  ou.ensureAnimation(image)
  const { frames } = image
  image.frames.push(...frames.slice(1, -1).reverse())
  return ou.imageSave(image)
}

export async function gifChangeFps(
  image: MemoryImage,
  _: Skia,
  {
    args: [fps],
    options: { force },
  }: ImageOperationOption<[string], { force?: boolean }>,
): Promise<Blob> {
  ou.ensureAnimation(image)
  const originalFrameTimes = image.frames.map((v) => v.frameDuration)
  const frameTimes = ou.matchRegExps<number[]>(fps, [
    [
      /^(?<x>\d{0,3}\.?\d{1,3})(x|X|倍速?)$/,
      (match) => {
        const x = parseFloat(match.groups!.x)
        return originalFrameTimes.map((v) => Math.round(v / x))
      },
    ],
    [
      /^(?<p>\d{0,3}\.?\d{1,3})%$/,
      (match) => {
        const p = parseFloat(match.groups!.p) / 100
        return originalFrameTimes.map((v) => Math.round(v / p))
      },
    ],
    [
      /^(?<fps>\d{0,3}\.?\d{1,3})(fps|FPS)$/,
      (match) => {
        const fps = parseFloat(match.groups!.fps)
        const time = Math.round(1000 / fps)
        return originalFrameTimes.map(() => time)
      },
    ],
    [
      /^(?<time>\d{0,3}\.?\d{1,3})(?<m>m)?s$/,
      (match) => {
        const time = parseFloat(match.groups!.time)
        const m = Math.round(match.groups!.m ? time * 1000 : time)
        return originalFrameTimes.map(() => m)
      },
    ],
  ])
  if (!force && frameTimes.some((v) => v < 20)) {
    throw new ou.OperationError('.fps-exceed-range-warn', [
      (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length).toFixed(2),
    ])
  }
  for (let i = 0; i < frameTimes.length; i += 1) {
    image.frames[i].frameDuration = frameTimes[i]
  }
  return ou.imageSave(image)
}

export async function gifSplit(image: MemoryImage): Promise<Blob[]> {
  ou.ensureAnimation(image)
  return Promise.all(image.frames.map((x) => ou.imageSavePng(x)))
}

export async function gifJoin(
  images: MemoryImage[],
  _: Skia,
  {
    options: { duration, force },
  }: ImageOperationOption<any[], { duration?: number; force?: boolean }>,
): Promise<Blob> {
  ou.ensureBigger(duration, 0)
  duration ??= 100
  if (!force && duration < 20) {
    throw new ou.OperationError('.fps-exceed-range-warn', [duration])
  }
  const frames = images.map((v) => v.frames).flat()
  ou.ensureMinImageNum(frames)

  const width = frames.map((v) => v.width).reduce((a, b) => Math.max(a, b))
  const height = frames.map((v) => v.height).reduce((a, b) => Math.max(a, b))
  let newImage: MemoryImage | null = null
  for (const f of frames) {
    const noFrameF = MemoryImage.from(f, true).convert({ numChannels: 4 })
    const fSized = (() => {
      if (width === f.width && height === f.height) return noFrameF
      const scale = Math.min(width / f.width, height / f.height)
      const scaleWidth = Math.round(f.width * scale)
      const scaleHeight = Math.round(f.height * scale)
      return Draw.compositeImage({
        src: Transform.copyResize({
          width: scaleWidth,
          height: scaleHeight,
          image: noFrameF,
          interpolation: Interpolation.cubic,
        }),
        dst: new MemoryImage({ width, height, numChannels: 4 }),
        center: true,
      })
    })()
    fSized.frameDuration = duration
    if (newImage) {
      newImage.addFrame(fSized)
    } else {
      newImage = fSized
    }
  }
  return ou.imageSave(newImage!)
}

export async function fourGrid(image: MemoryImage): Promise<Blob[]> {
  return ou.cropToGrids(image, (w) => {
    const a = Math.ceil(w / 2)
    return [
      [0, 0, a, a],
      [a, 0, a * 2, a],
      [0, a, a, a * 2],
      [a, a, a * 2, a * 2],
    ]
  })
}

export async function nineGrid(image: MemoryImage): Promise<Blob[]> {
  return ou.cropToGrids(image, (w) => {
    const a = Math.ceil(w / 3)
    return [
      [0, 0, a, a],
      [a, 0, a * 2, a],
      [a * 2, 0, w, a],
      [0, a, a, a * 2],
      [a, a, a * 2, a * 2],
      [a * 2, a, w, a * 2],
      [0, a * 2, a, w],
      [a, a * 2, a * 2, w],
      [a * 2, a * 2, w, w],
    ]
  })
}

export async function horizontalJoin(
  images: MemoryImage[],
  _: Skia,
  {
    options: { spacing, bgColor, force },
  }: ImageOperationOption<
    any[],
    { spacing?: number; bgColor?: string; force?: boolean }
  >,
): Promise<Blob> {
  ou.ensureMinImageNum(images)
  ou.warnAnimation(images, force)
  spacing ??= 10
  const bgColorObj = new ColorRgba8(
    ...(bgColor ? ou.parseColor(bgColor) : ([0, 0, 0, 0] as ou.RGBAColorTuple)),
  )

  const height = Math.max(...images.map((v) => v.height))
  const imagesNew = images.map((v) =>
    Transform.copyResize({ image: v, height }),
  )
  const width = imagesNew.reduce((a, b) => a + b.width + spacing, 0) - spacing
  const finalImg = new MemoryImage({ width, height, numChannels: 4 })
  finalImg.clear(bgColorObj)
  let offsetX = 0
  imagesNew.forEach((v, i) => {
    Draw.compositeImage({ src: v, dst: finalImg, dstX: offsetX })
    offsetX += v.width + spacing
  })
  return ou.imageSave(finalImg)
}

export async function verticalJoin(
  images: MemoryImage[],
  _: Skia,
  {
    options: { spacing, bgColor, force },
  }: ImageOperationOption<
    any[],
    { spacing?: number; bgColor?: string; force?: boolean }
  >,
): Promise<Blob> {
  ou.ensureMinImageNum(images)
  ou.warnAnimation(images, force)
  spacing ??= 10
  const bgColorObj = new ColorRgba8(
    ...(bgColor ? ou.parseColor(bgColor) : ([0, 0, 0, 0] as ou.RGBAColorTuple)),
  )

  const width = Math.max(...images.map((v) => v.width))
  const imagesNew = images.map((v) => Transform.copyResize({ image: v, width }))
  const height = imagesNew.reduce((a, b) => a + b.height + spacing, 0) - spacing
  const finalImg = new MemoryImage({ width, height, numChannels: 4 })
  finalImg.clear(bgColorObj)
  let offsetY = 0
  imagesNew.forEach((v, i) => {
    Draw.compositeImage({ src: v, dst: finalImg, dstY: offsetY })
    offsetY += v.height + spacing
  })
  return ou.imageSave(finalImg)
}
