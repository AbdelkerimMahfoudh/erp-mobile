/**
 * The design system's public surface.
 *
 * Screens import from here and nowhere else. If a screen needs a raw colour, a
 * hardcoded padding or its own `Pressable` wrapper, that is a signal the system
 * is missing a component — add it here rather than styling in place.
 *
 * Conventions these components share:
 *  - Direction-aware. Text alignment and directional glyphs flip for Arabic;
 *    see `lib/design/direction.ts` for what the toolchain does and does not
 *    handle on its own.
 *  - Token-driven. Spacing, radius, type and colour come from `lib/design`.
 *  - Colour never carries meaning alone — statuses always render a word too.
 *  - Nothing tappable is smaller than 48pt.
 */

export { Text, Identifier, type TextProps, type TextTone } from './Text';
export { Card, Section, Divider, Spacer, type CardProps, type SectionProps } from './Surface';
export { Screen, type ScreenProps } from './Screen';
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  type IconComponent,
} from './Button';
export { IconButton, type IconButtonProps } from './IconButton';
export { Chip, StatusChip, FilterChip, type ChipProps, type StatusChipProps } from './Chip';
export { TextField, MoneyField, type TextFieldProps, type MoneyFieldProps } from './Field';
export { SearchInput, type SearchInputProps } from './SearchInput';
export { Stepper, type StepperProps } from './Stepper';
export { SegmentedControl, type SegmentedControlProps, type SegmentOption } from './SegmentedControl';
export {
  Skeleton,
  SkeletonText,
  SkeletonList,
  SkeletonListRow,
  SkeletonStat,
} from './Skeleton';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { ErrorState, type ErrorStateProps } from './ErrorState';
export { ListRow, type ListRowProps } from './ListRow';
export { RowGroup, DEFAULT_SEPARATOR_INSET, type RowGroupProps } from './RowGroup';
export { MoneyValue, type MoneyValueProps, type MoneySize, type MoneyTone } from './MoneyValue';
export { InlineNotice, type InlineNoticeProps } from './InlineNotice';
export { PermissionNotice, type PermissionNoticeProps } from './PermissionNotice';
export { OfflineBanner } from './OfflineBanner';
export { AuthLanguageSwitch, type AuthLanguageSwitchProps } from './AuthLanguageSwitch';
export {
  WorkflowTimeline,
  type WorkflowTimelineProps,
  type WorkflowStep,
  type StepState,
} from './WorkflowTimeline';
export { Toggle, type ToggleProps } from './Toggle';
export { StatTile, type StatTileProps, type StatTrend } from './StatTile';

// ───────────────────────────────────────────────────────────────────────────
// Compatibility shims — TEMPORARY.
//
// The twelve screens built before this design system import these names. They
// are re-pointed at the real components so nothing breaks and the app keeps
// compiling, but they are NOT part of the system: no new screen should use
// them. Each disappears as its screens are rebuilt in Phase 2, and this whole
// block goes with the last one.
// ───────────────────────────────────────────────────────────────────────────

export { H1, H2, Muted, Row, Field, Badge } from './compat';
