<template>
  <template v-if="slides.length">
    <!-- Company AI：只读时不进编辑器，直接放映 -->
    <Screen v-if="screening || caiReadonly" />
    <Editor v-else-if="_isPC" />
    <Mobile v-else />
    <CaiPrint />
  </template>
  <div class="cai-error" v-else-if="caiError">{{ caiError }}</div>
  <FullscreenSpin tip="数据初始化中，请稍等 ..." v-else  loading :mask="false" />
</template>

<script lang="ts" setup>
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { nanoid } from 'nanoid'
import { useScreenStore, useMainStore, useSlidesStore } from '@/store'
import { LOCALSTORAGE_KEY_DISCARDED_DB } from '@/configs/storage'
import { isPC } from '@/utils/common'
import { bootCai } from '@/cai/boot'
import { caiError, caiReadonly } from '@/cai/session'

import Editor from './views/Editor/index.vue'
import Screen from './views/Screen/index.vue'
import Mobile from './views/Mobile/index.vue'
import FullscreenSpin from '@/components/FullscreenSpin.vue'
import CaiPrint from '@/cai/CaiPrint.vue'

const _isPC = isPC()

const mainStore = useMainStore()
const slidesStore = useSlidesStore()
const screenStore = useScreenStore()
const { databaseId } = storeToRefs(mainStore)
const { slides } = storeToRefs(slidesStore)
const { screening } = storeToRefs(screenStore)

const isAudienceMode = new URLSearchParams(window.location.search).get('mode') === 'audience'

// Company AI：不弹「离开此页？」的提示，离开前的保存由会话做（beforeunload / visibilitychange 时写回）

onMounted(async () => {
  if (isAudienceMode) {
    slidesStore.setSlides([{
      id: nanoid(10),
      elements: [],
    }])
    screenStore.setScreening(true)
  }
  else {
    // Company AI：内容从宿主来（含刚导入的 pptx），不再读 mocks/slides.json；快照库也在里面初始化
    await bootCai()
  }
})

// 应用注销时向 localStorage 中记录下本次 indexedDB 的数据库ID，用于之后清除数据库
window.addEventListener('beforeunload', () => {
  const discardedDB = localStorage.getItem(LOCALSTORAGE_KEY_DISCARDED_DB)
  const discardedDBList: string[] = discardedDB ? JSON.parse(discardedDB) : []

  discardedDBList.push(databaseId.value)

  const newDiscardedDB = JSON.stringify(discardedDBList)
  localStorage.setItem(LOCALSTORAGE_KEY_DISCARDED_DB, newDiscardedDB)
})
</script>

<style lang="scss">
#app {
  height: 100%;
}
.cai-error {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 14px;
}
</style>
