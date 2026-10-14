import { Component, inject, Injectable } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { TranslatePipe } from '../core/i18n/translate.pipe';

export interface ConfirmData {
  title: string;
  text: string;
  confirm: string;
  danger?: boolean;
  cancel?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p>{{ data.text }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false">{{ data.cancel ?? ('common.cancel' | t) }}</button>
      <button
        mat-flat-button
        [mat-dialog-close]="true"
        [class.danger]="data.danger"
        cdkFocusInitial
      >
        {{ data.confirm }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .danger { --mat-button-filled-container-color: var(--c-bad); --mat-button-filled-label-text-color: #fff; }
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
}

@Injectable({ providedIn: 'root' })
export class Confirm {
  private readonly dialog = inject(MatDialog);

  /** Zwei echte Optionen: true = confirm, false = cancel-Button, undefined = geschlossen. */
  choose(data: ConfirmData & { cancel: string }): Promise<boolean | undefined> {
    return firstValueFrom(
      this.dialog.open(ConfirmDialog, { data, width: '420px', maxWidth: 'calc(100vw - 32px)' }).afterClosed(),
    );
  }

  ask(data: ConfirmData): Promise<boolean> {
    return firstValueFrom(
      this.dialog.open(ConfirmDialog, { data, width: '420px', maxWidth: 'calc(100vw - 32px)' }).afterClosed(),
    ).then((r) => r === true);
  }
}
