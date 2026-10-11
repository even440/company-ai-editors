/**
 * 和宿主的会话在 PPTist 里的落脚点：bridge 的 Session 打开后放在这里，其他模块从这里取，不关心打开的先后。
 */
import { ref, shallowRef } from 'vue'
import type { Session } from '@cai/bridge'

/** 打开后的会话；没打开（打开失败、观众视图）时为空 */
export const caiSession = shallowRef<Session | null>(null)
/** 只读：宿主给的权限或 mode=read，以及宿主之后发来的 readonly 消息。只读时不进编辑器、不保存 */
export const caiReadonly = ref(false)
/** 打开会话失败的原因，App.vue 显示 */
export const caiError = ref('')
/** 宿主要导出 PDF：加一就打印一次，CaiPrint.vue 盯着它 */
export const printRequest = ref(0)
