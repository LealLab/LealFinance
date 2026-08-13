import type { IconName } from '../../shared/ui/icon/icon';

export type CategoryKind = 'income' | 'expense';

/**
 * One level of nesting only (`parentId` points at a top-level category, not
 * another child) — enough to group things like "Transporte" into "Uber" /
 * "Combustível" without turning the categories screen into a tree browser.
 *
 * `icon` is typed against the app's own icon set (`IconName`, a type-only
 * import — no runtime dependency on the UI layer) rather than a bare
 * `string`, so an unknown icon name is a compile error, not a silently
 * blank glyph.
 */
export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  parentId?: string;
  color: string;
  icon: IconName;
  archived: boolean;
  /**
   * Sibling display order (0-based), scoped to categories sharing the same
   * `kind` and `parentId` — top-level categories order among themselves,
   * and each parent's children order among themselves, independently. Set
   * by the store on create, updated only via `CategoryRepository.reorder`.
   */
  position: number;
}
