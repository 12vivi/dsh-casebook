// M0 待验证项 2：在 DSH Web 右侧栏加一个「线索板」页签。
// DSH 0.2.1-rc.5 的前端插件是一段普通脚本，交给 window.__ModuleLoader__ 加载，不需要打包；
// require 只能拿到宿主内置的模块（React 18 等）。模块 id 必须等于 package.json 的 name。
window.__ModuleLoader__.load({
  id: 'dsh-casebook-m0-clue-board',
  factory(require) {
    const h = require('react').createElement
    const TAB_ID = 'dsh-casebook-m0-clue-board/clues'

    function ClueBoard() {
      return h('div', { style: { padding: 12, fontSize: 13, lineHeight: 1.6 } },
        h('div', { style: { fontWeight: 600, marginBottom: 8 } }, '线索板（M0 测试）'),
        h('ul', { style: { margin: 0, paddingLeft: 18 } },
          h('li', null, '窗台上有半个湿脚印'),
          h('li', null, '管家说九点在码头')))
    }

    return {
      inject: ['slots', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: 'casebook-clues',
          title: () => '线索板',
          guide: [{ id: 'casebook-clues', order: 50, title: () => '线索板' }],
          keepMounted: true,
        }))
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, ClueBoard))
      },
    }
  },
})
