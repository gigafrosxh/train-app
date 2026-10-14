import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

const PUBLIC = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/csrf'];

function isApi(req: HttpRequest<unknown>) {
  return req.url.startsWith(environment.apiBase);
}

function isPublic(req: HttpRequest<unknown>) {
  return PUBLIC.some((p) => req.url.endsWith(p));
}

function withToken(req: HttpRequest<unknown>, token: string | null) {
  return token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
}

/** Hängt das Access-Token an und erneuert es einmalig bei 401. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApi(req) || isPublic(req)) {
    return next(req.clone({ withCredentials: true }));
  }
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(withToken(req, auth.token)).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse)) return throwError(() => err);

      if (err.status === 403 && err.error?.code === 'AUTH_PASSWORD_CHANGE_REQUIRED') {
        router.navigate(['/password']);
        return throwError(() => err);
      }
      if (err.status !== 401 || !auth.isLoggedIn()) return throwError(() => err);

      return auth.refresh().pipe(
        switchMap((token) => next(withToken(req, token))),
        catchError((refreshErr) => {
          auth.clear();
          router.navigate(['/login'], { queryParams: { reason: 'expired' } });
          return throwError(() => refreshErr);
        }),
      );
    }),
  );
};
