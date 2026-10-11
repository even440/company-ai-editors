/**
 * 图片等文件先传给宿主，内容里只存地址，不存 base64（内容小、宿主能管理附件）。
 * 宿主不可用、只读或上传失败时返回空，调用方退回 dataURL。
 */
import { caiReadonly, caiSession } from './session'

export async function uploadToHost(file: File | Blob, name?: string): Promise<string | null> {
  const s = caiSession.value
  if (!s || caiReadonly.value) return null
  try { return (await s.client.upload(file, name)).url }
  catch { return null }
}
