/** 调宿主接口：所有请求带编辑令牌。跨域部署时宿主要允许这个来源 */
import type { DirectoryUser, EditorDoc, EditorFile, PresenceUser, SaveBody, SaveConflict, SaveResult, SurveyResponse } from './protocol';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) { super(message); }
}

export class EditorClient {
  constructor(public readonly api: string, public readonly token: string) {}

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
  async upload(file: File | Blob, name?: string): Promise<EditorFile> {
    const fd = new FormData();
    fd.append('file', file, name ?? (file instanceof File ? file.name : 'file'));
    return this.request('POST', '/asset', fd);
  }
  responses(): Promise<{ responses: SurveyResponse[] }> { return this.request('GET', '/responses'); }
  respond(answers: Record<string, unknown>): Promise<{ id: string; count: number }> { return this.request('POST', '/responses', { answers }); }
  /** 问卷的收集状态 */
  collecting(on: boolean): Promise<{ collecting: boolean }> { return this.request('POST', '/collecting', { collecting: on }); }
}

export const isConflict = (e: unknown): e is ApiError & { data: SaveConflict } => e instanceof ApiError && e.status === 409 && !!e.data && typeof e.data === 'object' && (e.data as SaveConflict).error === 'version';
