/**
 * The compact Daily closing (docs/58), pinned in the source: what the screen
 * must keep doing whatever its styling becomes — the statement first, the
 * detail behind a tap, each channel with its own check, the close contract
 * untouched, and nothing added up on the phone.
 *
 *   node lib/daily-closing-screen.test.ts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

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
const sheet = code(read('components/closing/CloseDaySheet.tsx'));
const statement = screen.slice(screen.indexOf("<Card style={styles.statement}>"), screen.indexOf('<Warnings report={report}'));
// The slice ends on code, not on a comment: `code()` strips comments, so a comment marker would run the slice to the end of the file.
const movements = screen.slice(screen.indexOf("t('dailyReport.movements')"), screen.indexOf('<View style={styles.actions}>'));

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

it('Sales details — the one expandable of the statement — is figure rows only: invoiced, (cancelled, returned when nonzero), net, cost, gross profit, expenses, result; the words behind a (?)', () => {
  const details = statement.slice(statement.indexOf("t('dailyReport.salesDetails')"), statement.lastIndexOf('</Disclosure>'));
  for (const k of ['salesDetails.invoiced', 'sales.cancelled', 'sales.returns', 'sales.net', 'result.cost', 'result.gross', 'expenses.title', 'result.after']) {
    assert.ok(details.includes(`t('dailyReport.${k}'`), `sales details carry ${k}`);
  }
  for (const gone of ['sales.collected', 'sales.atCheckout', 'sales.laterSameDay', 'sales.owed', 'countRule', 'salesDetails.transactions', 'result.scope', 'result.how.body', 'result.beforeFixed']) {
    assert.ok(!details.includes(`t('dailyReport.${gone}'`), `sales details no longer carry ${gone}`);
  }
  assert.match(details, /cancellations\.count > 0 && report\.sales\.cancellations\.value !== 0/);
  assert.match(details, /returns\.count > 0 && report\.sales\.returns\.netRefundDue !== 0/);
  assert.ok(details.indexOf("t('dailyReport.sales.net')") < details.indexOf("t('dailyReport.result.cost')"));
  assert.ok(!/<Text\b/.test(details), 'no paragraph inside the details, only lines');
  assert.ok(!screen.includes('/sales/period'), 'no link to the transactions from the statement');
  // The explanation is asked for, never shown: a (?) beside the title opens it in its own dialog.
  assert.match(statement, /<IconButton\s+icon=\{HelpCircle\}[\s\S]*?accessibilityLabel=\{t\('dailyReport\.salesDetails\.help'\)\}[\s\S]*?dialog\.alert\(\{[\s\S]*?t\('dailyReport\.countRule'\)/);
  assert.equal((statement.match(/<Disclosure\b/g) ?? []).length, 1, 'one expandable on the statement');
});

it('no balance cards on the page: the drawer and the accounts are checked inside the closing popup, and the separate counting page is gone', () => {
  for (const gone of ['dailyReport.checkBalances', 'dailyReport.countCash', 'dailyReport.checkBalance', 'dailyReport.expected.account.note']) {
    assert.ok(!screen.includes(`t('${gone}'`), `the page no longer carries ${gone}`);
  }
  assert.ok(!screen.includes('/closing/count'), 'no route to a counting page');
  assert.ok(!existsSync(new URL('../app/closing/count.tsx', import.meta.url)), 'the counting page is removed');
  assert.ok(!existsSync(new URL('../components/closing/CloseReviewSheet.tsx', import.meta.url)), 'the old review sheet is removed');
  assert.ok(!read('lib/navigation/registry.ts').includes("'/closing/count'"), 'no route note for it');
  // The account's words stay in the popup: recorded movement, movement shown by the app, checked — never counted.
  assert.match(sheet, /account \? t\('dailyReport\.expected\.account'\) : cashUnanchored \? t\('dailyReport\.expected\.movementFromZero'\) : t\('closing\.expected\.drawer'\)/);
  assert.match(sheet, /account \? t\('closingCheck\.accountPrompt'\) : t\('closing\.countedLabel'\)/);
  assert.match(sheet, /verificationKey\(shown, account \? 'account' : 'cash'\)/);
  assert.match(code(read('lib/closing-report-view.ts')), /channel === 'account' && \(v === 'counted' \|\| v === 'stale'\)/);
  assert.match(screen, /p\.channel === 'account' \? 'closing\.history\.checked' : 'closing\.history\.counted'/);
});

it('Close the business day: a short popup — the question, then the amounts right there or the person’s word; never an invented figure, never matched, never a difference of 0 (docs/58 D71)', () => {
  assert.match(screen, /title=\{t\('dailyReport\.closeDay'\)\}[\s\S]*?onPress=\{\(\) => setClosing\(true\)\}/);
  assert.ok(!screen.includes("t('dailyReport.close')"), 'no "Review and close" left');
  assert.match(sheet, /type Step = 'ask' \| 'count' \| 'confirm';/);
  // The question is the step's own text, not a two-line caption; the title may wrap at large text.
  assert.match(sheet, /step === 'ask' \? \(\s*<View style=\{styles\.body\}>\s*<Text variant="heading">\{t\('closeDay\.question'\)\}<\/Text>/);
  assert.match(sheet, /titleLines=\{2\}/);
  assert.match(read('components/overlay/BottomSheet.tsx'), /<Text variant="heading" numberOfLines=\{titleLines\}>/);
  // The amount step only when there is a channel to show: a live view that did not load offers the attestation alone.
  assert.match(sheet, /const countable = canCount && rows\.length > 0;/);
  assert.match(sheet, /\{countable \? <Button title=\{t\('closeDay\.enterAmounts'\)\} fullWidth onPress=\{\(\) => setStep\('count'\)\} \/> : null\}/);
  assert.match(sheet, /title=\{t\('closeDay\.checked'\)\} variant=\{countable \? 'secondary' : 'primary'\} fullWidth onPress=\{\(\) => setStep\('confirm'\)\}/);
  // The confirmation signs what it shows: the day is read again as it opens.
  assert.match(sheet, /useEffect\(\(\) => \{\s*if \(open && step === 'confirm'\) onChanged\(\);\s*\}, \[open, step\]\);/);
  // The counting step scrolls under the keyboard and at large text, and pins nothing: its actions follow the last channel.
  assert.match(sheet, /step === 'count' \? \([\s\S]*?<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle=\{styles\.body\}>/);
  assert.match(sheet, /\) : step === 'count' \? \(\s*undefined\s*\) : \(/);
  assert.match(sheet, /\}\)\}\s*<View style=\{styles\.footer\}>[\s\S]*?t\('closeDay\.count\.continue'\)[\s\S]*?<\/View>\s*<\/ScrollView>/);
  // A typed amount is saved or cleared, never dropped: Continue waits and says why; Back clears; a change can be called off.
  assert.match(sheet, /const unsaved = rows\.some\(\(c\) => editing\(c\) && typed\(c\) !== ''\);/);
  assert.match(sheet, /disabled=\{saving \|\| unsaved\} onPress=\{\(\) => setStep\('confirm'\)\}/);
  assert.match(sheet, /\{unsaved \? \([\s\S]*?t\('closeDay\.count\.unsaved'\)/);
  assert.match(sheet, /const withoutAmount = rows\.filter\(\(c\) => !hasCount\(c\)\)\.length;/);
  assert.match(sheet, /const backToQuestion = \(\) => \{\s*setValues\(\{\}\);\s*setChanging\(\{\}\);/);
  assert.match(sheet, /title=\{t\('action\.cancel'\)\} accessibilityLabel=\{`\$\{t\('action\.cancel'\)\}, \$\{label\}`\} variant="tertiary" size="sm" disabled=\{saving\} onPress=\{\(\) => forget\(c\)\}/);
  // Only what the strict parser accepts is saved: Arabic-Indic digits, a signed movement for an account, two decimals at most.
  assert.match(sheet, /const amountOf = \(c: Row, v: string\) => parseAmount\(v, \{ allowNegative: c\.channel === 'account' \}\);/);
  assert.match(sheet, /const parsed = amountOf\(c, value\);\s*const invalid = !parsed\.ok && parsed\.reason === 'too_precise';/);
  assert.match(sheet, /disabled=\{saving \|\| !parsed\.ok\}/);
  // Each field and its buttons name the channel they belong to.
  assert.match(sheet, /accessibilityLabel=\{`\$\{label\}, \$\{prompt\}`\}/);
  assert.match(sheet, /accessibilityLabel=\{`\$\{t\('closing\.row\.save'\)\}, \$\{label\}`\}/);
  assert.match(sheet, /counted: amount\.value \}/);
  assert.match(sheet, /allowNegative=\{account\}/);
  assert.match(sheet, /error=\{invalid \? t\('closeDay\.count\.invalid'\) : undefined\}/);
  // A signed figure is written left to right, so "-300" reads "-300" in Arabic too.
  assert.match(code(read('components/ui/Field.tsx')), /variant=\{allowNegative \? 'amount' : 'default'\}/);
  assert.match(code(read('components/ui/Field.tsx')), /writingDirection: writingDirection\(isIdentifier \|\| isAmount\)/);
  const field = code(read('components/ui/Field.tsx'));
  assert.match(field, /onChangeText=\{\(text\) => onChangeText\?\.\(maskAmount\(text, allowNegative\)\)\}/);
  assert.match(field, /keyboardType=\{allowNegative \? Platform\.select\(\{ ios: 'numbers-and-punctuation', default: 'numeric' \}\) : 'decimal-pad'\}/);
  assert.match(field, /inputMode=\{allowNegative \? undefined : 'decimal'\}/);
  // Each opening starts on the question, reset while rendering the opening — the last step never flashes.
  assert.match(sheet, /if \(open !== shownOpen\) \{\s*setShownOpen\(open\);\s*if \(open\) \{\s*setStep\('ask'\);/);
  // The amounts are saved one by one through the same count request, and the report is read again before confirming.
  assert.match(sheet, /recordCount\(\s*\{ channel: c\.channel, accountId: c\.accountId \?\? undefined, counted: amount\.value \}/);
  assert.match(sheet, /onSuccess: \(\) => \{[\s\S]*?onChanged\(\);/);
  // The attestation travels as a flag, only when something has no amount; the close keeps its key and its version.
  assert.match(sheet, /const clientUuid = useMemo\(\(\) => \(open \? uuidv4\(\) : ''\), \[open\]\);/);
  assert.match(sheet, /reportVersion: report\.reportVersion,\s*\.\.\.\(needsAttest \? \{ attestChecked: true \} : \{\}\),/);
  // A refusal is read again by the close's own invalidation, and the button waits while the figures are re-read.
  assert.match(sheet, /e\.code === 'report_changed'\) \{\s*toast\.error\(t\('closeReview\.changed'\)\);\s*return;/);
  assert.match(sheet, /e\.code === 'already_closed'\) \{\s*toast\.info\(t\('closeDay\.alreadyClosed'\)\);/);
  assert.match(sheet, /busy: close\.isPending \|\| refreshing,/);
  assert.match(screen, /refreshing=\{report\.isFetching \|\| day\.isFetching\}/);
  assert.match(code(read('lib/closing-report.ts')), /onSettled: \(\) => \{\s*void qc\.invalidateQueries\(\{ queryKey: qk\.dailyReport\(branchId, date \?\? 'today'\) \}\);/);
  assert.ok(!/acknowledgeUnverified|reason:/.test(sheet), 'no acknowledgement toggle, no reason field');
  assert.ok(!/difference: 0|counted: 0|matched/.test(sheet), 'nothing invented');
  assert.match(sheet, /const shown = v === 'counted' \? v : 'attested';/);
  assert.match(sheet, /t\('closeDay\.attest\.note'\)/);
  assert.match(sheet, /disabled=\{!enabled\}/);
  const view = code(read('lib/closing-report-view.ts'));
  assert.match(view, /if \(v === 'attested'\) return 'info';/);
  assert.match(view, /return input\.attested;/);
  const en = read('lib/i18n/en.ts');
  for (const [k, v] of [['dailyReport.closeDay', 'Close the business day'], ['closeDay.question', 'Have you checked today’s cash and account movements?'], ['closeDay.enterAmounts', 'Enter the amounts'], ['closeDay.checked', 'I’ve checked'], ['closeDay.checkedNoAmounts', 'Checked; amounts not recorded.'], ['dailyReport.verify.attested', 'Checked; amounts not recorded']]) {
    assert.ok(en.includes(`'${k}': '${v}'`), `${k} reads "${v}"`);
  }
});

it('Closing history is one rectangle: a header with the count and the chevron at the end, the entries sliding out beneath it, none of the motion under reduced motion', () => {
  assert.match(screen, /<HistoryPanel title=\{t\('dailyReport\.history'\)\} count=\{day\.history\.length\}>/);
  assert.ok(!/<Section title=\{t\('dailyReport\.history'\)\}>/.test(screen), 'no second "Closing history" heading');
  assert.ok(!screen.includes("t('closingHistory.history')"), 'the disclosure title is gone with it');
  const panel = code(read('components/closing/HistoryPanel.tsx'));
  // The phone's setting as it is now, not as it was when the app started.
  assert.match(panel, /const reduceMotion = useReduceMotionSetting\(\);/);
  const live = code(read('lib/design/use-reduce-motion.ts'));
  // One subscription for the app: react-native-web keys listeners by the handler's text, and may return none.
  assert.match(live, /AccessibilityInfo\.addEventListener\('reduceMotionChanged', tell\);/);
  assert.ok(!/\.remove\(\)/.test(live), 'no subscription is removed per component');
  assert.match(live, /const \[reduce, setReduce\] = useState\(known \?\? atLaunch\);/);
  assert.match(live, /return \(\) => \{\s*listeners\.delete\(setReduce\);\s*\};/);
  assert.ok(panel.includes('accessibilityLabel={`${title}, ${count}`}'), 'the count is part of the announced name');
  assert.match(panel, /progress\.value = reduceMotion \? \(next \? 1 : 0\) : withTiming\(next \? 1 : 0/);
  assert.match(panel, /height: contentHeight \* progress\.value/);
  assert.match(panel, /translateY: \(progress\.value - 1\) \* SLIDE/);
  assert.match(panel, /<Animated\.View style=\{chevronStyle\}>\s*<ChevronDown/);
  assert.match(panel, /accessibilityState=\{\{ expanded: open \}\}/);
  assert.match(screen, /day\.history\.map\(\(h, i\) => <HistoryRow/);
});

it('Money movements is always in view: each channel’s recorded movement, a line, the debt settled (inside the channels, not added again), the total recorded movement said as such — no client sums', () => {
  assert.ok(!/<Disclosure\b/.test(movements), 'no expand/collapse on Money movements');
  assert.match(movements, /\.filter\(\(c\) => c\.countable \|\| c\.net !== 0\)[\s\S]*?<Line key=\{c\.key\} label=\{c\.channel === 'cash' \? t\('dailyReport\.expected\.cash'\) : channelLabel\(c, words\)\} value=\{c\.net\} signed tone="auto" \/>/);
  assert.match(movements, /<Divider \/>\s*<Line label=\{t\('dailyReport\.movements\.debtSettled'\)\} value=\{report\.money\.totals\.olderDebts\} quiet \/>\s*<Line label=\{t\('dailyReport\.movements\.total'\)\} value=\{report\.money\.totals\.net\} strong signed \/>/);
  assert.match(movements, /t\('dailyReport\.movements\.total\.note'\)/);
  for (const gone of ['money.in', 'money.out', 'money.net', 'money.details', 'expenses.total', 'expenses.reversal', 'movements.hint']) {
    assert.ok(!movements.includes(`t('dailyReport.${gone}'`), `movements no longer carry ${gone}`);
  }
  assert.ok(!screen.includes('function ChannelDetail('), 'the per-channel detail is gone');
  assert.ok(!/\.reduce\(|\+= |\bsum\(/.test(screen), 'the phone adds nothing up');
  const en = read('lib/i18n/en.ts');
  assert.ok(en.includes("'dailyReport.movements.total': 'Money in the shop — recorded movement'"));
  assert.ok(en.includes("'dailyReport.movements.debtSettled': 'Debt settled for this day (included above)'"));
});

it('Close the business day, Correct a transaction, Unsettled differences and Closing history are there, on the same contract as before', () => {
  assert.match(screen, /<CloseDaySheet[\s\S]*?onClose=\{\(\) => setClosing\(false\)\}[\s\S]*?report=\{report\}[\s\S]*?day=\{day\}[\s\S]*?freshness=\{freshness\}[\s\S]*?canCount=\{canCount\}/);
  // The loan reminders the counting page carried stay at closing time, as their own query and only when something waits.
  assert.match(screen, /\{report\.isToday \? <LoanReminders \/> : null\}/);
  assert.match(screen, /const reminders = useClosingReminders\(canSee\);/);
  assert.match(screen, /r\.proposalsNeedingAnswer === 0 && r\.paymentsAwaitingConfirmation === 0 && r\.balancesOutstanding === 0\) return null;/);
  // A close with the drawer counted still names the balances it took on the person's word.
  assert.match(screen, /Number\(p\.attestedCount \?\? 0\) > 0 \? t\('closing\.history\.attested', \{ count: String\(p\.attestedCount\) \}\) : null,/);
  assert.match(screen, /title=\{t\('dailyReport\.correct'\)\}[\s\S]*?pathname: '\/closing\/sources'/);
  assert.match(screen, /title=\{t\('closing\.differences\.link'\)\} onPress=\{\(\) => router\.push\('\/discrepancies' as never\)\}/);
  assert.match(screen, /report\.isToday && closed && canClose && day\?\.canReopen/);
  assert.match(screen, /<DayChoiceSheet\s+intent="reopen"/);
  assert.match(screen, /<DayChoiceSheet\s+key=\{openSheetNonce\}\s+intent="open"/);
  const closeHook = code(read('lib/closing-report.ts'));
  assert.match(closeHook, /mutationFn: \(body: CloseDayBody\) => api\.post<CloseDayResult>\('\/closings', body\)/);
});

it('every catalogue carries the section and popup words, and none of the removed page’s', () => {
  const keys = ['dailyReport.salesDetails', 'dailyReport.salesDetails.invoiced', 'dailyReport.salesDetails.help', 'dailyReport.account.counted', 'dailyReport.movements', 'dailyReport.movements.debtSettled', 'dailyReport.movements.total', 'dailyReport.movements.total.note', 'dailyReport.result.cannot.short', 'dailyReport.closeDay', 'closeDay.question', 'closeDay.count.unsaved', 'closeDay.alreadyClosed', 'closing.loans.title'];
  const gone = ['dailyReport.checkBalances', 'dailyReport.countCash', 'dailyReport.checkBalance', 'dailyReport.close', 'closeReview.acknowledge', 'closingCheck.title', 'closing.skip.action', 'closingHistory.history'];
  for (const lang of ['en', 'fr', 'ar']) {
    const catalogue = read(`lib/i18n/${lang}.ts`);
    for (const key of keys) assert.ok(catalogue.includes(`'${key}':`), `${lang} lacks ${key}`);
    for (const key of gone) assert.ok(!catalogue.includes(`'${key}':`), `${lang} still carries ${key}`);
  }
});

console.log(`daily-closing-screen: ${passed} passed`);
