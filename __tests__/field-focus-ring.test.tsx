/// <reference types="jest" />
/**
 * One focus treatment on every text field (2026-10-24): a single rounded ring drawn over the well, in the theme's focus
 * colour — or the danger colour when the field is invalid, thicker when it is invalid and focused — and none on a field
 * that cannot be edited. The well's own border never changes width, so gaining focus or an error moves nothing.
 *
 * The browser half (no native outline, the autofill tint held off, touch and keyboard focus, both engines) is checked in
 * a real browser by `ops/verify-browser-input`.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../lib/design/theme';
import { PALETTES } from '../lib/design/colors';
import { TextField } from '../components/ui/Field';
import { fieldRing } from '../components/ui/field-chrome';
import { textInput } from './tree';

const light = PALETTES.light;

async function renderField(props: Partial<React.ComponentProps<typeof TextField>> = {}) {
  return render(
    <ThemeProvider>
      <TextField label="Name staff will see" value="" onChangeText={() => {}} {...props} />
    </ThemeProvider>,
  );
}

const input = () => textInput();
// The ring is hidden from assistive technology on purpose (decoration), so it is queried with hidden elements included.
const rings = () => screen.queryAllByTestId('field-ring', { includeHiddenElements: true });
const ringStyle = () => StyleSheet.flatten(rings()[0].props.style) as { borderColor: string; borderWidth: number; pointerEvents?: string };
/** The well: the input's parent view. Its border is the only thing that could move the layout. */
const wellBorder = () => (StyleSheet.flatten(input().parent!.props.style) as { borderWidth: number }).borderWidth;

describe('the field ring', () => {
  it('normal: no ring, a hairline well', async () => {
    await renderField();
    await act(async () => {});
    expect(rings()).toHaveLength(0);
    expect(wellBorder()).toBe(StyleSheet.hairlineWidth);
  });

  it('focused: one ring in the focus colour, the well unchanged, and the ring never takes a touch', async () => {
    await renderField();
    await act(async () => {});
    await fireEvent(input(), 'focus');
    expect(rings()).toHaveLength(1);
    expect(ringStyle().borderColor).toBe(light.border.focus);
    expect(ringStyle().borderWidth).toBe(2);
    expect(ringStyle().pointerEvents).toBe('none');
    expect(wellBorder()).toBe(StyleSheet.hairlineWidth);
    await fireEvent(input(), 'blur');
    expect(rings()).toHaveLength(0);
  });

  it('invalid: the danger ring, with the problem in words underneath', async () => {
    await renderField({ error: 'Name the account so staff can recognise it.' });
    await act(async () => {});
    expect(rings()).toHaveLength(1);
    expect(ringStyle().borderColor).toBe(light.intent.danger.solid);
    expect(ringStyle().borderWidth).toBe(1.5);
    expect(screen.getByText('Name the account so staff can recognise it.')).toBeTruthy();
    expect(wellBorder()).toBe(StyleSheet.hairlineWidth);
  });

  it('focused and invalid: still the danger colour — never mistaken for a valid field — and drawn thicker', async () => {
    await renderField({ error: 'Required' });
    await act(async () => {});
    await fireEvent(input(), 'focus');
    expect(rings()).toHaveLength(1);
    expect(ringStyle().borderColor).toBe(light.intent.danger.solid);
    expect(ringStyle().borderWidth).toBe(2.5);
    expect(wellBorder()).toBe(StyleSheet.hairlineWidth);
  });

  it('disabled: no focus ring, the sunken surface, and the text in the disabled colour', async () => {
    await renderField({ editable: false, value: 'Cannot edit' });
    await act(async () => {});
    await fireEvent(input(), 'focus');
    expect(rings()).toHaveLength(0);
    expect((StyleSheet.flatten(input().parent!.props.style) as { backgroundColor: string }).backgroundColor).toBe(light.surface.sunken);
    expect((StyleSheet.flatten(input().props.style) as { color: string }).color).toBe(light.text.disabled);
  });

  it('a disabled field that is also invalid keeps its error visible', () => {
    expect(fieldRing({ focused: false, error: true, editable: false })).toBe('error');
    expect(fieldRing({ focused: true, error: false, editable: false })).toBeNull();
  });

  it('typing after a validation error is never blocked', async () => {
    const onChangeText = jest.fn();
    await renderField({ error: 'Required', onChangeText });
    await act(async () => {});
    await fireEvent(input(), 'focus');
    await fireEvent.changeText(input(), 'Bankily caisse');
    expect(onChangeText).toHaveBeenCalledWith('Bankily caisse');
  });
});
