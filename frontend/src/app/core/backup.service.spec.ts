import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BackupService } from './backup.service';

describe('BackupService', () => {
  let service: BackupService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BackupService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('maps an encrypted export and sends the encryption choice', () => {
    service.export(true).subscribe((result) => {
      expect(result.recoveryKey).toBe('recovery-key');
      expect(result.archive['encrypted']).toBe(true);
    });

    const request = http.expectOne('/api/v1/backups/export');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ encrypted: true });
    request.flush({
      filename: 'backup.json',
      archive: { encrypted: true },
      recovery_key: 'recovery-key',
    });
  });

  it('maps preview metadata and only sends a recovery key when present', () => {
    service.preview({ format_version: 1 }, 'key').subscribe((result) => {
      expect(result.sourceAppVersion).toBe('0.2.0');
      expect(result.exportedAt).toBe('2026-08-31T12:00:00Z');
      expect(result.counts).toEqual({ accounts: 2 });
    });

    const request = http.expectOne('/api/v1/backups/preview');
    expect(request.request.body).toEqual({
      archive: { format_version: 1 },
      recovery_key: 'key',
    });
    request.flush({
      source_app_version: '0.2.0',
      exported_at: '2026-08-31T12:00:00Z',
      encrypted: true,
      counts: { accounts: 2 },
      warnings: [],
    });
  });
});
