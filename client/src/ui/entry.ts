import { DEFAULT_BREAK_MINUTES, HAIR_STYLES, validateNickname, type HairStyle, type Profile } from '@studyverse/shared';
import { newAnonId } from '../profile';

export const HAIR_COLORS = ['#3b2a20', '#6b4423', '#a0622d', '#d9a441', '#c9503c', '#8a8d99'];
export const SHIRT_COLORS = ['#e8837a', '#f2b05e', '#f0d567', '#8fc28a', '#6fb7b0', '#7fa6d9', '#a995d6', '#e5a3c4'];
const HAIR_LABELS: Record<HairStyle, string> = { short: '짧은 머리', long: '긴 머리', bun: '똥머리' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function showEntry(root: HTMLElement, initial: Profile | null): Promise<Profile> {
  return new Promise((resolve) => {
    const base: Profile = initial ?? {
      anonId: newAnonId(),
      nickname: '',
      appearance: { hair: 'short', hairColor: HAIR_COLORS[0], shirtColor: SHIRT_COLORS[0] },
      breakMinutes: DEFAULT_BREAK_MINUTES,
    };
    let hair: HairStyle = base.appearance.hair;
    let hairColor = base.appearance.hairColor;
    let shirtColor = base.appearance.shirtColor;

    const card = el('form', 'entry-card');
    card.appendChild(el('h1', 'entry-title', 'Studyverse'));
    card.appendChild(el('p', 'entry-sub', '함께 공부하는 온라인 독서실'));

    const nickLabel = el('label', 'field-label', '닉네임');
    const input = el('input', 'nick-input');
    input.type = 'text';
    input.value = base.nickname;
    input.autocomplete = 'off';
    nickLabel.appendChild(input);
    const error = el('div', 'entry-error');
    error.setAttribute('role', 'alert');
    card.append(nickLabel, error);

    const group = (
      title: string,
      items: { value: string; label?: string; color?: string }[],
      get: () => string,
      set: (v: string) => void,
    ) => {
      const wrap = el('div', 'option-group');
      wrap.appendChild(el('div', 'field-label', title));
      const row = el('div', 'option-row');
      const buttons: HTMLButtonElement[] = [];
      const refresh = () => buttons.forEach((b, i) => b.classList.toggle('selected', items[i].value === get()));
      items.forEach((it) => {
        const b = el('button', it.color ? 'swatch' : 'chip', it.label);
        b.type = 'button';
        if (it.color) {
          b.style.background = it.color;
          b.setAttribute('aria-label', it.color);
        }
        b.addEventListener('click', () => {
          set(it.value);
          refresh();
        });
        buttons.push(b);
        row.appendChild(b);
      });
      refresh();
      wrap.appendChild(row);
      card.appendChild(wrap);
    };
    group('머리 모양', HAIR_STYLES.map((h) => ({ value: h, label: HAIR_LABELS[h] })), () => hair, (v) => { hair = v as HairStyle; });
    group('머리 색', HAIR_COLORS.map((c) => ({ value: c, color: c })), () => hairColor, (v) => { hairColor = v; });
    group('옷 색', SHIRT_COLORS.map((c) => ({ value: c, color: c })), () => shirtColor, (v) => { shirtColor = v; });

    const submit = el('button', 'enter-btn', '입장하기');
    submit.type = 'submit';
    card.appendChild(submit);

    card.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = validateNickname(input.value);
      if (!v.ok) {
        error.textContent = v.reason === 'length' ? '2~12자로 입력해 주세요' : '사용할 수 없는 단어가 있어요';
        return;
      }
      resolve({
        anonId: base.anonId,
        nickname: v.value,
        appearance: { hair, hairColor, shirtColor },
        breakMinutes: base.breakMinutes,
      });
    });

    const screen = el('div', 'entry-screen');
    screen.appendChild(card);
    root.replaceChildren(screen);
    input.focus();
  });
}
