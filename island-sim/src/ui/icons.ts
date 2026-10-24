export type UiIconName = 'edit' | 'palette' | 'world' | 'people' | 'history' | 'settings' | 'pause' | 'play' | 'save' | 'download' | 'upload' | 'add' | 'check' | 'alert' | 'refresh';

const paths: Readonly<Record<UiIconName, string>> = {
  edit: '<path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4 4 16.5Z"/><path d="m14.8 5.7 3.5 3.5"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18h1.1a1.9 1.9 0 0 0 1.3-3.3 1.8 1.8 0 0 1 1.3-3.1H18a3 3 0 0 0 3-3c0-4.8-4-8.6-9-8.6Z"/><path d="M7.5 11.5h.01M10 7.5h.01M15 8h.01M7 15.5h.01"/>',
  world: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20v-1.5a5.5 5.5 0 0 1 11 0V20H3.5Z"/><path d="M16 5.5a3 3 0 0 1 0 5.8m1 3a4.5 4.5 0 0 1 3.5 4.4V20h-3"/>',
  history: '<path d="M4 7V3m0 4h4"/><path d="M4.8 7.2A8.5 8.5 0 1 1 3.5 13"/><path d="M12 7v5l3 2"/>',
  settings: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1 1.3 1-1.3 2.2-1.6-.6a7.8 7.8 0 0 1-1.5.9l-.3 1.7h-2.6l-.3-1.7a7.8 7.8 0 0 1-1.5-.9l-1.6.6-1.3-2.2 1.3-1a7 7 0 0 1 0-1.8l-1.3-1 1.3-2.2 1.6.6a7.8 7.8 0 0 1 1.5-.9l.3-1.7h2.6l.3 1.7a7.8 7.8 0 0 1 1.5.9l1.6-.6 1.3 2.2-1.3 1a7 7 0 0 1 0 1.7Z"/>',
  pause: '<path d="M8 5h3v14H8zM15 5h3v14h-3z"/>',
  play: '<path d="m7 4 13 8-13 8V4Z"/>',
  save: '<path d="M4 4h13l3 3v13H4V4Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 17v4h16v-4"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5"/><path d="M4 17v4h16v-4"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  alert: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/>',
  refresh: '<path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 0 1 3"/><path d="M20 12a8 8 0 0 0-14-5"/>',
};

export function renderUiIcon(name: UiIconName): string {
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g>${paths[name]}</g></svg>`;
}
