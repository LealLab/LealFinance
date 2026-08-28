import type {
  RuleConditionField,
  RuleConditionOp,
  RuleLeafCondition,
  RuleMatchOp,
} from '../models/categorization-rule';
import { ruleConditionSummary } from './rule-summary';

const labels = {
  field: (field: RuleConditionField) => field[0].toUpperCase() + field.slice(1),
  op: (op: RuleConditionOp) => op.replaceAll('_', ' '),
  join: (op: RuleMatchOp) => op.toUpperCase(),
};

function leaf(overrides: Partial<RuleLeafCondition> = {}): RuleLeafCondition {
  return { field: 'description', op: 'starts_with', value: 'UBER', ...overrides };
}

describe('ruleConditionSummary', () => {
  it('renders a single leaf', () => {
    expect(ruleConditionSummary({ matchOp: 'and', conditions: [leaf()] }, labels)).toEqual(
      'Description starts with "UBER"',
    );
  });

  it('joins top-level leaves with OR', () => {
    expect(
      ruleConditionSummary(
        { matchOp: 'or', conditions: [leaf(), leaf({ value: '99 ' })] },
        labels,
      ),
    ).toEqual('Description starts with "UBER" OR Description starts with "99 "');
  });

  it('wraps a group and joins it with a leaf', () => {
    expect(
      ruleConditionSummary(
        {
          matchOp: 'or',
          conditions: [
            { op: 'and', conditions: [leaf(), leaf({ field: 'notes', op: 'contains', value: 'ride' })] },
            leaf({ field: 'amount', op: 'gte', value: '100' }),
          ],
        },
        labels,
      ),
    ).toEqual(
      '(Description starts with "UBER" AND Notes contains "ride") OR Amount gte "100"',
    );
  });
});
