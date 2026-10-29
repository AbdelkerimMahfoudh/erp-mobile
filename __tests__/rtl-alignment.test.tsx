/// <reference types="jest" />
/**
 * Arabic rows on the iPhone (D225, the owner's TestFlight feedback of 2026-10-29): a wide gap between each row's
 * title and its icon.
 *
 * React Native on the phone already reads `textAlign: 'left' | 'right'` against the layout direction
 * (`RCTResolveTextAlignment`), and the shared helper flipped them a second time — so "start" became the far side of
 * the row in Arabic. The browser does not flip, which is why the Chromium and WebKit checks were green. These pin both
 * platforms.
 */

function load(os: 'ios' | 'web', rtl: boolean) {
  let mod!: typeof import('../lib/design/direction');
  jest.isolateModules(() => {
    jest.doMock('../lib/design/layout-direction', () => ({ layoutIsRTL: () => rtl }));
    const RN = jest.requireActual('react-native');
    RN.Platform.OS = os;
    mod = require('../lib/design/direction');
  });
  return mod;
}

const realOS = jest.requireActual('react-native').Platform.OS;
afterEach(() => {
  jest.requireActual('react-native').Platform.OS = realOS;
});

describe('on the phone, RN resolves left and right against the layout', () => {
  it('start is "left" in both directions — RN turns it into right-aligned text in Arabic', () => {
    expect(load('ios', true).textAlign('start')).toBe('left');
    expect(load('ios', false).textAlign('start')).toBe('left');
    expect(load('ios', true).textAlign('end')).toBe('right');
  });

  it('a fixed side (an Arabic name in the English interface) is asked for the other way round in RTL', () => {
    expect(load('ios', true).physicalTextAlign('right')).toBe('left');
    expect(load('ios', false).physicalTextAlign('right')).toBe('right');
  });
});

describe('in the browser, the side is computed here', () => {
  it('start is right in Arabic and left otherwise', () => {
    expect(load('web', true).textAlign('start')).toBe('right');
    expect(load('web', false).textAlign('start')).toBe('left');
    expect(load('web', true).physicalTextAlign('left')).toBe('left');
  });
});
