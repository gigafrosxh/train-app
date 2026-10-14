import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Logo } from '../../shared/logo';
import { VersionFooter } from '../../shared/version-footer';
import { PasswordForm } from '../account/password-form';

/** Pflicht zum Passwortwechsel (z. B. nach Anlage durch Admin). */
@Component({
  selector: 'app-force-password',
  imports: [PasswordForm, MatButtonModule, MatIconModule, TranslatePipe, Logo, VersionFooter],
  template: `
    <div class="wrap">
      <div class="card enter">
        <app-logo [size]="44" />
        <h1>{{ 'password.forceTitle' | t }}</h1>
        <p class="muted">{{ 'password.forceText' | t: { name: auth.user()?.displayName ?? '' } }}</p>
        <app-password-form (changed)="done()" />
        <button mat-button type="button" (click)="auth.logout()">
          <mat-icon>logout</mat-icon>{{ 'account.logout' | t }}
        </button>
      </div>
      <app-version-footer class="foot" />
    </div>
  `,
  styles: `
    .wrap { min-height: 100dvh; display: grid; place-items: center; grid-template-rows: 1fr auto; padding: 16px; }
    .card { width: 100%; max-width: 440px; display: flex; flex-direction: column; gap: 12px; }
    h1 { font-size: 1.5rem; margin-top: 4px; }
  `,
})
export class ForcePasswordPage {
  protected readonly auth = inject(AuthService);

  protected done() {
    this.auth.clear();
    void this.auth.logout('passwordChanged');
  }
}
