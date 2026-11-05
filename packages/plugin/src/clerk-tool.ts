// 书记员唯一的工具：submit_effects。参数里的标识用案卷里的枚举值限定，DSH 先挡掉格式明显不对的调用；
// 真正的四道校验在领域层（effects.ts）做。
import type { CaseFile } from '../../domain/src/index.ts'
import { ACTION_TYPES } from '../../domain/src/index.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'

const quote = { type: 'string', description: '从本轮正文里原样复制的一段连续文字，去掉标点后至少 4 个字' } as const

export function submitEffectsTool(caseFile: CaseFile, handle: (args: unknown) => string) {
  const clues = caseFile.clues.map(clue => clue.id)
  const npcs = caseFile.npcs.map(npc => npc.id)
  const locations = caseFile.locations.map(location => location.id)
  return defineTool({
    name: 'submit_effects',
    description: '提交本轮结算：行动类别、移动、发现的线索、态度变化和口供。每一项都要引用本轮正文的原句。被驳回时按意见改正后再提交。',
    parameters: {
      action: {
        type: 'string',
        enum: ACTION_TYPES,
        required: true,
        description: '侦探这一轮的主要行动：search 调查、interrogate 审问、present 出示证据、think 整理推理、move 只是走路、other 其他',
      },
      move: {
        type: 'object',
        description: '侦探这一轮结束时到了另一个地点才填；没移动就不填',
        properties: {
          to: { type: 'string', enum: locations, required: true, description: '目的地的地点标识' },
          quote: { ...quote, required: true },
        },
        additionalProperties: false,
      },
      discoveries: {
        type: 'array',
        description: '本轮正文里侦探确实看到或听到内容的候选线索',
        items: {
          type: 'object',
          properties: {
            clue: { type: 'string', enum: clues, required: true },
            quote: { ...quote, required: true },
          },
          additionalProperties: false,
        },
      },
      attitudes: {
        type: 'array',
        description: '正文明确写出的态度变化，同一人一轮最多一次',
        items: {
          type: 'object',
          properties: {
            npc: { type: 'string', enum: npcs, required: true },
            delta: { type: 'integer', enum: [-1, 1], required: true },
            reason: { type: 'string', required: true, description: '一句话原因' },
            quote: { ...quote, required: true },
          },
          additionalProperties: false,
        },
      },
      testimonies: {
        type: 'array',
        description: '人物本轮说出的、对破案可能有用的原话，最多 5 条',
        items: {
          type: 'object',
          properties: {
            npc: { type: 'string', enum: npcs, required: true },
            quote: { ...quote, required: true },
          },
          additionalProperties: false,
        },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return handle(args)
    },
  })
}
