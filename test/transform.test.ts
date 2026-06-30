import { describe, it, expect } from 'vitest';
import {
  figmaNameToPath,
  rgbaToHex,
  varNameToRef,
  buildVariableSets,
  buildTypographyTokens,
  transform,
} from '../src/transform';
import type { SerializedFigma, SerializedVariable } from '../src/types';

// 테스트 fixture 빌더 — scopes/hidden 기본값 채움.
function fig(partial: Partial<SerializedFigma>): SerializedFigma {
  return { collections: [], variables: [], textStyles: [], ...partial };
}
function v(p: Partial<SerializedVariable> & Pick<SerializedVariable, 'id' | 'name' | 'collectionId' | 'resolvedType'>): SerializedVariable {
  return { valuesByMode: {}, scopes: ['ALL_SCOPES'], hiddenFromPublishing: false, ...p };
}

describe('figmaNameToPath', () => {
  it('splits on / and keeps spaces inside segments', () => {
    expect(figmaNameToPath('Color/White Opacity/950')).toEqual(['Color', 'White Opacity', '950']);
  });
});

describe('rgbaToHex', () => {
  it('opaque white → #ffffff (no alpha when a=1)', () => {
    expect(rgbaToHex({ r: 1, g: 1, b: 1, a: 1 })).toBe('#ffffff');
  });
  it('transparent white → #ffffff00', () => {
    expect(rgbaToHex({ r: 1, g: 1, b: 1, a: 0 })).toBe('#ffffff00');
  });
  it('white at 5% alpha → #ffffff0d', () => {
    expect(rgbaToHex({ r: 1, g: 1, b: 1, a: 0.05 })).toBe('#ffffff0d');
  });
});

describe('varNameToRef', () => {
  it('wraps name with / replaced by . in braces', () => {
    expect(varNameToRef('Color/White Opacity/950')).toBe('{Color.White Opacity.950}');
  });
  it('typography primitive ref', () => {
    expect(varNameToRef('fontSize/9')).toBe('{fontSize.9}');
  });
});

describe('buildVariableSets', () => {
  const base = fig({
    collections: [
      { id: 'c1', name: 'Primitive', modes: [{ modeId: 'm1', name: 'Light' }] },
      { id: 'c2', name: 'Scheme', modes: [{ modeId: 'm2', name: 'Light' }] },
    ],
    variables: [
      v({
        id: 'v1',
        name: 'Color/White Opacity/950',
        collectionId: 'c1',
        resolvedType: 'COLOR',
        valuesByMode: { m1: { kind: 'COLOR', r: 1, g: 1, b: 1, a: 0.95 } },
        scopes: ['ALL_SCOPES'],
      }),
      v({
        id: 'v2',
        name: 'Text/White/Rest',
        collectionId: 'c2',
        resolvedType: 'COLOR',
        valuesByMode: { m2: { kind: 'ALIAS', id: 'v1' } },
        scopes: ['TEXT_FILL'],
      }),
    ],
  });

  it('nests variable name path into the {collection}/{mode} set with $extensions', () => {
    const sets = buildVariableSets(base);
    expect((sets['Primitive/Light'] as any)['Color']['White Opacity']['950']).toEqual({
      $extensions: { 'com.figma.scopes': ['ALL_SCOPES'], 'com.figma.hiddenFromPublishing': false },
      $type: 'color',
      $value: '#fffffff2',
    });
  });

  it('resolves ALIAS to {target.name} ref dropping set name', () => {
    const sets = buildVariableSets(base);
    expect((sets['Scheme/Light'] as any)['Text']['White']['Rest']).toEqual({
      $extensions: { 'com.figma.scopes': ['TEXT_FILL'], 'com.figma.hiddenFromPublishing': false },
      $type: 'color',
      $value: '{Color.White Opacity.950}',
    });
  });
});

describe('buildTypographyTokens', () => {
  const figma = fig({
    collections: [{ id: 'c1', name: 'Primitive', modes: [{ modeId: 'm1', name: 'Light' }] }],
    variables: [
      v({ id: 'fs9', name: 'fontSize/9', collectionId: 'c1', resolvedType: 'FLOAT' }),
      v({ id: 'lh', name: 'Typography/Light height/leading-11', collectionId: 'c1', resolvedType: 'FLOAT' }),
      v({ id: 'fw', name: 'fontWeights/pretendard-0', collectionId: 'c1', resolvedType: 'FLOAT' }),
      v({ id: 'ls', name: 'letterSpacing/0', collectionId: 'c1', resolvedType: 'FLOAT' }),
      v({ id: 'ff', name: 'Typography/Font/Sans-serif', collectionId: 'c1', resolvedType: 'STRING' }),
    ],
    textStyles: [
      {
        name: 'Display/lg-bold',
        boundVariables: { fontFamily: 'ff', fontWeight: 'fw', lineHeight: 'lh', fontSize: 'fs9', letterSpacing: 'ls' },
      },
    ],
  });

  it('builds composite typography token with bound refs + synthetic refs (9 fields)', () => {
    const t = buildTypographyTokens(figma);
    expect((t as any)['Display']['lg-bold']).toEqual({
      $type: 'typography',
      $value: {
        fontFamily: '{Typography.Font.Sans-serif}',
        fontWeight: '{fontWeights.pretendard-0}',
        lineHeight: '{Typography.Light height.leading-11}',
        fontSize: '{fontSize.9}',
        letterSpacing: '{letterSpacing.0}',
        paragraphSpacing: '{paragraphSpacing.0}',
        paragraphIndent: '{paragraphIndent.0}',
        textCase: '{textCase.none}',
        textDecoration: '{textDecoration.none}',
      },
    });
  });
});

describe('buildVariableSets — Effect 컬렉션이 그림자 세트를 만든다', () => {
  it('Effect 변수 이름(Inner Shadow/Over contents/...)이 그대로 Effect/Mode 1 트리가 된다', () => {
    const figma = fig({
      collections: [
        { id: 'cP', name: 'Primitive', modes: [{ modeId: 'mp', name: 'Light' }] },
        { id: 'cE', name: 'Effect', modes: [{ modeId: 'me', name: 'Mode 1' }] },
      ],
      variables: [
        v({ id: 'white', name: 'Color/White Opacity/950', collectionId: 'cP', resolvedType: 'COLOR', valuesByMode: { mp: { kind: 'COLOR', r: 1, g: 1, b: 1, a: 1 } } }),
        v({ id: 'ic', name: 'Inner Shadow/Over contents/Color', collectionId: 'cE', resolvedType: 'COLOR', scopes: ['EFFECT_COLOR'], valuesByMode: { me: { kind: 'ALIAS', id: 'white' } } }),
        v({ id: 'ix', name: 'Inner Shadow/Over contents/X', collectionId: 'cE', resolvedType: 'FLOAT', scopes: ['EFFECT_FLOAT'], valuesByMode: { me: { kind: 'FLOAT', value: -8 } } }),
      ],
    });
    const sets = buildVariableSets(figma);
    const oc = (sets['Effect/Mode 1'] as any)['Inner Shadow']['Over contents'];
    expect(oc.Color).toEqual({
      $extensions: { 'com.figma.scopes': ['EFFECT_COLOR'], 'com.figma.hiddenFromPublishing': false },
      $type: 'color',
      $value: '{Color.White Opacity.950}',
    });
    expect(oc.X).toEqual({
      $extensions: { 'com.figma.scopes': ['EFFECT_FLOAT'], 'com.figma.hiddenFromPublishing': false },
      $type: 'number',
      $value: -8,
    });
  });
});

describe('transform (assembly)', () => {
  it('merges typography into the set holding its bound primitives + adds metadata', () => {
    const figma = fig({
      collections: [{ id: 'c1', name: 'Primitive', modes: [{ modeId: 'm1', name: 'Light' }] }],
      variables: [
        v({ id: 'fs9', name: 'fontSize/9', collectionId: 'c1', resolvedType: 'FLOAT', valuesByMode: { m1: { kind: 'FLOAT', value: 40 } } }),
        v({ id: 'fw', name: 'fontWeights/pretendard-0', collectionId: 'c1', resolvedType: 'FLOAT', valuesByMode: { m1: { kind: 'FLOAT', value: 700 } } }),
        v({ id: 'lh', name: 'leading/11', collectionId: 'c1', resolvedType: 'FLOAT', valuesByMode: { m1: { kind: 'FLOAT', value: 52 } } }),
        v({ id: 'ls', name: 'letterSpacing/0', collectionId: 'c1', resolvedType: 'FLOAT', valuesByMode: { m1: { kind: 'FLOAT', value: 0 } } }),
        v({ id: 'ff', name: 'Typography/Font/Sans-serif', collectionId: 'c1', resolvedType: 'STRING', valuesByMode: { m1: { kind: 'STRING', value: 'Pretendard' } } }),
      ],
      textStyles: [
        { name: 'Display/lg-bold', boundVariables: { fontFamily: 'ff', fontWeight: 'fw', lineHeight: 'lh', fontSize: 'fs9', letterSpacing: 'ls' } },
      ],
    });
    const out = transform(figma) as any;
    expect(out['Primitive/Light']['Display']['lg-bold'].$type).toBe('typography');
    expect(out['Primitive/Light']['fontSize']['9']).toMatchObject({ $type: 'number', $value: 40 });
    expect(out['$themes']).toEqual([]);
    expect(out['$metadata']).toEqual({ tokenSetOrder: ['Primitive/Light'] });
  });
});
