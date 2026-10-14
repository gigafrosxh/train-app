import { Component, effect, inject, input, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../core/mock/mock-db';
import { PreferencesService } from '../../core/prefs/preferences.service';
import { apiError, Notify } from '../../core/ui/notify.service';
import { Logo } from '../../shared/logo';
import { VersionFooter } from '../../shared/version-footer';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslatePipe,
    Logo,
    VersionFooter,
  ],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);
  protected readonly i18n = inject(I18n);
  protected readonly prefs = inject(PreferencesService);

  readonly reason = input<string>();
  readonly next = input<string>();

  protected readonly mode = signal<'login' | 'register'>('login');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly registered = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly demo = environment.useMocks;
  protected readonly demoAccounts = DEMO_ACCOUNTS;

  protected readonly loginForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected readonly registerForm = this.fb.nonNullable.group({
    displayName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected switchMode(mode: 'login' | 'register') {
    this.mode.set(mode);
    this.error.set(null);
  }

  protected async login() {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    const { email, password } = this.loginForm.getRawValue();
    await this.run(async () => {
      const user = await this.auth.login(email, password);
      if (user.mustChangePassword) await this.router.navigate(['/password']);
      else await this.router.navigateByUrl(this.next() || '/home');
    });
  }

  protected async demoLogin(email: string) {
    this.loginForm.setValue({ email, password: DEMO_PASSWORD });
    await this.login();
  }

  protected async register() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }
    const { displayName, email, password } = this.registerForm.getRawValue();
    await this.run(async () => {
      await this.auth.register(email, password, displayName);
      this.registered.set(true);
      this.loginForm.setValue({ email, password: '' });
      this.mode.set('login');
    });
  }

  private async run(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (err) {
      const api = apiError(err);
      const form: { get(path: string): import('@angular/forms').AbstractControl | null } =
        this.mode() === 'login' ? this.loginForm : this.registerForm;
      for (const fe of api?.fieldErrors ?? []) {
        form.get(fe.field)?.setErrors({ server: this.i18n.t(`fieldErrors.${fe.code}`) });
      }
      this.error.set(this.notify.messageFor(err));
    } finally {
      this.busy.set(false);
    }
  }

  constructor() {
    const title = inject(Title);
    effect(() => {
      const key = this.mode() === 'login' ? 'login.submit' : 'login.registerSubmit';
      title.setTitle(`${this.i18n.t(key)} · Gleis`);
    });
  }

  protected toggleLanguage() {
    this.prefs.setLanguage(this.i18n.lang() === 'de' ? 'en' : 'de');
  }
}
