import { Routes } from '@angular/router';
import { DEFS } from './defs';

const crud = Object.keys(DEFS).map((key) => ({
  path: key,
  data: { def: key },
  loadComponent: () => import('./crud.page').then((m) => m.CrudPage),
}));

export const SETUP_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./setup.shell').then((m) => m.SetupShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'country' },
      { path: 'country', loadComponent: () => import('./country.page').then((m) => m.CountryPage) },
      ...crud,
    ],
  },
];
