/** 从任意 JSON 里收集可读文字：给搜索和 AI 用的兜底办法。各编辑器最好按自己的结构生成更准确的纯文本 */
export function plainOfJson(v: unknown, limit = 200_000): string {
  const out: string[] = [];
  let n = 0;
  const walk = (x: unknown) => {
    if (n > limit) return;
    if (typeof x === 'string') { const t = x.replace(/<[^>]+>/g, ' ').trim(); if (t) { out.push(t); n += t.length; } }
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') for (const k of Object.keys(x)) { if (!/^(id|type|color|fill|stroke|font|style|src|url|href|width|height|x|y|w|h|rotate|zoom|version)$/i.test(k)) walk((x as Record<string, unknown>)[k]); }
  };
  walk(v);
  return out.join('\n').slice(0, limit);
}

/** 文件大小 */
export const fmtSize = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B');

/** 只留文件名里安全的字符 */
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '未命名';
