let alertAudio: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement {
  if (!alertAudio) {
    alertAudio = new Audio('/audio/alert-don-moi.wav');
    alertAudio.preload = 'auto';
  }
  return alertAudio;
}

function playSynthBellFallback(): void {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const tones = [
      { freq: 659.25, start: 0 },
      { freq: 987.77, start: 0.2 },
    ];
    for (const t of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(t.freq, now + t.start);
      gain.gain.setValueAtTime(0.001, now + t.start);
      gain.gain.exponentialRampToValueAtTime(0.3, now + t.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t.start + 0.7);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + 0.72);
    }
  } catch {
    // ignore
  }
}

export async function playAdminNewOrderSound(): Promise<void> {
  try {
    const audio = getAudio();
    audio.currentTime = 0;
    await audio.play();
  } catch {
    // Fallback if wav blocked or missing
    playSynthBellFallback();
    try {
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance('Đơn mới');
        u.lang = 'vi-VN';
        window.speechSynthesis.speak(u);
      }
    } catch {
      // ignore
    }
  }
}
