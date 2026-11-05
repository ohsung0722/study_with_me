export function isPcLike(ua: string, maxTouchPoints: number, hasFinePointer: boolean): boolean {
  if (/iPhone|iPad|iPod|Android.*Mobile/i.test(ua)) return false;
  if (maxTouchPoints > 0 && !hasFinePointer) return false;
  return true;
}

export function showPcOnly(root: HTMLElement): void {
  root.replaceChildren();
  const d = document.createElement('div');
  d.className = 'overlay';
  d.textContent = 'PC에서 접속해 주세요';
  root.appendChild(d);
}
