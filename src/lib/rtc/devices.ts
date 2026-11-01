export type MediaErrorCode = 'unsupported' | 'insecure' | 'denied' | 'not_found' | 'busy' | 'unknown';

export function mediaErrorText(code: MediaErrorCode, what: 'mic' | 'camera' | 'screen'): string {
  const name = what === 'mic' ? 'микрофону' : what === 'camera' ? 'камере' : 'экрану';
  switch (code) {
    case 'unsupported': return what === 'screen'
      ? 'Этот браузер/устройство не поддерживает демонстрацию экрана (на iOS и многих Android она недоступна).'
      : 'Браузер не поддерживает доступ к медиаустройствам.';
    case 'insecure': return 'Доступ к устройствам работает только по HTTPS или на localhost.';
    case 'denied': return `Доступ к ${name} запрещён. Разрешите его в настройках сайта (значок замка в адресной строке).`;
    case 'not_found': return what === 'mic' ? 'Микрофон не найден.' : what === 'camera' ? 'Камера не найдена.' : 'Источник не выбран.';
    case 'busy': return 'Устройство занято другим приложением.';
    default: return 'Не удалось получить доступ к устройству.';
  }
}

export class MediaAccessError extends Error {
  constructor(public code: MediaErrorCode, public what: 'mic' | 'camera' | 'screen') { super(mediaErrorText(code, what)); }
}

function classify(e: unknown): MediaErrorCode {
  const n = (e as { name?: string })?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'denied';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'not_found';
  if (n === 'NotReadableError' || n === 'AbortError') return 'busy';
  return 'unknown';
}

function guard(what: 'mic' | 'camera' | 'screen') {
  if (!window.isSecureContext) throw new MediaAccessError('insecure', what);
  if (!navigator.mediaDevices) throw new MediaAccessError('unsupported', what);
  if (what === 'screen' && !navigator.mediaDevices.getDisplayMedia) throw new MediaAccessError('unsupported', what);
}

export interface MediaPrefs { noiseSuppression: unknown; echoCancellation: unknown; autoGain?: unknown; cameraQuality?: unknown; cameraFps?: unknown; screenFps?: unknown; screenAudio?: unknown }

export async function getMic(deviceId: string, opts: MediaPrefs): Promise<MediaStream> {
  guard('mic');
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, noiseSuppression: Boolean(opts.noiseSuppression), echoCancellation: Boolean(opts.echoCancellation), autoGainControl: opts.autoGain !== false },
    });
  } catch (e) {
    if (deviceId && (e as { name?: string }).name === 'OverconstrainedError') return getMic('', opts);
    throw new MediaAccessError(classify(e), 'mic');
  }
}

export async function getCamera(deviceId: string, opts: MediaPrefs = { noiseSuppression: true, echoCancellation: true }): Promise<MediaStream> {
  guard('camera');
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  const h = Math.min(Number(opts.cameraQuality) || 720, mobile ? 480 : 1080); const fps = Number(opts.cameraFps) || 24;
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: Math.round(h * 16 / 9) }, height: { ideal: h }, frameRate: { ideal: fps, max: 30 } },
    });
  } catch (e) {
    if (deviceId && (e as { name?: string }).name === 'OverconstrainedError') return getCamera('', opts);
    throw new MediaAccessError(classify(e), 'camera');
  }
}

export async function getScreen(opts: MediaPrefs = { noiseSuppression: true, echoCancellation: true }): Promise<MediaStream> {
  guard('screen');
  try {
    const fps = Number(opts.screenFps) || 15;
    return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: fps, max: 30 } }, audio: opts.screenAudio !== false });
  } catch (e) {
    throw new MediaAccessError(classify(e) === 'denied' ? 'not_found' : classify(e), 'screen');
  }
}

export async function listDevices(): Promise<{ mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }> {
  if (!navigator.mediaDevices?.enumerateDevices) return { mics: [], cams: [], speakers: [] };
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    mics: all.filter((d) => d.kind === 'audioinput'),
    cams: all.filter((d) => d.kind === 'videoinput'),
    speakers: all.filter((d) => d.kind === 'audiooutput'),
  };
}

export const canPickSpeaker = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
export const canShareScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

// Простой индикатор уровня громкости (для «говорит» и проверки микрофона)
let ctx: AudioContext | null = null;
export function levelMeter(stream: MediaStream, cb: (level: number) => void): () => void { // порог речи задаёт вызывающий код
  if (!stream.getAudioTracks().length) return () => {};
  ctx ??= new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.frequencyBinCount);
  let stop = false;
  const tick = () => {
    if (stop) return;
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += (v - 128) ** 2;
    cb(Math.min(1, Math.sqrt(sum / buf.length) / 40));
    setTimeout(tick, 120);
  };
  if (ctx.state === 'suspended') void ctx.resume();
  tick();
  return () => { stop = true; src.disconnect(); };
}
