export const MEMBERS=[
  // Agents — report to their team lead
  {id:1, name:'Sarah Chen',     initials:'SC',role:'agent',  team:'EMEA',region:'EMEA',country:'UK',lead:11,email:'sarah.chen@deel.com'},
  {id:2, name:'James Okafor',   initials:'JO',role:'agent',  team:'EMEA',region:'EMEA',country:'DE',lead:11,email:'james.okafor@deel.com'},
  {id:3, name:'Maria González', initials:'MG',role:'agent',  team:'AMER',region:'AMER',country:'BR',lead:13,email:'maria.gonzalez@deel.com'},
  {id:4, name:'Priya Sharma',   initials:'PS',role:'agent',  team:'APAC',region:'APAC',country:'SG',lead:12,email:'priya.sharma@deel.com'},
  {id:5, name:'Tom Walsh',      initials:'TW',role:'agent',  team:'EMEA',region:'EMEA',country:'FR',lead:11,email:'tom.walsh@deel.com'},
  {id:6, name:'Yuki Tanaka',    initials:'YT',role:'agent',  team:'APAC',region:'APAC',country:'AU',lead:12,email:'yuki.tanaka@deel.com'},
  {id:7, name:'Aisha Mohammed', initials:'AM',role:'agent',  team:'EMEA',region:'EMEA',country:'AE',lead:11,email:'aisha.mohammed@deel.com'},
  {id:8, name:'David Kim',      initials:'DK',role:'agent',  team:'AMER',region:'AMER',country:'CA',lead:13,email:'david.kim@deel.com'},
  {id:9, name:'Elena Petrova',  initials:'EP',role:'agent',  team:'AMER',region:'AMER',country:'US',lead:13,email:'elena.petrova@deel.com'},
  {id:10,name:'Lucas Dubois',   initials:'LD',role:'agent',  team:'EMEA',region:'EMEA',country:'NL',lead:11,email:'lucas.dubois@deel.com'},
  {id:16,name:'Fatima El-Amin', initials:'FE',role:'agent',  team:'EMEA',region:'EMEA',country:'AE',lead:11,email:'fatima.el-amin@deel.com'},
  {id:17,name:'Renata Kowalski',initials:'RK',role:'agent',  team:'EMEA',region:'EMEA',country:'PL',lead:11,email:'renata.kowalski@deel.com'},
  {id:18,name:'Kenji Watanabe', initials:'KW',role:'agent',  team:'APAC',region:'APAC',country:'JP',lead:12,email:'kenji.watanabe@deel.com'},
  {id:19,name:'Soo-Yeon Park',  initials:'SP',role:'agent',  team:'APAC',region:'APAC',country:'KR',lead:12,email:'soo-yeon.park@deel.com'},
  {id:20,name:'Isabella Reyes', initials:'IR',role:'agent',  team:'AMER',region:'AMER',country:'MX',lead:13,email:'isabella.reyes@deel.com'},
  // Team Leads — report to their regional manager
  {id:11,name:'Alex Thompson',  initials:'AT',role:'lead',   team:'EMEA',region:'EMEA',country:'UK',lead:15,email:'alex.thompson@deel.com'},
  {id:12,name:'Jenny Liu',      initials:'JL',role:'lead',   team:'APAC',region:'APAC',country:'SG',lead:15,email:'jenny.liu@deel.com'},
  {id:13,name:'Carlos Reyes',   initials:'CR',role:'lead',   team:'AMER',region:'AMER',country:'US',lead:15,email:'carlos.reyes@deel.com'},
  // Director / Admin — top of hierarchy
  {id:14,name:'Mohamed Tantawy',initials:'MT',role:'admin',  team:'ALL', region:'ALL', country:'AE',lead:null,email:'mohamed.tantawy@deel.com'},
  // Regional Manager — oversees all regions, reports to admin
  {id:15,name:'Duygu Cakalli',  initials:'DC',role:'regional_mgr',team:'ALL',region:'ALL',country:'AE',lead:14,email:'duygu.cakalli@deel.com'},
];

// ---------------------------------------------------------------------------
// Full user directory — each entry is keyed by email
// Stores access type + org profile (title, manager, start date, region, team, department)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper: derive display name from email prefix (e.g. "abe.elkholi" → "Abe Elkholi")
// ---------------------------------------------------------------------------
function _nameFromEmail(email) {
  const prefix = email.split('@')[0];
  return prefix
    .split(/[.\-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// All admin emails — kept in sync with ADMIN_EMAILS in auth/google/callback
// ---------------------------------------------------------------------------
const ADMIN_EMAILS_LIST = [
  'abe.elkholi@deel.com',
  'adriana.jeremic@deel.com',
  'alaetra.wilkerson@deel.com',
  'alexandra.apsychou@deel.com',
  'aline.galletyer@deel.com',
  'andre.maia@deel.com',
  'anna.esipova@deel.com',
  'anne.sanmartin@deel.com',
  'armela.cibukaj@deel.com',
  'asako.abe@deel.com',
  'astrid.martinez@deel.com',
  'ayushi.jain@deel.com',
  'beatriz.charry@deel.com',
  'belen.silvestri@deel.com',
  'carolina.ferreira@deel.com',
  'celine.taruc@deel.com',
  'chaitanya.uppalapati@deel.com',
  'christina.shalaby@deel.com',
  'duygu.cakalli@deel.com',
  'elena.delgado@deel.com',
  'emilie.thiery@deel.com',
  'erwin.javier@deel.com',
  'ewa.kotowska@deel.com',
  'federica.deluca@deel.com',
  'fernanda.scafini@deel.com',
  'francesca.desantis@deel.com',
  'georgina.cotton@deel.com',
  'giselle.hernandez@deel.com',
  'hala.elkhalfaoui@deel.com',
  'helen.abraha@deel.com',
  'oludolapo.ifeoluwa@deel.com',
  'imran.lantra@deel.com',
  'insiya.jasdanwalla@deel.com',
  'isabella.mhamdi@deel.com',
  'jacqueline.ciboso@deel.com',
  'jessica.fowler@deel.com',
  'jessica.czech@deel.com',
  'jia.zhao@deel.com',
  'jithya.sathian@deel.com',
  'joaquin.celhay@deel.com',
  'jose.ruales@deel.com',
  'julia.mateos@deel.com',
  'kaat.meyns@deel.com',
  'kinga.bobko@deel.com',
  'kinga.ogorek@deel.com',
  'klaske.rinia@deel.com',
  'kristina.fomina@deel.com',
  'krystle.harsch@deel.com',
  'laura.llopislopez@deel.com',
  'laura.pai@deel.com',
  'lehi.salonga@deel.com',
  'natalia.marin@deel.com',
  'ljubica.andjelic@deel.com',
  'lorraine.muketo@deel.com',
  'luisinadecicco@deel.com',
  'lyall.genade@deel.com',
  'madeleine.solares@deel.com',
  'amanda.passos@deel.com',
  'rosa.meza@deel.com',
  'martina.guccione@deel.com',
  'martina.tobolcevic@deel.com',
  'maud.bouaziz@deel.com',
  'mauro.coronel@deel.com',
  'maylis.pourtau@deel.com',
  'megan.lawrence@deel.com',
  'melissa.capicchiano@deel.com',
  'meriam.fadel@deel.com',
  'mina.nagieva@deel.com',
  'natalia.mesa@deel.com',
  'navin.segar@deel.com',
  'oxana.serdyuk@deel.com',
  'paulina.saproniene@deel.com',
  'pilar.dominguez@deel.com',
  'pilvi.pirhonen@deel.com',
  'pranav.nagarkar@deel.com',
  'rachael.maclean@deel.com',
  'raquel.sanchez@deel.com',
  'sarah.suge@deel.com',
  'sayli.patil@deel.com',
  'sonal.singh@deel.com',
  'stefania.marini@deel.com',
  'stormie.skutnik@deel.com',
  'susana.santos@deel.com',
  'mohamed.tantawy@deel.com',
  'tara.lewendon@deel.com',
  'tatiana.glebova@deel.com',
  'trish.lee@deel.com',
  'tsetemi.tuoyo@deel.com',
  'victor.cortes@deel.com',
  'william.gaspar@deel.com',
  'xiaofeng.yao@deel.com',
  'yonit.menashe@deel.com',
  'ziyaad.mahomed@deel.com',
  'dw@deel.com',
  'albert.didi@deel.com',
];

// Build DEFAULT_USER_ACCESS_MAP dynamically from the admin list
const _buildAccessMap = () => {
  const map = {};

  // Add all admin users
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
