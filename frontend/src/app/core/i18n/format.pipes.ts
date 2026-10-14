import { inject, Pipe, PipeTransform } from '@angular/core';
import { Format } from './format.service';

// Alle Pipes sind unrein, damit ein Sprachwechsel sofort greift.

@Pipe({ name: 'hm', pure: false })
export class TimePipe implements PipeTransform {
  private readonly f = inject(Format);
  transform(iso: string | null | undefined): string {
    return this.f.time(iso);
  }
}

@Pipe({ name: 'day', pure: false })
export class DayPipe implements PipeTransform {
  private readonly f = inject(Format);
  transform(iso: string | null | undefined): string {
    return this.f.day(iso);
  }
}

@Pipe({ name: 'dateTime', pure: false })
export class DateTimePipe implements PipeTransform {
  private readonly f = inject(Format);
  transform(iso: string | null | undefined): string {
    return this.f.dateTime(iso);
  }
}

@Pipe({ name: 'dur', pure: false })
export class DurationPipe implements PipeTransform {
  private readonly f = inject(Format);
  transform(seconds: number | null | undefined): string {
    return this.f.duration(seconds);
  }
}

@Pipe({ name: 'rel', pure: false })
export class RelativePipe implements PipeTransform {
  private readonly f = inject(Format);
  transform(iso: string | null | undefined): string {
    return this.f.relative(iso);
  }
}

export const FORMAT_PIPES = [TimePipe, DayPipe, DateTimePipe, DurationPipe, RelativePipe] as const;
