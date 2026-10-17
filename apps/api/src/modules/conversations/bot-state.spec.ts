import { describe, expect, it } from 'vitest';

import { canBotReply } from './bot-state';

describe('canBotReply', () => {
  it('only allows the active state', () => {
    expect(canBotReply({ botState: 'active' })).toBe(true);
    expect(canBotReply({ botState: 'paused' })).toBe(false);
    expect(canBotReply({ botState: 'handed_off' })).toBe(false);
  });
});
