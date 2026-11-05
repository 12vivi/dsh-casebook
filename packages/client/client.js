// 雾港案卷：右侧栏「线索板」页签。
// 普通脚本，交给 window.__ModuleLoader__ 加载，不打包；require 只能拿到宿主内置的模块（React 18、ui-primitives 等）。
// 数据走宿主插件注册的 /api/casebook.* 路由：页签可见时每 1.5 秒拉一次线索板，指认和重试用 POST。
// 线索板只显示玩家已经知道的东西（L1）；真相只在结案后随判定结果一起返回。
window.__ModuleLoader__.load({
  id: 'dsh-casebook-client',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React
    let P = {}
    try {
      P = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch {
      P = {}
    }

    const TAB_ID = 'dsh-casebook-client/board'
    const POLL_MS = 1500
    const KIND_LABELS = { physical: '物证', document: '书证', testimony: '证词' }
    const muted = { opacity: 0.65 }
    const line = 'rgba(127, 127, 127, 0.25)'

    async function api(path, init) {
      const response = await fetch(path, { cache: 'no-store', ...init })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return response.json()
    }

    function post(path, body) {
      return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    }

    function Button(props) {
      if (P.Button !== undefined) return h(P.Button, { variant: props.primary ? 'primary' : 'outline', size: 'sm', disabled: props.disabled, onClick: props.onClick }, props.children)
      return h('button', { type: 'button', disabled: props.disabled, onClick: props.onClick, style: { padding: '4px 10px', cursor: 'pointer' } }, props.children)
    }

    function Section(props) {
      return h('section', { style: { borderTop: `1px solid ${line}`, padding: '10px 0' } },
        h('div', { style: { fontWeight: 600, marginBottom: 6, display: 'flex', justifyContent: 'space-between' } },
          h('span', null, props.title),
          props.extra === undefined ? null : h('span', { style: { ...muted, fontWeight: 400, fontSize: 12 } }, props.extra)),
        props.children)
    }

    function Badge(props) {
      return h('span', {
        style: {
          fontSize: 11, padding: '0 6px', marginLeft: 6, borderRadius: 8, border: `1px solid ${line}`,
          ...(props.accent ? { background: 'rgba(255, 170, 0, 0.18)', borderColor: 'rgba(255, 170, 0, 0.5)' } : {}),
        },
      }, props.children)
    }

    function percent(value) {
      return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`
    }

    function Settlement({ board, busy, onRetry }) {
      const s = board.settlement
      if (s.state === 'pending') {
        return h('div', { style: { fontSize: 12, padding: '6px 8px', borderRadius: 6, background: 'rgba(127,127,127,0.12)' } },
          busy ? `书记员正在结算第 ${s.revision} 轮…` : `第 ${s.revision} 轮等待结算…`)
      }
      if (s.state === 'failed') {
        return h('div', { style: { fontSize: 12, padding: '6px 8px', borderRadius: 6, background: 'rgba(255, 80, 80, 0.12)', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' } },
          h('span', null, `第 ${s.revision} 轮结算失败：${s.message ?? '原因不明'}。这一轮的发现没有记上。`),
          board.status === 'investigating' ? h(Button, { onClick: onRetry }, '重新结算') : null)
      }
      return null
    }

    function ClueList({ clues }) {
      const [open, setOpen] = useState({})
      if (clues.length === 0) return h('div', { style: { ...muted, fontSize: 12 } }, '还没有发现线索。')
      return h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } }, clues.map(clue =>
        h('li', { key: clue.id, style: { marginBottom: 6 } },
          h('div', { style: { cursor: 'pointer' }, onClick: () => setOpen(prev => ({ ...prev, [clue.id]: !prev[clue.id] })) },
            h('span', null, open[clue.id] ? '▾ ' : '▸ '),
            h('span', { style: { fontWeight: 500 } }, clue.name),
            h(Badge, null, KIND_LABELS[clue.kind] ?? clue.kind),
            clue.isNew ? h(Badge, { accent: true }, '新') : null,
            h('span', { style: { ...muted, fontSize: 11, marginLeft: 6 } }, `第 ${clue.revision} 轮`)),
          open[clue.id] ? h('div', { style: { fontSize: 12, lineHeight: 1.7, margin: '4px 0 0 14px', ...muted } }, clue.appearance) : null)))
    }

    function Verdict({ verdict }) {
      const ok = verdict.correctCulprit
      return h('div', { style: { padding: 10, borderRadius: 8, border: `1px solid ${line}`, marginBottom: 10, background: ok ? 'rgba(60, 180, 90, 0.10)' : 'rgba(255, 80, 80, 0.10)' } },
        h('div', { style: { fontSize: 16, fontWeight: 700 } }, `结案：${verdict.grade} · ${verdict.score} 分`),
        h('div', { style: { margin: '6px 0' } }, ok
          ? `你指认了${verdict.culprit.accused}，指认正确。`
          : `你指认了${verdict.culprit.accused}，指认错了：真正的凶手是${verdict.culprit.actual}。`),
        h('div', { style: { fontSize: 12, ...muted } }, `用了 ${verdict.turns} 轮，游戏内 ${verdict.minutesUsed} 分钟。出示的证据：${verdict.evidence.map(item => item.name).join('、')}`),
        h('div', { style: { fontWeight: 600, marginTop: 10 } }, '证据链'),
        h('ul', { style: { margin: '4px 0', paddingLeft: 18, fontSize: 12 } }, verdict.proofDetails.map(proof =>
          h('li', { key: proof.id }, `${proof.coveredBy === null ? '✗' : '✓'} ${proof.label}`,
            proof.coveredBy === null
              ? h('span', { style: muted }, `（可用：${proof.acceptable.join('、')}）`)
              : h('span', { style: muted }, `（${proof.coveredByName}）`)))),
        h('div', { style: { fontWeight: 600, marginTop: 8 } }, '推理题'),
        h('ul', { style: { margin: '4px 0', paddingLeft: 18, fontSize: 12 } }, verdict.questionDetails.map(question =>
          h('li', { key: question.prompt }, `${question.correct ? '✓' : '✗'} ${question.prompt}`,
            h('div', { style: muted }, `你的回答：${question.chosenText}`),
            question.correct ? null : h('div', { style: muted }, `答案：${question.answerText}`)))),
        h('details', { style: { marginTop: 8 } },
          h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '真相复盘'),
          h('div', { style: { whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.8, marginTop: 6 } }, verdict.reveal.text),
          h('div', { style: { fontWeight: 600, marginTop: 8, fontSize: 12 } }, '真实时间线'),
          h('ul', { style: { margin: '4px 0', paddingLeft: 18, fontSize: 12 } }, verdict.reveal.timeline.map((item, index) =>
            h('li', { key: index }, `${item.time}　${item.event}`)))))
    }

    function AccuseForm({ board, sessionId, onDone, onCancel }) {
      const [culprit, setCulprit] = useState('')
      const [evidence, setEvidence] = useState([])
      const [answers, setAnswers] = useState({})
      const [errors, setErrors] = useState([])
      const [busy, setBusy] = useState(false)
      const toggle = id => setEvidence(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]))
      const complete = culprit !== '' && evidence.length > 0 && board.accusation.questions.every(question => answers[question.id] !== undefined)
      const submit = async () => {
        setBusy(true)
        setErrors([])
        try {
          const result = await post('api/casebook.accuse', { sessionId, culprit, evidence, answers })
          if (result.ok) onDone(result.board)
          else setErrors(result.errors)
        } catch (error) {
          setErrors([`提交失败：${error.message}`])
        } finally {
          setBusy(false)
        }
      }
      const radio = (name, value, checked, onChange, label) =>
        h('label', { key: value, style: { display: 'block', fontSize: 13, margin: '3px 0', cursor: 'pointer' } },
          h('input', { type: 'radio', name, checked, onChange, style: { marginRight: 6 } }), label)
      return h('div', { style: { padding: 10, borderRadius: 8, border: `1px solid ${line}` } },
        h('div', { style: { fontWeight: 700, marginBottom: 6 } }, '指认凶手'),
        h('div', { style: { fontSize: 12, ...muted, marginBottom: 8 } }, '结案后不能再调查。证据要能串成一条链：作案的时间与机会、动机、现场的疑点、直接指向凶手的物证。'),
        h('div', { style: { fontWeight: 600, marginTop: 6 } }, '凶手是'),
        board.accusation.suspects.map(suspect => radio('casebook-culprit', suspect.id, culprit === suspect.id, () => setCulprit(suspect.id), `${suspect.name}（${suspect.role}）`)),
        h('div', { style: { fontWeight: 600, marginTop: 8 } }, `出示证据（已选 ${evidence.length} 条，最多 8 条）`),
        board.clues.map(clue => h('label', { key: clue.id, style: { display: 'block', fontSize: 13, margin: '3px 0', cursor: 'pointer' } },
          h('input', { type: 'checkbox', checked: evidence.includes(clue.id), onChange: () => toggle(clue.id), style: { marginRight: 6 } }), clue.name)),
        board.accusation.questions.map(question => h('div', { key: question.id, style: { marginTop: 8 } },
          h('div', { style: { fontWeight: 600 } }, question.prompt),
          question.options.map(option => radio(`casebook-${question.id}`, option.id, answers[question.id] === option.id,
            () => setAnswers(prev => ({ ...prev, [question.id]: option.id })), option.text)))),
        errors.length === 0 ? null : h('ul', { style: { color: 'rgb(220, 70, 70)', fontSize: 12, paddingLeft: 18 } }, errors.map(error => h('li', { key: error }, error))),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
          h(Button, { primary: true, disabled: !complete || busy, onClick: submit }, busy ? '等本轮结算完成…' : '确认指认'),
          h(Button, { disabled: busy, onClick: onCancel }, '再想想')))
    }

    function Board({ board, busy, sessionId, onBoard }) {
      const [accusing, setAccusing] = useState(false)
      const [notice, setNotice] = useState(null)
      const retry = async () => {
        try {
          const result = await post('api/casebook.retry', { sessionId })
          if (result.ok) onBoard(result.board)
          else setNotice(result.errors.join('；'))
        } catch (error) {
          setNotice(`重试失败：${error.message}`)
        }
      }
      const here = board.location
      return h('div', null,
        board.verdict === null ? null : h(Verdict, { verdict: board.verdict }),
        h('div', { style: { fontSize: 12, ...muted, marginBottom: 6 } }, `${board.clock} · ${here.name} · 第 ${board.turn} 轮`),
        h(Settlement, { board, busy, onRetry: retry }),
        notice === null ? null : h('div', { style: { fontSize: 12, color: 'rgb(220, 70, 70)' } }, notice),
        board.lastChanges === null || board.status === 'closed' ? null : h(Section, { title: '本轮新发现', extra: `第 ${board.lastChanges.revision} 轮` },
          h('ul', { style: { margin: 0, paddingLeft: 18, fontSize: 12 } }, board.lastChanges.lines.map(text => h('li', { key: text }, text)))),
        h(Section, { title: '线索', extra: `${board.clues.length} 条` }, h(ClueList, { clues: board.clues })),
        board.testimonies.length === 0 ? null : h(Section, { title: '口供', extra: `${board.testimonies.length} 条` },
          h('ul', { style: { listStyle: 'none', margin: 0, padding: 0, fontSize: 12 } }, board.testimonies.map((item, index) =>
            h('li', { key: index, style: { marginBottom: 4 } },
              h('span', { style: { fontWeight: 500 } }, `${item.npcName}：`), `「${item.quote}」`,
              h('span', { style: { ...muted, marginLeft: 6 } }, `第 ${item.revision} 轮`),
              item.isNew ? h(Badge, { accent: true }, '新') : null)))),
        h(Section, { title: '人物' },
          h('ul', { style: { listStyle: 'none', margin: 0, padding: 0, fontSize: 12 } }, board.npcs.map(npc =>
            h('li', { key: npc.id, style: { marginBottom: 6 }, title: npc.publicProfile },
              h('span', { style: { fontWeight: 500 } }, npc.name),
              h('span', { style: muted }, ` · ${npc.role} · ${npc.location}`),
              npc.met ? h(Badge, null, `态度：${npc.attitudeLabel}`) : h(Badge, null, '未见面'))))),
        h(Section, { title: '地点' },
          h('ul', { style: { listStyle: 'none', margin: 0, padding: 0, fontSize: 12 } }, board.locations.map(location =>
            h('li', { key: location.id, style: { marginBottom: 4 }, title: location.description ?? '' },
              location.here ? '● ' : location.visited ? '○ ' : '· ',
              h('span', { style: { fontWeight: location.here ? 600 : 400 } }, location.name),
              location.here ? h('span', { style: muted }, '（你在这里）') : location.visited ? h('span', { style: muted }, '（去过）') : null)))),
        board.status === 'closed' ? null : h(Section, { title: '结案' },
          accusing
            ? h(AccuseForm, { board, sessionId, onDone: next => { setAccusing(false); onBoard(next) }, onCancel: () => setAccusing(false) })
            : h('div', null,
                h('div', { style: { fontSize: 12, ...muted, marginBottom: 6 } }, board.clues.length === 0 ? '先找到线索再指认。' : '想好了就指认凶手。'),
                h(Button, { primary: true, disabled: board.clues.length === 0, onClick: () => setAccusing(true) }, '指认凶手'))),
        h('div', { style: { borderTop: `1px solid ${line}`, paddingTop: 8, fontSize: 11, ...muted } },
          `用量：叙事 ${board.usage.narrator.calls} 次，缓存命中 ${percent(board.usage.narrator.hitRate)}；`,
          `书记员 ${board.usage.clerk.calls} 次，缓存命中 ${percent(board.usage.clerk.hitRate)}`))
    }

    function ClueBoard(props) {
      const sessionId = props.sessionId
      const tabInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
      const visible = tabInfo?.tab?.visible !== false
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const seq = useRef(0)
      const load = useCallback(async () => {
        if (sessionId === undefined) return
        const mine = ++seq.current
        try {
          const next = await api(`api/casebook.board?session=${encodeURIComponent(sessionId)}`)
          if (mine === seq.current) {
            setData(next)
            setError(null)
          }
        } catch (failure) {
          if (mine === seq.current) setError(failure.message)
        }
      }, [sessionId])
      useEffect(() => {
        setData(null)
      }, [sessionId])
      useEffect(() => {
        if (!visible) return undefined
        void load()
        const timer = setInterval(() => void load(), POLL_MS)
        return () => clearInterval(timer)
      }, [visible, load])
      const onBoard = board => setData(prev => ({ kind: 'game', board, clerkBusy: prev?.clerkBusy ?? false }))
      const start = () => {
        const actions = props.inputActions
        if (actions === undefined) return
        actions.setDraft('开始调查')
        actions.submit()
      }

      const frame = children => h('div', { style: { padding: 12, fontSize: 13, lineHeight: 1.6, overflowY: 'auto', height: '100%', boxSizing: 'border-box' } }, children)
      if (sessionId === undefined) return frame(h('div', { style: muted }, '打开一个会话后这里会显示线索板。'))
      if (error !== null && data === null) return frame(h('div', { style: muted }, `线索板读取失败：${error}`))
      if (data === null) return frame(h('div', { style: muted }, '读取中…'))
      if (data.kind === 'none') {
        return frame(h('div', null,
          h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '雾港案卷'),
          h('div', { style: muted }, '这个会话不是对局。新建会话时选择「雾港案卷」模式，发一句话就开始调查。')))
      }
      if (data.kind === 'ready') {
        return frame(h('div', null,
          h('div', { style: { fontSize: 16, fontWeight: 700 } }, data.title),
          h('div', { style: { margin: '6px 0' } }, data.summary),
          h('div', { style: { ...muted, fontSize: 12, marginBottom: 10 } }, data.detective),
          props.inputActions === undefined
            ? h('div', { style: muted }, '在下方输入框里说一句话（比如「开始调查」），案子就开始了。')
            : h(Button, { primary: true, onClick: start }, '开始调查')))
      }
      const board = data.board
      return frame(h('div', null,
        h('div', { style: { fontSize: 16, fontWeight: 700 } }, board.title),
        h('div', { style: { fontSize: 12, ...muted, margin: '2px 0 8px' } }, board.summary),
        h(Board, { board, busy: data.clerkBusy, sessionId, onBoard })))
    }

    return {
      inject: ['slots', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: 'casebook-board',
          title: () => '线索板',
          guide: [{ id: 'casebook-board', order: 10, title: () => '线索板' }],
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
