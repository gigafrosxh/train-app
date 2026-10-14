import pkg from '../../../package.json';

/** Version aus package.json – wird über ../scripts/version.mjs mit VERSION synchron gehalten. */
export const APP_VERSION: string = pkg.version;
export const RELEASE_URL = `https://github.com/gigafrosxh/train-app/releases/tag/v${APP_VERSION}`;
