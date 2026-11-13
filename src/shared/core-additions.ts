// Additive contract extensions proposed by the CORE agent (src/shared/api.ts is untouched).
// The integrator may fold these into api.ts.
import type { LaunchIntent, XenithApi, XenithEvent } from './api';

export interface AudioOutput { deviceId: string; label: string }
export interface RumbleSample { left: number; right: number; lt: number; rt: number }

export interface XenithCoreExtras {
  /** Renderer pushes navigator.mediaDevices.enumerateDevices() audio outputs; main caches them for
   *  audioOutputs() and for the X-Haptics "game audio device" check. Fire-and-forget. */
  reportAudioOutputs(list: AudioOutput[]): void;
  /** Renderer forwards StreamController 'rumble' events (throttle to ≤10 Hz) so
   *  hapticsDiagnostics() can show the last rumble. Fire-and-forget. */
  reportRumble(r: RumbleSample): void;
  /** Renderer stream diagnostics (picture state, post-processing errors) written to the main log as
   *  `stream.<event>`. Fire-and-forget. */
  reportStreamDiag(event: string, data?: unknown): void;
  /** Quit and install the downloaded update (see updateReady). Fire-and-forget. */
  installUpdate(): void;
}

/** Extra event: a second launch (e.g. a Steam shortcut with --xcloud=<titleId>) while Xenith is running. */
export type XenithEventExt = XenithEvent | { type: 'launchIntent'; intent: LaunchIntent } | { type: 'updateReady'; version: string };

export type XenithApiFull = XenithApi & XenithCoreExtras;
