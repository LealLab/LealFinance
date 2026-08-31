import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from './api-client';

export type BackupArchive = Record<string, unknown>;

export interface BackupWarning {
  readonly code: string;
  readonly params: Record<string, unknown>;
}

export interface BackupExport {
  readonly filename: string;
  readonly archive: BackupArchive;
  readonly recoveryKey: string | null;
}

export interface BackupPreview {
  readonly sourceAppVersion: string;
  readonly exportedAt: string;
  readonly encrypted: boolean;
  readonly counts: Record<string, number>;
  readonly warnings: BackupWarning[];
}

export interface BackupRestore {
  readonly counts: Record<string, number>;
  readonly warnings: BackupWarning[];
}

interface BackupExportWire {
  filename: string;
  archive: BackupArchive;
  recovery_key: string | null;
}

interface BackupPreviewWire {
  source_app_version: string;
  exported_at: string;
  encrypted: boolean;
  counts: Record<string, number>;
  warnings: BackupWarning[];
}

@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly api = inject(ApiClient);

  export(encrypted: boolean): Observable<BackupExport> {
    return this.api.post<BackupExportWire>('/backups/export', { encrypted }).pipe(
      map((response) => ({
        filename: response.filename,
        archive: response.archive,
        recoveryKey: response.recovery_key,
      })),
    );
  }

  preview(archive: BackupArchive, recoveryKey?: string): Observable<BackupPreview> {
    return this.api
      .post<BackupPreviewWire>('/backups/preview', this.request(archive, recoveryKey))
      .pipe(map(mapPreview));
  }

  restore(archive: BackupArchive, recoveryKey?: string): Observable<BackupRestore> {
    return this.api.post<BackupRestore>('/backups/restore', this.request(archive, recoveryKey));
  }

  private request(archive: BackupArchive, recoveryKey?: string): object {
    return recoveryKey ? { archive, recovery_key: recoveryKey } : { archive };
  }
}

function mapPreview(response: BackupPreviewWire): BackupPreview {
  return {
    sourceAppVersion: response.source_app_version,
    exportedAt: response.exported_at,
    encrypted: response.encrypted,
    counts: response.counts,
    warnings: response.warnings,
  };
}
