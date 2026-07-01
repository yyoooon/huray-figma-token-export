import type {
  SerializedFigma,
  SerializedValue,
  SerializedVariable,
  TokenLeaf,
  TokenTree,
  TokensJson,
} from './types';

// ── 헬퍼 (Task 3) ──

export function figmaNameToPath(name: string): string[] {
  return name.split('/');
}

function channel(v: number): string {
  // 0–1 float → 2자리 소문자 hex.
  return Math.round(v * 255)
    .toString(16)
    .padStart(2, '0');
}

export function rgbaToHex(c: { r: number; g: number; b: number; a: number }): string {
  const hex = `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`;
  return c.a >= 1 ? hex : `${hex}${channel(c.a)}`;
}

export function varNameToRef(name: string): string {
  return `{${name.split('/').join('.')}}`;
}

// ── 변수 → 세트 트리 (Task 4) ──

// 변수 id → 변수명 (별칭 복원용)
export function nameById(figma: SerializedFigma): Map<string, string> {
  const m = new Map<string, string>();
  for (const v of figma.variables) m.set(v.id, v.name);
  return m;
}

// scope로 DTCG $type 판정. scopes는 출력엔 안 넣고 판정에만 쓴다.
const NUMBER_SCOPES = new Set(['OPACITY', 'FONT_WEIGHT']);

export function dtcgTypeOf(
  v: SerializedVariable,
): 'color' | 'dimension' | 'number' | 'fontFamily' | 'string' {
  switch (v.resolvedType) {
    case 'COLOR':
      return 'color';
    case 'FLOAT':
      return v.scopes.some((s) => NUMBER_SCOPES.has(s)) ? 'number' : 'dimension';
    case 'STRING':
      return v.scopes.includes('FONT_FAMILY') ? 'fontFamily' : 'string';
    case 'BOOLEAN':
      return 'string';
  }
}

// 변수 id → 변수 (별칭 타입 해석용)
export function varsById(figma: SerializedFigma): Map<string, SerializedVariable> {
  const m = new Map<string, SerializedVariable>();
  for (const v of figma.variables) m.set(v.id, v);
  return m;
}

function leafFor(
  v: SerializedVariable,
  value: SerializedValue,
  vars: Map<string, SerializedVariable>,
): TokenLeaf {
  switch (value.kind) {
    case 'COLOR':
      return { $type: 'color', $value: rgbaToHex(value) };
    case 'ALIAS': {
      const target = vars.get(value.id);
      if (!target) throw new Error(`alias target not found: ${value.id}`);
      return { $type: dtcgTypeOf(target), $value: varNameToRef(target.name) };
    }
    case 'FLOAT':
      return dtcgTypeOf(v) === 'dimension'
        ? { $type: 'dimension', $value: `${value.value}px` }
        : { $type: 'number', $value: value.value };
    case 'STRING':
      return { $type: dtcgTypeOf(v), $value: value.value };
    case 'BOOLEAN':
      return { $type: 'string', $value: String(value.value) };
  }
}

function setLeaf(tree: TokenTree, path: string[], leaf: TokenLeaf): void {
  let node = tree;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!(key in node)) node[key] = {};
    node = node[key] as TokenTree;
  }
  node[path[path.length - 1]] = leaf;
}

export function buildVariableSets(figma: SerializedFigma): Record<string, TokenTree> {
  const vars = varsById(figma);
  const collById = new Map(figma.collections.map((c) => [c.id, c]));
  const sets: Record<string, TokenTree> = {};

  for (const v of figma.variables) {
    const coll = collById.get(v.collectionId);
    if (!coll) continue;
    for (const mode of coll.modes) {
      const setName = `${coll.name}/${mode.name}`;
      const value = v.valuesByMode[mode.modeId];
      if (value == null) continue;
      sets[setName] = sets[setName] ?? {};
      setLeaf(sets[setName], figmaNameToPath(v.name), leafFor(v, value, vars));
    }
  }
  return sets;
}

// ── 합성 타이포 (Task 5) ──

// DTCG typography 합성 — 표준 5필드만 (Token Studio 합성 필드는 안 붙인다).
const TYPO_PROPS = ['fontFamily', 'fontWeight', 'lineHeight', 'fontSize', 'letterSpacing'] as const;

export function buildTypographyTokens(figma: SerializedFigma): TokenTree {
  const names = nameById(figma);
  const tree: TokenTree = {};
  for (const style of figma.textStyles) {
    const [group, variant] = style.name.split('/');
    if (!group || !variant) continue;
    const $value: Record<string, string> = {};
    for (const prop of TYPO_PROPS) {
      const id = style.boundVariables[prop];
      if (!id) continue;
      const target = names.get(id);
      if (!target) throw new Error(`typo bound var not found: ${id}`);
      $value[prop] = varNameToRef(target);
    }
    tree[group] = tree[group] ?? {};
    (tree[group] as TokenTree)[variant] = { $type: 'typography', $value };
  }
  return tree;
}

// ── 전체 조립 (Task 6) ──

// 합성 타이포가 들어갈 세트 = fontSize로 바인딩된 변수의 컬렉션/모드.
function typographySetName(figma: SerializedFigma): string | null {
  const collById = new Map(figma.collections.map((c) => [c.id, c]));
  for (const style of figma.textStyles) {
    const id = style.boundVariables.fontSize;
    if (!id) continue;
    const v = figma.variables.find((x) => x.id === id);
    const coll = v && collById.get(v.collectionId);
    if (coll) return `${coll.name}/${coll.modes[0].name}`;
  }
  return null;
}

function deepMerge(target: TokenTree, source: TokenTree): void {
  for (const [k, val] of Object.entries(source)) {
    if (val && typeof val === 'object' && !('$value' in val) && target[k]) {
      deepMerge(target[k] as TokenTree, val as TokenTree);
    } else {
      target[k] = val as TokenTree[string];
    }
  }
}

export function transform(figma: SerializedFigma): TokensJson {
  const sets = buildVariableSets(figma);

  const typo = buildTypographyTokens(figma);
  const typoSet = typographySetName(figma);
  if (typoSet && Object.keys(typo).length) {
    sets[typoSet] = sets[typoSet] ?? {};
    deepMerge(sets[typoSet], typo);
  }

  // Effect/Mode 1 은 'Effect' 변수 컬렉션에서 buildVariableSets 가 이미 만든다.
  // (이펙트 '스타일'에서 파생하면 스타일 이름이 변수 이름과 달라 'Over contents'가 깨진다.)

  return sets;
}
