import { BaseChannel } from '../../src/channels/base.js';
import { NAVIGATION_ACTIONS, normalizeNavigation, isBack, isCancel } from '../../src/core/interaction/navigation.js';

describe('shared navigation contract', () => {
  test('normalizes terminal and channel back inputs', () => {
    expect(normalizeNavigation('back')).toBe(NAVIGATION_ACTIONS.BACK);
    expect(normalizeNavigation('← Back')).toBe(NAVIGATION_ACTIONS.BACK);
    expect(isBack('⬅️ Back')).toBe(true);
  });

  test('normalizes cancel inputs and ignores ordinary content', () => {
    expect(normalizeNavigation('/cancel')).toBe(NAVIGATION_ACTIONS.CANCEL);
    expect(isCancel('q')).toBe(true);
    expect(normalizeNavigation('hello')).toBeNull();
  });

  test('BaseChannel exposes the shared navigation adapter', () => {
    const channel = new BaseChannel();
    expect(channel.normalizeNavigation('back')).toBe(NAVIGATION_ACTIONS.BACK);
    expect(channel.getChannelIdentity({ metadata: { userId: 'u1', conversationId: 'c1' } })).toMatchObject({
      userId: 'base:u1',
      conversationId: 'base:c1',
      rawUserId: 'u1',
      rawConversationId: 'c1',
    });
  });
});
