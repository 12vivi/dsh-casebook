// 从玩家输入里找出提到的地点和人物。纯字面匹配，不用模型：
// 叙事要在写正文之前拿到目的地的资料，否则「我去码头看看」这一轮只能凭空描写码头。
import type { CaseFile } from '../case/schema.ts'

export interface Mentions {
  readonly locations: readonly string[]
  readonly npcs: readonly string[]
}

function mentioned(text: string, names: readonly string[]): boolean {
  return names.some(name => name.length > 0 && text.includes(name))
}

/** 按在案卷里的顺序返回提到的地点与人物标识。 */
export function findMentions(caseFile: CaseFile, text: string): Mentions {
  return {
    locations: caseFile.locations.filter(location => mentioned(text, [location.name, ...location.aliases])).map(location => location.id),
    npcs: caseFile.npcs.filter(npc => mentioned(text, [npc.name, npc.role, ...npc.aliases])).map(npc => npc.id),
  }
}

/** 本轮可能前往的地点：输入里提到的、不是当前所在的地点，最多两处。 */
export function lookaheadLocations(caseFile: CaseFile, currentLocation: string, playerInput: string): string[] {
  const { locations, npcs } = findMentions(caseFile, playerInput)
  const targets = new Set(locations)
  // 「去找何先生」也算：提到不在场的人，就把他所在的地点也备上。
  for (const id of npcs) {
    const npc = caseFile.npcs.find(item => item.id === id)
    if (npc !== undefined) targets.add(npc.location)
  }
  targets.delete(currentLocation)
  return [...targets].slice(0, 2)
}
