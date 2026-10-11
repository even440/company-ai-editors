<template>
  <!-- 宿主要导出 PDF：把所有页按 1600px 宽画在屏幕外，交给 PPTist 的打印工具（和它的「打印 / 导出 PDF」对话框一样） -->
  <div class="cai-print" ref="rootRef" v-if="printing">
    <ThumbnailSlide class="page" v-for="slide in slides" :key="slide.id" :slide="slide" :size="1600" />
  </div>
</template>

<script lang="ts" setup>
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSlidesStore } from '@/store'
import { print } from '@/utils/print'
import ThumbnailSlide from '@/views/components/ThumbnailSlide/index.vue'
import { caiSession, printRequest } from './session'

const { slides, viewportRatio, title } = storeToRefs(useSlidesStore())
const rootRef = useTemplateRef<HTMLElement>('rootRef')
const printing = ref(false)

watch(printRequest, async () => {
  if (printing.value) return
  printing.value = true
  await nextTick()
  await new Promise((r) => setTimeout(r, 600)) // 等图片、图表画完
  if (rootRef.value) print(rootRef.value, { width: 1600, height: 1600 * viewportRatio.value, margin: 0 })
  printing.value = false
  caiSession.value?.send({ type: 'exported', name: `${title.value}.pdf` })
})
</script>

<style lang="scss" scoped>
.cai-print {
  position: fixed;
  left: -20000px;
  top: 0;
  width: 1600px;
}
.page {
  break-after: page;
}
</style>
