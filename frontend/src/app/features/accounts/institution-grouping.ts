import { Account } from '../../domain/models/account';
import { Institution } from '../../domain/models/institution';

export interface InstitutionAccountGroup {
  /** null is the "no institution" bucket — e.g. a cash account. */
  institution: Institution | null;
  accounts: Account[];
}

/**
 * Groups accounts by `institutionId`, resolving each to its `Institution`
 * (or `null`). Real institutions are ordered by `position`; the `null`
 * bucket always sorts last, since it has no position of its own. Groups
 * with no accounts are dropped. Shared by the Accounts page's grouping and
 * by the `<optgroup>`-per-institution account pickers in
 * transaction-form-modal.ts / recurring-rule-form-modal.ts.
 */
export function groupAccountsByInstitution(
  accounts: readonly Account[],
  institutions: readonly Institution[],
  includeEmptyInstitutions = false
): InstitutionAccountGroup[] {
  const sortedInstitutions = [...institutions].sort((a, b) => a.position - b.position);
  const groups = sortedInstitutions.map((institution) => ({ institution, accounts: [] as Account[] }));
  const groupById = new Map(groups.map((group) => [group.institution.id, group]));
  const noInstitutionGroup: InstitutionAccountGroup = { institution: null, accounts: [] };

  for (const account of accounts) {
    const group = account.institutionId ? groupById.get(account.institutionId) : undefined;
    (group ?? noInstitutionGroup).accounts.push(account);
  }

  return [...groups, noInstitutionGroup].filter(
    (group) => group.accounts.length > 0 || (includeEmptyInstitutions && group.institution !== null)
  );
}
