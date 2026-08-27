import type { IconName } from '../../shared/ui/icon/icon';

export type CategoryKind = 'income' | 'expense';

/**
 * `icon` is typed against the app's own icon set (`IconName`, a type-only
 * import - no runtime dependency on the UI layer) rather than a bare
 * `string`, so an unknown icon name is a compile error, not a silently
 * blank glyph. Categories are not nested; every category belongs to a group,
 * and `position` is scoped to categories sharing the same `kind` and `groupId`.
 */
export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  groupId: string;
  color: string;
  icon: IconName;
  /** Display order (0-based), scoped to the same `kind` and `groupId`. */
  position: number;
}
