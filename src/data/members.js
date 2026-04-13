import { ADMIN_EMAILS_LIST } from './adminEmails';

// ---------------------------------------------------------------------------
// MEMBERS array — used for user lookup on login (JWT fallback handles
// users not in this list). Keep minimal; real access is via userAccessMap.
// ---------------------------------------------------------------------------
export const MEMBERS=[
  {id:14,name:'Mohamed Tantawy',initials:'MT',role:'admin',  team:'ALL', region:'ALL', country:'AE',lead:null,email:'mohamed.tantawy@deel.com'},
  {id:15,name:'Duygu Cakalli',  initials:'DC',role:'admin',team:'ALL',region:'ALL',country:'AE',lead:14,email:'duygu.cakalli@deel.com'},
];

// ---------------------------------------------------------------------------
// Helper: derive display name from email prefix
// ---------------------------------------------------------------------------
function _nameFromEmail(email) {
  const prefix = email.split('@')[0];
  return prefix
    .split(/[.\-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Build DEFAULT_USER_ACCESS_MAP from the canonical admin list.
// Every admin gets full admin access type in the People Directory.
// ---------------------------------------------------------------------------
const _buildAccessMap = () => {
  const map = {};

  for (const email of ADMIN_EMAILS_LIST) {
    map[email] = {
      accessTypeId: 'at_admin',
      name: _nameFromEmail(email),
      title: 'Admin, HR Experience',
      startDate: '2024-01-01',
      managerEmail: null,
      region: 'ALL',
      team: 'JTK',
      department: 'HR Experience',
      country: null,
      status: 'active',
    };
  }

  // Override specific users with richer profile data
  Object.assign(map['mohamed.tantawy@deel.com'], {
    name: 'Mohamed Tantawy',
    title: 'Director, HR Experience',
    startDate: '2023-01-10',
    region: 'EMEA',
    team: 'EOR Services',
    country: 'AE',
  });
  Object.assign(map['duygu.cakalli@deel.com'], {
    name: 'Duygu Cakalli',
    title: 'Senior Regional Manager, HR Experience',
    startDate: '2023-03-15',
    managerEmail: 'mohamed.tantawy@deel.com',
    region: 'EMEA',
    team: 'EOR Services',
    country: 'AE',
  });

  return map;
};

export const DEFAULT_USER_ACCESS_MAP = _buildAccessMap();
