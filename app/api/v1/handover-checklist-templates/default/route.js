// ── GET /api/v1/handover-checklist-templates/default ──────────────────
// Resolves the default checklist template for the caller's scope (team
// > region > global). Used by CreateHandoverModal to pre-fill Step 3
// before the handover row exists.
//
// Phase 2 always returns the global default (team / region rows arrive
// in Phase 5 when the Settings UI ships).

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { resolveDefaultSettings, loadTemplate } from '../../../../../src/lib/handover-server';
import { MEMBERS_BY_EMAIL } from '../../../../../src/data/members';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const member = MEMBERS_BY_EMAIL[(user.email || '').toLowerCase()] || null;
    const settings = await resolveDefaultSettings({
      team: member?.team || null,
      region: member?.region || null,
    });
    if (!settings) {
      // Defaults seed didn't run / was wiped — return an empty template
      // so the FE can still let the user submit (they'll add items by hand).
      return NextResponse.json({ template: null, items: [] });
    }
    const tpl = await loadTemplate(settings.default_template_id);
    return NextResponse.json({
      template: tpl ? { id: tpl.id, name: tpl.name } : null,
      items: Array.isArray(tpl?.items) ? tpl.items : [],
      settings: {
        id: settings.id,
        manager_approval_required: settings.manager_approval_required,
        coverer_acceptance_required: settings.coverer_acceptance_required,
        allow_country_split: settings.allow_country_split,
        min_days_to_trigger: settings.min_days_to_trigger,
      },
    });
  } catch (err) {
    console.error('[handover-checklist-templates/default GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
