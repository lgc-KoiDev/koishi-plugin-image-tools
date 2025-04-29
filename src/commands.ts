import type { Skia } from '@ltxhhz/koishi-plugin-skia-canvas'
import { MemoryImage } from 'image-in-browser'
import { Command } from 'koishi'

import * as ops from './ops'

export interface ImageCommandBase {
  name: string
  aliases?: string[]
  args?: (string | Parameters<Command['alias']>)[]
  options?: Parameters<Command['option']>[]
}

export interface ImageOperationOption<
  A extends readonly any[] = any[],
  O extends Record<string, any> = any,
> {
  args: A
  options: O
}

export interface IgnoreImageCommand extends ImageCommandBase {
  ignoreImages: true
  func: (
    _: any,
    canvasSv: Skia,
    options: ImageOperationOption<any, any>,
  ) => Promise<Blob | Blob[]>
}

export interface SingleImageCommand extends ImageCommandBase {
  multiImages?: false
  func: (
    image: MemoryImage,
    canvasSv: Skia,
    options: ImageOperationOption<any, any>,
  ) => Promise<Blob | Blob[]>
}

export interface MultiImageCommand extends ImageCommandBase {
  multiImages: true
  func: (
    images: MemoryImage[],
    canvasSv: Skia,
    options: ImageOperationOption<any, any>,
  ) => Promise<Blob | Blob[]>
}

export type AcceptImageCommand = SingleImageCommand | MultiImageCommand
export type ImageCommand = IgnoreImageCommand | AcceptImageCommand

export const registeredCommands: ImageCommand[] = [
  {
    name: 'flip-h',
    aliases: ['水平翻转', '左翻', '右翻'],
    func: ops.flipHorizontal,
  },
  {
    name: 'flip-v',
    aliases: ['竖直翻转', '上翻', '下翻'],
    func: ops.flipVertical,
  },
  {
    name: 'flip',
    aliases: ['双向翻转'],
    func: ops.flipBoth,
  },
  {
    name: 'gray',
    aliases: ['灰度图', '黑白'],
    func: ops.grayScale,
  },
  {
    name: 'rotate',
    aliases: ['旋转'],
    args: ['<angle:number>'],
    func: ops.rotate,
  },
  {
    name: 'resize',
    aliases: ['缩放'],
    args: ['<size:string>'],
    func: ops.resize,
  },
  {
    name: 'crop',
    aliases: ['裁剪'],
    args: ['<size:string>'],
    func: ops.crop,
  },
  {
    name: 'invert',
    aliases: ['反相', '反色'],
    func: ops.invert,
  },
  {
    name: 'contour',
    aliases: ['轮廓'],
    func: ops.contour,
  },
  {
    name: 'emboss',
    aliases: ['浮雕'],
    func: ops.emboss,
  },
  {
    name: 'blur',
    aliases: ['模糊'],
    options: [['radius', '-r [radius:number]']],
    func: ops.blur,
  },
  {
    name: 'sharpen',
    aliases: ['锐化'],
    func: ops.sharpen,
  },
  {
    name: 'pixelate',
    aliases: ['像素化'],
    options: [['size', '-s [size:number]']],
    func: ops.pixelate,
  },
  {
    name: 'color-mask',
    aliases: ['颜色滤镜'],
    args: ['<color:string>'],
    func: ops.colorMask,
  },
  {
    name: 'color-image',
    aliases: ['纯色图'],
    args: ['<color:string>'],
    options: [
      ['width', '-W [width:number]'],
      ['height', '-H [height:number]'],
    ],
    ignoreImages: true,
    func: ops.colorImage,
  },
  {
    name: 'gradient-image',
    aliases: ['渐变图'],
    args: ['<...colors:string>'],
    options: [
      ['angle', '-a [angle:string]'],
      ['width', '-W [width:number]'],
      ['height', '-H [height:number]'],
    ],
    ignoreImages: true,
    func: ops.gradientImage,
  },
  {
    name: 'gif-rev',
    aliases: ['gif倒放', 'GIF倒放', '倒放'],
    func: ops.gifReverse,
  },
  {
    name: 'gif-obv-rev',
    aliases: ['gif正放倒放', 'GIF正放倒放', '正放倒放'],
    func: ops.gifObverseReverse,
  },
  {
    name: 'gif-change-fps',
    aliases: ['gif变速', 'GIF变速', '变速'],
    args: ['<fps:string>'],
    options: [['force', '-f [force:boolean]']],
    func: ops.gifChangeFps,
  },
  {
    name: 'gif-split',
    aliases: ['gif分解', '分解'],
    func: ops.gifSplit,
  },
  {
    name: 'gif-join',
    aliases: ['gif合成', 'GIF合成', '合成'],
    options: [
      ['duration', '-d [duration:number]'],
      ['force', '-f [force:boolean]'],
    ],
    multiImages: true,
    func: ops.gifJoin,
  },
  {
    name: 'four-grid',
    aliases: ['四宫格'],
    func: ops.fourGrid,
  },
  {
    name: 'nine-grid',
    aliases: ['九宫格'],
    func: ops.nineGrid,
  },
  {
    name: 'h-join',
    aliases: ['横向拼接', '水平拼接'],
    options: [
      ['spacing', '-s [spacing:number]'],
      ['bgColor', '-c [bgColor:string]'],
      ['force', '-f [force:boolean]'],
    ],
    multiImages: true,
    func: ops.horizontalJoin,
  },
  {
    name: 'v-join',
    aliases: ['纵向拼接', '垂直拼接'],
    options: [
      ['spacing', '-s [spacing:number]'],
      ['bgColor', '-c [bgColor:string]'],
      ['force', '-f [force:boolean]'],
    ],
    multiImages: true,
    func: ops.verticalJoin,
  },
]
