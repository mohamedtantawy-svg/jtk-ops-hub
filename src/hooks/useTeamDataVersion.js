// ── useTeamDataVersion — single counter that bumps on any team-data change ──
//
// The roster (members.js) and the country-ownership map (countryOwners.js)
// are independent live-binding modules — hydrateRoster() rebuilds the first;
// hydrateOwnerCountries() rebuilds the second. Each emits its own version +
// subscribe pair. Downstream client-side scopers (Queue.jsx's
// scope{Onboarding,Offboarding,Amendment,Redline,Workbench} memos +
// BriefingView.jsx's equivalents) need to re-derive when EITHER changes —
// but they can't watch live bindings in useMemo deps directly, since a
// module-level Map reference change isn't observable to React.
//
// This hook subscribes to both, returns a single monotonically-increasing
// counter, and is safe to add to any useMemo dep array so the memo re-runs
// the moment a Team-tab edit (manager change, country picker save) lands
// — whether it came from this session or another user's session pulling
// fresh data via the visibility/focus/poll refetch in useTeamMembers.
//
// Reported by Insiya + Mohamed 2026-05-18:
//   "I am editing the countries for my team members but they keep reverting"
//   "the new manager still see the old team Qs, the old team member assigned
//    still see old countries that has been removed from them"
// Two of the three contributing gaps fixed in useTeamMembers (cache write
// on mutation + visibility/focus/poll refetch); this hook closes the third
// (memo doesn't re-derive when the live map mutates mid-session).

import { useEffect, useState } from 'react';
import { getRosterVersion, subscribeRoster } from '../data/members';
import { getCountryOwnersVersion, subscribeCountryOwners } from '../data/countryOwners';

export function useTeamDataVersion() {
  // Sum of both counters — monotonically non-decreasing since each is
  // monotonic on its own. A scope memo only cares that the value CHANGED,
  // not what it means, so this is the simplest correct combination.
  const [version, setVersion] = useState(() => getRosterVersion() + getCountryOwnersVersion());

  useEffect(() => {
    const recompute = () => setVersion(getRosterVersion() + getCountryOwnersVersion());
    const unsubRoster = subscribeRoster(recompute);
    const unsubOwners = subscribeCountryOwners(recompute);
    // Pick up any change that happened between the initial useState read
    // and the subscribe registration.
    recompute();
    return () => {
      unsubRoster();
      unsubOwners();
    };
  }, []);

  return version;
}
