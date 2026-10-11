/**
 * 宿主发来的消息：标题、只读、导出、命令、插入。theme 和 flush 由 bridge 的会话自己处理。
 */
import { watch, type Ref } from 'vue'
import type { HostToEditor, Session } from '@cai/bridge'
import { useMainStore, useScreenStore, useSlidesStore } from '@/store'
import useExport from '@/hooks/useExport'
import useScreening from '@/hooks/useScreening'
import useCreateElement from '@/hooks/useCreateElement'
import message from '@/utils/message'
import { caiReadonly, printRequest } from './session'

/** 等 PPTist 的「进行中」标记变回 false（导入、导出都用 exporting 这个 ref） */
export const untilDone = (flag: Ref<boolean>) => new Promise<void>((resolve) => {
  if (!flag.value) return resolve()
  const stop = watch(flag, (v) => { if (!v) { stop(); resolve() } })
})

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 宿主改了标题：先记到会话里再写进 store，免得 store 的监听又把同一个标题发回去 */
export function applyHostTitle(s: Session, title: string) {
  const t = title.trim()
  if (!t) return
  s.doc.title = t
  document.title = t
  useSlidesStore().setTitle(t)
}

/** 导出 PPTX：用 PPTist 自己的导出，参数和它的导出对话框默认一致（主题色写进母版、忽略音视频） */
async function exportPptx(s: Session) {
  const st = useSlidesStore()
  const { exportPPTX, exporting } = useExport()
  exportPPTX(st.slides, true, true)
  await untilDone(exporting)
  s.send({ type: 'exported', name: `${st.title}.pptx` })
}

/** 宿主的 insert（AI 续写等）：把文字作为一个文本框放到当前页 */
function insertText(m: { text?: string; html?: string }) {
  const html = m.html?.trim() || (m.text ?? '').split(/\r?\n/).filter((l) => l.trim()).map((l) => `<p>${esc(l)}</p>`).join('')
  if (!html) return
  const st = useSlidesStore()
  const width = st.viewportSize * 0.8
  const { createTextElement } = useCreateElement()
  createTextElement({ left: (st.viewportSize - width) / 2, top: st.viewportSize * st.viewportRatio * 0.3, width, height: 80 }, { content: html })
}

export function handleHost(s: Session, m: HostToEditor) {
  const screenStore = useScreenStore()
  switch (m.type) {
    case 'title':
      applyHostTitle(s, m.title)
      break
    case 'readonly':
      // 宿主能把可编辑的锁成只读；本来就只读的（权限或 mode=read）解不开
      caiReadonly.value = m.value || s.readonly
      if (caiReadonly.value) useMainStore().setActiveElementIdList([])
      break
    case 'export':
      if (m.format === 'pptx') void exportPptx(s)
      else if (m.format === 'pdf') printRequest.value++
      else message.error(`不支持导出为 ${m.format}`)
      break
    case 'command':
      // 不调 requestFullscreen：postMessage 不算用户操作，浏览器会拒绝；要全屏由宿主对 iframe 做
      if (m.name === 'play') { useSlidesStore().updateSlideIndex(0); screenStore.setScreening(true) }
      else if (m.name === 'stop') useScreening().exitScreening()
      break
    case 'insert':
      if (!caiReadonly.value) insertText(m)
      break
    case 'focus':
      window.focus()
      break
    default:
      break
  }
}
