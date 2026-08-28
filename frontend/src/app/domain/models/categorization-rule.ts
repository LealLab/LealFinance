export type RuleMatchOp = 'and' | 'or';
export type RuleConditionField = 'description' | 'notes' | 'amount' | 'type';
export type RuleTextOp =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'starts_with'
  | 'ends_with'
  | 'regex';
export type RuleAmountOp = 'equals' | 'gt' | 'gte' | 'lt' | 'lte';
export type RuleConditionOp = RuleTextOp | RuleAmountOp;

export interface RuleLeafCondition {
  field: RuleConditionField;
  op: RuleConditionOp;
  /** Decimal string when field is `amount`. */
  value: string;
}

export interface RuleConditionGroup {
  op: RuleMatchOp;
  /** Leaves only; condition trees are at most two levels deep. */
  conditions: RuleLeafCondition[];
}

export type RuleConditionEntry = RuleLeafCondition | RuleConditionGroup;

export function isConditionGroup(
  entry: RuleConditionEntry,
): entry is RuleConditionGroup {
  return (entry as RuleConditionGroup).conditions !== undefined;
}

/**
 * A server-owned categorization rule. Its id is assigned by the server;
 * priority determines the client/server evaluation order, with lower values
 * running first.
 */
export interface CategorizationRule {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  matchOp: RuleMatchOp;
  conditions: RuleConditionEntry[];
  categoryId: string;
}

/** Available server-provided rule packs and whether this instance installed one. */
export interface RulePack {
  code: string;
  ruleCount: number;
  installed: boolean;
}

/** JSON export/import file; categories are referenced by name so files port between instances. */
export interface RuleExportFile {
  format: 'lealfinance-categorization-rules';
  version: 1;
  rules: RuleExportItem[];
}

export interface RuleExportItem {
  name: string;
  matchOp: RuleMatchOp;
  priority: number;
  isActive: boolean;
  /** Category name, not id. */
  category: string;
  conditions: RuleConditionEntry[];
}
