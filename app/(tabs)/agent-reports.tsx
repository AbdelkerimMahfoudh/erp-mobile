import React from 'react';
import { AgentReportView } from '../../components/agent/AgentReportView';

/**
 * Reports — the tab of an agent-only branch (D157). A combined branch reaches
 * the same reports from Money, beside Results, at /agent/reports.
 */
export default function AgentReportsTab() {
  return <AgentReportView tab />;
}
