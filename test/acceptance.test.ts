import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { transform } from '../src/transform';

function load(name: string) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

const hasFixture = existsSync(new URL('./fixtures/figma-raw.json', import.meta.url));

// 회귀 스냅샷: expected-tokens.json = 검증된 시점의 transform(figma-raw) 출력.
// (정답 기준은 'theme.css 변환이 잘 되는가'. 그건 huray-design-web의 tokensToCss로
//  한 번 검증함 — 구조 100% 일치, Effect/Mode 1 'Over contents' 복원 확인.
//  이 테스트는 이후 transform 코드가 출력을 바꾸지 않는지 지키는 회귀 가드.)
// figma-raw.json 없으면 skip. Figma 토큰이 바뀌면 baseline을 다시 캡처해 갱신한다.
describe.skipIf(!hasFixture)('회귀 — transform(figma-raw) 출력 고정', () => {
  it('transform(figma-raw) === 캡처된 baseline(expected-tokens.json)', () => {
    const raw = load('figma-raw.json');
    const expected = load('expected-tokens.json');
    const out = transform(raw);
    expect(out).toEqual(expected);
  });
});
