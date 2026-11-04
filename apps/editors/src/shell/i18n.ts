/**
 * 界面语言：平台在编辑器地址上带 ui=<界面语言>（zh-CN / en / pt-BR / ja / ko），和平台界面一致，平台换语言时地址变了、编辑器跟着重新加载；
 * 没带（假宿主、别的宿主）时按浏览器语言猜，猜不出来用中文。
 * 只管界面上的字；内容本身的语言（s.doc.lang）是另一回事。
 */
export type Lang = 'zh-CN' | 'en' | 'pt-BR' | 'ja' | 'ko';

function match(v: string): Lang | null {
  const l = v.toLowerCase();
  if (l.startsWith('zh')) return 'zh-CN';
  if (l.startsWith('pt')) return 'pt-BR';
  if (l.startsWith('en')) return 'en';
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('ko')) return 'ko';
  return null;
}

export const lang: Lang = match(new URLSearchParams(location.search).get('ui') ?? '')
  ?? (navigator.languages?.length ? navigator.languages : [navigator.language]).map(match).find((x): x is Lang => !!x)
  ?? 'zh-CN';
document.documentElement.lang = lang;

/** 按界面语言挑一套文字 */
export const pick = <D>(d: Record<Lang, D>): D => d[lang];

/** 列举时的分隔：中文、日文用顿号，其余用逗号 */
export const listSep = lang === 'zh-CN' || lang === 'ja' ? '、' : ', ';

/** 编辑器外壳（出错页、弹窗按钮）的字 */
export const ST = pick({
  'zh-CN': { openFail: '打不开这份内容', openFailHint: '请从平台里重新打开；如果一直这样，联系管理员。', loading: '加载中', close: '关闭', ok: '确定', cancel: '取消' },
  en: { openFail: 'Can’t open this content', openFailHint: 'Open it again from the platform. If this keeps happening, contact your administrator.', loading: 'Loading', close: 'Close', ok: 'OK', cancel: 'Cancel' },
  'pt-BR': { openFail: 'Não foi possível abrir este conteúdo', openFailHint: 'Abra de novo pela plataforma. Se continuar assim, fale com o administrador.', loading: 'Carregando', close: 'Fechar', ok: 'OK', cancel: 'Cancelar' },
  ja: { openFail: 'このコンテンツを開けません', openFailHint: 'プラットフォームから開き直してください。解決しない場合は管理者に連絡してください。', loading: '読み込み中', close: '閉じる', ok: 'OK', cancel: 'キャンセル' },
  ko: { openFail: '이 콘텐츠를 열 수 없습니다', openFailHint: '플랫폼에서 다시 열어 주세요. 계속 이러면 관리자에게 문의하세요.', loading: '불러오는 중', close: '닫기', ok: '확인', cancel: '취소' },
});
