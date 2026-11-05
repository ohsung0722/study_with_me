import './styles.css';
import type { Profile } from '@studyverse/shared';
import { connect } from './net';
import { loadProfile, saveProfile } from './profile';
import { isPcLike, showPcOnly } from './ui/pcOnly';
import { showEntry } from './ui/entry';

const root = document.getElementById('app')!;

function overlay(text: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'overlay';
  d.textContent = text;
  document.body.appendChild(d);
  return d;
}

async function start(): Promise<void> {
  const fine = window.matchMedia?.('(pointer: fine)').matches ?? true;
  if (!isPcLike(navigator.userAgent, navigator.maxTouchPoints, fine)) {
    showPcOnly(root);
    return;
  }
  const profile: Profile = await showEntry(root, loadProfile(localStorage));
  saveProfile(localStorage, profile);

  const conn = connect();
  conn.socket.on('replaced', () => {
    conn.socket.disconnect();
    overlay('다른 탭에서 접속했어요');
  });

  let notice: HTMLElement | null = null;
  for (;;) {
    try {
      const r = await conn.join(profile);
      if (r.ok) break;
      if (r.reason === 'nickname') {
        notice?.remove();
        overlay('사용할 수 없는 닉네임이에요. 새로고침해 주세요');
        return;
      }
      if (!notice) notice = overlay('지금 독서실이 가득 찼어요. 자리가 나면 자동으로 들어가요');
    } catch {
      /* no ack within 5s: retry */
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  notice?.remove();
  // Task 15 replaces this placeholder with the 3D game.
  root.textContent = '입장 완료';
}

void start();
