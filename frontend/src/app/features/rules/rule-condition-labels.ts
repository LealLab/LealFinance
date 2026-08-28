import type {
  RuleConditionField,
  RuleConditionOp,
  RuleMatchOp,
} from '../../domain/models/categorization-rule';

export const RULE_FIELD_LABEL_KEYS: Record<RuleConditionField, string> = {
  description: 'rules.conditions.fields.description',
  notes: 'rules.conditions.fields.notes',
  amount: 'rules.conditions.fields.amount',
  type: 'rules.conditions.fields.type',
};

export const RULE_OP_LABEL_KEYS: Record<RuleConditionOp, string> = {
  contains: 'rules.conditions.ops.contains',
  not_contains: 'rules.conditions.ops.not_contains',
  equals: 'rules.conditions.ops.equals',
  not_equals: 'rules.conditions.ops.not_equals',
  starts_with: 'rules.conditions.ops.starts_with',
  ends_with: 'rules.conditions.ops.ends_with',
  regex: 'rules.conditions.ops.regex',
  gt: 'rules.conditions.ops.gt',
  gte: 'rules.conditions.ops.gte',
  lt: 'rules.conditions.ops.lt',
  lte: 'rules.conditions.ops.lte',
};

export const RULE_MATCH_LABEL_KEYS: Record<RuleMatchOp, string> = {
  and: 'rules.conditions.join.and',
  or: 'rules.conditions.join.or',
};
