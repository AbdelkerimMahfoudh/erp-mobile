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
  const details = statement.slice(statement.indexOf('<View style={styles.detail}>'), statement.indexOf('</Expandable>'));
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
  assert.ok(!/<Disclosure\b/.test(statement), 'the statement’s one expandable is Sales details');
  // One line on the shared Expandable: the title with its chevron right after it, the (?) at the end, handed over as
  // `trailing` so it opens the explanation and never the rows.
  assert.match(
    statement,
    /<Expandable\s+title=\{t\('dailyReport\.salesDetails'\)\}\s+tone="accent"\s+chevron="afterTitle"\s+open=\{detailsOpen\}\s+onOpenChange=\{setDetailsOpen\}\s+trailing=\{\s*<IconButton\s+icon=\{HelpCircle\}[\s\S]*?\/>\s*\}\s*>\s*<View style=\{styles\.detail\}>/,
  );
  assert.ok(!details.includes('HelpCircle'), 'the (?) is not among the rows');
  const expandable = code(read('components/ui/Expandable.tsx'));
  assert.match(expandable, /<\/Pressable>\s*\{trailing\}\s*<\/View>/, 'trailing sits beside the toggle, outside it');
  // The rows keep their styles and the statement's full width: the accent body adds no horizontal inset.
  assert.match(details, /^<View style=\{styles\.detail\}>\s*<Line label=\{t\('dailyReport\.salesDetails\.invoiced'\)\}/);
  assert.match(expandable, /accentBody: \{ paddingTop: space\.sm \}/);
  // The toggle built on the page is gone with its styles.
  assert.ok(!/<Pressable\b|ChevronDown|detailsHead|detailsToggle|styles\.up\b|styles\.shrink\b/.test(screen), 'no hand-built toggle left');
  // A light-violet wash, the title underlined in the accent, the chevron straight after the words.
  assert.match(expandable, /wash: \{ backgroundColor: colors\.intent\.info\.bg, borderRadius: radius\.sm \}/);
  assert.match(expandable, /link: \{ textDecorationLine: 'underline' \}/);
  assert.match(expandable, /const ink = solid \? colors\.intent\.info\.onSolid : colors\.text\.accent;/);
  assert.match(expandable, /\{edge \? <View style=\{\{ width: size \}\} \/> : null\}\s*\{words\}\s*\{turn\}/);
  assert.match(expandable, /words: \{ flexShrink: 1, minWidth: 0 \}/);
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

it('Closing history is one rectangle: a purple header saying "Closing history" and how many events, the chevron at the right edge, the entries sliding out beneath it, none of the motion under reduced motion', () => {
  assert.match(screen, /<HistoryPanel title=\{t\('dailyReport\.history'\)\} count=\{day\.history\.length\}>/);
  assert.ok(!/<Section title=\{t\('dailyReport\.history'\)\}>/.test(screen), 'no second "Closing history" heading');
  assert.ok(!screen.includes("t('closingHistory.history')"), 'the disclosure title is gone with it');
  const panel = code(read('components/closing/HistoryPanel.tsx'));
  const expandable = code(read('components/ui/Expandable.tsx'));
  // The count in words under the title, never a bare number; the same words in the announced name.
  assert.match(panel, /const meta = count === 0 \? t\('closing\.history\.events\.none'\) : count === 1 \? t\('closing\.history\.events\.one'\) : t\('closing\.history\.events', \{ count \}\);/);
  assert.ok(panel.includes('<Expandable title={title} meta={meta} tone="solid" chevron="edge" accessibilityLabel={`${title}, ${meta}`}>'), 'a solid header, chevron at the edge, title and count announced');
  assert.ok(!/<Pressable\b|useSharedValue/.test(panel), 'the panel is a thin wrapper; the motion lives in Expandable');
  // The phone's setting as it is now, not as it was when the app started.
  assert.match(expandable, /const reduceMotion = useReduceMotionSetting\(\);/);
  const live = code(read('lib/design/use-reduce-motion.ts'));
  // One subscription for the app: react-native-web keys listeners by the handler's text, and may return none.
  assert.match(live, /AccessibilityInfo\.addEventListener\('reduceMotionChanged', tell\);/);
  assert.ok(!/\.remove\(\)/.test(live), 'no subscription is removed per component');
  assert.match(live, /const \[reduce, setReduce\] = useState\(known \?\? atLaunch\);/);
  assert.match(live, /return \(\) => \{\s*listeners\.delete\(setReduce\);\s*\};/);
  // The reveal: the body is as tall as the measured rows times the progress, and the rows hang from its bottom, so
  // they come out from beneath the header and fold back the same way; both snap under reduced motion.
  assert.match(expandable, /const SLIDE = \{ duration: duration\.base, easing: Easing\.out\(Easing\.cubic\) \};/);
  assert.match(expandable, /progress\.value = reduceMotion \? to : withTiming\(to, SLIDE\);/);
  assert.match(expandable, /height: measured\.value \* progress\.value/);
  assert.match(expandable, /translateY: \(progress\.value - 1\) \* measured\.value/);
  assert.match(expandable, /<Animated\.View onLayout=\{onLayout\} style=\{\[styles\.measure, /);
  assert.match(expandable, /measure: \{ position: 'absolute', left: 0, right: 0, top: 0 \}/);
  // An event arriving while open eases the body to its new height; the first measure lands as it is.
  assert.match(expandable, /measured\.value = height\.current !== null && isOpen && !reduceMotion \? withTiming\(h, SLIDE\) : h;/);
  // Closed, the chevron points forward (right, or left in Arabic); open, down. The wrapper turns, never the SVG.
  assert.match(expandable, /const closedAngle = layoutIsRTL\(\) \? 90 : -90;/);
  assert.ok(expandable.includes('rotate: `${(1 - progress.value) * closedAngle}deg`'), 'the chevron turns with the reveal');
  assert.match(expandable, /<Animated\.View style=\{turnStyle\}>\s*<ChevronDown size=\{size\} strokeWidth=\{solid \? 2\.5 : 2\} color=\{ink\} \/>/);
  // The purple of the day's main button (the info intent's solid, darker while held), white on it, in its own card
  // with the button's radius; the chevron kept at the physical right edge in both directions.
  assert.match(expandable, /solid \? \{ backgroundColor: pressed \? colors\.intent\.info\.solidPressed : colors\.intent\.info\.solid \} : styles\.wash/);
  assert.match(expandable, /card: \{ overflow: 'hidden', borderRadius: radius\.md \}/);
  assert.match(expandable, /solidToggle: \{ minHeight: touch\.comfortable,/);
  assert.match(expandable, /edge \? \{ flexDirection: layoutIsRTL\(\) \? 'row-reverse' : 'row' \} : null/);
  assert.match(expandable, /centre: \{ flex: 1, minWidth: 0, alignItems: 'center', gap: 2 \}/);
  assert.ok(!/numberOfLines/.test(expandable), 'the title wraps at large text');
  assert.ok(!/colors\.brand\[/.test(expandable), 'semantic colours only');
  // Pressed state from usePressed and a plain style array — native drops a function style.
  assert.match(expandable, /const \{ pressed, pressHandlers \} = usePressed\(\);/);
  assert.match(expandable, /\{\.\.\.pressHandlers\}\s*style=\{\[/);
  assert.ok(!/style=\{\s*(\(|function\b)/.test(expandable), 'no function style');
  // Announced as a button that says whether it is open; folded rows hidden from readers.
  assert.match(expandable, /accessibilityRole="button"/);
  assert.match(expandable, /accessibilityState=\{\{ expanded: isOpen \}\}\s*aria-expanded=\{isOpen\}/);
  assert.match(expandable, /aria-hidden=\{!isOpen\}\s*accessibilityElementsHidden=\{!isOpen\}\s*importantForAccessibility=\{isOpen \? 'auto' : 'no-hide-descendants'\}/);
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
  // The Money owed card is gone, counts, amount, words and link (2026-09-27); Debt settled stays in Money movements.
  assert.ok(!/LoanReminders|useClosingReminders|closing\.loans\./.test(screen), 'no Money owed card');
  assert.ok(!read('lib/loans.ts').includes('useClosingReminders'), 'its hook is gone with it');
  assert.match(screen, /t\('dailyReport\.movements\.debtSettled'\)/);
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
  const keys = ['dailyReport.salesDetails', 'dailyReport.salesDetails.invoiced', 'dailyReport.salesDetails.help', 'dailyReport.account.counted', 'dailyReport.movements', 'dailyReport.movements.debtSettled', 'dailyReport.movements.total', 'dailyReport.movements.total.note', 'dailyReport.result.cannot.short', 'dailyReport.closeDay', 'closeDay.question', 'closeDay.count.unsaved', 'closeDay.alreadyClosed', 'closing.history.events.none', 'closing.history.events.one', 'closing.history.events'];
  const gone = ['dailyReport.checkBalances', 'dailyReport.countCash', 'dailyReport.checkBalance', 'dailyReport.close', 'closeReview.acknowledge', 'closingCheck.title', 'closing.skip.action', 'closingHistory.history', 'closing.loans.title', 'returns.policy.reason', 'returns.policy.reasonRequired'];
  for (const lang of ['en', 'fr', 'ar']) {
    const catalogue = read(`lib/i18n/${lang}.ts`);
    for (const key of keys) assert.ok(catalogue.includes(`'${key}':`), `${lang} lacks ${key}`);
    for (const key of gone) assert.ok(!catalogue.includes(`'${key}':`), `${lang} still carries ${key}`);
  }
});

it('the popup says Sell and Receive wait after the close, no line says a sale reopens the day, and "no events" fits any day (2026-09-27)', () => {
  const words = {
    en: ['After closing, Sell and Receive wait until the Owner or a named delegate opens the store again.', 'No events'],
    fr: ['Après la clôture, la vente et la réception attendent que le propriétaire ou un délégué désigné rouvre la boutique.', 'Aucun événement'],
    ar: ['بعد الإقفال، يتوقف البيع والاستلام حتى يعيد المالك أو مفوَّض مسمّى فتح المتجر.', 'لا أحداث'],
  };
  for (const [lang, [selling, none]] of Object.entries(words)) {
    const catalogue = read(`lib/i18n/${lang}.ts`);
    assert.ok(catalogue.includes(`'closeReview.selling': '${selling}',`), `${lang}: closeReview.selling`);
    assert.ok(catalogue.includes(`'closing.history.events.none': '${none}',`), `${lang}: closing.history.events.none`);
    assert.ok(!catalogue.includes("'closingHistory.closed.note':"), `${lang} still says a sale reopens the day`);
  }
  assert.match(code(read('components/closing/CloseDaySheet.tsx')), /\{t\('closeReview\.selling'\)\}/);
});

console.log(`daily-closing-screen: ${passed} passed`);
