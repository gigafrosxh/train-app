import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, firstValueFrom, map, Observable, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthResponse, Role, User } from '../models/api.models';

const API = environment.apiBase;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  /** Access-Token nur im Speicher (Vertrag: kein localStorage). */
  private accessToken: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refresh$: Observable<string | null> | null = null;
  private csrfReady = false;

  readonly user = signal<User | null>(null);
  /** Ändert sich bei jedem neuen Token – Socket baut daraufhin neu auf. */
  readonly tokenVersion = signal(0);
  readonly isLoggedIn = computed(() => this.user() !== null);
  readonly role = computed<Role | null>(() => this.user()?.role ?? null);
  readonly isWorker = computed(() => this.role() === 'WORKER' || this.role() === 'ADMIN');
  readonly isAdmin = computed(() => this.role() === 'ADMIN');

  get token(): string | null {
    return this.accessToken;
  }

  /** Beim App-Start: bestehende Sitzung über das Refresh-Cookie wiederherstellen. */
  async restoreSession(): Promise<void> {
    try {
      await this.ensureCsrf();
      await firstValueFrom(this.refresh());
    } catch {
      // keine Sitzung – Login-Seite
    }
  }

  async ensureCsrf(): Promise<void> {
    if (this.csrfReady && document.cookie.includes('XSRF-TOKEN')) return;
    await firstValueFrom(this.http.get(`${API}/auth/csrf`, { observe: 'response' }));
    this.csrfReady = true;
  }

  async login(email: string, password: string): Promise<User> {
    await this.ensureCsrf();
    const res = await firstValueFrom(
      this.http.post<AuthResponse>(`${API}/auth/login`, { email, password }),
    );
    this.applyAuth(res);
    return res.user;
  }

  async register(email: string, password: string, displayName: string): Promise<void> {
    await this.ensureCsrf();
    await firstValueFrom(
      this.http.post<User>(`${API}/auth/register`, { email, password, displayName }),
    );
  }

  /** Teilt sich laufende Refresh-Anfragen, damit nur eine gleichzeitig läuft. */
  refresh(): Observable<string | null> {
    if (!this.refresh$) {
      this.refresh$ = this.http.post<AuthResponse>(`${API}/auth/refresh`, {}).pipe(
        tap((res) => this.applyAuth(res)),
        map((res) => res.accessToken),
        finalize(() => (this.refresh$ = null)),
        shareReplay(1),
      );
    }
    return this.refresh$;
  }

  async logout(reason?: 'expired' | 'passwordChanged'): Promise<void> {
    if (this.accessToken) {
      await firstValueFrom(
        this.http.post(`${API}/auth/logout`, {}).pipe(catchError(() => of(null))),
      );
    }
    this.clear();
    await this.router.navigate(['/login'], reason ? { queryParams: { reason } } : undefined);
  }

  /** Lokaler Abbruch ohne Serveraufruf (z. B. Refresh fehlgeschlagen). */
  clear(): void {
    this.accessToken = null;
    this.user.set(null);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.tokenVersion.update((v) => v + 1);
  }

  updateUser(user: User): void {
    this.user.set(user);
  }

  private applyAuth(res: AuthResponse): void {
    this.accessToken = res.accessToken;
    this.user.set(res.user);
    this.tokenVersion.update((v) => v + 1);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    // 30 s vor Ablauf still erneuern
    const ms = Math.max(10, res.expiresIn - 30) * 1000;
    this.refreshTimer = setTimeout(() => {
      this.refresh().subscribe({ error: () => this.logout('expired') });
    }, ms);
  }
}
