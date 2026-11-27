/**
 * 幻灯片内容在宿主里的格式：{ title, theme, slides, viewportSize, viewportRatio }，和 PPTist 的 slidesStore 一一对应。
 * 空内容（{}）打开时建一页空白封面，用 PPTist 自己的默认主题。
 */
import { nanoid } from 'nanoid'
import { useMainStore, useSlidesStore, useSnapshotStore } from '@/store'
import { db } from '@/utils/database'
import type { PPTElement, Slide, SlideTheme } from '@/types/slides'
import { htmlToText } from '@/utils/common'

export interface SlidesContent {
  title: string
  theme: SlideTheme
  slides: Slide[]
  viewportSize: number
  viewportRatio: number
}

/** 内容里有没有页面：没有就按空内容处理 */
export const isSlidesContent = (c: unknown): c is Partial<SlidesContent> & { slides: Slide[] } =>
  !!c && typeof c === 'object' && Array.isArray((c as { slides?: unknown }).slides) && (c as { slides: unknown[] }).slides.length > 0

/** 默认演示文稿：一页空白封面 */
export const defaultSlides = (theme: SlideTheme): Slide[] => [{
  id: nanoid(10),
  type: 'cover',
  elements: [],
  background: { type: 'solid', color: theme.backgroundColor },
}]

/** 把宿主的内容装进 store；缺的字段保留 store 的默认值。标题不在这里装（以宿主的为准，启动时另外设） */
export function applyContent(content: unknown) {
  const st = useSlidesStore()
  const c = (content && typeof content === 'object' ? content : {}) as Partial<SlidesContent>
  if (c.theme && typeof c.theme === 'object') st.setTheme(c.theme)
  if (typeof c.viewportSize === 'number' && c.viewportSize > 0) st.setViewportSize(c.viewportSize)
  if (typeof c.viewportRatio === 'number' && c.viewportRatio > 0) st.setViewportRatio(c.viewportRatio)
  st.updateSlideIndex(0)
  st.setSlides(isSlidesContent(c) ? c.slides : defaultSlides(st.theme))
}

/**
 * 别人保存后合并好的内容换进 store（bridge 会话的 live）：和 applyContent 不同，停在原来那一页（按页面编号找，被删了就停在附近），
 * 选中的元素还在就留着；撤销记录从现在重新记（快照是整份幻灯片，撤销会把别人的改动一起退掉）
 */
export function applyRemote(content: unknown) {
  const st = useSlidesStore(), main = useMainStore()
  const c = (content && typeof content === 'object' ? content : {}) as Partial<SlidesContent>
  const curId = st.slides[st.slideIndex]?.id, at = st.slideIndex
  if (c.theme && typeof c.theme === 'object') st.setTheme(c.theme)
  if (typeof c.viewportSize === 'number' && c.viewportSize > 0) st.setViewportSize(c.viewportSize)
  if (typeof c.viewportRatio === 'number' && c.viewportRatio > 0) st.setViewportRatio(c.viewportRatio)
  const slides = isSlidesContent(c) ? c.slides : defaultSlides(st.theme)
  st.setSlides(slides)
  const i = slides.findIndex((x) => x.id === curId)
  st.updateSlideIndex(i >= 0 ? i : Math.max(0, Math.min(at, slides.length - 1)))
  const ids = new Set((slides[st.slideIndex]?.elements ?? []).map((e) => e.id))
  const keep = main.activeElementIdList.filter((id) => ids.has(id))
  if (keep.length !== main.activeElementIdList.length) main.setActiveElementIdList(keep)
  // 不等它：会话在 apply 期间不记改动，等 IndexedDB 的这段时间里用户的改动会漏掉
  void db.snapshots.clear().then(() => useSnapshotStore().initSnapshotDatabase())
}

/** 当前 store 里的内容：保存时用 */
export function currentContent(): SlidesContent {
  const st = useSlidesStore()
  return { title: st.title, theme: st.theme, slides: st.slides, viewportSize: st.viewportSize, viewportRatio: st.viewportRatio }
}

/** 去掉 HTML 标签；段落、换行变成换行，免得两段文字粘在一起 */
const stripHtml = (html: string) =>
  htmlToText(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n'))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

/** 一个元素里的文字：文本框、带文字的形状、表格、公式 */
const textOf = (el: PPTElement): string => {
  switch (el.type) {
    case 'text': return stripHtml(el.content)
    case 'shape': return el.text ? stripHtml(el.text.content) : ''
    case 'table': return el.data.map((row) => row.map((cell) => cell.text).filter(Boolean).join(' ')).filter(Boolean).join('\n')
    case 'latex': return el.latex
    default: return ''
  }
}

/** 每页文字元素的纯文本按页拼起来（页之间空一行）：给搜索和 AI 用 */
export function plainOf(slides: Slide[]): string {
  return slides.map((slide) => {
    const lines = slide.elements.map(textOf).filter(Boolean)
    if (slide.remark) lines.push(stripHtml(slide.remark))
    return lines.join('\n')
  }).filter(Boolean).join('\n\n')
}
