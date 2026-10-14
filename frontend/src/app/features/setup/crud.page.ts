import { Component, computed, DestroyRef, inject, OnInit, signal, Type } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { debounceTime, firstValueFrom, Subject } from 'rxjs';
import { AdminApi } from '../../core/api/api';
import { FORMAT_PIPES } from '../../core/i18n/format.pipes';
import { Format } from '../../core/i18n/format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { errorCode, Notify } from '../../core/ui/notify.service';
import { Confirm } from '../../shared/confirm.dialog';
import { CrudDialog, CrudDialogData } from './crud.dialog';
import { ColumnDef, DEFS, ResourceDef } from './defs';
import { Lookup } from './lookup';

type Row = Record<string, unknown> & { id: string; version: number };
const PAGE = 25;

@Component({
  selector: 'app-crud-page',
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, MatTooltipModule, TranslatePipe, ...FORMAT_PIPES],
  templateUrl: './crud.page.html',
  styleUrl: './crud.page.scss',
})
export class CrudPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  private readonly i18n = inject(I18n);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly lookup = inject(Lookup);
  protected readonly f = inject(Format);

  protected readonly def: ResourceDef = DEFS[inject(ActivatedRoute).snapshot.data['def'] as string];
  protected readonly rows = signal<Row[] | null>(null);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly q = signal('');
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE)));
  private readonly search$ = new Subject<string>();

  ngOnInit() {
    this.load();
    this.search$.pipe(debounceTime(250), takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      this.q.set(q);
      this.page.set(1);
      this.load();
    });
  }

  protected onSearch(q: string) {
    this.search$.next(q);
  }

  protected load() {
    this.api.list(this.def.resource, { ...(this.def.query ?? {}), q: this.q() || undefined, page: this.page(), pageSize: PAGE }).subscribe({
      next: (p) => {
        const items = p.items as unknown as Row[];
        this.rows.set(items);
        this.total.set(p.total);
        this.lookup.remember(this.def.resource, items);
      },
      error: (err) => {
        this.rows.set([]);
        this.notify.error(err);
      },
    });
  }

  protected go(page: number) {
    this.page.set(Math.min(Math.max(1, page), this.pages()));
    this.load();
  }

  protected cell(row: Row, col: ColumnDef): unknown {
    return col.value ? col.value(row) : row[col.key];
  }

  protected async open(row: Row | null) {
    const data: CrudDialogData = { def: this.def, row };
    const component: Type<unknown> = this.def.dialog ? await this.def.dialog() : CrudDialog;
    const ref = this.dialog.open(component, {
      data,
      width: this.def.dialog ? '760px' : '560px',
      maxWidth: 'calc(100vw - 24px)',
      autoFocus: false,
    });
    const saved = await firstValueFrom(ref.afterClosed());
    if (saved) {
      this.lookup.invalidate(this.def.resource);
      this.notify.info(row ? 'setup.saved' : 'setup.created');
      this.load();
    }
  }

  protected async remove(row: Row) {
    const ok = await this.confirm.ask({
      title: this.i18n.t('setup.deleteTitle'),
      text: this.i18n.t('setup.deleteText'),
      confirm: this.i18n.t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.api.remove(this.def.resource, row.id, row.version));
      this.lookup.invalidate(this.def.resource);
      this.notify.info('setup.deleted');
      this.load();
    } catch (err) {
      if (errorCode(err) === 'VERSION_CONFLICT') this.load();
      this.notify.error(err);
    }
  }
}
