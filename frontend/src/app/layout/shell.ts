import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../core/auth/auth.service';
import { I18n } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { Role } from '../core/models/api.models';
import { PreferencesService } from '../core/prefs/preferences.service';
import { Notify } from '../core/ui/notify.service';
import { Logo } from '../shared/logo';
import { VersionFooter } from '../shared/version-footer';

interface NavItem {
  path: string;
  icon: string;
  label: string;
  roles?: Role[];
  mobile: boolean;
}

const NAV: NavItem[] = [
  { path: '/home', icon: 'home', label: 'nav.home', mobile: true },
  { path: '/tickets', icon: 'confirmation_number', label: 'nav.tickets', mobile: true },
  { path: '/rail', icon: 'departure_board', label: 'nav.rail', mobile: true },
  { path: '/map', icon: 'map', label: 'nav.map', mobile: true },
  { path: '/account', icon: 'person', label: 'nav.account', mobile: true },
  { path: '/plan', icon: 'edit_calendar', label: 'nav.plan', roles: ['WORKER', 'ADMIN'], mobile: false },
  { path: '/setup', icon: 'tune', label: 'nav.setup', roles: ['ADMIN'], mobile: false },
];

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatTooltipModule, TranslatePipe, Logo, VersionFooter],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18n);
  protected readonly prefs = inject(PreferencesService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  protected readonly demo = environment.useMocks;
  private readonly notify = inject(Notify);

  /** Browser meldet keine Netzverbindung → Hinweis oben. */
  protected readonly offline = signal(typeof navigator !== 'undefined' && navigator.onLine === false);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => (e as NavigationEnd).urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly items = computed(() => {
    const role = this.auth.role();
    return NAV.filter((n) => !n.roles || (role && n.roles.includes(role)));
  });
  protected readonly mainItems = computed(() => this.items().filter((n) => !n.roles));
  protected readonly staffItems = computed(() => this.items().filter((n) => n.roles));
  protected readonly mobileItems = computed(() => this.items().filter((n) => n.mobile));

  protected readonly current = computed(() => {
    const url = this.url();
    return NAV.find((n) => url.startsWith(n.path)) ?? NAV[0];
  });

  protected readonly fullBleed = computed(() => this.url().startsWith('/map'));

  constructor() {
    effect(() => {
      this.i18n.lang();
      const label = this.i18n.t(this.current().label);
      this.title.setTitle(`${label} · Gleis`);
    });

    const goOffline = () => this.offline.set(true);
    const goOnline = () => {
      if (this.offline()) this.notify.info('shell.backOnline');
      this.offline.set(false);
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    });
  }

  protected toggleLanguage() {
    this.prefs.setLanguage(this.i18n.lang() === 'de' ? 'en' : 'de');
  }
}
