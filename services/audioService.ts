/**
 * AudioService - Low-latency audio playback for coaching actions
 *
 * Uses pre-generated MP3 files for instant playback (<10ms latency)
 * Falls back to Web Speech API if audio files unavailable
 */

type ActionAudio = string; // Action name like "THROTTLE", "BRAKE", etc.

class CoachAudioService {
  private audioContext: AudioContext | null = null;
  private audioBuffers = new Map<string, AudioBuffer>();
  private isLoaded = false;
  private isLoading = false;
  private lastPlayedAction = '';
  private lastPlayTime = 0;
  private minRepeatInterval = 1500; // Minimum ms between same action

  // All available actions
  private readonly ACTIONS = [
    'THRESHOLD', 'TRAIL_BRAKE', 'BRAKE', 'WAIT',
    'TURN_IN', 'COMMIT', 'ROTATE', 'APEX',
    'THROTTLE', 'UNWIND', 'TRACK_OUT', 'PUSH', 'ACCELERATE', 'SEND_IT',
    'SMOOTH', 'BALANCE', 'NO_COAST', 'EARLY', 'LATE',
    'GOOD', 'NICE', 'OPTIMAL',
    'MAINTAIN', 'STABILIZE'
  ];

  /**
   * Initialize audio context and preload all clips
   * Call this on user interaction (button click) to avoid autoplay restrictions
   */
  async initialize(): Promise<void> {
    if (this.isLoaded || this.isLoading) return;

    this.isLoading = true;

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Preload all audio files in parallel
      const loadPromises = this.ACTIONS.map(action => this.loadAudio(action));
      await Promise.allSettled(loadPromises);

      this.isLoaded = true;
      console.log(`[AudioService] Loaded ${this.audioBuffers.size}/${this.ACTIONS.length} audio clips`);

    } catch (error) {
      console.error('[AudioService] Failed to initialize:', error);
    } finally {
      this.isLoading = false;
    }
  }

  private async loadAudio(action: string): Promise<void> {
    if (!this.audioContext) return;

    try {
      const response = await fetch(`/audio/${action}.mp3`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      this.audioBuffers.set(action, audioBuffer);

    } catch (error) {
      // Silently fail - will use fallback TTS
      console.debug(`[AudioService] Failed to load ${action}.mp3`);
    }
  }

  /**
   * Play an action audio clip
   * @param action - Action name like "THROTTLE"
   * @param force - If true, play even if same as last action
   */
  play(action: string, force = false): void {
    const now = Date.now();

    // Throttle repeated same action
    if (!force && action === this.lastPlayedAction) {
      if (now - this.lastPlayTime < this.minRepeatInterval) {
        return;
      }
    }

    // Skip neutral actions
    if (action === 'STABILIZE' || action === 'MAINTAIN') {
      return;
    }

    this.lastPlayedAction = action;
    this.lastPlayTime = now;

    // Try pre-loaded audio first
    if (this.audioContext && this.audioBuffers.has(action)) {
      this.playBuffer(action);
    } else {
      // Fallback to Web Speech API
      this.playFallbackTTS(action);
    }
  }

  private playBuffer(action: string): void {
    const buffer = this.audioBuffers.get(action);
    if (!buffer || !this.audioContext) return;

    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();

    source.buffer = buffer;
    gainNode.gain.value = 0.8; // Slightly reduce volume to prevent clipping

    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    source.start(0);
  }

  private playFallbackTTS(action: string): void {
    if (!('speechSynthesis' in window)) return;

    // Convert underscores to spaces
    const text = action.replace(/_/g, ' ');

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.3;
    utterance.pitch = 0.9;
    utterance.volume = 0.9;

    window.speechSynthesis.speak(utterance);
  }

  /**
   * Check if audio service is ready
   */
  get ready(): boolean {
    return this.isLoaded && this.audioBuffers.size > 0;
  }

  /**
   * Get loading status
   */
  get loading(): boolean {
    return this.isLoading;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.audioBuffers.clear();
    this.isLoaded = false;
  }
}

// Export singleton instance
export const coachAudio = new CoachAudioService();
