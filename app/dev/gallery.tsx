import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import {
  Boxes,
  Camera,
  PackagePlus,
  Plus,
  ScanLine,
  ShoppingCart,
  Trash2,
  Truck,
} from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  ErrorState,
  FilterChip,
  Identifier,
  InlineNotice,
  ListRow,
  MoneyField,
  MoneyValue,
  PermissionNotice,
  Screen,
  SearchInput,
  Section,
  SegmentedControl,
  Skeleton,
  SkeletonList,
  SkeletonStat,
  SkeletonText,
  StatTile,
  StatusChip,
  Stepper,
  Text,
  TextField,
  WorkflowTimeline,
} from '../../components/ui';
import { BottomSheet, SelectSheet } from '../../components/overlay';
import { ProductConfirmationCard } from '../../components/product';
import { ScannerSheet, ScanTarget } from '../../components/scanner';
import { ApiError } from '../../lib/api-client';
import type { ScanResult } from '../../types/api';
import { colors } from '../../lib/design/colors';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { formatMoney, formatQuantity, formatRelative } from '../../lib/format';
import { toast } from '../../lib/toast';
import { LANGUAGE_LABELS, useI18n, useTranslation, type Language } from '../../lib/i18n';

interface DemoSupplier {
  id: string;
  name: string;
  city: string;
  balance: number;
}

/** The four shapes `POST /scan` actually returns. */
const SCAN_STATES: { label: string; result: ScanResult }[] = [
  {
    label: 'Confident — learned mapping or exact barcode',
    result: {
      code: '356938035643809',
      kind: 'imei',
      recognized: true,
      confidence: 1,
      recognitionKey: { codeType: 'tac', code: '35693803' },
      suggestion: {
        productId: 'p1',
        brand: 'Apple',
        model: 'iPhone 16 Pro',
        variant: '256GB',
        trackingType: 'imei',
        keySpecifications: { storage: '256GB', colour: 'Natural Titanium' },
        image: null,
        defaultCost: 380000,
        defaultPrice: 450000,
      },
    },
  },
  {
    label: 'Uncertain — TAC catalogue match (0.6)',
    result: {
      code: '490154203237518',
      kind: 'imei',
      recognized: true,
      confidence: 0.6,
      recognitionKey: { codeType: 'tac', code: '49015420' },
      suggestion: {
        productId: 'p2',
        brand: 'Samsung',
        model: 'Galaxy A55',
        variant: null,
        trackingType: 'imei',
        keySpecifications: { storage: '128GB' },
        image: null,
        defaultCost: 28000,
        defaultPrice: 38000,
      },
    },
  },
  {
    label: 'Unknown — serial, nothing learned yet',
    result: {
      code: 'SN-TCL-99AF2231',
      kind: 'serial',
      recognized: false,
      confidence: 0,
      recognitionKey: null,
      suggestion: null,
      hint: 'Serial scan — confirm the product manually (serial learning coming soon).',
    },
  },
  {
    // The teach path: the backend hands back a recognitionKey it can learn
    // against, so confirming here makes the next scan of this box instant.
    label: 'Unknown barcode — confirming teaches the scanner',
    result: {
      code: '6001234567890',
      kind: 'barcode',
      recognized: false,
      confidence: 0,
      recognitionKey: { codeType: 'barcode', code: '6001234567890' },
      suggestion: null,
      hint: 'New barcode — confirm the product to teach it.',
    },
  },
  {
    label: 'Unreadable — classifier could not place it',
    result: {
      code: '??3x',
      kind: 'unknown',
      recognized: false,
      confidence: 0,
      recognitionKey: null,
      suggestion: null,
      hint: 'Unrecognized code — create a new product template.',
    },
  },
];

const DEMO_SUPPLIERS: DemoSupplier[] = [
  { id: '1', name: 'Karim Electronics', city: 'Nouakchott', balance: 128000 },
  { id: '2', name: 'Atlantic Imports', city: 'Nouadhibou', balance: 0 },
  { id: '3', name: 'Sahara Distribution', city: 'Rosso', balance: -42000 },
  { id: '4', name: 'Maghreb Tech', city: 'Nouakchott', balance: 76500 },
];

/**
 * Component gallery — the visual verification surface for the design system.
 *
 * Every primitive appears here in every state it supports, so a regression is
 * visible on one screen instead of being discovered inside a workflow. Also the
 * fastest way to check Arabic: switch language at the top, relaunch, and read
 * this page top to bottom.
 *
 * Development only. Not linked from the app's navigation.
 */
export default function GalleryScreen() {
  const { t, isRTL, language } = useTranslation();
  const setLanguage = useI18n((s) => s.setLanguage);
  const restartRequired = useI18n((s) => s.restartRequired);

  const [search, setSearch] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [price, setPrice] = useState('45000');
  const [password, setPassword] = useState('testtest');
  const [broken, setBroken] = useState('12');
  const [qty, setQty] = useState(1);
  const [filter, setFilter] = useState('in_stock');
  const [segment, setSegment] = useState<'imei' | 'serial' | 'quantity'>('imei');
  const [loading, setLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [supplier, setSupplier] = useState<DemoSupplier | null>(null);
  const [suppliers, setSuppliers] = useState(DEMO_SUPPLIERS);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [liveScan, setLiveScan] = useState<ScanResult | null>(null);
  const [sellPrice, setSellPrice] = useState('450000');

  return (
    <Screen gap="xl">
      <Stack.Screen options={{ headerShown: true, title: 'Design system' }} />

      {/* ── Language / direction ─────────────────────────────────────────── */}
      <Section title="Language & direction" subtitle={`Currently ${language} · ${isRTL ? 'RTL' : 'LTR'}`}>
        <Card>
          <View style={styles.row}>
            {(Object.keys(LANGUAGE_LABELS) as Language[]).map((lang) => (
              <FilterChip
                key={lang}
                label={LANGUAGE_LABELS[lang]}
                selected={language === lang}
                onPress={() => void setLanguage(lang)}
              />
            ))}
          </View>
          {restartRequired ? (
            <>
              <Divider style={styles.divider} />
              <Text variant="bodyStrong" tone="warning">
                {t('settings.language.restartTitle')}
              </Text>
              <Text variant="caption" tone="secondary">
                {t('settings.language.restartBody')}
              </Text>
            </>
          ) : null}
        </Card>
      </Section>

      {/* ── Typography ───────────────────────────────────────────────────── */}
      <Section title="Typography">
        <Card style={styles.stack}>
          <Text variant="display">{formatMoney(1284500)}</Text>
          <Text variant="title">Title — the screen headline</Text>
          <Text variant="heading">Heading — a section</Text>
          <Text variant="body">Body — the default reading size for content.</Text>
          <Text variant="bodyStrong">Body strong — emphasis inside a paragraph.</Text>
          <Text variant="label" tone="secondary">
            Label — form fields and metadata
          </Text>
          <Text variant="caption" tone="tertiary">
            Caption — timestamps and hints
          </Text>
          <Divider style={styles.divider} />
          <Text variant="caption" tone="tertiary">
            Identifier — always LTR, tabular figures
          </Text>
          <Identifier>356938035643809</Identifier>
        </Card>
      </Section>

      {/* ── Buttons ──────────────────────────────────────────────────────── */}
      <Section title="Buttons" subtitle="Icons inherit the variant colour">
        <Card style={styles.stack}>
          <Button title="Primary" icon={ShoppingCart} onPress={() => {}} />
          <Button title="Secondary" variant="secondary" icon={PackagePlus} onPress={() => {}} />
          <Button title="Tertiary" variant="tertiary" onPress={() => {}} />
          <Button title="Danger" variant="danger" icon={Trash2} onPress={() => {}} />
          <Divider style={styles.divider} />
          <View style={styles.row}>
            <Button title="Small" size="sm" onPress={() => {}} />
            <Button title="Medium" size="md" onPress={() => {}} />
          </View>
          <Button title="Large · full width" size="lg" fullWidth icon={ScanLine} onPress={() => {}} />
          <Divider style={styles.divider} />
          <Button
            title={loading ? 'Charging…' : 'Tap to see loading'}
            loading={loading}
            onPress={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1600);
            }}
          />
          <Button title="Disabled" disabled onPress={() => {}} />
          <Button title="Icon at the end" icon={Truck} iconPosition="end" variant="secondary" onPress={() => {}} />
        </Card>
      </Section>

      {/* ── Status & chips ───────────────────────────────────────────────── */}
      <Section title="Status chips" subtitle="Colour and word, always together">
        <Card style={styles.stack}>
          <View style={styles.wrap}>
            {['in_stock', 'reserved', 'sold', 'returned', 'faulty', 'in_transit', 'transferred_out'].map(
              (value) => (
                <StatusChip key={value} domain="unit" value={value} />
              ),
            )}
          </View>
          <Divider style={styles.divider} />
          <View style={styles.wrap}>
            {['ready_to_ship', 'in_transit', 'received', 'cancelled'].map((value) => (
              <StatusChip key={value} domain="transfer" value={value} />
            ))}
          </View>
          <Divider style={styles.divider} />
          <View style={styles.wrap}>
            {['imei', 'serial', 'quantity'].map((value) => (
              <StatusChip key={value} domain="tracking" value={value} dot={false} size="sm" />
            ))}
            <StatusChip domain="unit" value="a_status_this_build_has_never_seen" />
          </View>
          <Divider style={styles.divider} />
          <View style={styles.wrap}>
            <Chip label="Neutral" tone="neutral" />
            <Chip label="Info" tone="info" />
            <Chip label="Success" tone="success" />
            <Chip label="Warning" tone="warning" />
            <Chip label="Danger" tone="danger" />
          </View>
        </Card>
      </Section>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <Section title="Filter chips">
        <View style={styles.wrap}>
          {[
            { key: 'in_stock', label: 'In stock', count: 128 },
            { key: 'sold', label: 'Sold', count: 46 },
            { key: 'faulty', label: 'Faulty', count: 2 },
            { key: '', label: 'All' },
          ].map((f) => (
            <FilterChip
              key={f.key}
              label={f.label}
              count={f.count}
              selected={filter === f.key}
              onPress={() => setFilter(f.key)}
            />
          ))}
        </View>
      </Section>

      {/* ── Inputs ───────────────────────────────────────────────────────── */}
      <Section title="Inputs">
        <Card style={styles.stack}>
          <SearchInput
            value={search}
            onChangeText={setSearch}
            onScanPress={() => {}}
            placeholder="Search products"
          />
          <SearchInput
            value={identifier}
            onChangeText={setIdentifier}
            identifier
            onScanPress={() => {}}
            placeholder="Scan IMEI or serial"
          />
          <TextField label="Brand" placeholder="Apple" required />
          <TextField
            label="Serial number"
            variant="identifier"
            placeholder="SN-0000-0000"
            hint="Stays left-to-right in every language"
          />
          <TextField
            label="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            hint="Any secure field gets a reveal toggle automatically"
          />
          <MoneyField label="Selling price" value={price} onChangeText={setPrice} />
          <MoneyField
            label="Cost"
            value={broken}
            onChangeText={setBroken}
            error="That is below the unit cost of 30 000 MRU"
          />
          <TextField label="Locked" value="Cannot edit" editable={false} />
        </Card>
      </Section>

      {/* ── Selection controls ───────────────────────────────────────────── */}
      <Section title="Selection">
        <Card style={styles.stack}>
          <Text variant="label" tone="secondary">
            Segmented control
          </Text>
          <SegmentedControl
            options={[
              { value: 'imei', label: t('tracking.imei') },
              { value: 'serial', label: t('tracking.serial') },
              { value: 'quantity', label: t('tracking.quantity') },
            ]}
            value={segment}
            onChange={setSegment}
          />
          <Divider style={styles.divider} />
          <View style={styles.between}>
            <Text variant="label" tone="secondary">
              Stepper — never mirrors
            </Text>
            <Stepper value={qty} onChange={setQty} accessibilityLabel="Quantity" />
          </View>
        </Card>
      </Section>

      {/* ── Stat tiles ───────────────────────────────────────────────────── */}
      <Section title="Stat tiles" subtitle="A number always carries its meaning">
        <View style={styles.row}>
          <StatTile
            label="Revenue"
            value={formatMoney(184500)}
            tone="accent"
            trend={{ direction: 'up', label: '18% vs yesterday' }}
            caption="Strong morning"
          />
          <StatTile
            label="Profit"
            value={formatMoney(42300)}
            tone="success"
            trend={{ direction: 'down', label: '4% vs yesterday' }}
          />
        </View>
        <View style={styles.row}>
          <StatTile label="Items sold" value={formatQuantity(23)} caption="Across 11 sales" />
          <StatTile label="Cost" value="" restricted />
        </View>
        <View style={styles.row}>
          <StatTile label="Loading" value="" loading />
          <StatTile
            label="Returns"
            value={formatQuantity(3)}
            tone="danger"
            trend={{ direction: 'up', label: '2 more than usual', positiveIsGood: false }}
          />
        </View>
        <StatTile
          label="Today"
          value={formatMoney(1284500)}
          size="lg"
          tone="accent"
          caption="The one focal figure on a screen"
        />
      </Section>

      {/* ── List rows ────────────────────────────────────────────────────── */}
      <Section title="List rows" subtitle="Every list in the app is built from this">
        <View style={styles.stack}>
          <ListRow
            leading={Boxes}
            title="iPhone 16 Pro"
            subtitle="256GB · Natural Titanium"
            identifier="356938035643809"
            accessory={<StatusChip domain="unit" value="in_stock" size="sm" />}
            onPress={() => {}}
          />
          <ListRow
            leading={Boxes}
            title="Samsung Galaxy A55"
            subtitle="Sold 12 minutes ago"
            identifier="490154203237518"
            accessory={<StatusChip domain="unit" value="sold" size="sm" />}
            value={formatMoney(38000)}
            onPress={() => {}}
          />
          <ListRow
            leading={Truck}
            title="Nouadhibou branch"
            subtitle={`Last received ${formatRelative(Date.now() - 1000 * 60 * 60 * 26)}`}
            value={formatMoney(920000)}
            valueCaption="12 units"
            valueTone="success"
            onPress={() => {}}
          />
          <ListRow leading={Camera} title="No chevron, not tappable" subtitle="Read-only row" />
          <ListRow leading={Boxes} title="Selected" subtitle="Shown while picking" selected onPress={() => {}} />
          <ListRow leading={Boxes} title="Disabled" subtitle="Cannot be chosen" disabled onPress={() => {}} />
        </View>
      </Section>

      {/* ── Money ────────────────────────────────────────────────────────── */}
      <Section title="Money" subtitle="Tabular figures, so a column can be compared at a glance">
        <Card>
          <MoneyValue value={1250000} size="display" />
          <Divider style={styles.divider} />
          {/* The point of tabular-nums: these three must line up exactly. */}
          <MoneyValue value={9.5} />
          <MoneyValue value={11111.11} />
          <MoneyValue value={888888.88} />
          <Divider style={styles.divider} />
          <View style={styles.row}>
            <MoneyValue value={4500} tone="positive" signed size="small" />
            <MoneyValue value={-4500} tone="auto" signed size="small" />
            <MoneyValue value={0} tone="auto" size="small" />
          </View>
          <Divider style={styles.divider} />
          {/* Withheld cost, NOT zero — the two must never look alike. */}
          <MoneyValue value={null} />
          <Text variant="caption" tone="tertiary">
            Hidden because this role has no cost.view
          </Text>
        </Card>
      </Section>

      {/* ── Inline notices ───────────────────────────────────────────────── */}
      <Section title="Inline notices" subtitle="Attached to the thing they are about">
        <InlineNotice tone="warning" title="Below cost">
          This price is under what the shop paid. Sell anyway?
        </InlineNotice>
        <InlineNotice tone="danger">This IMEI has already been sold.</InlineNotice>
        <InlineNotice tone="success">Refund confirmed. The money has left the till.</InlineNotice>
        <InlineNotice tone="info">Reported, waiting for a manager to confirm.</InlineNotice>
        <PermissionNotice message="Only an owner or manager can confirm a refund." />
        {/* Long Arabic, to prove wrapping rather than truncation. */}
        <InlineNotice tone="warning" title="تحذير">
          هذا السعر أقل من التكلفة التي دفعها المتجر لهذا الهاتف، هل تريد المتابعة على أي حال؟
        </InlineNotice>
      </Section>

      {/* ── Workflow ─────────────────────────────────────────────────────── */}
      <Section
        title="Workflow timeline"
        subtitle="Due, reported and confirmed differ in SHAPE before colour"
      >
        <Card>
          <WorkflowTimeline
            steps={[
              {
                key: 'requested',
                label: 'Return requested',
                detail: 'Fatimatou · screen fault',
                timestamp: 'Mon 14:02',
                state: 'done',
              },
              {
                key: 'approved',
                label: 'Approved — refund due',
                detail: 'The shop owes 45,000 MRU',
                timestamp: 'Mon 16:20',
                state: 'done',
              },
              {
                key: 'reported',
                label: 'Payout reported',
                detail: 'Waiting for an owner or manager to confirm',
                state: 'current',
              },
              { key: 'confirmed', label: 'Confirmed — money paid', state: 'pending' },
            ]}
          />
        </Card>
        <Card>
          <WorkflowTimeline
            steps={[
              { key: 'r', label: 'Return requested', timestamp: 'Tue 09:10', state: 'done' },
              {
                key: 'x',
                label: 'Rejected after investigation',
                detail: 'Customer damage — outside the policy',
                timestamp: 'Tue 11:45',
                state: 'rejected',
              },
            ]}
          />
        </Card>
      </Section>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      <Section title="Loading skeletons" subtitle="Shape first, so nothing jumps">
        <View style={styles.row}>
          <SkeletonStat />
          <SkeletonStat />
        </View>
        <SkeletonList count={3} />
        <Card>
          <SkeletonText lines={3} />
          <Divider style={styles.divider} />
          <Skeleton width={120} height={12} />
        </Card>
      </Section>

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      <Section title="Empty states" subtitle="Coach the next action, never dead-end">
        <Card padding="none">
          <EmptyState
            icon={Boxes}
            title="No stock yet"
            body="Scan your first item to add it to this branch."
            action={{ label: t('action.scan'), icon: ScanLine, onPress: () => {} }}
            secondaryAction={{ label: t('action.typeInstead'), onPress: () => {} }}
          />
        </Card>
        <Card padding="none">
          <EmptyState
            icon={Plus}
            title={t('state.noResults.title')}
            body={t('state.noResults.body')}
            size="inline"
          />
        </Card>
      </Section>

      {/* ── Errors ───────────────────────────────────────────────────────── */}
      <Section title="Error states" subtitle="Interpreted from the thrown value">
        <Card padding="none">
          <ErrorState
            error={new ApiError('This IMEI has already been sold.', 409)}
            size="inline"
            onRetry={() => {}}
          />
        </Card>
        <Card padding="none">
          <ErrorState error={new ApiError('Forbidden', 403)} size="inline" onRetry={() => {}} />
        </Card>
        <Card padding="none">
          <ErrorState error={new TypeError('Network request failed')} size="inline" onRetry={() => {}} />
        </Card>
        <Card padding="none">
          <ErrorState error={new ApiError('Internal error', 500)} size="inline" onRetry={() => {}} />
        </Card>
      </Section>

      {/* ── Surfaces ─────────────────────────────────────────────────────── */}
      <Section title="Surfaces">
        <Card>
          <Text variant="bodyStrong">Card — the default reading surface</Text>
        </Card>
        <Card variant="sunken">
          <Text variant="bodyStrong">Sunken — recessed wells</Text>
        </Card>
        <Card variant="outlined">
          <Text variant="bodyStrong">Outlined — grouping without weight</Text>
        </Card>
        <Card raised="md">
          <Text variant="bodyStrong">Raised — sheets and toasts only</Text>
        </Card>
      </Section>

      {/* ── Scanner ──────────────────────────────────────────────────────── */}
      <Section
        title="Scanner"
        subtitle="Camera → POST /scan → recognition → confirmation card"
      >
        <Card style={styles.stack}>
          <Text variant="label" tone="secondary">
            Inline scan target — camera, wedge scanner, or thumbs
          </Text>
          <ScanTarget onResult={setLiveScan} />
          <Button
            title="Open full-screen camera"
            variant="secondary"
            icon={Camera}
            onPress={() => setScannerOpen(true)}
          />
          <Text variant="caption" tone="tertiary">
            Needs a real device — there is no camera on web. Typing still works everywhere.
          </Text>
        </Card>

        {liveScan ? (
          <>
            <Text variant="label" tone="secondary">
              Live result from the backend
            </Text>
            <ProductConfirmationCard
              result={liveScan}
              context="lookup"
              confirmLabel="Use this product"
              onConfirm={(s) => toast.success(`Confirmed ${s.brand} ${s.model}`)}
              onChooseProduct={() => setPickerOpen(true)}
              onCreateProduct={() => toast.info('Would open the create-product flow')}
              onScanAgain={() => setLiveScan(null)}
            />
          </>
        ) : null}
      </Section>

      <Section
        title="Product confirmation card"
        subtitle="One component, every state the backend returns"
      >
        {SCAN_STATES.map(({ label, result }) => (
          <View key={label} style={styles.stack}>
            <Text variant="caption" tone="tertiary">
              {label}
            </Text>
            <ProductConfirmationCard
              result={result}
              context="sell"
              confirmLabel="Add to sale"
              onConfirm={(s) => toast.success(`Added ${s.brand} ${s.model}`)}
              onChooseProduct={() => setPickerOpen(true)}
              onCreateProduct={() => toast.info('Would open the create-product flow')}
            />
          </View>
        ))}

        <Text variant="caption" tone="tertiary">
          With workflow fields injected (Sell) and a blocking notice
        </Text>
        <ProductConfirmationCard
          result={SCAN_STATES[0].result}
          context="sell"
          confirmLabel={`Add · ${formatMoney(Number(sellPrice) || 0)}`}
          onConfirm={() => toast.success('Added to sale')}
          onChooseProduct={() => setPickerOpen(true)}
        >
          <MoneyField label="Selling price" value={sellPrice} onChangeText={setSellPrice} />
        </ProductConfirmationCard>

        <ProductConfirmationCard
          result={SCAN_STATES[0].result}
          context="sell"
          confirmLabel="Add to sale"
          onConfirm={() => {}}
          onChooseProduct={() => setPickerOpen(true)}
          onScanAgain={() => {}}
          notice={{ tone: 'danger', message: 'This unit is already sold — it cannot be sold again.' }}
        />
      </Section>

      <ScannerSheet
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onResult={(r) => {
          setLiveScan(r);
          toast.success(`Scanned ${r.code}`, { description: r.recognized ? 'Recognized' : 'Not recognized' });
        }}
      />

      {/* ── Overlays ─────────────────────────────────────────────────────── */}
      <Section title="Toasts" subtitle="Undo instead of “are you sure?”">
        <Card style={styles.stack}>
          <Button
            title="Success"
            variant="secondary"
            onPress={() => toast.success('Sale complete', { description: 'Invoice NKC-00412' })}
          />
          <Button
            title="Success with undo"
            variant="secondary"
            onPress={() =>
              toast.success('Item removed from cart', {
                action: { label: t('action.undo'), onPress: () => toast.info('Restored') },
              })
            }
          />
          <Button
            title="Error"
            variant="secondary"
            onPress={() => toast.error('This IMEI has already been sold')}
          />
          <Button
            title="Warning"
            variant="secondary"
            onPress={() =>
              toast.warning('Selling below cost', { description: 'Cost is 30 000 MRU' })
            }
          />
          <Button title="Info" variant="secondary" onPress={() => toast.info('Stock refreshed')} />
          <Button
            title="Three at once (stack cap)"
            variant="tertiary"
            onPress={() => {
              toast.info('First');
              toast.warning('Second');
              toast.error('Third');
            }}
          />
        </Card>
      </Section>

      <Section title="Dialogs" subtitle="Only where the decision really matters">
        <Card style={styles.stack}>
          <Button
            title="Confirm"
            variant="secondary"
            onPress={async () => {
              const ok = await dialog.confirm({
                title: t('dialog.discard.title'),
                message: t('dialog.discard.body'),
                confirmLabel: t('dialog.discard.confirm'),
                tone: 'danger',
              });
              toast.info(ok ? 'Discarded' : 'Kept editing');
            }}
          />
          <Button
            title="Confirm with reason (below cost)"
            variant="secondary"
            onPress={async () => {
              const { confirmed, reason } = await dialog.confirmWithReason({
                title: 'Sell below cost?',
                message: 'This unit cost 30 000 MRU and you are selling at 24 000 MRU.',
                confirmLabel: 'Sell anyway',
                reasonLabel: 'Why?',
                reasonPlaceholder: 'Damaged box, agreed with owner…',
                tone: 'danger',
              });
              if (confirmed) toast.warning('Override logged', { description: reason });
            }}
          />
          <Button
            title="Alert"
            variant="secondary"
            onPress={() =>
              void dialog.alert({
                title: 'Yesterday was never closed',
                message: 'Close 1 August before starting today.',
              })
            }
          />
        </Card>
      </Section>

      <Section title="Sheets">
        <Card style={styles.stack}>
          <Button title="Bottom sheet" variant="secondary" onPress={() => setSheetOpen(true)} />
          <Button
            title={supplier ? `Supplier: ${supplier.name}` : 'Select sheet (searchable)'}
            variant="secondary"
            onPress={() => setPickerOpen(true)}
          />
        </Card>
      </Section>

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Bottom sheet"
        subtitle="Drag the header down, tap the backdrop, or press close"
        footer={<Button title={t('action.done')} fullWidth onPress={() => setSheetOpen(false)} />}
      >
        <View style={styles.stack}>
          <Text variant="body" tone="secondary">
            Content sits here. The sheet grows to fit, up to 85% of the screen, and lifts above the
            keyboard when a field inside it is focused.
          </Text>
          <TextField label="Try focusing this" placeholder="The sheet should rise" />
        </View>
      </BottomSheet>

      <SelectSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Choose supplier"
        items={suppliers}
        keyExtractor={(s) => s.id}
        labelExtractor={(s) => s.name}
        descriptionExtractor={(s) => s.city}
        valueExtractor={(s) => (s.balance === 0 ? undefined : formatMoney(s.balance))}
        leadingIcon={Truck}
        selectedKeys={supplier ? [supplier.id] : []}
        searchPlaceholder="Search suppliers"
        onSelect={(s) => {
          setSupplier(s);
          toast.success(`${s.name} selected`);
        }}
        onCreate={(name) => {
          const created = { id: String(Date.now()), name, city: '—', balance: 0 };
          setSuppliers((prev) => [created, ...prev]);
          setSupplier(created);
          setPickerOpen(false);
          toast.success(`${name} created`);
        }}
      />

      {/* ── Formatting ───────────────────────────────────────────────────── */}
      <Section title="Formatting" subtitle="No Intl — identical on every device">
        <Card style={styles.stack}>
          <Between label="Money" value={formatMoney(1284500)} />
          <Between label="Money, no currency" value={formatMoney(1284500, { showCurrency: false })} />
          <Between label="Negative" value={formatMoney(-8400)} />
          <Between label="Signed delta" value={formatMoney(8400, { signed: true })} />
          <Between label="With decimals" value={formatMoney(1284.5, { decimals: 2 })} />
          <Between label="Withheld (no cost.view)" value={formatMoney(undefined)} />
          <Between label="Quantity" value={formatQuantity(1284)} />
          <Between label="Relative time" value={formatRelative(Date.now() - 1000 * 60 * 90)} />
        </Card>
      </Section>
    </Screen>
  );
}

function Between({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.between}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  stack: {
    gap: space.md,
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  divider: {
    marginVertical: space.xs,
    backgroundColor: colors.border.subtle,
  },
});
