/**
 * The compact Daily closing (docs/58), pinned in the source: what the screen
 * must keep doing whatever its styling becomes — the statement first, the
 * detail behind a tap, each channel with its own check, the close contract
 * untouched, and nothing added up on the phone.
 *
 *   node lib/daily-closing-screen.test.ts
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

const screen = code(read('app/closing/index.tsx'));
const count = code(read('app/closing/count.tsx'));
const statement = screen.slice(screen.indexOf("<Card style={styles.statement}>"), screen.indexOf('<Warnings report={report}'));
const balances = screen.slice(screen.indexOf("t('dailyReport.checkBalances')"), screen.indexOf("t('dailyReport.movements')"));
const movements = screen.slice(screen.indexOf("t('dailyReport.movements')"), screen.indexOf("{/* ── The actions of the day ── */}"));

it('the first view is the statement: sales and items, then gross profit, expenses and result only where permitted and calculable', () => {
  assert.match(statement, /t\('dailyReport\.headline'\)/);
  assert.match(statement, /count: String\(report\.sales\.salesCount \?\? report\.sales\.count\)/);
  assert.match(statement, /\{resultOk \? <Line label=\{t\('dailyReport\.result\.gross'\)\}/);
  assert.match(statement, /\{report\.expenses \? <Line label=\{t\('dailyReport\.expenses\.title'\)\} value=\{-report\.expenses\.total\}/);
  assert.match(statement, /\{resultOk \? <Line label=\{t\('dailyReport\.result\.after'\)\}/);
  assert.match(statement, /\{resultBlocked \? \([\s\S]*?t\('dailyReport\.result\.cannot\.short'/);
  assert.match(screen, /const resultOk = result\.status === 'ok';/);
  // Never "net profit": the result keeps its own words.
  assert.ok(!/net profit/i.test(read('lib/i18n/en.ts').split("'dailyReport.")[1] ?? ''), 'no "net profit" wording');
});

it('Sales details — the one expandable of the statement — explains invoiced sales, cancellations, returns, net, how the result follows, collected and owed, and leads to the transactions', () => {
  const details = statement.slice(statement.indexOf("t('dailyReport.salesDetails')"), statement.lastIndexOf('</Disclosure>'));
  for (const k of ['salesDetails.invoiced', 'sales.cancelled', 'sales.returns', 'sales.net', 'result.cost', 'result.gross', 'result.after', 'result.scope', 'result.how.body', 'sales.collected', 'sales.atCheckout', 'sales.laterSameDay', 'sales.owed', 'countRule', 'salesDetails.transactions']) {
    assert.ok(details.includes(`t('dailyReport.${k}'`), `sales details carry ${k}`);
  }
  // The result's lines follow net sales, before the money side; a result that cannot be calculated says so there.
  assert.ok(details.indexOf("t('dailyReport.sales.net')") < details.indexOf("t('dailyReport.result.cost')") && details.indexOf("t('dailyReport.result.after')") < details.indexOf("t('dailyReport.sales.collected')"));
  assert.match(details, /resultBlocked \? \([\s\S]*?t\('dailyReport\.result\.cannot'\)/);
  assert.match(details, /router\.push\(`\/sales\/period\?day=\$\{report\.date\}` as Href\)/);
  assert.equal((statement.match(/<Disclosure\b/g) ?? []).length, 1, 'one expandable on the statement');
});

it('Check balances: the drawer and each account, what was recorded, how it stands, its own count or check', () => {
  assert.match(balances, /t\('dailyReport\.checkBalances\.optional'\)/);
  assert.match(balances, /t\('dailyReport\.expected\.cash'\)[\s\S]*?verificationTone\(cash\.verification, cash\.difference\)/);
  // With no counted opening the drawer's figure is the recorded movement from 0 — never "should be in the drawer".
  assert.match(balances, /t\(cash\.opening\.anchorDate === null \? 'dailyReport\.expected\.movementFromZero' : 'dailyReport\.expected\.expected'\)\} value=\{cash\.expected\} strong/);
  assert.match(code(read('components/closing/CloseReviewSheet.tsx')), /anchorDate === null \? 'dailyReport\.expected\.movementFromZero' : 'closeReview\.expected'/);
  // An account is checked against its app, never counted.
  assert.match(balances, /verificationKey\(a\.verification, 'account'\)/);
  assert.match(code(read('lib/closing-report-view.ts')), /channel === 'account' && \(v === 'counted' \|\| v === 'stale'\)/);
  for (const [k, v] of [['dailyReport.expected.movementFromZero', 'Recorded cash movement, from a 0 start'], ['dailyReport.verify.account.counted', 'Checked against the app'], ['dailyReport.checkBalance', 'Check movement'], ['dailyReport.account.counted', 'Movement in the account app'], ['closingCheck.accountPrompt', 'Movement shown by the account app']]) {
    assert.ok(read('lib/i18n/en.ts').includes(`'${k}': '${v}'`), `${k} reads "${v}"`);
  }
  // The counting screen says the same: recorded movement for an account, checked (not counted) once compared, the drawer's figure by its anchor.
  assert.match(count, /account\s*\? t\('dailyReport\.expected\.account'\)\s*: cashAnchored === null\s*\? t\('closing\.expected'\)\s*: cashAnchored\s*\? t\('closing\.expected\.drawer'\)\s*: t\('dailyReport\.expected\.movementFromZero'\)/);
  assert.match(count, /t\(account \? 'closing\.channel\.checked' : 'closing\.channel\.counted'\)/);
  assert.match(count, /t\(account \? 'dailyReport\.account\.counted' : 'closing\.counted'\)/);
  assert.match(count, /t\(account \? 'closingCheck\.recheck' : 'closingCheck\.recount'\)/);
  assert.match(screen, /p\.channel === 'account' \? 'closing\.history\.checked' : 'closing\.history\.counted'/);
  assert.match(balances, /\{cash\.counted !== null \? \([\s\S]*?t\('dailyReport\.expected\.counted'\)[\s\S]*?t\('dailyReport\.expected\.difference'\)/);
  assert.match(balances, /t\('dailyReport\.countCash'\)[\s\S]*?checkChannel\('cash'\)/);
  // An account shows its recorded movement, never a balance — and says so.
  assert.match(balances, /accounts\.map\(\(a\) => \([\s\S]*?t\('dailyReport\.expected\.account'\)\} value=\{a\.expectedMovement\} strong signed/);
  assert.match(balances, /t\('dailyReport\.account\.counted'\)\} value=\{a\.counted\}/);
  assert.match(balances, /t\('dailyReport\.checkBalance'\)[\s\S]*?checkChannel\(a\.accountId \?\? a\.key\)/);
  assert.match(balances, /t\('dailyReport\.expected\.account\.note'\)/);
  assert.match(screen, /const canCheck = report\.isToday && canCount && !closed;/);
  assert.match(screen, /const checkChannel = \(focus: string\) => router\.push\(\{ pathname: '\/closing\/count', params: \{ focus \} \}/);
  // The counting screen takes the channel by name and focuses it.
  assert.match(count, /useLocalSearchParams<\{ focus\?: string \}>\(\)/);
  assert.match(count, /focused=\{focus !== undefined && focus === \(item\.channel === 'cash' \? 'cash' : \(item\.accountId \?\? ''\)\)\}/);
  assert.match(count, /autoFocus=\{focused && !disabled\}/);
});

it('Money movements holds the calculation detail: by channel, totals, details, expenses — with no client sums', () => {
  for (const k of ['movements.hint', 'money.in', 'money.olderDebts', 'money.out', 'money.net', 'money.details', 'expenses.title', 'expenses.total', 'expenses.reversal']) {
    assert.ok(movements.includes(`t('dailyReport.${k}'`), `movements carry ${k}`);
  }
  assert.match(movements, /<ChannelDetail key=\{c\.key\} channel=\{c\} label=\{channelLabel\(c, words\)\} \/>/);
  assert.ok(!/\.reduce\(|\+= |\bsum\(/.test(screen), 'the phone adds nothing up');
});

it('Review & close, Correct a transaction and Closing history are there, on the same contract as before', () => {
  assert.match(screen, /title=\{t\('dailyReport\.close'\)\}[\s\S]*?onPress=\{\(\) => setReview\(true\)\}/);
  assert.match(screen, /<CloseReviewSheet[\s\S]*?report=\{report\}[\s\S]*?freshness=\{freshness\}/);
  assert.match(screen, /title=\{t\('dailyReport\.correct'\)\}[\s\S]*?pathname: '\/closing\/sources'/);
  assert.match(screen, /<Section title=\{t\('dailyReport\.history'\)\}>/);
  assert.match(screen, /report\.isToday && closed && canClose && day\?\.canReopen/);
  assert.match(screen, /<DayChoiceSheet\s+intent="reopen"/);
  assert.match(screen, /<DayChoiceSheet\s+key=\{openSheetNonce\}\s+intent="open"/);
  const closeHook = code(read('lib/closing-report.ts'));
  assert.match(closeHook, /mutationFn: \(body: CloseDayBody\) => api\.post<CloseDayResult>\('\/closings', body\)/);
});

it('every catalogue carries the new section words', () => {
  const keys = ['dailyReport.salesDetails', 'dailyReport.salesDetails.invoiced', 'dailyReport.salesDetails.transactions', 'dailyReport.checkBalances', 'dailyReport.checkBalances.optional', 'dailyReport.countCash', 'dailyReport.checkBalance', 'dailyReport.account.counted', 'dailyReport.movements', 'dailyReport.movements.hint', 'dailyReport.result.cannot.short'];
  for (const lang of ['en', 'fr', 'ar']) {
    const catalogue = read(`lib/i18n/${lang}.ts`);
    for (const key of keys) assert.ok(catalogue.includes(`'${key}':`), `${lang} lacks ${key}`);
  }
});

console.log(`daily-closing-screen: ${passed} passed`);
