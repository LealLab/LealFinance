import type { CategoryKind } from './category';
import type { IconName } from '../../shared/ui/icon/icon';

/**
 * An organizational bucket for categories - a transaction references a
 * category directly and never references a group.
 */
export interface CategoryGroup {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: IconName;
  position: number;
}
