// Интерфейс провайдера звонков. Mesh — встроенный; SFU — точка расширения (LiveKit/mediasoup/Janus и т.п.).
export type ConnState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

export interface RemoteParticipant {
  userId: string;
  audio: MediaStream | null;
  camera: MediaStream | null;
  screen: MediaStream | null;
  state: RTCPeerConnectionState | 'new';
}

export interface LocalMedia { mic: MediaStream | null; camera: MediaStream | null; screen: MediaStream | null }

export interface CallEngine {
  readonly kind: 'mesh' | 'sfu';
  join(): Promise<void>;
  leave(): Promise<void>;
  setMic(stream: MediaStream | null): Promise<void>;
  setCamera(stream: MediaStream | null): Promise<void>;
  setScreen(stream: MediaStream | null): Promise<void>;
  onChange(cb: () => void): () => void;
  readonly participants: Map<string, RemoteParticipant>;
  readonly state: ConnState;
  readonly error: string | null;
}

export function configuredProvider(): 'mesh' | 'sfu' {
  return import.meta.env.VITE_CALL_PROVIDER === 'sfu' ? 'sfu' : 'mesh';
}
