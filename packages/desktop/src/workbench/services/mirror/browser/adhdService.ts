import type { AdhdFile, LineRange } from '../common/adhd.js';
import { type AdhdChannel, adhdChannel } from './adhdChannel.js';

export interface AdhdService {
  get(file: string): Promise<AdhdFile | null>;
  addKeyword(file: string, keyword: string): Promise<AdhdFile>;
  removeKeyword(file: string, keyword: string): Promise<AdhdFile | null>;
  markRead(file: string, range: { start: number; end: number }): Promise<AdhdFile>;
  markUnread(file: string, range: { start: number; end: number }): Promise<AdhdFile | null>;
  set(
    file: string,
    state: {
      highlight_keywords?: readonly string[];
      read_paragraphs?: readonly LineRange[];
    },
  ): Promise<AdhdFile>;
}

export function createAdhdService(channel: AdhdChannel): AdhdService {
  return {
    get: (file) => channel.get(file),
    addKeyword: (file, keyword) => channel.addKeyword({ file, keyword }),
    removeKeyword: (file, keyword) => channel.removeKeyword({ file, keyword }),
    markRead: (file, { start, end }) => channel.markRead({ file, start, end }),
    markUnread: (file, { start, end }) => channel.markUnread({ file, start, end }),
    set: (file, state) => channel.set({ file, ...state }),
  };
}

export const adhdService = createAdhdService(adhdChannel);
