import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { openOnNewParam } from './open-on-new-param';

@Component({ selector: 'app-test-host', template: '' })
class TestHost {
  calls = 0;
  constructor() {
    openOnNewParam(() => this.calls++);
  }
}

describe('openOnNewParam', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: 'host', component: TestHost }])
      ]
    });
  });

  it('fires the callback and strips ?new=1 from the URL', async () => {
    const harness = await RouterTestingHarness.create();
    const host = await harness.navigateByUrl('/host?new=1', TestHost);
    await harness.fixture.whenStable();

    expect(host.calls).toBe(1);
    expect(TestBed.inject(Router).url).toBe('/host');
  });

  it('does not fire when there is no `new` param', async () => {
    const harness = await RouterTestingHarness.create();
    const host = await harness.navigateByUrl('/host', TestHost);

    expect(host.calls).toBe(0);
  });

  it('fires again on a later ?new=1 navigation - the case the param-stripping fixes', async () => {
    const harness = await RouterTestingHarness.create();
    const host = await harness.navigateByUrl('/host?new=1', TestHost);
    await harness.fixture.whenStable();
    expect(host.calls).toBe(1);

    await harness.navigateByUrl('/host?new=1', TestHost);
    await harness.fixture.whenStable();

    expect(host.calls).toBe(2);
  });
});
