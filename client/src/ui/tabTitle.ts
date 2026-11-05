// Tab title + favicon alert for when the tab is in the background ("⏰ 휴식 끝!").
// Cleared automatically when the tab becomes visible again; the original title/favicon come back.

const ALARM_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="50%" y="54%" font-size="52" text-anchor="middle" dominant-baseline="middle">⏰</text></svg>',
)}`;

export class TabTitle {
  private saved: { title: string; icon: HTMLLinkElement | null; iconHref: string | null; added: HTMLLinkElement | null } | null = null;

  constructor(private doc: Document) {
    doc.addEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = () => {
    if (this.doc.visibilityState === 'visible') this.clear();
  };

  /** Shows `text` as the tab title with an alarm favicon. The caller decides when (e.g. only if doc.hidden). */
  alert(text: string): void {
    const head = this.doc.head;
    if (!this.saved) {
      const icon = head.querySelector<HTMLLinkElement>('link[rel~="icon"]');
      this.saved = { title: this.doc.title, icon, iconHref: icon?.getAttribute('href') ?? null, added: null };
      if (!icon) {
        const link = this.doc.createElement('link');
        link.rel = 'icon';
        head.appendChild(link);
        this.saved.added = link;
      }
    }
    this.doc.title = text;
    (this.saved.icon ?? this.saved.added)!.href = ALARM_ICON;
  }

  clear(): void {
    const s = this.saved;
    if (!s) return;
    this.saved = null;
    this.doc.title = s.title;
    if (s.added) s.added.remove();
    if (s.icon) {
      if (s.iconHref === null) s.icon.removeAttribute('href');
      else s.icon.setAttribute('href', s.iconHref);
    }
  }

  dispose(): void {
    this.clear();
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
  }
}
