/**
 * 模型声明来自 `./models/index`（每个模型一个纯数据文件）。
 *
 * 声明文件已经就位，直接静态引入即可：动态 import 的脚手架在源码环境下
 * 会静默返回空数组，让「声明驱动」的表单与工具 schema 拿不到模型。
 */
import type { ModelDeclaration } from '@modelbay/core'
import { all } from './models/index'

/** OpenAI 与 OpenAI 兼容渠道的全部模型声明。 */
export const allModels: ModelDeclaration[] = all
