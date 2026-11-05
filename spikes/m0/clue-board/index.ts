// M0 待验证项 2 的宿主一半：本身什么都不做。
// DSH 从这条 Loader 记录往上找到最近的 package.json，读其中的 dsh.client 和 ./client 导出，才会把前端脚本送进浏览器。
export const name = 'casebook-clue-board'

export function apply() {}
