import { Component, inject, output, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { AccountApi } from '../../core/api/api';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { apiError, Notify } from '../../core/ui/notify.service';

function sameAsNew(group: AbstractControl): ValidationErrors | null {
  const a = group.get('newPassword')?.value;
  const b = group.get('repeat')?.value;
  return a && b && a !== b ? { mismatch: true } : null;
}

@Component({
  selector: 'app-password-form',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, TranslatePipe],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="stack">
      <mat-form-field>
        <mat-label>{{ 'password.current' | t }}</mat-label>
        <input matInput type="password" formControlName="currentPassword" autocomplete="current-password" />
        @if (form.controls.currentPassword.hasError('server')) {
          <mat-error>{{ form.controls.currentPassword.getError('server') }}</mat-error>
        } @else if (form.controls.currentPassword.invalid) {
          <mat-error>{{ 'login.passwordRequired' | t }}</mat-error>
        }
      </mat-form-field>
      <mat-form-field>
        <mat-label>{{ 'password.new' | t }}</mat-label>
        <input matInput type="password" formControlName="newPassword" autocomplete="new-password" />
        <mat-hint>{{ 'login.passwordHint' | t }}</mat-hint>
        @if (form.controls.newPassword.invalid) {
          <mat-error>{{ 'login.passwordHint' | t }}</mat-error>
        }
      </mat-form-field>
      <mat-form-field>
        <mat-label>{{ 'password.repeat' | t }}</mat-label>
        <input matInput type="password" formControlName="repeat" autocomplete="new-password" />
      </mat-form-field>
      @if (form.hasError('mismatch') && form.controls.repeat.touched) {
        <p class="err small">{{ 'password.mismatch' | t }}</p>
      }
      <p class="muted small">{{ 'password.relogin' | t }}</p>
      <div class="row">
        <button mat-flat-button type="submit" [disabled]="busy()">{{ 'password.save' | t }}</button>
      </div>
    </form>
  `,
  styles: '.err { color: var(--c-bad); margin-top: -4px; }',
})
export class PasswordForm {
  private readonly api = inject(AccountApi);
  private readonly fb = inject(FormBuilder);
  private readonly notify = inject(Notify);
  private readonly i18n = inject(I18n);
  readonly changed = output<void>();
  protected readonly busy = signal(false);

  protected readonly form = this.fb.nonNullable.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      repeat: ['', Validators.required],
    },
    { validators: sameAsNew },
  );

  protected async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    try {
      const { currentPassword, newPassword } = this.form.getRawValue();
      await firstValueFrom(this.api.changePassword(currentPassword, newPassword));
      this.changed.emit();
    } catch (err) {
      const api = apiError(err);
      for (const fe of api?.fieldErrors ?? []) {
        this.form.get(fe.field)?.setErrors({ server: this.i18n.t(`fieldErrors.${fe.code}`) });
      }
      if (!api?.fieldErrors?.length) this.notify.error(err);
    } finally {
      this.busy.set(false);
    }
  }
}
