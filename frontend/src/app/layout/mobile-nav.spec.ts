import { activePathFor, isSectionRootUrl, mobileTabsFor } from './mobile-nav';
import { navSectionsFor } from './sidebar';

const paths = (tabs: ReturnType<typeof mobileTabsFor>, index: number) =>
  tabs[index].items.map((item) => item.path);

describe('mobileTabsFor', () => {
  it('splits Settings out of Setup for a member', () => {
    const tabs = mobileTabsFor(navSectionsFor('member', false, false, false));

    expect(tabs.map((tab) => tab.labelKey)).toEqual([
      'layout.nav.sections.accounts',
      'layout.nav.sections.analysis',
      'layout.nav.sections.setup',
      'layout.nav.settings',
    ]);
    expect(paths(tabs, 0)).toEqual(['/', '/transactions', '/accounts', '/reconciliation']);
    expect(paths(tabs, 2)).not.toContain('/settings');
    expect(paths(tabs, 3)).toEqual(['/settings']);
  });

  it('folds admin pages into the Settings tab and keeps feature-gated items', () => {
    const tabs = mobileTabsFor(navSectionsFor('admin', true, true, false));

    expect(paths(tabs, 0)).toContain('/investments');
    expect(paths(tabs, 1)).toContain('/chat');
    expect(paths(tabs, 3)).toEqual([
      '/settings',
      '/admin/users',
      '/admin/automations',
      '/admin/providers',
    ]);
  });

  it('hides investments and chat when they are off', () => {
    const tabs = mobileTabsFor(navSectionsFor('member', false, false, false));

    expect(paths(tabs, 0)).not.toContain('/investments');
    expect(paths(tabs, 1)).not.toContain('/chat');
  });
});

describe('activePathFor', () => {
  const tabs = mobileTabsFor(navSectionsFor('admin', true, true, true));

  it.each([
    ['/', '/'],
    ['/accounts/42', '/accounts'],
    ['/transactions/import', '/transactions'],
    ['/investments/abc', '/investments'],
    ['/admin/users', '/admin/users'],
    ['/settings?tab=security', '/settings'],
  ])('resolves %s to %s', (url, expected) => {
    expect(activePathFor(tabs, url)).toBe(expected);
  });

  it('returns undefined for routes with no nav entry', () => {
    expect(activePathFor(tabs, '/onboarding')).toBeUndefined();
  });
});

describe('isSectionRootUrl', () => {
  it.each(['/', '/transactions', '/settings?tab=security', '/admin/users'])(
    'is true for nav root %s',
    (url) => expect(isSectionRootUrl(url)).toBe(true),
  );

  it.each(['/accounts/42', '/transactions/import', '/onboarding'])(
    'is false for %s',
    (url) => expect(isSectionRootUrl(url)).toBe(false),
  );
});
