'use client';

import { useActiveShift, useActiveVisit } from '@/lib/db';
import { useGeolocation } from '@/lib/geo/useGeolocation';
import { useAgentStore } from '@/store/agent-store';

/**
 * Records the agent's route for the whole shift, whichever screen they are on.
 * Mounted once in the agent layout — recording used to live on the Home and Visit
 * screens only, so the route had holes whenever the agent was adding a partner,
 * filling the survey or looking at their block.
 */
export default function ShiftTracker() {
  const agentId = useAgentStore((s) => s.agentId);
  const activeShift = useActiveShift(agentId ?? undefined);
  const activeVisit = useActiveVisit(agentId ?? undefined);
  useGeolocation({
    shiftId: activeShift?.clientId,
    visitId: activeVisit?.clientId,
    record: !!activeShift && !activeShift.endAt,
  });
  return null;
}
