// 网页插件的宿主一半：本身什么都不做。DSH 从这条记录往上找到最近的 package.json，
// 读其中的 dsh.client 和 ./client 导出，把 client.js 送进浏览器。
export const name = 'casebook-client'

export function apply() {}
