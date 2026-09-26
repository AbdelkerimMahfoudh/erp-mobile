/**
 * The expense form's date and its draft (docs/57): a default never outlives the
 * day it was made on, and a submitted or discarded draft is not written back.
 *
 *   node lib/expense-form.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');

let passed = 0;
const it = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL  ${name}`);
    throw e;
  }
};

const form = code(read('app/expenses/new.tsx'));
const hook = code(read('lib/offline/use-draft.ts'));

it('only a date the person chose comes back from a draft; a default is today’s, whatever day the draft was written', () => {
  assert.match(form, /const \[dateTouched, setDateTouched\] = useState\(false\);/);
  assert.match(form, /dateTouched,\s*\},\s*\(v\) => \{/);
  assert.match(form, /const chosen = Boolean\(v\.dateTouched\) && typeof v\.spentOn === 'string' && \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(v\.spentOn\);/);
  assert.match(form, /setSpentOn\(chosen \? v\.spentOn! : localDay\(new Date\(\)\)\);\s*setDateTouched\(chosen\);/);
  // Typing in the date field is what makes it chosen.
  assert.match(form, /onChangeText=\{\(v\) => \{\s*setSpentOn\(v\);\s*setDateTouched\(true\);\s*\}\}/);
  assert.ok(!form.includes('placeholder="2026-09-18"'), 'no fixed example date');
});

it('discarding a restored draft puts the date back to today', () => {
  const discard = form.slice(form.indexOf('onDiscard={() => {'), form.indexOf('}}', form.indexOf('onDiscard={() => {')));
  assert.match(discard, /setSpentOn\(localDay\(new Date\(\)\)\);/);
  assert.match(discard, /setDateTouched\(false\);/);
});

it('the draft is written only when its content changed, and never straight after it was cleared', () => {
  assert.match(hook, /const content = JSON\.stringify\(value\);\s*if \(content === lastWritten\.current\) return;\s*lastWritten\.current = content;/);
  assert.match(hook, /const clear = useCallback\(\(\) => \{\s*if \(scope\) clearDraft\(form, scope, recordId\);[\s\S]*?lastWritten\.current = JSON\.stringify\(valueRef\.current\);/);
  assert.match(hook, /valueRef\.current = value;/);
});

console.log(`expense-form: ${passed} passed`);
