import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AccountApi } from '../../core/api/api';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { mockDb } from '../../core/mock/mock-backend';
import { PreferencesService } from '../../core/prefs/preferences.service';
import { Notify } from '../../core/ui/notify.service';
import { Confirm } from '../../shared/confirm.dialog';
import { PasswordForm } from './password-form';

@Component({
  selector: 'app-account',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    TranslatePipe,
    PasswordForm,
  ],
  templateUrl: './account.page.html',
  styleUrl: './account.page.scss',
})
export class AccountPage {
  protected readonly auth = inject(AuthService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly i18n = inject(I18n);
  private readonly api = inject(AccountApi);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  protected readonly demo = environment.useMocks;

  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly name = new FormControl(this.auth.user()?.displayName ?? '', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(80)],
  });

  protected edit() {
    this.name.setValue(this.auth.user()?.displayName ?? '');
    this.editing.set(true);
  }

  protected async saveName() {
    if (this.name.invalid) {
      this.name.markAsTouched();
      return;
    }
    this.saving.set(true);
    try {
      const user = await firstValueFrom(this.api.update({ displayName: this.name.value.trim() }));
      this.auth.updateUser(user);
      this.editing.set(false);
      this.notify.info('account.saved');
    } catch (err) {
      this.notify.error(err);
    } finally {
      this.saving.set(false);
    }
  }

  protected passwordChanged() {
    this.auth.clear();
    void this.auth.logout('passwordChanged');
  }

  protected async logout() {
    await this.auth.logout();
  }

  protected async resetDemo() {
    const ok = await this.confirm.ask({
      title: this.i18n.t('account.resetTitle'),
      text: this.i18n.t('account.resetText'),
      confirm: this.i18n.t('account.reset'),
      danger: true,
    });
    if (!ok) return;
    mockDb().reset();
    await this.auth.logout();
  }
}
