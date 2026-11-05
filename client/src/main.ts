import './styles.css';
import type { Profile } from '@studyverse/shared';
import { connect } from './net';
import { joinWithRetry } from './joinFlow';
import { loadProfile, saveProfile } from './profile';
import { isPcLike, showPcOnly } from './ui/pcOnly';
import { showEntry } from './ui/entry';
import { Game } from './game/game';

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
  let replaced = false;
  conn.socket.on('replaced', () => {
    replaced = true;
    conn.socket.disconnect();
    overlay('다른 탭에서 접속했어요');
  });

  let notice: HTMLElement | undefined;
  const r = await joinWithRetry(conn, profile, {
    onFull: () => { notice ??= overlay('지금 독서실이 가득 찼어요. 자리가 나면 자동으로 들어가요'); },
    cancelled: () => replaced,
  });
  (notice as HTMLElement | undefined)?.remove(); // set from the onFull callback
  if (!r) return;
  if (!r.ok) {
    overlay('사용할 수 없는 닉네임이에요. 새로고침해 주세요');
    return;
  }
  new Game(root, conn, r, profile);
}

void start();
