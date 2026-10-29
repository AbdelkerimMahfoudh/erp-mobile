/// <reference types="jest" />
/**
 * A decision dialog never cuts its answers (D225, the owner's TestFlight feedback of 2026-10-29).
 *
 * On a phone the product-identification question showed "Cet article précis (son numéro de s…": each answer was a
 * one-line button, and the part that told the two answers apart was the part that was cut. The dialog now draws an
 * answer as a title and a description that wrap, inside a body that scrolls, with the cancel action outside the
 * scrolled body so it stays reachable however long the copy is or however large the text.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../lib/design/theme';
import { dialog, useDialogStore } from '../lib/dialog';
import { translateIn } from '../lib/i18n';
import { DialogHost, dialogMaxHeight } from '../components/overlay/DialogHost';

jest.mock('../lib/api-client', () => ({ __esModule: true, api: { get: jest.fn(async () => []) } }));

import { askScanIntake } from '../lib/scan/ask-intake';

async function mount() {
  return await render(
    <ThemeProvider>
      <DialogHost />
    </ThemeProvider>,
  );
}

/** The host Text elements whose text is exactly `value`. */
function hostTexts(value: string) {
  return screen.container.queryAll((n) => n.type === 'Text' && textOf(n) === value);
}

function textOf(node: { children: unknown[] }): string {
  return node.children.map((c) => (typeof c === 'string' ? c : textOf(c as { children: unknown[] }))).join('');
}

/** Host element type names from a node up to the root. */
function hostAncestors(node: { parent: unknown }): string[] {
  const out: string[] = [];
  let at = node.parent as { type?: unknown; parent: unknown } | null;
  while (at) {
    if (typeof at.type === 'string') out.push(at.type);
    at = at.parent as typeof at;
  }
  return out;
}

afterEach(async () => {
  await act(async () => useDialogStore.setState({ queue: [] }));
});

const FR = {
  unitTitle: translateIn('fr', 'intake.identity.unit.title'),
  unitBody: translateIn('fr', 'intake.identity.unit.body'),
  modelTitle: translateIn('fr', 'intake.identity.model.title'),
  modelBody: translateIn('fr', 'intake.identity.model.body'),
};

describe('the identification question', () => {
  it('carries the agreed wording in English, French and Arabic', () => {
    expect(translateIn('en', 'intake.identity.unit.title')).toBe('This exact item');
    expect(translateIn('en', 'intake.identity.unit.body')).toBe('It has its own IMEI or serial number.');
    expect(translateIn('en', 'intake.identity.model.title')).toBe('This product model');
    expect(translateIn('en', 'intake.identity.model.body')).toBe('Every unit shares this barcode.');
    expect(FR).toEqual({
      unitTitle: 'Cet exemplaire précis',
      unitBody: 'Il possède son propre IMEI ou numéro de série.',
      modelTitle: 'Ce modèle de produit',
      modelBody: 'Toutes les unités utilisent ce code-barres.',
    });
    for (const key of ['intake.identity.unit.title', 'intake.identity.unit.body', 'intake.identity.model.title', 'intake.identity.model.body'] as const) {
      expect(translateIn('ar', key)).toMatch(/[؀-ۿ]/);
    }
  });

  it('asks with a title and a description for each answer, and the answer decides the field', async () => {
    await mount();
    let answer: Promise<unknown> = Promise.resolve();
    await act(async () => {
      answer = askScanIntake({ kind: 'unknown', code: 'C02XK1ABJHD5' } as never);
    });
    const shown = useDialogStore.getState().queue[0];
    expect(shown.choices).toEqual([
      { title: 'This exact item', description: 'It has its own IMEI or serial number.' },
      { title: 'This product model', description: 'Every unit shares this barcode.' },
    ]);
    await fireEvent.press(screen.getByLabelText('This product model. Every unit shares this barcode.'));
    await expect(answer).resolves.toEqual({ field: 'productBarcode' });
  });
});

describe('a choice dialog', () => {
  it('draws every answer in full: no line limit on any title or description', async () => {
    await mount();
    await act(async () => {
      void dialog.choose({
        title: 'Que désigne ce code ?',
        choices: [
          { title: FR.unitTitle, description: FR.unitBody },
          { title: FR.modelTitle, description: FR.modelBody },
        ],
      });
    });
    for (const text of [FR.unitTitle, FR.unitBody, FR.modelTitle, FR.modelBody]) {
      const nodes = hostTexts(text);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].props.numberOfLines).toBeUndefined();
      expect(nodes[0].props.ellipsizeMode).toBeUndefined();
    }
  });

  it('resolves to the index pressed, and a cancelled question is not an answer', async () => {
    await mount();
    let first: Promise<number | null> = Promise.resolve(null);
    await act(async () => {
      first = dialog.choose({ title: 'Q', choices: [{ title: 'A', description: 'first' }, 'B'] });
    });
    await fireEvent.press(screen.getByLabelText('B'));
    await expect(first).resolves.toBe(1);

    let second: Promise<number | null> = Promise.resolve(0);
    await act(async () => {
      second = dialog.choose({ title: 'Q', choices: ['A', 'B'], cancelLabel: 'Annuler' });
    });
    await fireEvent.press(screen.getByLabelText('Annuler'));
    await expect(second).resolves.toBeNull();
  });

  it('scrolls the copy and the answers, and keeps the cancel action outside the scrolled body', async () => {
    await mount();
    const long = 'Une explication très longue. '.repeat(40);
    await act(async () => {
      void dialog.choose({ title: 'Q', message: long, choices: [{ title: FR.unitTitle, description: FR.unitBody }], cancelLabel: 'Annuler' });
    });
    const option = hostTexts(FR.unitBody)[0];
    const cancel = hostTexts('Annuler')[0];
    expect(hostAncestors(option)).toContain('RCTScrollView');
    expect(hostAncestors(cancel)).not.toContain('RCTScrollView');
  });

  it('a confirmation wraps its button labels instead of cutting them', async () => {
    await mount();
    const label = 'Continuer sans le coût d’achat et enregistrer quand même';
    await act(async () => {
      void dialog.confirm({ title: 'Q', confirmLabel: label });
    });
    const node = hostTexts(label)[0];
    expect(node.props.numberOfLines).toBeUndefined();
  });
});

describe('the room a dialog may take', () => {
  it('leaves the backdrop margin and the keyboard out, so the actions stay on screen', () => {
    // 568 pt is the shortest iPhone screen still supported (an SE at 320 × 568).
    expect(dialogMaxHeight(568, 0)).toBe(568 - 48);
    expect(dialogMaxHeight(568, 260)).toBe(568 - 260 - 48);
    expect(dialogMaxHeight(100, 300)).toBe(0);
  });
});
