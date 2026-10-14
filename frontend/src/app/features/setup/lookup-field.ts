import { Component, DestroyRef, forwardRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, FormControl, NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, of, startWith, switchMap } from 'rxjs';
import { AdminResource } from '../../core/api/api';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Lookup, Option } from './lookup';

/** Suchfeld für eine Referenz (ID) auf eine Admin-Ressource. */
@Component({
  selector: 'app-lookup-field',
  imports: [ReactiveFormsModule, MatAutocompleteModule, MatFormFieldModule, MatInputModule, TranslatePipe],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => LookupField), multi: true }],
  template: `
    <mat-form-field>
      <mat-label>{{ label() }}</mat-label>
      <input matInput [formControl]="text" [matAutocomplete]="auto" (blur)="onBlur()" autocomplete="off" />
      @if (error()) {
        <mat-hint class="err">{{ error() }}</mat-hint>
      }
      <mat-autocomplete #auto="matAutocomplete" (optionSelected)="pick($event.option.value)" [displayWith]="display">
        @for (o of options(); track o.value) {
          <mat-option [value]="o">
            {{ o.label }}
            @if (o.sub) {
              <span class="muted small"> · {{ o.sub }}</span>
            }
          </mat-option>
        } @empty {
          <mat-option disabled>{{ 'common.noResults' | t }}</mat-option>
        }
      </mat-autocomplete>
    </mat-form-field>
  `,
  styles: ':host { display: block; } .err { color: var(--c-bad); }',
})
export class LookupField implements ControlValueAccessor, OnInit {
  private readonly lookup = inject(Lookup);
  private readonly destroyRef = inject(DestroyRef);
  readonly resource = input.required<AdminResource>();
  readonly label = input('');
  readonly query = input<Record<string, string>>({});
  readonly error = input<string | null>(null);

  protected readonly text = new FormControl<string | Option>('', { nonNullable: true });
  protected readonly options = signal<Option[]>([]);
  private value: string | null = null;
  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  protected display = (o: Option | string | null) => (typeof o === 'string' ? o : (o?.label ?? ''));

  ngOnInit() {
    this.text.valueChanges
      .pipe(
        startWith(''),
        debounceTime(200),
        switchMap((v) => (typeof v === 'string' ? this.lookup.search(this.resource(), v.trim(), this.query()) : of(null))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((opts) => opts && this.options.set(opts));
  }

  protected pick(o: Option) {
    this.value = o.value;
    this.onChange(o.value);
  }

  protected onBlur() {
    this.onTouched();
    setTimeout(() => {
      if (typeof this.text.value === 'string') {
        if (!this.text.value.trim()) {
          this.value = null;
          this.onChange(null);
        } else if (this.value) {
          const name = this.lookup.name(this.resource(), this.value);
          this.text.setValue({ value: this.value, label: name ?? this.value }, { emitEvent: false });
        }
      }
    }, 200);
  }

  writeValue(id: string | null): void {
    this.value = id;
    if (!id) {
      this.text.setValue('', { emitEvent: false });
      return;
    }
    const name = this.lookup.name(this.resource(), id);
    this.text.setValue({ value: id, label: name ?? '…' }, { emitEvent: false });
    if (!name) {
      // Name kommt asynchron
      const t = setInterval(() => {
        const n = this.lookup.name(this.resource(), id);
        if (n) {
          clearInterval(t);
          if (this.value === id) this.text.setValue({ value: id, label: n }, { emitEvent: false });
        }
      }, 150);
      setTimeout(() => clearInterval(t), 5000);
    }
  }

  registerOnChange(fn: (v: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    if (disabled) this.text.disable({ emitEvent: false });
    else this.text.enable({ emitEvent: false });
  }
}
