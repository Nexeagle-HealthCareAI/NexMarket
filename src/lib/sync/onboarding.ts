/**
 * Onboarding is the one mandatory first step every agent must complete
 * before the rest of the app unlocks (see AgentLayout's profileCompleted
 * redirect) — but unlike every other write in this app, submitting it used
 * to be a synchronous, unqueued network call (photo upload + profile PUT).
 * An agent onboarding without signal — plausible, since this app's whole
 * coverage area is rural — was completely locked out with no way to proceed.
 *
 * This queues the submission locally (mirroring the outbox pattern used
 * elsewhere) so onboarding can complete offline: the agent is let into the
 * app immediately, and the actual photo upload + profile update finish in
 * the background once a connection is available.
 */
import { db, getSyncStateValue, setSyncStateValue } from '../db';
import { uploadPhoto, updateAgentProfile } from './api-client';

const PENDING_KEY = 'pendingOnboarding';

interface PendingOnboardingPayload {
  agentId: string;
  personalDetails: string;
  education: string;
  photoDataUri: string; // base64, already compressed by the caller
}

export async function queuePendingOnboarding(payload: PendingOnboardingPayload): Promise<void> {
  await setSyncStateValue(PENDING_KEY, JSON.stringify(payload));
}

export async function getPendingOnboarding(): Promise<PendingOnboardingPayload | null> {
  const raw = await getSyncStateValue(PENDING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingOnboardingPayload;
  } catch {
    return null;
  }
}

export async function clearPendingOnboarding(): Promise<void> {
  await db.syncState.delete(PENDING_KEY);
}

function dataUriToBlob(dataUri: string): Blob {
  const [header, base64] = dataUri.split(',');
  const contentType = /data:(.*);base64/.exec(header)?.[1] ?? 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

/** Called from the sync polling loop — a no-op unless a submission is actually queued. */
export async function retryPendingOnboarding(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const pending = await getPendingOnboarding();
  if (!pending) return;

  try {
    const { url: photoUrl } = await uploadPhoto(dataUriToBlob(pending.photoDataUri), 'onboarding.jpg');
    await updateAgentProfile(pending.agentId, {
      personalDetails: pending.personalDetails,
      education: pending.education,
      photoUrl,
    });
    await clearPendingOnboarding();
  } catch {
    // Still offline or the API is unreachable — stays queued for the next poll.
  }
}
