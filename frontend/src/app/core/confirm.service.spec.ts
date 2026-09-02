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

  it('exposes choices and resolves the selected value', async () => {
    const choices = [
      { labelKey: 'one', value: 'one' },
      { labelKey: 'all', value: 'all', tone: 'danger' as const },
    ];
    const promise = service.choose('title', 'message', choices, { count: 10 });

    expect(service.request()).toEqual(
      expect.objectContaining({
        titleKey: 'title',
        messageKey: 'message',
        choices,
        params: { count: 10 },
      }),
    );

    service.respondChoice('all');

    expect(await promise).toBe('all');
    expect(service.request()).toBeNull();
  });

  it('resolves null when a choice dialog is dismissed', async () => {
    const promise = service.choose('title', 'message', [{ labelKey: 'one', value: 'one' }]);
    service.dismiss();

    expect(await promise).toBeNull();
  });
});
