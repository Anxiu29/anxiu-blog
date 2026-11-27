import { initializeDailyQuote } from './daily-quote';
import { initializeScrollTools } from './scroll-tools';
import { initializeSavedArticles } from './saved-articles';
import { initializeShell } from './journal-shell';
import { initializeJournalSearch } from './journal-search';
import { initializeJournalMusic } from './journal-music';
import { initializePostCovers } from './journal-covers';
import { initializeDiscoveryNotices } from './discovery-notice';
import { initializeJournalWidgets } from './journal-widgets';
import { initializeArticleSharing, initializeReadingTools, initializeArticleToc } from './journal-reading';
import { initializeReadingResume } from './reading-resume';
import { initializeArticleImages } from './journal-images';
import { initializeArchiveFilter } from './archive-filter';
import { initializeBookmarkDiscovery } from './bookmark-discovery';

let checkedAppearanceRadios: HTMLInputElement[] = [];

export function initializeJournalPage() {
 // Incoming default radios briefly share a document with the persisted controls.
 for (const radio of checkedAppearanceRadios) radio.checked = true;
 checkedAppearanceRadios = [];
 initializeJournalMusic();
 initializeShell();
 initializeDailyQuote();
 initializeSavedArticles();
 initializeScrollTools();
 initializeJournalSearch();
 initializePostCovers();
 initializeDiscoveryNotices();
 initializeJournalWidgets();
 initializeReadingTools();
 initializeArticleSharing();
 initializeArticleToc();
 initializeReadingResume();
 initializeArticleImages();
 initializeArchiveFilter();
 initializeBookmarkDiscovery();
}

export function prepareJournalSwap(event: Event) {
 const next = (event as Event & { newDocument: Document }).newDocument;
 if (!next) return;
 checkedAppearanceRadios = [...document.querySelectorAll<HTMLInputElement>("#journal-utilities input[type=radio]:checked")];
 // Persist local appearance while the router replaces HTML attributes.
 for (const name of ['dark', 'has-custom-background']) next.documentElement.classList.toggle(name, document.documentElement.classList.contains(name));
 for (const name of ['data-theme', 'data-post-view']) {
  const value = document.documentElement.getAttribute(name);
  if (value !== null) next.documentElement.setAttribute(name, value);
 }
 // Reuse controls and listeners; only their navigation selection changes.
 for (const selector of ['#journal-header .desktop-navigation a', '#journal-header .explore-menu', '#mobile-navigation a']) {
  const current = [...document.querySelectorAll<HTMLElement>(selector)];
  const incoming = [...next.querySelectorAll<HTMLElement>(selector)];
  current.forEach((element, index) => {
   const peer = incoming[index];
   if (!peer) return;
   element.classList.toggle('selected', peer.classList.contains('selected'));
   const value = peer.getAttribute('aria-current');
   if (value) element.setAttribute('aria-current', value); else element.removeAttribute('aria-current');
  });
 }
 for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close();
 const panel = document.querySelector<HTMLElement>('#music-panel');
 if (panel?.matches(':popover-open')) panel.hidePopover();
 for (const menu of document.querySelectorAll<HTMLDetailsElement>('.explore-menu[open]')) menu.open = false;
 next.documentElement.classList.remove('navigation-open');
}
