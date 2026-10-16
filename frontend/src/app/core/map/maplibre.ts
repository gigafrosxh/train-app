import * as maplibregl from 'maplibre-gl';

// MapLibre 6 lädt den Worker als eigene Datei. Nach dem Bündeln stimmt der relative Pfad nicht mehr,
// daher liegt der Worker als Asset unter /maplibre/ (siehe angular.json). Immer über dieses Modul importieren.
maplibregl.setWorkerUrl(new URL('maplibre/maplibre-gl-worker.mjs', document.baseURI).href);

export { maplibregl };
