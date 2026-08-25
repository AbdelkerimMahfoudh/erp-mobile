import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Check, Circle, CircleDot, X, type LucideIcon } from 'lucide-react-native';
import { type Intent } from '../../lib/design/colors';
import { icon as iconSize, radius, space } from '../../lib/design/tokens';
import { Text } from './Text';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * The state of a multi-step workflow — a return, a transfer, a supplier payment.
 *
 * This is not the quantity `Stepper`, which counts things. This shows where
 * something has got to and what has not happened yet.
 *
 * The design problem it solves: in this app "approved", "reported" and
 * "confirmed" are three different amounts of certainty about the same money,
 * and a list of similar grey rows makes them look interchangeable. They are not.
 * Approved means the shop owes it. Reported means someone says they paid it.
 * Confirmed means the money actually left. Only the last one is settled.
 *
 * So each step differs in **shape** before it differs in colour:
 *
 *   done     filled disc, tick        — this happened, at a known time
 *   current  ringed dot               — waiting on somebody now
 *   pending  hollow outline           — has not happened
 *   rejected filled disc, cross       — this ended here
 *
 * A colourblind user, or anyone glancing at a phone in sunlight, reads the
 * shape. The label and timestamp say it in words regardless.
 */

export type StepState = 'done' | 'current' | 'pending' | 'rejected';

export interface WorkflowStep {
  key: string;
  /** Already translated. */
  label: string;
  /** What happened, who did it, or what is being waited on. Already translated. */
  detail?: string;
  /** Already formatted; omitted for anything that has not happened. */
  timestamp?: string;
  state: StepState;
}

export interface WorkflowTimelineProps {
  steps: WorkflowStep[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const STEP_ICON: Record<StepState, LucideIcon> = {
  done: Check,
  current: CircleDot,
  pending: Circle,
  rejected: X,
};

const STEP_TONE: Record<StepState, Intent> = {
  done: 'success',
  // Warning, not success: somebody's outstanding work, not a resting state.
  current: 'warning',
  pending: 'neutral',
  rejected: 'danger',
};

export function WorkflowTimeline({ steps, style, testID }: WorkflowTimelineProps) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={[styles.container, style]} testID={testID}>
      {steps.map((step, index) => {
        const tone = colors.intent[STEP_TONE[step.state]];
        const Icon = STEP_ICON[step.state];
        const filled = step.state === 'done' || step.state === 'rejected';
        const isLast = index === steps.length - 1;
        // A connector is only "achieved" if the step above it actually
        // completed — a pending step must not appear joined to the timeline.
        const connectorDone = step.state === 'done';

        return (
          <View key={step.key} style={styles.row}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.marker,
                  {
                    backgroundColor: filled ? tone.solid : colors.surface.card,
                    borderColor: step.state === 'pending' ? colors.border.default : tone.solid,
                  },
                ]}
              >
                <Icon
                  size={iconSize.sm}
                  color={filled ? tone.onSolid : step.state === 'pending' ? colors.text.tertiary : tone.solid}
                  strokeWidth={3}
                />
              </View>
              {!isLast ? (
                <View
                  style={[
                    styles.connector,
                    { backgroundColor: connectorDone ? tone.solid : colors.border.subtle },
                  ]}
                />
              ) : null}
            </View>

            <View style={[styles.body, isLast ? null : styles.bodySpaced]}>
              <View style={styles.headline}>
                <Text
                  variant="bodyStrong"
                  style={{
                    color: step.state === 'pending' ? colors.text.tertiary : colors.text.primary,
                    flexShrink: 1,
                  }}
                >
                  {step.label}
                </Text>
                {step.timestamp ? (
                  <Text variant="caption" tone="tertiary">
                    {step.timestamp}
                  </Text>
                ) : null}
              </View>
              {step.detail ? (
                <Text variant="body" tone="secondary">
                  {step.detail}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const MARKER = 28;

const useStyles = makeStyles((colors) => ({
  container: { width: '100%' },
  row: { flexDirection: 'row', gap: space.md },
  // The rail is a fixed-width column so markers align regardless of how much
  // text each step carries — including long Arabic that wraps to three lines.
  rail: { alignItems: 'center', width: MARKER },
  marker: {
    width: MARKER,
    height: MARKER,
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: { width: 2, flex: 1, minHeight: space.base },
  body: { flex: 1, gap: space.xs, paddingTop: space.xs },
  bodySpaced: { paddingBottom: space.lg },
  headline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
  },
}));
