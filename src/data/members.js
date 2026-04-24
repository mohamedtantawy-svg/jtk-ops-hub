// ---------------------------------------------------------------------------
// Complete team org chart — 104 people from Access Mapping spreadsheet.
// Defines hierarchy (managerEmail), access levels, teams, services.
// This is the single source of truth for the people directory.
// ---------------------------------------------------------------------------

// ── Full team roster ─────────────────────────────────────────────────────
export const TEAM_MEMBERS = [
  { email: 'mohamed.tantawy@deel.com', name: 'Mohamed Tantawy', initials: 'MT', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Mohamed%20Tantawy&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Director, HR Experience', access: 'admin', managerEmail: 'carlos@deel.com', team: 'All', service: 'All', startDate: '2021-08-02' },
  { email: 'giselle.hernandez@deel.com', name: 'Giselle Hernandez', initials: 'GH', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Giselle%20Hernandez&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Regional Manager, HR Experience & Mobility', access: 'regional_manager', managerEmail: 'mohamed.tantawy@deel.com', team: 'LATAM + NAM', service: 'EOR', startDate: '2021-11-08' },
  { email: 'kristina.fomina@deel.com', name: 'Kristina Fomina', initials: 'KF', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Kristina%20Fomina&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior Regional Manager, HR Experience & Mobility', access: 'regional_manager', managerEmail: 'mohamed.tantawy@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-06-13' },
  { email: 'megan.lawrence@deel.com', name: 'Megan Lawrence', initials: 'ML', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Megan%20Lawrence&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Team Lead, HR Experience & Mobility', access: 'regional_manager', managerEmail: 'mohamed.tantawy@deel.com', team: 'LATAM + NAM', service: 'EOR', startDate: '2023-11-13' },
  { email: 'melissa.capicchiano@deel.com', name: 'Melissa Capicchiano', initials: 'MC', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Melissa%20Capicchiano&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Manager, HR Experience', access: 'regional_manager', managerEmail: 'mohamed.tantawy@deel.com', team: 'APAC', service: 'EOR', startDate: '2022-09-01' },
  { email: 'sarah.suge@deel.com', name: 'Sarah Suge', initials: 'SS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Sarah%20Suge&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior Manager, HR Experience', access: 'regional_manager', managerEmail: 'mohamed.tantawy@deel.com', team: 'EMEA', service: 'EOR', startDate: '2021-10-25' },
  { email: 'adriana.jeremic@deel.com', name: 'Adriana Jeremic', initials: 'AJ', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Adriana%20Jeremic&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Manager, Regional HR Experience & Mobility', access: 'team_lead', managerEmail: 'mohamed.tantawy@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-01-10' },
  { email: 'jose.ruales@deel.com', name: 'Jose Ruales', initials: 'JR', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Jose%20Ruales&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Team Lead, HR Experience & Mobility', access: 'team_lead', managerEmail: 'kristina.fomina@deel.com', team: 'EMEA', service: 'EOR', startDate: '2021-08-30' },
  { email: 'kinga.ogorek@deel.com', name: 'Kinga Ogórek', initials: 'KO', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Kinga%20Ogórek&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Team Lead, Global Service Center', access: 'team_lead', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2025-07-07' },
  { email: 'ljubica.andjelic@deel.com', name: 'Ljubica Andjelic', initials: 'LA', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Ljubica%20Andjelic&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Team Lead, HR Experience & Mobility', access: 'team_lead', managerEmail: 'kristina.fomina@deel.com', team: 'EMEA', service: 'EOR', startDate: '2021-11-15' },
  { email: 'madeleine.solares@deel.com', name: 'Madeleine Solares Decuir', initials: 'MD', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Madeleine%20Solares%20Decuir&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Team Lead, HR Experience', access: 'team_lead', managerEmail: 'megan.lawrence@deel.com', team: 'LATAM', service: 'EOR', startDate: '2022-07-25' },
  { email: 'mina.nagieva@deel.com', name: 'Mina Nagieva', initials: 'MN', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Mina%20Nagieva&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Team Lead, HR Experience', access: 'team_lead', managerEmail: 'kristina.fomina@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-01-09' },
  { email: 'abe.elkholi@deel.com', name: 'Abe Elkholi', initials: 'AE', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Abe%20Elkholi&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2026-03-16' },
  { email: 'alaetra.wilkerson@deel.com', name: 'Alaetra Wilkerson', initials: 'AW', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Alaetra%20Wilkerson&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2025-03-10' },
  { email: 'alejandro.ramirez@deel.com', name: 'Alejandro Ramirez Lopera', initials: 'AL', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Alejandro%20Ramirez%20Lopera&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2024-09-30' },
  { email: 'alexandra.apsychou@deel.com', name: 'Alexandra Apsychou', initials: 'AA', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Alexandra%20Apsychou&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-05-13' },
  { email: 'aline.galletyer@deel.com', name: 'Aline Galletyer', initials: 'AG', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Aline%20Galletyer&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-06-03' },
  { email: 'amanda.passos@deel.com', name: 'Amanda Passos', initials: 'AP', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Amanda%20Passos&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'madeleine.solares@deel.com', team: 'LATAM', service: 'EOR', startDate: '2024-02-19' },
  { email: 'andre.maia@deel.com', name: 'André Martins', initials: 'AM', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=André%20Martins&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'madeleine.solares@deel.com', team: 'LATAM', service: 'EOR', startDate: '2025-03-10' },
  { email: 'angelgrace.armea@deel.com', name: 'Angel Grace Armea', initials: 'AA', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Angel%20Grace%20Armea&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2023-05-15' },
  { email: 'angy.castillo@deel.com', name: 'Angy Virginia Castillo Patterson', initials: 'AP', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Angy%20Virginia%20Castillo%20Patterson&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2025-02-24' },
  { email: 'anna.esipova@deel.com', name: 'Anna Esipova', initials: 'AE', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Anna%20Esipova&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'mina.nagieva@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-04-10' },
  { email: 'anne.sanmartin@deel.com', name: 'Anne Sanmartin', initials: 'AS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Anne%20Sanmartin&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-10-27' },
  { email: 'armela.cibukaj@deel.com', name: 'Armela Cibukaj', initials: 'AC', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Armela%20Cibukaj&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2026-03-23' },
  { email: 'asako.abe@deel.com', name: 'Asako Abe', initials: 'AA', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Asako%20Abe&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2023-04-03' },
  { email: 'astrid.martinez@deel.com', name: 'Astrid Martinez', initials: 'AM', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Astrid%20Martinez&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'madeleine.solares@deel.com', team: 'LATAM', service: 'EOR', startDate: '2026-03-17' },
  { email: 'ayne.betarmos@deel.com', name: 'Ayne Betarmos', initials: 'AB', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Ayne%20Betarmos&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2023-03-20' },
  { email: 'ayushi.jain@deel.com', name: 'Ayushi Jain', initials: 'AJ', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Ayushi%20Jain&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2024-07-01' },
  { email: 'beatriz.charry@deel.com', name: 'Beatriz Charry', initials: 'BC', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Beatriz%20Charry&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior HR Experience Operations Manager', access: 'agent', managerEmail: 'kristina.fomina@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-05-08' },
  { email: 'carolina.ferreira@deel.com', name: 'Carolina Ferreira', initials: 'CF', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Carolina%20Ferreira&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-01-24' },
  { email: 'celine.taruc@deel.com', name: 'Celine Taruc', initials: 'CT', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Celine%20Taruc&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2022-07-20' },
  { email: 'chaitanya.uppalapati@deel.com', name: 'Chaitanya Raju Uppalapati', initials: 'CU', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Chaitanya%20Raju%20Uppalapati&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Administrator', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2021-11-22' },
  { email: 'christina.shalaby@deel.com', name: 'Christina Shalaby', initials: 'CS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Christina%20Shalaby&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'adriana.jeremic@deel.com', team: 'EMEA', service: 'New Services', startDate: '2023-07-24' },
  { email: 'daniel.olatunji@deel.com', name: 'Daniel Olatunji', initials: 'DO', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Daniel%20Olatunji&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Quality Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2023-05-01' },
  { email: 'duygu.cakalli@deel.com', name: 'Duygu Cakalli', initials: 'DC', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Duygu%20Cakalli&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Team Lead, HR Experience & Mobility', access: 'agent', managerEmail: 'sarah.suge@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-10-10' },
  { email: 'elena.delgado@deel.com', name: 'Elena Delgado', initials: 'ED', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Elena%20Delgado&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2026-02-23' },
  { email: 'emilie.thiery@deel.com', name: 'Emilie Thiery', initials: 'ET', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Emilie%20Thiery&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-09-26' },
  { email: 'erwin.javier@deel.com', name: 'Erwin Javier', initials: 'EJ', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Erwin%20Javier&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2024-08-19' },
  { email: 'ewa.kotowska@deel.com', name: 'Ewa Kotowska', initials: 'EK', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Ewa%20Kotowska&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-05-05' },
  { email: 'federica.deluca@deel.com', name: 'Federica De Luca', initials: 'FL', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Federica%20De%20Luca&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-05-27' },
  { email: 'fernanda.scafini@deel.com', name: 'Fernanda Scafini', initials: 'FS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Fernanda%20Scafini&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-06-23' },
  { email: 'francesca.desantis@deel.com', name: 'Francesca De Santis', initials: 'FS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Francesca%20De%20Santis&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-11-03' },
  { email: 'georgina.cotton@deel.com', name: 'Georgie Cotton', initials: 'GC', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Georgie%20Cotton&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-06-28' },
  { email: 'hala.elkhalfaoui@deel.com', name: 'Hala El Khalfaoui', initials: 'HK', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Hala%20El%20Khalfaoui&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2026-03-23' },
  { email: 'krystle.harsch@deel.com', name: 'Harsch Krystle Rose', initials: 'HR', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Harsch%20Krystle%20Rose&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2025-02-17' },
  { email: 'helen.abraha@deel.com', name: 'Helen Abraha', initials: 'HA', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Helen%20Abraha&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2025-05-19' },
  { email: 'imran.lantra@deel.com', name: 'Imran Lantra', initials: 'IL', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Imran%20Lantra&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Administrator', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-11-27' },
  { email: 'insiya.jasdanwalla@deel.com', name: 'Insiya Jasdanwalla', initials: 'IJ', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Insiya%20Jasdanwalla&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Operations Manager', access: 'agent', managerEmail: 'sarah.suge@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-08-16' },
  { email: 'isabella.mhamdi@deel.com', name: 'Isabella Mhamdi', initials: 'IM', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Isabella%20Mhamdi&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-10-01' },
  { email: 'jacqueline.ciboso@deel.com', name: 'Jackie Ciboso', initials: 'JC', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Jackie%20Ciboso&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2026-02-23' },
  { email: 'jessica.fowler@deel.com', name: 'Jessica Fowler', initials: 'JF', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Jessica%20Fowler&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2025-04-07' },
  { email: 'jessica.czech@deel.com', name: 'Jessica Sabrina Czech', initials: 'JC', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Jessica%20Sabrina%20Czech&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-03-03' },
  { email: 'jithya.sathian@deel.com', name: 'Jithya Sathyan', initials: 'JS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Jithya%20Sathyan&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Administrator', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-04-21' },
  { email: 'joaquin.celhay@deel.com', name: 'Joaquin Celhay', initials: 'JC', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Joaquin%20Celhay&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2024-01-15' },
  { email: 'jia.zhao@deel.com', name: 'Jojo Zhao', initials: 'JZ', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Jojo%20Zhao&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2025-07-14' },
  { email: 'tsetemi.tuoyo@deel.com', name: 'Josephine Oritsetsetemi Tuoyo', initials: 'JT', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Josephine%20Oritsetsetemi%20Tuoyo&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Operations Manager', access: 'agent', managerEmail: 'adriana.jeremic@deel.com', team: 'EMEA', service: 'New Services', startDate: '2023-02-20' },
  { email: 'julia.mateos@deel.com', name: 'Julia Mateos Aixandri', initials: 'JA', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Julia%20Mateos%20Aixandri&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-01-17' },
  { email: 'kaat.meyns@deel.com', name: 'Kaat Meyns', initials: 'KM', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Kaat%20Meyns&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-07-14' },
  { email: 'katty.carvajal@deel.com', name: 'Katty Prensa', initials: 'KP', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Katty%20Prensa&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2025-01-06' },
  { email: 'kelechi.obasi@deel.com', name: 'Kelechi Obasi', initials: 'KO', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Kelechi%20Obasi&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2024-09-16' },
  { email: 'kinga.bobko@deel.com', name: 'Kinga Bobko', initials: 'KB', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Kinga%20Bobko&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'mina.nagieva@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-04-03' },
  { email: 'klaske.rinia@deel.com', name: 'Klaske Rinia', initials: 'KR', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Klaske%20Rinia&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-10-20' },
  { email: 'laura.llopislopez@deel.com', name: 'Laura Llopis', initials: 'LL', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Laura%20Llopis&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Operations Manager', access: 'agent', managerEmail: 'kristina.fomina@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-04-15' },
  { email: 'laura.pai@deel.com', name: 'Laura Pai', initials: 'LP', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Laura%20Pai&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'madeleine.solares@deel.com', team: 'LATAM', service: 'EOR', startDate: '2025-07-28' },
  { email: 'lehi.salonga@deel.com', name: 'Lehi Salonga', initials: 'LS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Lehi%20Salonga&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Operations Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2022-03-01' },
  { email: 'lorraine.muketo@deel.com', name: 'Lorraine Muketo', initials: 'LM', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Lorraine%20Muketo&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'mina.nagieva@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-10-01' },
  { email: 'luisinadecicco@deel.com', name: 'Luisina De Cicco', initials: 'LC', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Luisina%20De%20Cicco&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2021-08-02' },
  { email: 'lyall.genade@deel.com', name: 'Lyall Genade', initials: 'LG', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Lyall%20Genade&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-08-26' },
  { email: 'rosa.meza@deel.com', name: 'Margarita Meza', initials: 'MM', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Margarita%20Meza&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Administrator', access: 'agent', managerEmail: 'madeleine.solares@deel.com', team: 'LATAM', service: 'EOR', startDate: '2023-10-23' },
  { email: 'belen.silvestri@deel.com', name: 'Maria Belen Silvestri', initials: 'MS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Maria%20Belen%20Silvestri&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Team Lead, HR Experience & Mobility', access: 'agent', managerEmail: 'sarah.suge@deel.com', team: 'EMEA', service: 'EOR', startDate: '2021-12-01' },
  { email: 'martina.guccione@deel.com', name: 'Martina Guccione', initials: 'MG', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Martina%20Guccione&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-01-02' },
  { email: 'martina.tobolcevic@deel.com', name: 'Martina Tobolcevic', initials: 'MT', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Martina%20Tobolcevic&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior HR Specialist', access: 'agent', managerEmail: 'mina.nagieva@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-10-01' },
  { email: 'maud.bouaziz@deel.com', name: 'Maud Bouaziz', initials: 'MB', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Maud%20Bouaziz&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Audit Consultant', access: 'agent', managerEmail: 'adriana.jeremic@deel.com', team: 'EMEA', service: 'New Services', startDate: '2025-01-17' },
  { email: 'mauro.coronel@deel.com', name: 'Mauro Coronel', initials: 'MC', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Mauro%20Coronel&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-09-02' },
  { email: 'maylis.pourtau@deel.com', name: 'Maylis Pourtau', initials: 'MP', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Maylis%20Pourtau&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'adriana.jeremic@deel.com', team: 'EMEA', service: 'New Services', startDate: '2025-06-02' },
  { email: 'natalia.marin@deel.com', name: 'Natalia Atehortua', initials: 'NA', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Natalia%20Atehortua&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Administrator', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2023-08-28' },
  { email: 'natalia.mesa@deel.com', name: 'Natalia Olarte', initials: 'NO', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Natalia%20Olarte&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2022-05-23' },
  { email: 'navin.segar@deel.com', name: 'Navin Segar', initials: 'NS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Navin%20Segar&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2025-06-02' },
  { email: 'oxana.serdyuk@deel.com', name: 'Oksana Serdyuk', initials: 'OS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Oksana%20Serdyuk&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'mina.nagieva@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-01-27' },
  { email: 'oludolapo.ifeoluwa@deel.com', name: 'Oludolapo Akindutire', initials: 'OA', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Oludolapo%20Akindutire&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior HR Experience Operations Manager', access: 'agent', managerEmail: 'kristina.fomina@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-02-16' },
  { email: 'omolabake.owolabi@deel.com', name: 'Omolabake Owolabi', initials: 'OO', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Omolabake%20Owolabi&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2024-11-18' },
  { email: 'justine.esquierdo@deel.com', name: 'Pearl Esquierdo', initials: 'PE', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Pearl%20Esquierdo&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2024-05-13' },
  { email: 'pilar.dominguez@deel.com', name: 'Pilar Dominguez', initials: 'PD', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Pilar%20Dominguez&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-09-30' },
  { email: 'pilvi.pirhonen@deel.com', name: 'Pilvi Pirhonen', initials: 'PP', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Pilvi%20Pirhonen&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-07-14' },
  { email: 'rachael.maclean@deel.com', name: 'Rachael Maclean', initials: 'RM', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Rachael%20Maclean&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Specialist', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-10-01' },
  { email: 'raquel.sanchez@deel.com', name: 'Raquel Sanchez', initials: 'RS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Raquel%20Sanchez&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-11-13' },
  { email: 'saida.yusuf@deel.com', name: 'Saida Yusuf', initials: 'SY', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Saida%20Yusuf&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2024-09-23' },
  { email: 'saomi.auste@deel.com', name: 'Sao Auste', initials: 'SA', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Sao%20Auste&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2025-07-14' },
  { email: 'sayli.patil@deel.com', name: 'Sayli Patil', initials: 'SP', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Sayli%20Patil&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2026-01-05' },
  { email: 'xiaofeng.yao@deel.com', name: 'Shell Yao', initials: 'SY', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Shell%20Yao&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2024-07-01' },
  { email: 'sonal.singh@deel.com', name: 'Sonal Singh', initials: 'SS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Sonal%20Singh&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2025-10-01' },
  { email: 'stefania.marini@deel.com', name: 'Stefania Marini', initials: 'SM', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Stefania%20Marini&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2024-07-08' },
  { email: 'stormie.skutnik@deel.com', name: 'Stormie Skutnik', initials: 'SS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Stormie%20Skutnik&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2025-10-01' },
  { email: 'susana.santos@deel.com', name: 'Suzy Santos', initials: 'SS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Suzy%20Santos&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Administrator', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-12-02' },
  { email: 'tatiana.glebova@deel.com', name: 'Tania Glebova Leontyeva', initials: 'TL', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Tania%20Glebova%20Leontyeva&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-06-23' },
  { email: 'tara.lewendon@deel.com', name: 'Tara Lewendon', initials: 'TL', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Tara%20Lewendon&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-02-03' },
  { email: 'trish.lee@deel.com', name: 'Trish Lee', initials: 'TL', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Trish%20Lee&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-05-21' },
  { email: 'victor.marin@deel.com', name: 'Victor Alejandro Marin Jimenez', initials: 'VJ', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Victor%20Alejandro%20Marin%20Jimenez&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2023-06-12' },
  { email: 'victor.cortes@deel.com', name: 'Victor Cortes', initials: 'VC', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Victor%20Cortes&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'madeleine.solares@deel.com', team: 'LATAM', service: 'EOR', startDate: '2025-09-01' },
  { email: 'vilija.survilaite@deel.com', name: 'Vilija Survilaite', initials: 'VS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Vilija%20Survilaite&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-06-24' },
  { email: 'weintonye.sese@deel.com', name: 'Weintonye Sese', initials: 'WS', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Weintonye%20Sese&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2025-02-10' },
  { email: 'william.gaspar@deel.com', name: 'Will Gaspar', initials: 'WG', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Will%20Gaspar&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2024-09-02' },
  { email: 'yonit.menashe@deel.com', name: 'Yonit Rucki Menashe', initials: 'YM', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Yonit%20Rucki%20Menashe&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'mina.nagieva@deel.com', team: 'EMEA', service: 'EOR', startDate: '2021-12-06' },
  { email: 'ziyaad.mahomed@deel.com', name: 'Ziyaad Mahomed', initials: 'ZM', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Ziyaad%20Mahomed&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40', title: 'HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2024-04-15' },
];

// ---------------------------------------------------------------------------
// Hydratable roster — single source of truth that mirrors team_member_overrides
// ---------------------------------------------------------------------------
// TEAM_MEMBERS above is the BASELINE. _currentRoster is the mutable runtime
// state that hydrateRoster(merged) replaces whenever overrides land (on login,
// or whenever the client hook / server helper pulls from the DB).
//
// The derived exports below (MEMBERS_BY_EMAIL, ALL_EMAILS, ALL_EMAILS_SET,
// MEMBERS, DEFAULT_USER_ACCESS_MAP) are declared with `export let` so they can
// be rebuilt on every hydration. Thanks to ES module live bindings, every
// `import { MEMBERS_BY_EMAIL } from '.../members'` elsewhere in the app sees
// the newest reference without needing to re-import or remount.
//
// Helper functions (getDirectReports, getAllReports, getVisibleEmailsForAccess)
// close over the module-level _currentRoster / ALL_EMAILS_SET names, so they
// track hydration automatically — no caller needs to change.
//
// React integration: subscribeRoster(cb) lets React components bridge module
// state into state, so a re-render fires after hydration. App.jsx reads the
// roster version from the subscription and threads it through PermissionsContext
// so memoised derivations in Briefing / Queue / Home invalidate correctly.

function _normaliseMember(m) {
  return {
    ...m,
    email: String(m.email || '').toLowerCase(),
    managerEmail: m.managerEmail ? String(m.managerEmail).toLowerCase() : null,
  };
}

let _currentRoster = TEAM_MEMBERS.map(_normaliseMember);
let _rosterVersion = 0;
const _subscribers = new Set();

function _buildMembersByEmail(roster) {
  return Object.fromEntries(roster.map(m => [m.email, m]));
}

function _buildMembers(roster) {
  return roster.map((m, i) => ({
    id: i + 1,
    name: m.name,
    initials: m.initials,
    avatarUrl: m.avatarUrl,
    role: m.access,
    team: m.team,
    region: m.team,
    country: m.country || null,
    lead: null,
    email: m.email,
  }));
}

function _accessTypeId(access) {
  return (
    {
      admin: 'at_admin',
      regional_manager: 'at_regional_mgr',
      team_lead: 'at_lead',
      agent: 'at_agent',
    }[access] || 'at_agent'
  );
}

function _buildAccessMap(roster) {
  return Object.fromEntries(
    roster.map(m => [
      m.email,
      {
        accessTypeId: _accessTypeId(m.access),
        name: m.name,
        title: m.title,
        startDate: m.startDate,
        managerEmail: m.managerEmail,
        region: m.team,
        team: m.team,
        department: 'HR Experience',
        country: m.country || null,
        status: m.isDeleted ? 'inactive' : 'active',
        access: m.access,
        service: m.service,
      },
    ])
  );
}

// ── Live-binding derived exports ────────────────────────────────────────
// These are `export let` specifically so hydrateRoster() can reassign them —
// consumers using `import { MEMBERS_BY_EMAIL } from '.../members'` will see
// the new values on their very next read (ES module live bindings).
export let MEMBERS_BY_EMAIL = _buildMembersByEmail(_currentRoster);
export let ALL_EMAILS = _currentRoster.map(m => m.email);
export let ALL_EMAILS_SET = new Set(ALL_EMAILS);
export let MEMBERS = _buildMembers(_currentRoster);
export let DEFAULT_USER_ACCESS_MAP = _buildAccessMap(_currentRoster);

// ── Structural equality short-circuit ───────────────────────────────────
// Avoid rebuilding every derived map when hydration returns the same data
// (e.g. the client hook fetches the same roster twice in a row). Comparing
// on the subset of fields that actually impact scoping / permissions is
// cheap and eliminates thrash + unnecessary subscriber callbacks.
function _rostersEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) return false;
    if (
      x.email !== y.email ||
      x.access !== y.access ||
      x.managerEmail !== y.managerEmail ||
      x.team !== y.team ||
      x.service !== y.service ||
      x.name !== y.name ||
      x.title !== y.title ||
      (x.country || null) !== (y.country || null) ||
      Boolean(x.isDeleted) !== Boolean(y.isDeleted) ||
      Boolean(x.onLeave) !== Boolean(y.onLeave)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Swap the runtime roster and rebuild every derived export. Returns true if
 * the swap happened (nextMembers differed from the current roster), false
 * otherwise. A no-op swap does NOT fire subscribers and does NOT bump the
 * version — callers can rely on rosterVersion only changing when something
 * actually changed.
 */
export function hydrateRoster(nextMembers) {
  if (!Array.isArray(nextMembers) || nextMembers.length === 0) return false;
  const normalised = nextMembers.map(_normaliseMember);
  if (_rostersEqual(_currentRoster, normalised)) return false;

  _currentRoster = normalised;
  MEMBERS_BY_EMAIL = _buildMembersByEmail(_currentRoster);
  ALL_EMAILS = _currentRoster.map(m => m.email);
  ALL_EMAILS_SET = new Set(ALL_EMAILS);
  MEMBERS = _buildMembers(_currentRoster);
  DEFAULT_USER_ACCESS_MAP = _buildAccessMap(_currentRoster);
  _rosterVersion += 1;

  for (const cb of _subscribers) {
    try {
      cb(_rosterVersion);
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[members subscribeRoster]', err?.message || err);
      }
    }
  }
  return true;
}

/** Current monotonically-increasing roster version (0 if untouched). */
export function getRosterVersion() {
  return _rosterVersion;
}

/** Register a callback fired after each successful hydration. Returns an
 *  unsubscribe function. Intentionally tiny — consumers (React, caches) call
 *  setState / invalidate inside their own handler. */
export function subscribeRoster(cb) {
  if (typeof cb !== 'function') return () => {};
  _subscribers.add(cb);
  return () => {
    _subscribers.delete(cb);
  };
}

/** Read-only snapshot of the current roster for server-side consumers that
 *  don't want to touch the live binding directly. */
export function getCurrentRoster() {
  return [..._currentRoster];
}

// ── Hierarchy helpers — read from the hydrated _currentRoster ───────────
// Soft-deleted members (isDeleted=true) are filtered out so removing a person
// on the Team tab has immediate effect on Queue / Briefing / Home scoping.
export function getDirectReports(email) {
  if (!email) return [];
  const e = email.toLowerCase();
  return _currentRoster.filter(m => m.managerEmail === e && !m.isDeleted);
}

export function getAllReports(email) {
  if (!email) return [];
  const reports = new Set();
  const queue = [email.toLowerCase()];
  while (queue.length > 0) {
    const mgr = queue.shift();
    for (const m of _currentRoster) {
      if (m.isDeleted) continue;
      if (m.managerEmail === mgr && !reports.has(m.email)) {
        reports.add(m.email);
        queue.push(m.email);
      }
    }
  }
  return [...reports];
}

// ── Get the visible email set for a user based on access level + hierarchy
// Admin → all. Regional manager → self + full subtree.
// Team lead → self + direct reports. Agent → self only.
export function getVisibleEmailsForAccess(email) {
  if (!email) return new Set();
  const lower = email.toLowerCase();
  const member = MEMBERS_BY_EMAIL[lower];
  if (!member) return new Set([lower]);
  if (member.access === 'admin') return ALL_EMAILS_SET;

  const visible = new Set([lower]);
  if (member.access === 'regional_manager') {
    for (const r of getAllReports(email)) visible.add(r);
  } else if (member.access === 'team_lead') {
    for (const r of getDirectReports(email)) visible.add(r.email);
  }
  return visible;
}
