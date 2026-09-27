/**
 * Choose from stock, easier to scan (2026-09-27): each item a card set in from
 * both edges with room between the name, the variant, the masked identifier,
 * the price and the selection; a 64-pt target; and a long list kept fast — the
 * memoised row re-renders only when its own selection changes.
 *
 *   node lib/stock-picker-layout.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};
const src = readFileSync(new URL('../components/sell/PhonePicker.tsx', import.meta.url), 'utf8');
const picker = src.slice(src.indexOf('export function StockPicker'), src.indexOf('function StockFilterSheet'));
const row = src.slice(src.indexOf('const StockOption = React.memo'), src.indexOf('export function SelectedPhoneCard'));

it('each item is a card with the same side margins as the search above it, and air between cards', () => {
  assert.match(src, /option: \{[^}]*minHeight: touch\.large,[^}]*marginHorizontal: space\.base,[^}]*paddingVertical: space\.md,[^}]*paddingHorizontal: space\.base,[^}]*borderRadius: radius\.lg,/);
  assert.match(src, /shelfHead: \{ gap: space\.sm, paddingHorizontal: space\.base/);
  assert.match(src, /const Gap = \(\) => <View style=\{\{ height: space\.sm \}\} \/>;/);
  assert.match(picker, /ItemSeparatorComponent=\{Gap\}/);
});

it('name, variant and masked identifier each on their own line, apart; price and selection at the far edge', () => {
  assert.match(row, /<View style=\{\[styles\.grow, styles\.optionText\]\}>\s*<Text variant="bodyStrong">\{name\}<\/Text>/);
  assert.match(src, /optionText: \{ gap: space\.xs \}/);
  assert.match(row, /<Identifier>\{`•••• \$\{id\.slice\(-4\)\}`\}<\/Identifier>/);
  assert.match(row, /<View style=\{styles\.trailing\}>[\s\S]*styles\.price[\s\S]*styles\.radio/);
  assert.match(src, /optionSelected: \{\s*backgroundColor: colors\.intent\.info\.bg,\s*borderColor: colors\.intent\.info\.solid,/);
});

it('a long list stays fast: one stable callback, one stable renderItem, batched windows', () => {
  assert.match(picker, /const choose = useCallback\(\(row: InventoryUnitRow\) => onSelectRef\.current\(identifierOf\(row\), labelOf\(row\)\), \[\]\);/);
  assert.match(picker, /useEffect\(\(\) => \{\s*onSelectRef\.current = onSelect;\s*\}, \[onSelect\]\);/);
  assert.match(picker, /const renderRow = useCallback\(/);
  assert.match(picker, /keyExtractor=\{keyOfRow\}\s*renderItem=\{renderRow\}/);
  assert.match(picker, /initialNumToRender=\{10\}\s*maxToRenderPerBatch=\{8\}\s*updateCellsBatchingPeriod=\{50\}\s*windowSize=\{5\}/);
  assert.match(row, /onPress=\{\(\) => onChoose\(row\)\}/);
});

console.log(`stock-picker-layout: ${passed} passed`);
