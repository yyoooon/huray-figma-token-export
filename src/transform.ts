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

const FLOAT_TYPE = 'number';
const STRING_TYPE = 'text';
const COLOR_TYPE = 'color';

// 변수 id → 변수명 (별칭 복원용)
export function nameById(figma: SerializedFigma): Map<string, string> {
  const m = new Map<string, string>();
  for (const v of figma.variables) m.set(v.id, v.name);
  return m;
}

// $extensions = Token Studio가 붙이는 Figma 메타.
function extOf(scopes: string[], hidden: boolean) {
  return {
    'com.figma.scopes': scopes,
    'com.figma.hiddenFromPublishing': hidden,
  };
}

function leafFor(
  variable: SerializedVariable,
  value: SerializedValue,
  names: Map<string, string>,
): TokenLeaf {
  const $extensions = extOf(variable.scopes, variable.hiddenFromPublishing);
  switch (value.kind) {
    case 'COLOR':
      return { $extensions, $type: COLOR_TYPE, $value: rgbaToHex(value) };
    case 'ALIAS': {
      const target = names.get(value.id);
      if (!target) throw new Error(`alias target not found: ${value.id}`);
      return { $extensions, $type: COLOR_TYPE, $value: varNameToRef(target) };
    }
    case 'FLOAT':
      return { $extensions, $type: FLOAT_TYPE, $value: value.value };
    case 'STRING':
      return { $extensions, $type: STRING_TYPE, $value: value.value };
    case 'BOOLEAN':
      return { $extensions, $type: STRING_TYPE, $value: value.value };
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
  const names = nameById(figma);
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
      setLeaf(sets[setName], figmaNameToPath(v.name), leafFor(v, value, names));
    }
  }
  return sets;
}

// ── 합성 타이포 (Task 5) ──

const TYPO_PROPS = ['fontFamily', 'fontWeight', 'lineHeight', 'fontSize', 'letterSpacing'] as const;

// Token Studio가 모든 타이포에 붙이는 합성 ref(변수 바인딩 아님 — 상수).
// textDecoration만 -underline 변형에서 underline. (정확한 값은 합격 deep-equal로 확정)
function syntheticTypoRefs(name: string): Record<string, string> {
  return {
    paragraphSpacing: '{paragraphSpacing.0}',
    paragraphIndent: '{paragraphIndent.0}',
    textCase: '{textCase.none}',
    textDecoration: name.endsWith('-underline') ? '{textDecoration.underline}' : '{textDecoration.none}',
  };
}

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
    Object.assign($value, syntheticTypoRefs(variant));
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

  const out: TokensJson = {};
  const order: string[] = [];
  for (const [name, tree] of Object.entries(sets)) {
    out[name] = tree;
    order.push(name);
  }
  out['$themes'] = [];
  out['$metadata'] = { tokenSetOrder: order };
  return out;
}
