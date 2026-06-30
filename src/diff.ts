// tokens.json(세트 트리) 두 개를 비교해 PR 본문용 변경 목록을 만든다.
// 순수 함수 — 네트워크/DOM 의존 없음.

// { "Set/Path/.../Leaf": value } 로 평탄화. $-키(메타)와 비객체는 건너뛴다.
export function flattenTokens(json: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$') || v == null || typeof v !== 'object') continue;
      const path = prefix ? `${prefix}/${k}` : k;
      if ('$value' in (v as Record<string, unknown>)) out[path] = (v as { $value: unknown }).$value;
      else walk(v as Record<string, unknown>, path);
    }
  };
  for (const [setName, tree] of Object.entries(json)) {
    if (setName.startsWith('$') || !tree || typeof tree !== 'object') continue;
    walk(tree as Record<string, unknown>, setName);
  }
  return out;
}

export interface TokenDiff {
  added: { path: string; value: unknown }[];
  removed: { path: string; value: unknown }[];
  changed: { path: string; from: unknown; to: unknown }[];
}

export function diffTokens(
  oldJson: Record<string, unknown>,
  newJson: Record<string, unknown>,
): TokenDiff {
  const a = flattenTokens(oldJson);
  const b = flattenTokens(newJson);
  const eq = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const diff: TokenDiff = { added: [], removed: [], changed: [] };
  for (const k of Object.keys(b)) {
    if (!(k in a)) diff.added.push({ path: k, value: b[k] });
    else if (!eq(a[k], b[k])) diff.changed.push({ path: k, from: a[k], to: b[k] });
  }
  for (const k of Object.keys(a)) {
    if (!(k in b)) diff.removed.push({ path: k, value: a[k] });
  }
  return diff;
}

const MAX_ROWS = 80; // PR 본문 폭주 방지

function fmt(v: unknown): string {
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function section(title: string, lines: string[]): string {
  if (!lines.length) return '';
  const shown = lines.slice(0, MAX_ROWS);
  const more = lines.length > MAX_ROWS ? `\n- …외 ${lines.length - MAX_ROWS}개` : '';
  return `\n### ${title} (${lines.length})\n${shown.join('\n')}${more}\n`;
}

export function formatPrBody(diff: TokenDiff, project: string): string {
  const { added, removed, changed } = diff;
  if (!added.length && !removed.length && !changed.length) {
    return `\`${project}\` 토큰 변경 없음 (이전과 동일).`;
  }
  const head = `## 토큰 변경 요약 — \`${project}\`\n\n변경 ${changed.length} · 추가 ${added.length} · 삭제 ${removed.length}\n`;
  return [
    head,
    section('변경', changed.map((d) => `- \`${d.path}\`: \`${fmt(d.from)}\` → \`${fmt(d.to)}\``)),
    section('추가', added.map((d) => `- \`${d.path}\`: \`${fmt(d.value)}\``)),
    section('삭제', removed.map((d) => `- \`${d.path}\`: \`${fmt(d.value)}\``)),
    '\n— Huray Token Export 플러그인 자동 생성',
  ].join('');
}
