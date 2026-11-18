import React from 'react';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { usePwaManifestSync } from '@/hooks/usePwaManifestSync';
import { useQueuedMessageAutoSend } from '@/hooks/useQueuedMessageAutoSend';
import { useSessionAutoCleanup } from '@/hooks/useSessionAutoCleanup';
import { useMergedWorktreeCleanup } from '@/hooks/useMergedWorktreeCleanup';
import { useWindowControlsOverlayLayout } from '@/hooks/useWindowControlsOverlayLayout';
import { setOptimisticRefs } from '@/sync/session-actions';
import { markSessionViewed } from '@/sync/notification-store';
import { setExternallyViewedSession } from '@/sync/sync-context';
import { useSync } from '@/sync/use-sync';
import { isServerOwnedMessageQueue } from '@/stores/messageQueueStore';
import { useProjectsStore } from '@/stores/useProjectsStore';

const MINI_CHAT_PRESENCE_CHANNEL = 'openchamber:mini-chat-presence';

type MiniChatPresenceMessage = {
  type?: string;
  sessionId?: string;
  directory?: string;
  viewed?: boolean;
};

const SyncOptimisticBridge: React.FC = () => {
  const sync = useSync();
  const addRef = React.useRef(sync.optimistic.add);
  const removeRef = React.useRef(sync.optimistic.remove);
  const confirmRef = React.useRef(sync.optimistic.confirm);
  addRef.current = sync.optimistic.add;
  removeRef.current = sync.optimistic.remove;
  confirmRef.current = sync.optimistic.confirm;

  React.useEffect(() => {
    setOptimisticRefs(
      (input) => addRef.current(input),
      (input) => removeRef.current(input),
      (input) => confirmRef.current(input),
    );
  }, []);

  return null;
};

const MiniChatPresenceBridge: React.FC = () => {
  React.useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(MINI_CHAT_PRESENCE_CHANNEL);
    channel.onmessage = (event) => {
      const data = event.data as MiniChatPresenceMessage | null;
      if (data?.type !== 'mini-chat-session-presence' || !data.sessionId || !data.directory) {
        return;
      }

      const viewed = data.viewed !== false;
      setExternallyViewedSession(data.directory, data.sessionId, viewed);
      if (viewed) {
        markSessionViewed(data.sessionId);
      }
    };

    return () => channel.close();
  }, []);

  return null;
};

export function SyncRuntimeEffects({ backgroundWorkEnabled }: {
  backgroundWorkEnabled: boolean;
}) {
  useSessionAutoCleanup({ enabled: backgroundWorkEnabled });
  useQueuedMessageAutoSend(backgroundWorkEnabled && !isServerOwnedMessageQueue());

  return <SyncOptimisticBridge />;
}

/** `?dir=/path` opens the app on that project, so a launcher can start in the current folder. */
const OpenDirectoryParam: React.FC = () => {
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const directory = params.get('dir')?.trim();
    if (!directory) return;
    params.delete('dir');
    const search = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);

    const apply = (): boolean => {
      const state = useProjectsStore.getState();
      if (!state.hasServerSnapshot) return false;
      void state.addProject(directory).then((project) => {
        if (project) state.setActiveProject(project.id);
      });
      return true;
    };

    if (apply()) return;
    const unsubscribe = useProjectsStore.subscribe(() => {
      if (apply()) unsubscribe();
    });
    return unsubscribe;
  }, []);

  return null;
};

export function SyncAppEffects({ backgroundWorkEnabled }: {
  backgroundWorkEnabled: boolean;
}) {
  usePwaManifestSync();
  useWindowControlsOverlayLayout();
  useKeyboardShortcuts();
  useMergedWorktreeCleanup({ enabled: backgroundWorkEnabled });

  return (
    <>
      <SyncRuntimeEffects backgroundWorkEnabled={backgroundWorkEnabled} />
      <MiniChatPresenceBridge />
      <OpenDirectoryParam />
    </>
  );
}
