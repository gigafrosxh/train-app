import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { I18n } from '../i18n/i18n.service';
import { ApiError } from '../models/api.models';

export function apiError(err: unknown): ApiError | null {
  if (err instanceof HttpErrorResponse && err.error && typeof err.error === 'object' && 'code' in err.error) {
    return err.error as ApiError;
  }
  return null;
}

export function errorCode(err: unknown): string | null {
  return apiError(err)?.code ?? null;
}

@Injectable({ providedIn: 'root' })
export class Notify {
  private readonly snack = inject(MatSnackBar);
  private readonly i18n = inject(I18n);

  /** Lesbarer Text für einen API-Fehler: erst Code übersetzen, dann Server-Text, dann allgemein. */
  messageFor(err: unknown): string {
    const api = apiError(err);
    if (api && this.i18n.has(`errors.${api.code}`)) return this.i18n.t(`errors.${api.code}`);
    if (err instanceof HttpErrorResponse && err.status === 0) return this.i18n.t('errors.OFFLINE');
    if (api?.message) return api.message;
    return this.i18n.t('errors.GENERIC');
  }

  info(key: string, params?: Record<string, string | number>) {
    this.snack.open(this.i18n.t(key, params), undefined, { duration: 3000 });
  }

  error(err: unknown) {
    this.snack.open(this.messageFor(err), this.i18n.t('common.ok'), {
      duration: 6000,
      panelClass: 'snack-error',
    });
  }
}
