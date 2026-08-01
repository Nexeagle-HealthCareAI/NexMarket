/**
 * Zustand agent store — current agent session state
 *
 * Persisted to sessionStorage via middleware.
 * Source of truth for: agentId, deviceId, active shift, current visit.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AgentState {
  agentId: string | null;
  deviceId: string | null;
  name: string | null;
  role: string | null;
  jwtToken: string | null;
  refreshToken: string | null;
  activeShiftClientId: string | null;
  activeVisitClientId: string | null;
  profileCompleted: boolean;

  // Zustand's persist middleware rehydrates from localStorage asynchronously —
  // on every fresh page load, agentId is briefly null (pre-hydration) even for
  // an already-logged-in agent. Anything that redirects to /login on a falsy
  // agentId must wait for hasHydrated first, or it fires a false "automatic
  // logout" on every refresh.
  hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;

  setAuth: (auth: {
    agentId: string;
    deviceId: string;
    name: string;
    role: string;
    jwtToken: string;
    refreshToken: string;
    profileCompleted?: boolean;
  }) => void;

  setProfileCompleted: (completed: boolean) => void;
  setActiveShift: (clientId: string | null) => void;
  setActiveVisit: (clientId: string | null) => void;
  clearAuth: () => void;
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set) => ({
      agentId: null,
      deviceId: null,
      name: null,
      role: null,
      jwtToken: null,
      refreshToken: null,
      activeShiftClientId: null,
      activeVisitClientId: null,
      profileCompleted: false,

      hasHydrated: false,
      setHasHydrated: (state) => set({ hasHydrated: state }),

      setAuth: (auth) =>
        set({
          agentId: auth.agentId,
          deviceId: auth.deviceId,
          name: auth.name,
          role: auth.role,
          jwtToken: auth.jwtToken,
          refreshToken: auth.refreshToken,
          profileCompleted: auth.profileCompleted ?? false,
        }),

      setProfileCompleted: (completed) => set({ profileCompleted: completed }),
      setActiveShift: (clientId) => set({ activeShiftClientId: clientId }),
      setActiveVisit: (clientId) => set({ activeVisitClientId: clientId }),

      clearAuth: () =>
        set({
          agentId: null,
          deviceId: null,
          name: null,
          role: null,
          jwtToken: null,
          refreshToken: null,
          activeShiftClientId: null,
          activeVisitClientId: null,
          profileCompleted: false,
        }),
    }),
    {
      name: 'agent-session',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : ({} as Storage),
      ),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
