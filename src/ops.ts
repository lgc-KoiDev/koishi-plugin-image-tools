import {
  Filter,
  Interpolation,
  MemoryImage,
  Rectangle,
  Transform,
} from 'image-in-browser'

import { ImageOperationOption } from './commands'
import * as ou from './op-utils'

import type { Skia } from '@lgcnpm/koishi-plugin-skia-canvas'

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
  if (radius && radius < 0) {
    throw new ou.OperationError('.value-too-small', [radius, 0])
  }
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
  if (size && size < 0) {
    throw new ou.OperationError('.value-too-small', [size, 0])
  }
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
  skia: Skia,
  {
    args: [color],
    options: { width, height },
  }: ImageOperationOption<[string], { width?: number; height?: number }>,
): Promise<Blob> {
  const colorTuple = ou.parseColor(color)
  ;[width, height] = ou.checkSize(width, height)
  const canvas = new skia.Canvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = ou.colorTupleToWebColor(colorTuple)
  ctx.fillRect(0, 0, width, height)
  return ou.canvasSavePng(canvas)
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

export async function gifSplit(image: MemoryImage): Promise<Blob[]> {
  ou.ensureAnimation(image)
  return Promise.all(image.frames.map((x) => ou.imageSavePng(x)))
}
