/**
 * 文档编辑器的界面文字：按平台的界面语言（shell/i18n.ts）挑一套。
 * 2026-11-10 加「AI 识别目录」时新写的字在这里（五种语言）；更早的界面文字还是写在组件里的中文，以后逐个挪过来。
 */
import { pick } from '../shell/i18n';

const zh = {
  aiBtn: 'AI 识别目录',
  aiHint: '让 AI 从正文里认出各级标题，确认后设成标题',
  tocEmpty: '这篇文档还没有标题。把段落设成「标题 1」到「标题 6」，它就会列在这里；标题只是加粗、放大的文字时，可以让 AI 认出来。',
  busy: (b: number, n: number) => (n > 1 ? `正在识别 ${b} / ${n}……` : '正在识别……'),
  nothing: '没有可以识别的内容：正文里没有短的段落',
  none: 'AI 没有认出新的标题',
  unsupported: '这里还不能用 AI 识别目录，请联系管理员升级平台',
  failed: (why: string) => `识别失败：${why}`,
  unknown: '未知错误',
  reviewTitle: 'AI 识别目录',
  reviewLead: (n: number) => `认出 ${n} 个标题。去掉不对的、改一下级别，确认后这些段落会设成对应级别的标题（可以撤销）。`,
  mockNote: '现在没有接入真正的模型，下面是按编号的写法（第一章、一、1.1 ……）猜的，仅供参考。',
  all: '全选', clear: '全不选',
  level: (n: number) => `标题 ${n}`,
  levelOf: '级别',
  apply: (n: number) => `设为标题（${n}）`,
  applied: (n: number) => `已把 ${n} 段设为标题`,
  moved: '正文在这期间改过，没有找到这些段落，请再识别一次',
};
type Dict = typeof zh;

const en: Dict = {
  aiBtn: 'Detect headings with AI',
  aiHint: 'Let AI find the headings in the text; they become headings after you confirm',
  tocEmpty: 'This document has no headings yet. Set a paragraph to Heading 1–6 and it will be listed here. If the headings are just bold or larger text, AI can detect them.',
  busy: (b, n) => (n > 1 ? `Detecting ${b} / ${n}…` : 'Detecting…'),
  nothing: 'Nothing to detect: the text has no short paragraphs',
  none: 'AI found no new headings',
  unsupported: 'AI heading detection isn’t available here yet. Ask your administrator to upgrade the platform.',
  failed: (why) => `Detection failed: ${why}`,
  unknown: 'unknown error',
  reviewTitle: 'Detect headings with AI',
  reviewLead: (n) => `Found ${n} heading${n === 1 ? '' : 's'}. Uncheck the wrong ones and adjust the levels; after you confirm, these paragraphs become headings (you can undo).`,
  mockNote: 'No real model is connected. The list below is guessed from the numbering (Chapter 1, 1.1, …) and is only a suggestion.',
  all: 'Select all', clear: 'Select none',
  level: (n) => `Heading ${n}`,
  levelOf: 'Level',
  apply: (n) => `Set as headings (${n})`,
  applied: (n) => `${n} paragraph${n === 1 ? '' : 's'} set as heading${n === 1 ? '' : 's'}`,
  moved: 'The text changed in the meantime and these paragraphs weren’t found. Please detect again.',
};

const pt: Dict = {
  aiBtn: 'Detectar títulos com IA',
  aiHint: 'A IA encontra os títulos no texto; depois de confirmar, eles viram títulos',
  tocEmpty: 'Este documento ainda não tem títulos. Defina um parágrafo como Título 1 a 6 e ele aparece aqui. Se os títulos forem só texto em negrito ou maior, a IA pode detectá-los.',
  busy: (b, n) => (n > 1 ? `Detectando ${b} / ${n}…` : 'Detectando…'),
  nothing: 'Nada para detectar: o texto não tem parágrafos curtos',
  none: 'A IA não encontrou novos títulos',
  unsupported: 'A detecção de títulos com IA ainda não está disponível aqui. Peça ao administrador para atualizar a plataforma.',
  failed: (why) => `Falha na detecção: ${why}`,
  unknown: 'erro desconhecido',
  reviewTitle: 'Detectar títulos com IA',
  reviewLead: (n) => `${n} título${n === 1 ? ' encontrado' : 's encontrados'}. Desmarque os errados e ajuste os níveis; ao confirmar, esses parágrafos viram títulos (dá para desfazer).`,
  mockNote: 'Nenhum modelo real está conectado. A lista abaixo foi deduzida pela numeração (Capítulo 1, 1.1, …) e serve só como sugestão.',
  all: 'Marcar todos', clear: 'Desmarcar todos',
  level: (n) => `Título ${n}`,
  levelOf: 'Nível',
  apply: (n) => `Definir como títulos (${n})`,
  applied: (n) => `${n} parágrafo${n === 1 ? ' definido como título' : 's definidos como títulos'}`,
  moved: 'O texto mudou nesse meio-tempo e esses parágrafos não foram encontrados. Detecte de novo.',
};

const ja: Dict = {
  aiBtn: 'AI で見出しを検出',
  aiHint: '本文から AI が見出しを見つけます。確認すると見出しに設定されます',
  tocEmpty: 'この文書にはまだ見出しがありません。段落を「見出し 1」～「見出し 6」に設定すると、ここに表示されます。見出しが太字や大きな文字だけの場合は、AI で検出できます。',
  busy: (b, n) => (n > 1 ? `検出中 ${b} / ${n}…` : '検出中…'),
  nothing: '検出できる内容がありません：本文に短い段落がありません',
  none: 'AI は新しい見出しを見つけませんでした',
  unsupported: 'ここではまだ AI の見出し検出を使えません。管理者にプラットフォームの更新を依頼してください',
  failed: (why) => `検出に失敗しました：${why}`,
  unknown: '不明なエラー',
  reviewTitle: 'AI で見出しを検出',
  reviewLead: (n) => `${n} 件の見出しを検出しました。違うものは外し、レベルを直してください。確認すると、これらの段落が見出しになります（元に戻せます）。`,
  mockNote: '実際のモデルが接続されていません。下の一覧は番号の書き方（第一章、1.1 など）からの推測で、参考用です。',
  all: 'すべて選択', clear: 'すべて解除',
  level: (n) => `見出し ${n}`,
  levelOf: 'レベル',
  apply: (n) => `見出しに設定（${n}）`,
  applied: (n) => `${n} 個の段落を見出しに設定しました`,
  moved: 'その間に本文が変更され、これらの段落が見つかりませんでした。もう一度検出してください',
};

const ko: Dict = {
  aiBtn: 'AI로 제목 인식',
  aiHint: 'AI가 본문에서 제목을 찾습니다. 확인하면 제목으로 설정됩니다',
  tocEmpty: '이 문서에는 아직 제목이 없습니다. 단락을 「제목 1」~「제목 6」으로 설정하면 여기에 표시됩니다. 제목이 굵거나 큰 글자일 뿐이라면 AI로 인식할 수 있습니다.',
  busy: (b, n) => (n > 1 ? `인식 중 ${b} / ${n}…` : '인식 중…'),
  nothing: '인식할 내용이 없습니다: 본문에 짧은 단락이 없습니다',
  none: 'AI가 새 제목을 찾지 못했습니다',
  unsupported: '여기서는 아직 AI 제목 인식을 쓸 수 없습니다. 관리자에게 플랫폼 업그레이드를 요청하세요',
  failed: (why) => `인식 실패: ${why}`,
  unknown: '알 수 없는 오류',
  reviewTitle: 'AI로 제목 인식',
  reviewLead: (n) => `제목 ${n}개를 찾았습니다. 틀린 것은 빼고 수준을 고치세요. 확인하면 이 단락들이 해당 수준의 제목이 됩니다(실행 취소 가능).`,
  mockNote: '실제 모델이 연결되어 있지 않습니다. 아래 목록은 번호 쓰는 방식(제1장, 1.1 등)으로 추측한 것으로, 참고용입니다.',
  all: '모두 선택', clear: '모두 해제',
  level: (n) => `제목 ${n}`,
  levelOf: '수준',
  apply: (n) => `제목으로 설정(${n})`,
  applied: (n) => `단락 ${n}개를 제목으로 설정했습니다`,
  moved: '그사이 본문이 바뀌어 이 단락들을 찾지 못했습니다. 다시 인식해 주세요',
};

export const T: Dict = pick({ 'zh-CN': zh, en, 'pt-BR': pt, ja, ko });
