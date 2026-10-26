import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiClient } from './api-client';

describe('ApiClient', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('serializes typed query parameters', () => {
    api.get('/items', { active: true, page: 2, omitted: undefined }).subscribe();
    const req = http.expectOne((request) => request.url === '/api/v1/items');
    expect(req.request.params.get('active')).toBe('true');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.has('omitted')).toBe(false);
    req.flush([]);
  });

  it('getPage reads the X-Total-Count header', () => {
    let page: { items: unknown[]; total: number } | undefined;
    api.getPage('/items', { limit: 2 }).subscribe((result) => (page = result));
    const req = http.expectOne((request) => request.url === '/api/v1/items');
    req.flush([{ id: 'a' }, { id: 'b' }], { headers: { 'X-Total-Count': '17' } });
    expect(page).toEqual({ items: [{ id: 'a' }, { id: 'b' }], total: 17 });
  });

  it('getPage falls back to the body length when the header is absent', () => {
    let page: { items: unknown[]; total: number } | undefined;
    api.getPage('/items').subscribe((result) => (page = result));
    const req = http.expectOne((request) => request.url === '/api/v1/items');
    req.flush([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(page?.total).toBe(3);
  });

  it('supports POST, PUT, PATCH, DELETE, and 204 responses', () => {
    for (const [verb, call, path] of [
      ['POST', () => api.post('/items', { name: 'one' }), '/api/v1/items'],
      ['PUT', () => api.put('/items/one', { name: 'two' }), '/api/v1/items/one'],
      ['PATCH', () => api.patch('/items/one', { name: 'three' }), '/api/v1/items/one'],
    ] as const) {
      call().subscribe();
      const req = http.expectOne(path);
      expect(req.request.method).toBe(verb);
      req.flush({});
    }
    let completed = false;
    api.delete('/items/one').subscribe({ complete: () => (completed = true) });
    const req = http.expectOne('/api/v1/items/one');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(completed).toBe(true);
  });

  it('sends a JSON body with a DELETE only when one is given', () => {
    api.delete('/items/one', undefined, { current_password: 'pw' }).subscribe();
    const withBody = http.expectOne('/api/v1/items/one');
    expect(withBody.request.method).toBe('DELETE');
    expect(withBody.request.body).toEqual({ current_password: 'pw' });
    withBody.flush(null, { status: 204, statusText: 'No Content' });

    api.delete('/items/two').subscribe();
    const without = http.expectOne('/api/v1/items/two');
    expect(without.request.body).toBeNull();
    without.flush(null, { status: 204, statusText: 'No Content' });
  });
});
