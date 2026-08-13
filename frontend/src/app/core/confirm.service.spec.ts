import { TestBed } from '@angular/core/testing';
import { ConfirmService } from './confirm.service';

describe('ConfirmService', () => {
  let service: ConfirmService;

  beforeEach(() => {
    service = TestBed.inject(ConfirmService);
  });

  it('has no pending request initially', () => {
    expect(service.request()).toBeNull();
  });

  it('exposes the pending request while confirm() is awaited, then clears it', async () => {
    const promise = service.confirm('some.title', 'some.message', 'danger');

    expect(service.request()).toEqual(
      expect.objectContaining({ titleKey: 'some.title', messageKey: 'some.message', tone: 'danger' })
    );

    service.respond(true);

    expect(await promise).toBe(true);
    expect(service.request()).toBeNull();
  });

  it('resolves false when responded to with false', async () => {
    const promise = service.confirm('t', 'm');
    service.respond(false);

    expect(await promise).toBe(false);
  });

  it('defaults tone to "default"', () => {
    void service.confirm('t', 'm');
    expect(service.request()?.tone).toBe('default');
  });
});
