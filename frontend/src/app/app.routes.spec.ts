import { adminGuard, agentsGuard } from './core/auth.guards';
import { routes } from './app.routes';

describe('app routes', () => {
  it('protects providers under the admin route', () => {
    const shell = routes.find((route) => route.path === '');
    const providers = shell?.children?.find((route) => route.path === 'admin/providers');

    expect(shell?.children?.find((route) => route.path === 'providers')).toBeUndefined();
    expect(providers?.canActivate).toEqual([adminGuard, agentsGuard]);
    expect(providers?.loadComponent).toBeDefined();
  });
});
