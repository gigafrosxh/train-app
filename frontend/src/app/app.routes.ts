import { Routes } from '@angular/router';
import { authGuard, guestGuard, passwordChangeGuard, roleGuard } from './core/auth/auth.guards';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'password',
    canActivate: [passwordChangeGuard],
    loadComponent: () => import('./features/auth/force-password.page').then((m) => m.ForcePasswordPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      {
        path: 'home',
        title: 'Gleis',
        loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage),
      },
      {
        path: 'tickets',
        loadComponent: () => import('./features/tickets/tickets.page').then((m) => m.TicketsPage),
      },
      {
        path: 'rail',
        loadComponent: () => import('./features/rail/rail.page').then((m) => m.RailPage),
      },
      {
        path: 'rail/trips/:id',
        loadComponent: () => import('./features/rail/trip.page').then((m) => m.TripPage),
      },
      {
        path: 'map',
        loadComponent: () => import('./features/map/map.page').then((m) => m.MapPage),
      },
      {
        path: 'account',
        loadComponent: () => import('./features/account/account.page').then((m) => m.AccountPage),
      },
      {
        path: 'plan',
        canActivate: [roleGuard('WORKER', 'ADMIN')],
        loadComponent: () => import('./features/plan/plan.page').then((m) => m.PlanPage),
      },
      {
        path: 'setup',
        canActivate: [roleGuard('ADMIN')],
        loadChildren: () => import('./features/setup/setup.routes').then((m) => m.SETUP_ROUTES),
      },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
