import React, { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useLeave } from '../../components/navigation/HeaderBack';
import { ArrowRight, Plus, ScanLine, Trash2 } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  EmptyState,
  RowGroup,
  Screen,
  SearchInput,
  Section,
  SegmentedControl,
  Stepper,
  Text,
} from '../../components/ui';
import { CategoryIllustrationIcon } from '../../components/ui/CategoryIllustration';
import { ScannerSheet } from '../../components/scanner';
import { api } from '../../lib/api-client';
import { useActiveBranchName, useBranch } from '../../lib/branch';
import { illustrationForNested, type CategoryIllustration } from '../../lib/category-illustration';
import { useColors } from '../../lib/design/theme';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { toFriendlyError } from '../../lib/errors';
import { maskIdentifier } from '../../lib/file-receiving-rules';
import { haptics } from '../../lib/haptics';
import { isRTL, useTranslation, type TranslationKey, type TranslationValues } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';
import {
  addStockToDraft,
  addUnitToDraft,
  canSubmitDraft,
  countDraft,
  draftToBody,
  hasUnsavedDraft,
  isStockLine,
  isUnitLine,
  removeStockFromDraft,
  removeUnitFromDraft,
  setLineQuantity,
  submitIntent,
  type DraftLine,
  type StockCandidate,
} from '../../lib/transfer-draft';
import { transferProblems, useCreateTransfer } from '../../lib/transfers';
import type { InventoryPage, InventoryStockRow, InventoryUnitRow, UserBranch } from '../../types/api';

type Row = InventoryUnitRow | InventoryStockRow;

/**
 * Request a transfer: route, one way to add anything, the list, then review (D226, docs/111 §5).
 *
 * One search box finds any item at the source boutique by name, IMEI, serial or
 * barcode, and the scan button beside it does the same with the camera. There
 * is no separate phone entry and no accessory section: the result says what the
 * item is, and the draft rules decide how it is counted. A phone is one object,
 * so adding it twice is reported; an accessory is a count, so it grows.
 *
 * The request id is minted once when the draft begins and reused for every
 * retry, so a timeout is safe: the server recognises the replay.
 *
 * No cost, margin or selling price appears anywhere on this screen.
 */
export default function NewTransferScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const exit = useLeave('/transfers/new');
  const { branchId } = useBranch();
  const branchName = useActiveBranchName();
  const branches = useQuery({
    queryKey: qk.branches,
    queryFn: () => api.get<UserBranch[]>('/auth/branches'),
  });
  const create = useCreateTransfer();
  const canApproveHere = usePermission('transfer.approve');
  const colors = useColors();

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [toBranchId, setToBranchId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [search, setSearch] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const requestId = useRef<string>(uuidv4());

  /** Every other boutique in the company: a transfer to the source itself is refused. */
  const destinations = useMemo(
    () => (branches.data ?? []).filter((b) => b.id !== branchId),
    [branches.data, branchId],
  );
  const toName = destinations.find((b) => b.id === toBranchId)?.name ?? null;

  /** Anything at THIS boutique, searched on the server: units and quantity stock alike. */
  const query = search.trim();
  const results = useQuery({
    queryKey: [...qk.inventory(branchId), 'transfer-pick', query],
    enabled: query.length > 1,
    queryFn: () => api.get<InventoryPage>(`/inventory?search=${encodeURIComponent(query)}&limit=20`),
  });
  const rows = (results.data?.rows ?? []) as Row[];

  const counts = countDraft(lines);
  const intent = submitIntent(canApproveHere);
  const canSubmit = canSubmitDraft({ lines, toBranchId, fromBranchId: branchId });
  const dirty = hasUnsavedDraft(lines, submitted);

  const leave = async () => {
    if (!dirty) {
      exit();
      return;
    }
    const ok = await dialog.confirm({
      title: t('transfers.new.discard.title'),
      message: t('transfers.new.discard.body', { count: summaryText(counts, t) }),
      confirmLabel: t('transfers.new.discard.confirm'),
      cancelLabel: t('transfers.new.keep'),
      tone: 'danger',
    });
    if (ok) exit();
  };

  const addUnit = (row: InventoryUnitRow) => {
    if (row.status !== 'in_stock') {
      void haptics.error();
      toast.error(t('transfers.new.unavailable', { product: productLabel(row) }));
      return;
    }
    const result = addUnitToDraft(lines, row.identifier, {
      product: productLabel(row),
      illustration: illustrationOf(row),
    });
    if (!result.ok) {
      void haptics.error();
      toast.error(t('transfers.new.duplicate'));
      return;
    }
    void haptics.success();
    setLines(result.lines);
    setSearch('');
    toast.success(t('transfers.new.added', { product: productLabel(row) }));
  };

  const addStock = (row: InventoryStockRow) => {
    const candidate = toCandidate(row);
    const result = addStockToDraft(lines, candidate);
    if (result.ok) {
      void haptics.success();
      setLines(result.lines);
      setSearch('');
      toast.success(
        result.merged
          ? t('transfers.new.merged', { product: candidate.product })
          : t('transfers.new.added', { product: candidate.product }),
      );
      return;
    }
    void haptics.error();
    if (result.reason === 'none_available') {
      toast.error(t('transfers.new.noneAvailable', { product: candidate.product }));
    } else {
      toast.error(t('transfers.new.overAvailable', { product: candidate.product, available: candidate.availableQuantity }));
    }
  };

  const addRow = (row: Row) => (row.kind === 'unit' ? addUnit(row) : addStock(row));

  /**
   * A typed or scanned code: add it only when exactly one item is that code.
   * Anything else shows the results, because guessing which item was meant is
   * how the wrong thing gets sent.
   */
  const resolveCode = async (code: string) => {
    const value = code.trim();
    if (!value) return;
    try {
      const page = await api.get<InventoryPage>(`/inventory?search=${encodeURIComponent(value)}&limit=20`);
      const exact = (page.rows as Row[]).filter((r) => matchesExactly(r, value));
      if (exact.length === 1) {
        addRow(exact[0]);
        return;
      }
      setSearch(value);
      if (exact.length > 1) {
        void dialog.alert({ title: t('transfers.new.ambiguous'), message: t('transfers.new.ambiguousBody') });
      } else if (page.rows.length === 0) {
        void haptics.error();
        toast.error(t('transfers.new.notHere'));
      }
    } catch (error) {
      setSearch(value);
      toast.error(toFriendlyError(error).body);
    }
  };

  const openReview = () => {
    if (!toBranchId) {
      toast.error(t('transfers.new.chooseDestination'));
      return;
    }
    if (canSubmit) setReviewing(true);
  };

  const submit = async () => {
    if (!canSubmit || create.isPending) return;
    try {
      const result = await create.mutateAsync({
        clientUuid: requestId.current,
        toBranchId: toBranchId!,
        lines: draftToBody(lines),
      });
      setSubmitted(true);
      toast.success(t('transfers.new.created', { ref: result.transferNo ?? '' }));
      router.replace(`/transfers/${result.id}` as never);
    } catch (error) {
      // Per-item refusals are shown as themselves; they are actionable.
      const problems = transferProblems(error);
      if (problems.length > 0) {
        await dialog.alert({
          title: t('transfers.new.problems'),
          message: problems.map((p) => `${p.label} — ${p.reason}`).join('\n'),
        });
        setReviewing(false);
        return;
      }
      toast.error(toFriendlyError(error).body);
      // The request id is deliberately NOT regenerated: the next attempt is a
      // retry of this one.
    }
  };

  const footer = reviewing ? (
    <View style={styles.footer}>
      <Button
        title={t(intent === 'creates_approved' ? 'transfers.new.submit.approved' : 'transfers.new.submit.awaits')}
        disabled={!canSubmit}
        loading={create.isPending}
        onPress={submit}
      />
      <Button title={t('transfers.new.backToEdit')} variant="tertiary" onPress={() => setReviewing(false)} />
    </View>
  ) : (
    <Button
      title={t('transfers.new.review', { count: counts.totalQuantity })}
      disabled={lines.length === 0}
      onPress={openReview}
    />
  );

  return (
    <Screen footer={footer}>
      <Stack.Screen options={{ headerShown: true, title: t('transfers.new') }} />

      <Section>
        <Card>
          <View style={styles.route}>
            <View style={styles.routeEnd}>
              <Text variant="caption" tone="tertiary">{t('transfers.new.from')}</Text>
              <Text variant="bodyStrong" numberOfLines={2}>{branchName ?? '—'}</Text>
            </View>
            <View style={isRTL() ? styles.flip : undefined}><ArrowRight size={18} color={colors.text.tertiary} /></View>
            <View style={styles.routeEnd}>
              <Text variant="caption" tone="tertiary">{t('transfers.new.to')}</Text>
              <Text variant="bodyStrong" tone={toName ? 'primary' : 'tertiary'} numberOfLines={2}>
                {toName ?? t('transfers.new.chooseDestination')}
              </Text>
            </View>
          </View>
          {reviewing ? null : destinations.length === 0 ? (
            <Text tone="secondary" style={styles.gapTop}>{t('transfers.new.noOtherBoutique')}</Text>
          ) : (
            <View style={styles.gapTop}>
              <SegmentedControl
                options={destinations.map((b) => ({ value: b.id, label: b.name }))}
                value={toBranchId ?? ''}
                onChange={setToBranchId}
              />
            </View>
          )}
        </Card>
      </Section>

      {reviewing ? null : (
        <Section title={t('transfers.new.add')}>
          <Card>
            <View style={styles.addRow}>
              <View style={styles.flex}>
                <SearchInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder={t('transfers.new.searchPlaceholder')}
                  onSubmit={(v) => void resolveCode(v)}
                />
              </View>
              <Button
                title={t('transfers.new.scan')}
                icon={ScanLine}
                variant="secondary"
                onPress={() => setScanning(true)}
              />
            </View>
            {query.length > 1 && rows.length === 0 && !results.isLoading ? (
              <Text variant="caption" tone="tertiary" style={styles.gapTop}>{t('transfers.new.notHere')}</Text>
            ) : null}
            <View style={styles.results}>
              {rows.map((row) => (
                <ResultRow key={row.id} row={row} lines={lines} onAdd={() => addRow(row)} />
              ))}
            </View>
          </Card>
        </Section>
      )}

      <Section
        title={reviewing ? t('transfers.new.reviewTitle') : t('transfers.new.items')}
        subtitle={lines.length > 0 ? summaryText(counts, t) : undefined}
      >
        {lines.length === 0 ? (
          <EmptyState size="inline" title={t('transfers.new.noItems')} body={t('transfers.new.noItemsBody')} />
        ) : (
          <RowGroup separatorInset={space.md}>
            {lines.map((line) => (
              <SelectedRow
                key={isUnitLine(line) ? `u:${line.identifier}` : `s:${line.productId}`}
                line={line}
                readOnly={reviewing}
                onQuantity={(next) => isStockLine(line) && setLines(setLineQuantity(lines, line.productId, next))}
                onRemove={() =>
                  setLines(
                    isUnitLine(line)
                      ? removeUnitFromDraft(lines, line.identifier)
                      : removeStockFromDraft(lines, line.productId),
                  )
                }
              />
            ))}
          </RowGroup>
        )}
      </Section>

      {reviewing ? (
        <Section>
          <Card>
            {/* What the button does, said before it is pressed. Never "received". */}
            <Text tone="secondary">
              {t(intent === 'creates_approved' ? 'transfers.new.note.approved' : 'transfers.new.note.awaits', {
                to: toName ?? '',
              })}
            </Text>
          </Card>
        </Section>
      ) : (
        <Section>
          <Button title={t('action.cancel')} variant="tertiary" onPress={leave} />
        </Section>
      )}

      <ScannerSheet
        open={scanning}
        onClose={() => setScanning(false)}
        hint={t('transfers.new.scanHint')}
        onResult={(result) => {
          setScanning(false);
          void resolveCode(result.code ?? '');
        }}
      />
    </Screen>
  );
}

/** One search result: picture, name, masked number or what is free, and why it cannot be added. */
function ResultRow({ row, lines, onAdd }: { row: Row; lines: DraftLine[]; onAdd: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  const added =
    row.kind === 'unit'
      ? lines.some((l) => isUnitLine(l) && l.identifier === row.identifier)
      : lines.some((l) => isStockLine(l) && l.productId === row.productId && l.quantity >= row.availableQuantity);
  const unavailable = row.kind === 'unit' ? row.status !== 'in_stock' : row.availableQuantity <= 0;
  const detail =
    row.kind === 'unit'
      ? unavailable
        ? t('transfers.new.notFree')
        : maskIdentifier(row.identifier)
      : t('transfers.new.freeCount', { available: row.availableQuantity });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: added || unavailable }}
      accessibilityLabel={`${productLabel(row)}, ${detail}`}
      disabled={added || unavailable}
      onPress={onAdd}
      style={[styles.result, (added || unavailable) && styles.dim]}
    >
      <CategoryIllustrationIcon name={illustrationOf(row)} color={colors.text.secondary} size={22} />
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={2}>{productLabel(row)}</Text>
        <Text variant="caption" tone="secondary">{detail}</Text>
      </View>
      {added ? (
        <Text variant="caption" tone="tertiary">{t('transfers.new.inList')}</Text>
      ) : unavailable ? null : (
        <Plus size={20} color={colors.text.accent} />
      )}
    </Pressable>
  );
}

/** One selected item: picture, name, masked number or quantity, and remove. */
function SelectedRow({
  line,
  readOnly,
  onQuantity,
  onRemove,
}: {
  line: DraftLine;
  readOnly: boolean;
  onQuantity: (next: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const name = (isUnitLine(line) ? line.product : line.product) ?? '—';
  const illustration: CategoryIllustration = line.illustration ?? (isUnitLine(line) ? 'phone' : 'electronics');
  return (
    <View style={styles.selected}>
      <CategoryIllustrationIcon name={illustration} color={colors.text.secondary} size={22} />
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={2}>{name}</Text>
        {isUnitLine(line) ? (
          <Text variant="caption" tone="secondary">{maskIdentifier(line.identifier)}</Text>
        ) : readOnly ? (
          <Text variant="caption" tone="secondary">{t('transfers.new.quantityOf', { count: line.quantity })}</Text>
        ) : (
          <View style={styles.gapTop}>
            <Stepper
              value={line.quantity}
              min={1}
              max={line.availableQuantity}
              accessibilityLabel={t('transfers.new.quantity')}
              onChange={onQuantity}
            />
          </View>
        )}
      </View>
      {readOnly ? null : (
        <Button
          title={t('action.remove')}
          icon={Trash2}
          variant="tertiary"
          size="sm"
          onPress={onRemove}
        />
      )}
    </View>
  );
}

/** "2 phones · 10 accessories", in the shop's language and grammar. */
export function summaryText(
  counts: { unitCount: number; totalQuantity: number; quantityLineCount: number },
  t: (key: TranslationKey, vars?: TranslationValues) => string,
): string {
  const accessories = counts.totalQuantity - counts.unitCount;
  const parts: string[] = [];
  if (counts.unitCount > 0) parts.push(t('transfers.summary.units' as never, { count: counts.unitCount }));
  if (accessories > 0) parts.push(t('transfers.summary.accessories' as never, { count: accessories }));
  return parts.join(' · ');
}

/** True when the code IS this item: its identifier, either IMEI, serial or barcode. */
export function matchesExactly(row: Row, code: string): boolean {
  const c = code.trim().toLowerCase();
  if (row.kind === 'unit') {
    return [row.identifier, row.imeiPrimary, row.imeiSecondary, row.serialNo]
      .some((v) => v != null && v.toLowerCase() === c);
  }
  return (row.product?.barcode ?? '').toLowerCase() === c;
}

function productLabel(row: Row): string {
  const p = row.product;
  if (!p) return '—';
  return [p.brand, p.model, p.variant].filter(Boolean).join(' ');
}

function illustrationOf(row: Row): CategoryIllustration {
  return illustrationForNested(row.product?.category ?? null, row.product?.trackingType ?? null);
}

function toCandidate(row: InventoryStockRow): StockCandidate {
  return {
    productId: row.productId,
    product: productLabel(row),
    variant: row.product?.variant ?? null,
    barcode: row.product?.barcode ?? null,
    physicalQuantity: row.quantity,
    reservedQuantity: row.reservedQuantity,
    availableQuantity: row.availableQuantity,
    illustration: illustrationOf(row),
  };
}

const styles = StyleSheet.create({
  gapTop: { marginTop: space.sm },
  flex: { flex: 1, gap: space.xs },
  footer: { gap: space.xs },
  route: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  routeEnd: { flex: 1, gap: 2 },
  // The arrow points along the reading direction; RTL mirrors it.
  flip: { transform: [{ scaleX: -1 }] },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  results: { gap: space.xs, marginTop: space.sm },
  result: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, minHeight: 48 },
  selected: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md },
  dim: { opacity: 0.5 },
});
