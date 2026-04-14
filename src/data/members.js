// ---------------------------------------------------------------------------
// Complete team org chart — 104 people from Access Mapping spreadsheet.
// Defines hierarchy (managerEmail), access levels, teams, services.
// This is the single source of truth for the people directory.
// ---------------------------------------------------------------------------

// ── Full team roster ─────────────────────────────────────────────────────
export const TEAM_MEMBERS = [
  { email: 'mohamed.tantawy@deel.com', name: 'Mohamed Tantawy', initials: 'MT', title: 'Director, HR Experience', access: 'admin', managerEmail: 'carlos@deel.com', team: 'All', service: 'All', startDate: '2021-08-02' },
  { email: 'giselle.hernandez@deel.com', name: 'Giselle Hernandez', initials: 'GH', title: 'Regional Manager, HR Experience & Mobility', access: 'regional_manager', managerEmail: 'mohamed.tantawy@deel.com', team: 'LATAM + NAM', service: 'EOR', startDate: '2021-11-08' },
  { email: 'kristina.fomina@deel.com', name: 'Kristina Fomina', initials: 'KF', title: 'Senior Regional Manager, HR Experience & Mobility', access: 'regional_manager', managerEmail: 'mohamed.tantawy@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-06-13' },
  { email: 'megan.lawrence@deel.com', name: 'Megan Lawrence', initials: 'ML', title: 'Team Lead, HR Experience & Mobility', access: 'regional_manager', managerEmail: 'mohamed.tantawy@deel.com', team: 'LATAM + NAM', service: 'EOR', startDate: '2023-11-13' },
  { email: 'melissa.capicchiano@deel.com', name: 'Melissa Capicchiano', initials: 'MC', title: 'Manager, HR Experience', access: 'regional_manager', managerEmail: 'mohamed.tantawy@deel.com', team: 'APAC', service: 'EOR', startDate: '2022-09-01' },
  { email: 'sarah.suge@deel.com', name: 'Sarah Suge', initials: 'SS', title: 'Senior Manager, HR Experience', access: 'regional_manager', managerEmail: 'mohamed.tantawy@deel.com', team: 'EMEA', service: 'EOR', startDate: '2021-10-25' },
  { email: 'adriana.jeremic@deel.com', name: 'Adriana Jeremic', initials: 'AJ', title: 'Manager, Regional HR Experience & Mobility', access: 'team_lead', managerEmail: 'mohamed.tantawy@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-01-10' },
  { email: 'jose.ruales@deel.com', name: 'Jose Ruales', initials: 'JR', title: 'Team Lead, HR Experience & Mobility', access: 'team_lead', managerEmail: 'kristina.fomina@deel.com', team: 'EMEA', service: 'EOR', startDate: '2021-08-30' },
  { email: 'kinga.ogorek@deel.com', name: 'Kinga Ogórek', initials: 'KO', title: 'Team Lead, Global Service Center', access: 'team_lead', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2025-07-07' },
  { email: 'ljubica.andjelic@deel.com', name: 'Ljubica Andjelic', initials: 'LA', title: 'Team Lead, HR Experience & Mobility', access: 'team_lead', managerEmail: 'kristina.fomina@deel.com', team: 'EMEA', service: 'EOR', startDate: '2021-11-15' },
  { email: 'madeleine.solares@deel.com', name: 'Madeleine Solares Decuir', initials: 'MD', title: 'Team Lead, HR Experience', access: 'team_lead', managerEmail: 'megan.lawrence@deel.com', team: 'LATAM', service: 'EOR', startDate: '2022-07-25' },
  { email: 'mina.nagieva@deel.com', name: 'Mina Nagieva', initials: 'MN', title: 'Team Lead, HR Experience', access: 'team_lead', managerEmail: 'kristina.fomina@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-01-09' },
  { email: 'abe.elkholi@deel.com', name: 'Abe Elkholi', initials: 'AE', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2026-03-16' },
  { email: 'alaetra.wilkerson@deel.com', name: 'Alaetra Wilkerson', initials: 'AW', title: 'HR Experience Manager', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2025-03-10' },
  { email: 'alejandro.ramirez@deel.com', name: 'Alejandro Ramirez Lopera', initials: 'AL', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2024-09-30' },
  { email: 'alexandra.apsychou@deel.com', name: 'Alexandra Apsychou', initials: 'AA', title: 'HR Experience Manager', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-05-13' },
  { email: 'aline.galletyer@deel.com', name: 'Aline Galletyer', initials: 'AG', title: 'HR Experience Manager', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-06-03' },
  { email: 'amanda.passos@deel.com', name: 'Amanda Passos', initials: 'AP', title: 'HR Experience Manager', access: 'agent', managerEmail: 'madeleine.solares@deel.com', team: 'LATAM', service: 'EOR', startDate: '2024-02-19' },
  { email: 'andre.maia@deel.com', name: 'André Martins', initials: 'AM', title: 'HR Experience Manager', access: 'agent', managerEmail: 'madeleine.solares@deel.com', team: 'LATAM', service: 'EOR', startDate: '2025-03-10' },
  { email: 'angelgrace.armea@deel.com', name: 'Angel Grace Armea', initials: 'AA', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2023-05-15' },
  { email: 'angy.castillo@deel.com', name: 'Angy Virginia Castillo Patterson', initials: 'AP', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2025-02-24' },
  { email: 'anna.esipova@deel.com', name: 'Anna Esipova', initials: 'AE', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'mina.nagieva@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-04-10' },
  { email: 'anne.sanmartin@deel.com', name: 'Anne Sanmartin', initials: 'AS', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-10-27' },
  { email: 'armela.cibukaj@deel.com', name: 'Armela Cibukaj', initials: 'AC', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2026-03-23' },
  { email: 'asako.abe@deel.com', name: 'Asako Abe', initials: 'AA', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2023-04-03' },
  { email: 'astrid.martinez@deel.com', name: 'Astrid Martinez', initials: 'AM', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'madeleine.solares@deel.com', team: 'LATAM', service: 'EOR', startDate: '2026-03-17' },
  { email: 'ayne.betarmos@deel.com', name: 'Ayne Betarmos', initials: 'AB', title: 'Senior Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2023-03-20' },
  { email: 'ayushi.jain@deel.com', name: 'Ayushi Jain', initials: 'AJ', title: 'HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2024-07-01' },
  { email: 'beatriz.charry@deel.com', name: 'Beatriz Charry', initials: 'BC', title: 'Senior HR Experience Operations Manager', access: 'agent', managerEmail: 'kristina.fomina@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-05-08' },
  { email: 'carolina.ferreira@deel.com', name: 'Carolina Ferreira', initials: 'CF', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-01-24' },
  { email: 'celine.taruc@deel.com', name: 'Celine Taruc', initials: 'CT', title: 'HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2022-07-20' },
  { email: 'chaitanya.uppalapati@deel.com', name: 'Chaitanya Raju Uppalapati', initials: 'CU', title: 'HR Experience Administrator', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2021-11-22' },
  { email: 'christina.shalaby@deel.com', name: 'Christina Shalaby', initials: 'CS', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'adriana.jeremic@deel.com', team: 'EMEA', service: 'New Services', startDate: '2023-07-24' },
  { email: 'daniel.olatunji@deel.com', name: 'Daniel Olatunji', initials: 'DO', title: 'Quality Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2023-05-01' },
  { email: 'duygu.cakalli@deel.com', name: 'Duygu Cakalli', initials: 'DC', title: 'Team Lead, HR Experience & Mobility', access: 'agent', managerEmail: 'sarah.suge@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-10-10' },
  { email: 'elena.delgado@deel.com', name: 'Elena Delgado', initials: 'ED', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2026-02-23' },
  { email: 'emilie.thiery@deel.com', name: 'Emilie Thiery', initials: 'ET', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-09-26' },
  { email: 'erwin.javier@deel.com', name: 'Erwin Javier', initials: 'EJ', title: 'HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2024-08-19' },
  { email: 'ewa.kotowska@deel.com', name: 'Ewa Kotowska', initials: 'EK', title: 'HR Experience Manager', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-05-05' },
  { email: 'federica.deluca@deel.com', name: 'Federica De Luca', initials: 'FL', title: 'HR Experience Manager', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-05-27' },
  { email: 'fernanda.scafini@deel.com', name: 'Fernanda Scafini', initials: 'FS', title: 'HR Experience Manager', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-06-23' },
  { email: 'francesca.desantis@deel.com', name: 'Francesca De Santis', initials: 'FS', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-11-03' },
  { email: 'georgina.cotton@deel.com', name: 'Georgie Cotton', initials: 'GC', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-06-28' },
  { email: 'hala.elkhalfaoui@deel.com', name: 'Hala El Khalfaoui', initials: 'HK', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2026-03-23' },
  { email: 'krystle.harsch@deel.com', name: 'Harsch Krystle Rose', initials: 'HR', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2025-02-17' },
  { email: 'helen.abraha@deel.com', name: 'Helen Abraha', initials: 'HA', title: 'HR Experience Manager', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2025-05-19' },
  { email: 'imran.lantra@deel.com', name: 'Imran Lantra', initials: 'IL', title: 'HR Experience Administrator', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-11-27' },
  { email: 'insiya.jasdanwalla@deel.com', name: 'Insiya Jasdanwalla', initials: 'IJ', title: 'HR Experience Operations Manager', access: 'agent', managerEmail: 'sarah.suge@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-08-16' },
  { email: 'isabella.mhamdi@deel.com', name: 'Isabella Mhamdi', initials: 'IM', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-10-01' },
  { email: 'jacqueline.ciboso@deel.com', name: 'Jackie Ciboso', initials: 'JC', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2026-02-23' },
  { email: 'jessica.fowler@deel.com', name: 'Jessica Fowler', initials: 'JF', title: 'HR Experience Manager', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2025-04-07' },
  { email: 'jessica.czech@deel.com', name: 'Jessica Sabrina Czech', initials: 'JC', title: 'HR Experience Manager', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-03-03' },
  { email: 'jithya.sathian@deel.com', name: 'Jithya Sathyan', initials: 'JS', title: 'HR Experience Administrator', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-04-21' },
  { email: 'joaquin.celhay@deel.com', name: 'Joaquin Celhay', initials: 'JC', title: 'HR Experience Manager', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2024-01-15' },
  { email: 'jia.zhao@deel.com', name: 'Jojo Zhao', initials: 'JZ', title: 'HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2025-07-14' },
  { email: 'tsetemi.tuoyo@deel.com', name: 'Josephine Oritsetsetemi Tuoyo', initials: 'JT', title: 'HR Experience Operations Manager', access: 'agent', managerEmail: 'adriana.jeremic@deel.com', team: 'EMEA', service: 'New Services', startDate: '2023-02-20' },
  { email: 'julia.mateos@deel.com', name: 'Julia Mateos Aixandri', initials: 'JA', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-01-17' },
  { email: 'kaat.meyns@deel.com', name: 'Kaat Meyns', initials: 'KM', title: 'HR Experience Manager', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-07-14' },
  { email: 'katty.carvajal@deel.com', name: 'Katty Prensa', initials: 'KP', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2025-01-06' },
  { email: 'kelechi.obasi@deel.com', name: 'Kelechi Obasi', initials: 'KO', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2024-09-16' },
  { email: 'kinga.bobko@deel.com', name: 'Kinga Bobko', initials: 'KB', title: 'HR Experience Manager', access: 'agent', managerEmail: 'mina.nagieva@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-04-03' },
  { email: 'klaske.rinia@deel.com', name: 'Klaske Rinia', initials: 'KR', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-10-20' },
  { email: 'laura.llopislopez@deel.com', name: 'Laura Llopis', initials: 'LL', title: 'HR Experience Operations Manager', access: 'agent', managerEmail: 'kristina.fomina@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-04-15' },
  { email: 'laura.pai@deel.com', name: 'Laura Pai', initials: 'LP', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'madeleine.solares@deel.com', team: 'LATAM', service: 'EOR', startDate: '2025-07-28' },
  { email: 'lehi.salonga@deel.com', name: 'Lehi Salonga', initials: 'LS', title: 'HR Experience Operations Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2022-03-01' },
  { email: 'lorraine.muketo@deel.com', name: 'Lorraine Muketo', initials: 'LM', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'mina.nagieva@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-10-01' },
  { email: 'luisinadecicco@deel.com', name: 'Luisina De Cicco', initials: 'LC', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2021-08-02' },
  { email: 'lyall.genade@deel.com', name: 'Lyall Genade', initials: 'LG', title: 'HR Experience Manager', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-08-26' },
  { email: 'rosa.meza@deel.com', name: 'Margarita Meza', initials: 'MM', title: 'HR Experience Administrator', access: 'agent', managerEmail: 'madeleine.solares@deel.com', team: 'LATAM', service: 'EOR', startDate: '2023-10-23' },
  { email: 'belen.silvestri@deel.com', name: 'Maria Belen Silvestri', initials: 'MS', title: 'Team Lead, HR Experience & Mobility', access: 'agent', managerEmail: 'sarah.suge@deel.com', team: 'EMEA', service: 'EOR', startDate: '2021-12-01' },
  { email: 'martina.guccione@deel.com', name: 'Martina Guccione', initials: 'MG', title: 'HR Experience Manager', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-01-02' },
  { email: 'martina.tobolcevic@deel.com', name: 'Martina Tobolcevic', initials: 'MT', title: 'Senior HR Specialist', access: 'agent', managerEmail: 'mina.nagieva@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-10-01' },
  { email: 'maud.bouaziz@deel.com', name: 'Maud Bouaziz', initials: 'MB', title: 'Audit Consultant', access: 'agent', managerEmail: 'adriana.jeremic@deel.com', team: 'EMEA', service: 'New Services', startDate: '2025-01-17' },
  { email: 'mauro.coronel@deel.com', name: 'Mauro Coronel', initials: 'MC', title: 'HR Experience Manager', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-09-02' },
  { email: 'maylis.pourtau@deel.com', name: 'Maylis Pourtau', initials: 'MP', title: 'HR Experience Manager', access: 'agent', managerEmail: 'adriana.jeremic@deel.com', team: 'EMEA', service: 'New Services', startDate: '2025-06-02' },
  { email: 'natalia.marin@deel.com', name: 'Natalia Atehortua', initials: 'NA', title: 'HR Experience Administrator', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2023-08-28' },
  { email: 'natalia.mesa@deel.com', name: 'Natalia Olarte', initials: 'NO', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2022-05-23' },
  { email: 'navin.segar@deel.com', name: 'Navin Segar', initials: 'NS', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2025-06-02' },
  { email: 'oxana.serdyuk@deel.com', name: 'Oksana Serdyuk', initials: 'OS', title: 'HR Experience Manager', access: 'agent', managerEmail: 'mina.nagieva@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-01-27' },
  { email: 'oludolapo.ifeoluwa@deel.com', name: 'Oludolapo Akindutire', initials: 'OA', title: 'Senior HR Experience Operations Manager', access: 'agent', managerEmail: 'kristina.fomina@deel.com', team: 'EMEA', service: 'EOR', startDate: '2022-02-16' },
  { email: 'omolabake.owolabi@deel.com', name: 'Omolabake Owolabi', initials: 'OO', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2024-11-18' },
  { email: 'justine.esquierdo@deel.com', name: 'Pearl Esquierdo', initials: 'PE', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2024-05-13' },
  { email: 'pilar.dominguez@deel.com', name: 'Pilar Dominguez', initials: 'PD', title: 'HR Experience Manager', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-09-30' },
  { email: 'pilvi.pirhonen@deel.com', name: 'Pilvi Pirhonen', initials: 'PP', title: 'HR Experience Manager', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-07-14' },
  { email: 'rachael.maclean@deel.com', name: 'Rachael Maclean', initials: 'RM', title: 'HR Specialist', access: 'agent', managerEmail: 'ljubica.andjelic@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-10-01' },
  { email: 'raquel.sanchez@deel.com', name: 'Raquel Sanchez', initials: 'RS', title: 'HR Experience Manager', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2023-11-13' },
  { email: 'saida.yusuf@deel.com', name: 'Saida Yusuf', initials: 'SY', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2024-09-23' },
  { email: 'saomi.auste@deel.com', name: 'Sao Auste', initials: 'SA', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2025-07-14' },
  { email: 'sayli.patil@deel.com', name: 'Sayli Patil', initials: 'SP', title: 'HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2026-01-05' },
  { email: 'xiaofeng.yao@deel.com', name: 'Shell Yao', initials: 'SY', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2024-07-01' },
  { email: 'sonal.singh@deel.com', name: 'Sonal Singh', initials: 'SS', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2025-10-01' },
  { email: 'stefania.marini@deel.com', name: 'Stefania Marini', initials: 'SM', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2024-07-08' },
  { email: 'stormie.skutnik@deel.com', name: 'Stormie Skutnik', initials: 'SS', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2025-10-01' },
  { email: 'susana.santos@deel.com', name: 'Suzy Santos', initials: 'SS', title: 'HR Experience Administrator', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-12-02' },
  { email: 'tatiana.glebova@deel.com', name: 'Tania Glebova Leontyeva', initials: 'TL', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'jose.ruales@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-06-23' },
  { email: 'tara.lewendon@deel.com', name: 'Tara Lewendon', initials: 'TL', title: 'HR Experience Manager', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2025-02-03' },
  { email: 'trish.lee@deel.com', name: 'Trish Lee', initials: 'TL', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'belen.silvestri@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-05-21' },
  { email: 'victor.marin@deel.com', name: 'Victor Alejandro Marin Jimenez', initials: 'VJ', title: 'Senior Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2023-06-12' },
  { email: 'victor.cortes@deel.com', name: 'Victor Cortes', initials: 'VC', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'madeleine.solares@deel.com', team: 'LATAM', service: 'EOR', startDate: '2025-09-01' },
  { email: 'vilija.survilaite@deel.com', name: 'Vilija Survilaite', initials: 'VS', title: 'HR Experience Specialist', access: 'agent', managerEmail: 'duygu.cakalli@deel.com', team: 'EMEA', service: 'EOR', startDate: '2024-06-24' },
  { email: 'weintonye.sese@deel.com', name: 'Weintonye Sese', initials: 'WS', title: 'Operations Analyst, Global Service Center', access: 'agent', managerEmail: 'kinga.ogorek@deel.com', team: 'EMEA', service: 'LifeCycle', startDate: '2025-02-10' },
  { email: 'william.gaspar@deel.com', name: 'Will Gaspar', initials: 'WG', title: 'HR Experience Manager', access: 'agent', managerEmail: 'megan.lawrence@deel.com', team: 'NAM', service: 'EOR', startDate: '2024-09-02' },
  { email: 'yonit.menashe@deel.com', name: 'Yonit Rucki Menashe', initials: 'YM', title: 'Senior HR Experience Manager', access: 'agent', managerEmail: 'mina.nagieva@deel.com', team: 'EMEA', service: 'EOR', startDate: '2021-12-06' },
  { email: 'ziyaad.mahomed@deel.com', name: 'Ziyaad Mahomed', initials: 'ZM', title: 'HR Experience Manager', access: 'agent', managerEmail: 'melissa.capicchiano@deel.com', team: 'APAC', service: 'EOR', startDate: '2024-04-15' },
];

// ── Lookup helpers ───────────────────────────────────────────────────────
export const MEMBERS_BY_EMAIL = Object.fromEntries(
  TEAM_MEMBERS.map(m => [m.email, m])
);

// ── Flat email lists ─────────────────────────────────────────────────────
export const ALL_EMAILS = TEAM_MEMBERS.map(m => m.email);
export const ALL_EMAILS_SET = new Set(ALL_EMAILS);

// ── Hierarchy helpers ────────────────────────────────────────────────────
export function getDirectReports(email) {
  if (!email) return [];
  const e = email.toLowerCase();
  return TEAM_MEMBERS.filter(m => m.managerEmail === e);
}

export function getAllReports(email) {
  if (!email) return [];
  const reports = new Set();
  const queue = [email.toLowerCase()];
  while (queue.length > 0) {
    const mgr = queue.shift();
    for (const m of TEAM_MEMBERS) {
      if (m.managerEmail === mgr && !reports.has(m.email)) {
        reports.add(m.email);
        queue.push(m.email);
      }
    }
  }
  return [...reports];
}

// ── Get the visible email set for a user based on access level + hierarchy
export function getVisibleEmailsForAccess(email) {
  if (!email) return new Set();
  const member = MEMBERS_BY_EMAIL[email.toLowerCase()];
  if (!member) return new Set([email.toLowerCase()]);

  // Admin sees everyone
  if (member.access === 'admin') return ALL_EMAILS_SET;

  // Regional Manager: own + all reports (TLs + their agents)
  // Team Lead: own + direct reports
  // Agent: own only
  const visible = new Set([email.toLowerCase()]);
  if (member.access === 'regional_manager' || member.access === 'team_lead') {
    for (const r of getAllReports(email)) visible.add(r);
  }
  return visible;
}

// ── Backward-compatible MEMBERS array (with numeric IDs) ────────────────
export const MEMBERS = TEAM_MEMBERS.map((m, i) => ({
  id: i + 1,
  name: m.name,
  initials: m.initials,
  role: m.access,
  team: m.team,
  region: m.team,
  country: null,
  lead: null,
  email: m.email,
}));

// ── DEFAULT_USER_ACCESS_MAP — maps email → access config ────────────────
function _accessTypeId(access) {
  return { admin: 'at_admin', regional_manager: 'at_regional_mgr', team_lead: 'at_lead', agent: 'at_agent' }[access] || 'at_agent';
}

export const DEFAULT_USER_ACCESS_MAP = Object.fromEntries(
  TEAM_MEMBERS.map(m => [m.email, {
    accessTypeId: _accessTypeId(m.access),
    name: m.name,
    title: m.title,
    startDate: m.startDate,
    managerEmail: m.managerEmail,
    region: m.team,
    team: m.team,
    department: 'HR Experience',
    country: null,
    status: 'active',
    access: m.access,
    service: m.service,
  }])
);
