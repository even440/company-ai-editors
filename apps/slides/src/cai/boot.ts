/**
 * 启动：打开和宿主的会话、装内容（或把刚导入的 pptx 转成内容）、装上自动保存和宿主消息。App.vue 挂载时调用一次。
 */
import { nextTick, watch } from 'vue'
import { openSession, type Session } from '@cai/bridge'
import { useSlidesStore, useSnapshotStore } from '@/store'
import { deleteDiscardedDB } from '@/utils/database'
import useImport from '@/hooks/useImport'
import { applyContent, currentContent, plainOf } from './content'
import { handleHost, untilDone } from './host'
import { caiError, caiReadonly, caiSession } from './session'

/** 记下改动，会话停下来 1.5 秒后保存 */
const markDirty = (s: Session) => {
  if (caiReadonly.value) return
  s.markDirty(() => ({ content: currentContent(), plain: plainOf(useSlidesStore().slides) }))
}

/** 编辑器里改了标题：告诉宿主；宿主不接受的（比如清空）再改回宿主的 */
async function syncTitle(s: Session, title: string) {
  const st = useSlidesStore()
  await s.setTitle(title)
  if (st.title !== s.doc.title) st.setTitle(s.doc.title)
}

/** 刚从文件导入、还没转换：下载源文件，用 PPTist 的 pptx 导入装进 store */
async function importFromHost(s: Session): Promise<boolean> {
  const f = s.doc.importFile!
  const st = useSlidesStore()
  try {
    const res = await fetch(s.client.assetUrl(f.id))
    if (!res.ok) throw new Error(`下载源文件失败（${res.status}）`)
    const file = new File([await res.blob()], f.name, { type: f.mime })
    const { importPPTXFile, exporting } = useImport()
    importPPTXFile([file], { cover: true })
    await untilDone(exporting)
    if (!st.slides.length) throw new Error('无法读取这个 pptx 文件')
    return true
  }
  catch (e) {
    s.send({ type: 'error', message: e instanceof Error ? e.message : '导入失败' })
    return false
  }
}

export async function bootCai() {
  const st = useSlidesStore()
  let s: Session
  try { s = await openSession() }
  catch (e) { caiError.value = e instanceof Error ? e.message : '打开失败'; return }
  caiSession.value = s
  caiReadonly.value = s.readonly

  const imported = s.doc.importFile && !s.readonly ? await importFromHost(s) : false
  if (!imported) applyContent(s.doc.content)
  st.setTitle(s.doc.title) // 标题以宿主的为准
  await deleteDiscardedDB()
  await useSnapshotStore().initSnapshotDatabase()

  await nextTick() // 上面的装载不算改动，监听从这以后开始
  watch(() => [st.slides, st.theme, st.viewportSize, st.viewportRatio], () => markDirty(s), { deep: true })
  watch(() => st.title, (t) => void syncTitle(s, t))
  s.onHost((m) => handleHost(s, m))

  if (imported) {
    markDirty(s)
    await s.flush()
    await s.client.imported()
    s.send({ type: 'imported', title: st.title })
  }
}
