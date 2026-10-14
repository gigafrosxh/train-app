import { inject, Injectable, signal } from '@angular/core';
import { catchError, map, Observable, of, shareReplay } from 'rxjs';
import { AdminApi, AdminResource } from '../../core/api/api';

export interface Option {
  value: string;
  label: string;
  sub?: string;
}

/** Wie ein Datensatz in Auswahllisten heißt. */
export function labelOf(resource: AdminResource, row: Record<string, unknown>): Option {
  const id = String(row['id']);
  switch (resource) {
    case 'trains':
      return { value: id, label: String(row['trainNumber']), sub: (row['name'] as string) ?? undefined };
    case 'users':
      return { value: id, label: String(row['displayName']), sub: String(row['email']) };
    case 'routes':
      return { value: id, label: String(row['name']) };
    case 'stations':
      return { value: id, label: String(row['name']), sub: (row['code'] as string) ?? undefined };
    case 'schedules':
      return { value: id, label: id };
    default:
      return { value: id, label: String(row['name'] ?? row['code'] ?? id), sub: (row['code'] as string) ?? undefined };
  }
}

/** Zwischenspeicher für Namen referenzierter Datensätze (z. B. Linie zu einer Route). */
@Injectable({ providedIn: 'root' })
export class Lookup {
  private readonly api = inject(AdminApi);
  private readonly names = new Map<string, ReturnType<typeof signal<string | null>>>();
  private readonly lists = new Map<string, Observable<Option[]>>();

  /** Name zu einer ID – lädt bei Bedarf einzeln nach. */
  name(resource: AdminResource, id: string | null | undefined): string | null {
    if (!id) return null;
    const key = `${resource}:${id}`;
    let s = this.names.get(key);
    if (!s) {
      s = signal<string | null>(null);
      this.names.set(key, s);
      const target = s;
      this.api.get(resource, id).subscribe({
        next: (row) => target.set(labelOf(resource, row as unknown as Record<string, unknown>).label),
        error: () => target.set('–'),
      });
    }
    return s();
  }

  remember(resource: AdminResource, rows: Record<string, unknown>[]) {
    for (const r of rows) {
      const o = labelOf(resource, r);
      const key = `${resource}:${o.value}`;
      const s = this.names.get(key);
      if (s) s.set(o.label);
      else this.names.set(key, signal<string | null>(o.label));
    }
  }

  /** Komplette kleine Liste (Gesellschaften, Linien …), einmal geladen. */
  all(resource: AdminResource, query: Record<string, string> = {}): Observable<Option[]> {
    const key = resource + JSON.stringify(query);
    let o = this.lists.get(key);
    if (!o) {
      o = this.api.list(resource, { ...query, pageSize: 100 }).pipe(
        map((p) => {
          this.remember(resource, p.items as unknown as Record<string, unknown>[]);
          return p.items.map((r) => labelOf(resource, r as unknown as Record<string, unknown>));
        }),
        catchError(() => of([])),
        shareReplay(1),
      );
      this.lists.set(key, o);
    }
    return o;
  }

  /** Serverseitige Suche für große Listen (Züge, Bahnhöfe). */
  search(resource: AdminResource, q: string, query: Record<string, string> = {}): Observable<Option[]> {
    return this.api.list(resource, { ...query, q, pageSize: 20 }).pipe(
      map((p) => {
        this.remember(resource, p.items as unknown as Record<string, unknown>[]);
        return p.items.map((r) => labelOf(resource, r as unknown as Record<string, unknown>));
      }),
      catchError(() => of([])),
    );
  }

  invalidate(resource: AdminResource) {
    for (const k of [...this.lists.keys()]) if (k.startsWith(resource)) this.lists.delete(k);
  }
}
