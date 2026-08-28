import type {
  CategorizationRule,
  RuleConditionEntry,
  RuleConditionField,
  RuleConditionOp,
  RuleLeafCondition,
  RuleMatchOp,
} from '../models/categorization-rule';
import { isConditionGroup } from '../models/categorization-rule';

export function ruleConditionSummary(
  rule: Pick<CategorizationRule, 'matchOp' | 'conditions'>,
  labels: {
    field: (field: RuleConditionField) => string;
    op: (op: RuleConditionOp) => string;
    join: (op: RuleMatchOp) => string;
  },
): string {
  const renderLeaf = (condition: RuleLeafCondition): string =>
    `${labels.field(condition.field)} ${labels.op(condition.op)} "${condition.value}"`;
  const renderEntry = (entry: RuleConditionEntry): string =>
    isConditionGroup(entry)
      ? `(${entry.conditions.map(renderLeaf).join(` ${labels.join(entry.op)} `)})`
      : renderLeaf(entry);

  return rule.conditions.map(renderEntry).join(` ${labels.join(rule.matchOp)} `);
}
