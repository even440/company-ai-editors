/** 调宿主接口：所有请求带编辑令牌。跨域部署时宿主要允许这个来源 */
import type { DirectoryUser, EditorDoc, EditorFile, PresenceUser, SaveBody, SaveConflict, SaveResult, SurveyResponse } from './protocol';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) { super(message); }
}

/** 宿主的直传接口开始上传时给的（平台 drive/uploads.ts 的 UploadStart）：cos 是一次 PUT 的签名地址，local 是没配对象存储、交给宿主存本机 */
interface UploadStart { id: string; mode: 'cos' | 'local'; single?: { url: string; headers: Record<string, string> } }
/** 直传只走一次 PUT：宿主小于两块（32 MB）时给一次 PUT 的地址，更大的经宿主传 */
const DIRECT_MAX = 32 * 1024 * 1024;

export class EditorClient {
  constructor(public readonly api: string, public readonly token: string) {}
  /** 宿主认不认直传接口：试过一次不认（旧的宿主）就不再试 */
  private direct = true;

  private url(path: string) { return `${this.api}/api/v1/editor${path}`; }
  /** 带令牌的资源地址：图片、附件、源文件这些由浏览器直接加载的地址 */
  assetUrl(id: string): string { return `${this.url('/asset/' + encodeURIComponent(id))}?token=${encodeURIComponent(this.token)}`; }

  async request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, ...(init.headers as Record<string, string> | undefined) };
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(this.url(path), { ...init, method, headers, body: payload });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : res.status === 401 ? '登录已失效或链接已过期' : `请求失败（${res.status}）`;
      throw new ApiError(res.status, msg, data);
    }
    return data as T;
  }

  doc(): Promise<EditorDoc> { return this.request('GET', '/doc'); }
  /** 保存。版本冲突时抛 ApiError(409)，data 是 SaveConflict */
  save(body: SaveBody, keepalive = false): Promise<SaveResult> { return this.request('PUT', '/doc', body, { keepalive }); }
  rename(title: string): Promise<{ title: string }> { return this.request('PATCH', '/doc', { title }); }
  /** 导入完成：清掉 importFile 标记 */
  imported(): Promise<{ ok: true }> { return this.request('POST', '/doc/imported'); }
  presence(editing: boolean, leave = false): Promise<{ present: PresenceUser[] }> { return this.request('POST', '/presence', { editing, leave }, { keepalive: leave }); }
  directory(): Promise<{ users: DirectoryUser[] }> { return this.request('GET', '/directory'); }
  /**
   * 传图片、附件，得到带令牌的地址。先试直传对象存储（2026-10-27：深圳同事导入一份几百张图的 Word，图片一张张经美国的服务器传了 4 分钟；
   * 宿主给签名地址，浏览器直接 PUT 到香港的桶，再登记），宿主没配对象存储时（开发）照它说的交给 …/local；
   * 宿主不认直传、文件太大、PUT 不上去、服务端出错时退回 /asset 经宿主传。权限、容量这类拒绝照常报错，不绕过去
   */
  async upload(file: File | Blob, name?: string): Promise<EditorFile> {
    const n = name ?? (file instanceof File ? file.name : 'file');
    if (this.direct && file.size > 0 && file.size < DIRECT_MAX) {
      const got = await this.uploadDirect(file, n);
      if (got) return got;
    }
    const fd = new FormData();
    fd.append('file', file, n);
    return this.request('POST', '/asset', fd);
  }

  /** 直传；返回 null 表示这次要退回 /asset */
  private async uploadDirect(file: File | Blob, name: string): Promise<EditorFile | null> {
    const fallback = (e: unknown) => {
      if (e instanceof ApiError && e.status < 500) throw e;
      return null;
    };
    let st: UploadStart;
    try { st = await this.request<UploadStart>('POST', '/uploads', { name, size: file.size, ...(file.type ? { mime: file.type } : {}) }); }
    catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) { this.direct = false; return null; }
      return fallback(e);
    }
    const id = encodeURIComponent(st.id);
    try {
      if (st.mode === 'local') { const fd = new FormData(); fd.append('file', file, name); return await this.request<EditorFile>('POST', `/uploads/${id}/local`, fd); }
      if (!st.single) return null;
      const put = await fetch(st.single.url, { method: 'PUT', headers: st.single.headers, body: file });
      if (!put.ok) return null;
      return await this.request<EditorFile>('POST', `/uploads/${id}/complete`, {});
    } catch (e) { return fallback(e); }
  }
  responses(): Promise<{ responses: SurveyResponse[] }> { return this.request('GET', '/responses'); }
  respond(answers: Record<string, unknown>): Promise<{ id: string; count: number }> { return this.request('POST', '/responses', { answers }); }
  /** 问卷的收集状态 */
  collecting(on: boolean): Promise<{ collecting: boolean }> { return this.request('POST', '/collecting', { collecting: on }); }
}

export const isConflict = (e: unknown): e is ApiError & { data: SaveConflict } => e instanceof ApiError && e.status === 409 && !!e.data && typeof e.data === 'object' && (e.data as SaveConflict).error === 'version';
