# DTCG 토큰 포맷 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 또는 superpowers:executing-plans 로 task 단위 실행. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 플러그인의 `tokens.json`을 DTCG 표준으로 바꾼다. (변환·검증은 소비처 token-sync 담당 — 이 계획 범위 밖)

**Architecture:** `transform.ts`(순수 함수)가 Figma 변수의 `scopes`로 DTCG `$type`을 판정한다. 플러그인은 DTCG tokens.json만 생성·푸시.

**Tech Stack:** TypeScript, esbuild, vitest.

## Global Constraints

- 크기 토큰 = `$type:"dimension"`, `$value` = **`"{n}px"` 문자열**.
- 단위 없는 수(opacity·font-weight) = `$type:"number"`, 숫자 그대로.
- 폰트명 = `$type:"fontFamily"`, 그 외 문자열 = `$type:"string"`.
- 타이포 = `$type:"typography"` + **표준 5필드만**(fontFamily·fontSize·fontWeight·lineHeight·letterSpacing).
- `scopes`는 출력 JSON에 넣지 않음(판정 전용). `$extensions`/`$themes`/`$metadata` 없음.
- alias `$type` = **대상 변수 타입**.
- **커밋은 사용자 승인 후에만.** 각 Task의 커밋 스텝은 "스테이징 후 사용자 확인"으로 실행.

---

## File Structure

- `src/transform.ts` (수정) — scope→DTCG 타입, dimension px, alias 타입, 타이포 5필드.
- `src/types.ts` (수정) — `SerializedVariable.scopes` 유지, 문서화.
- `test/transform.test.ts` (수정) — DTCG 기대값.
- `test/fixtures/expected-tokens.json` (재생성) — DTCG baseline.

---

## Task 1: scope 기반 DTCG 타입 판정

**Files:**
- Modify: `src/transform.ts`, `test/transform.test.ts`

**Interfaces:**
- Produces: `dtcgTypeOf(v: SerializedVariable): 'color'|'dimension'|'number'|'fontFamily'|'string'`

- [ ] **Step 1: 유닛 테스트 작성** (`test/transform.test.ts` 최상단 describe 추가)

```ts
import { dtcgTypeOf } from '../src/transform';

describe('dtcgTypeOf — scope로 DTCG $type 판정', () => {
  const mk = (resolvedType: any, scopes: string[]) =>
    ({ id: 'x', name: 'n', collectionId: 'c', resolvedType, valuesByMode: {}, scopes, hiddenFromPublishing: false });

  it('COLOR → color', () => expect(dtcgTypeOf(mk('COLOR', ['ALL_SCOPES']))).toBe('color'));
  it('FLOAT + CORNER_RADIUS → dimension', () => expect(dtcgTypeOf(mk('FLOAT', ['CORNER_RADIUS']))).toBe('dimension'));
  it('FLOAT + GAP → dimension', () => expect(dtcgTypeOf(mk('FLOAT', ['GAP']))).toBe('dimension'));
  it('FLOAT + FONT_SIZE → dimension', () => expect(dtcgTypeOf(mk('FLOAT', ['FONT_SIZE']))).toBe('dimension'));
  it('FLOAT + OPACITY → number', () => expect(dtcgTypeOf(mk('FLOAT', ['OPACITY']))).toBe('number'));
  it('FLOAT + FONT_WEIGHT → number', () => expect(dtcgTypeOf(mk('FLOAT', ['FONT_WEIGHT']))).toBe('number'));
  it('FLOAT + 미지 scope → dimension(기본)', () => expect(dtcgTypeOf(mk('FLOAT', ['???']))).toBe('dimension'));
  it('STRING + FONT_FAMILY → fontFamily', () => expect(dtcgTypeOf(mk('STRING', ['FONT_FAMILY']))).toBe('fontFamily'));
  it('STRING + TEXT_CONTENT → string', () => expect(dtcgTypeOf(mk('STRING', ['TEXT_CONTENT']))).toBe('string'));
  it('BOOLEAN → string', () => expect(dtcgTypeOf(mk('BOOLEAN', []))).toBe('string'));
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run test/transform.test.ts -t dtcgTypeOf` → FAIL(`dtcgTypeOf is not a function`)

- [ ] **Step 3: 구현** (`src/transform.ts`, 기존 `leafFor` 위에 추가; import에 `SerializedVariable` 추가)

```ts
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
```

- [ ] **Step 4: 통과 확인** — `npx vitest run test/transform.test.ts -t dtcgTypeOf` → PASS(10)

- [ ] **Step 5: 스테이징 후 사용자 확인** — `git add src/transform.ts test/transform.test.ts`

---

## Task 2: 리프 생성 (dimension px · alias 타입)

**Files:**
- Modify: `src/transform.ts`, `test/transform.test.ts`

**Interfaces:**
- Consumes: `dtcgTypeOf`.
- Produces: `varsById(figma): Map<string, SerializedVariable>`, `leafFor(v, value, vars): TokenLeaf`.

- [ ] **Step 1: `base` fixture에 dimension 변수 추가 + 기대 테스트 3개로 교체**

`buildVariableSets` describe의 `base`를 교체:
```ts
const base = fig({
  collections: [
    { id: 'c1', name: 'Primitive', modes: [{ modeId: 'm1', name: 'Light' }] },
    { id: 'c2', name: 'Scheme', modes: [{ modeId: 'm2', name: 'Light' }] },
  ],
  variables: [
    v({ id: 'v1', name: 'Color/White Opacity/950', collectionId: 'c1', resolvedType: 'COLOR',
        valuesByMode: { m1: { kind: 'COLOR', r: 1, g: 1, b: 1, a: 0.95 } }, scopes: ['ALL_SCOPES'] }),
    v({ id: 'v2', name: 'Text/White/Rest', collectionId: 'c2', resolvedType: 'COLOR',
        valuesByMode: { m2: { kind: 'ALIAS', id: 'v1' } }, scopes: ['TEXT_FILL'] }),
    v({ id: 'r1', name: 'Radius/16', collectionId: 'c1', resolvedType: 'FLOAT',
        valuesByMode: { m1: { kind: 'FLOAT', value: 16 } }, scopes: ['CORNER_RADIUS'] }),
  ],
});
```

세 `it`으로 교체:
```ts
it('COLOR 리프 → color + hex', () => {
  const sets = buildVariableSets(base);
  expect((sets['Primitive/Light'] as any)['Color']['White Opacity']['950']).toEqual({ $type: 'color', $value: '#fffffff2' });
});
it('FLOAT+CORNER_RADIUS → dimension + "16px"', () => {
  const sets = buildVariableSets(base);
  expect((sets['Primitive/Light'] as any)['Radius']['16']).toEqual({ $type: 'dimension', $value: '16px' });
});
it('ALIAS → 대상(color) 타입 + 전체경로 ref', () => {
  const sets = buildVariableSets(base);
  expect((sets['Scheme/Light'] as any)['Text']['White']['Rest']).toEqual({ $type: 'color', $value: '{Color.White Opacity.950}' });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run test/transform.test.ts -t buildVariableSets` → FAIL

- [ ] **Step 3: `varsById` + `leafFor` 교체** (`src/transform.ts`)

```ts
export function varsById(figma: SerializedFigma): Map<string, SerializedVariable> {
  const m = new Map<string, SerializedVariable>();
  for (const v of figma.variables) m.set(v.id, v);
  return m;
}

function leafFor(v: SerializedVariable, value: SerializedValue, vars: Map<string, SerializedVariable>): TokenLeaf {
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
```

`buildVariableSets` 안: `const names = nameById(figma)` → `const vars = varsById(figma)`, 호출부 `leafFor(v, value, names)` → `leafFor(v, value, vars)`. 미사용 상수(`FLOAT_TYPE`/`STRING_TYPE`/`COLOR_TYPE`) 제거. `nameById`는 `buildTypographyTokens`에서 쓰이면 유지.

- [ ] **Step 4: 통과 확인** — `npx vitest run test/transform.test.ts -t buildVariableSets` → PASS(3)

- [ ] **Step 5: 스테이징 후 사용자 확인** — `git add src/transform.ts test/transform.test.ts`

---

## Task 3: 타이포 5필드 + Effect + baseline 재생성

**Files:**
- Modify: `src/transform.ts`, `test/transform.test.ts`
- Regenerate: `test/fixtures/expected-tokens.json`

- [ ] **Step 1: 타이포/Effect 기대값 갱신**

`buildTypographyTokens` 기대값을 5필드로:
```ts
it('builds composite typography token with 5 standard fields only', () => {
  const t = buildTypographyTokens(figma);
  expect((t as any)['Display']['lg-bold']).toEqual({
    $type: 'typography',
    $value: {
      fontFamily: '{Typography.Font.Sans-serif}',
      fontWeight: '{fontWeights.pretendard-0}',
      lineHeight: '{Typography.Light height.leading-11}',
      fontSize: '{fontSize.9}',
      letterSpacing: '{letterSpacing.0}',
    },
  });
});
```

Effect describe에서 `oc.X` 를 dimension으로:
```ts
expect(oc.X).toEqual({ $type: 'dimension', $value: '-8px' });
```
(`oc.Color`는 alias→color 그대로)

- [ ] **Step 2: 실패 확인** — `npx vitest run test/transform.test.ts` → FAIL

- [ ] **Step 3: `syntheticTypoRefs` 제거** — 함수와 `Object.assign` 호출 삭제. `buildTypographyTokens`는:

```ts
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
```

- [ ] **Step 4: 통과 확인** — `npx vitest run test/transform.test.ts` → PASS(전체)

- [ ] **Step 5: baseline 재생성**

```bash
npx esbuild src/transform.ts --bundle --format=esm --platform=node --outfile=/tmp/t.mjs
node --input-type=module -e "import {transform} from '/tmp/t.mjs'; import {readFileSync,writeFileSync} from 'node:fs'; const raw=JSON.parse(readFileSync('./test/fixtures/figma-raw.json','utf8')); writeFileSync('./test/fixtures/expected-tokens.json', JSON.stringify(transform(raw),null,2)+'\n'); console.log('ok');"
```

- [ ] **Step 6: 전체 회귀** — `npm test` → PASS

- [ ] **Step 7: baseline 육안 확인**
  - `grep -c '"$type": "dimension"' test/fixtures/expected-tokens.json` > 0
  - `grep -c 'com.figma' test/fixtures/expected-tokens.json` == 0

- [ ] **Step 8: 스테이징 후 사용자 확인** — `git add src/transform.ts test/transform.test.ts test/fixtures/expected-tokens.json`

---

## 후속 작업 (별도 계획 — 이번 범위 밖, 협응 필요)

> 아래는 `fe-toolkit` 레포 작업. 플러그인 DTCG 배포와 **타이밍 맞춰야** web이 안 깨짐.

### 후속 1: token-sync `transform.mjs` DTCG 대응 (필수·협응)
- dimension이 `"16px"` 문자열이 됐으므로 값 사용처에 `parsePx` 적용.
- `$type` 변화 대응(경로 기반이라 영향 적음).
- 회귀: DTCG tokens.json → **동일 theme.css** 확인.

### 후속 2: token-sync 검증 어휘 확장 (선택)
- 현재 `extractTokens`가 color·radius·typography만 인벤토리화 → border-width·shadow 제거 미감지.
- `--border-width-*`·`--shadow-*` 추출 규칙 추가 + `inventoryKeys`에 키 추가.

---

## Self-Review

- **Spec coverage:** 타입매핑→Task1·2, alias→Task2, 타이포→Task3, baseline→Task3, 후속(token-sync)→후속1·2. 누락 없음.
- **Placeholder scan:** 코드 스텝 모두 실제 코드 포함.
- **Type consistency:** `dtcgTypeOf`(Task1) → `leafFor(v,value,vars)`·`varsById`(Task2) 일관.
