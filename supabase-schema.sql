-- ==============================================================================
-- CUADERNO: Esquema de Base de Datos para Supabase
-- ==============================================================================
-- Este script crea las tablas, políticas de seguridad (RLS) y datos iniciales
-- para migrar de archivos estáticos JSON a una base de datos PostgreSQL en Supabase.
-- ==============================================================================

-- 1. Tablas del catálogo de estudio
create table if not exists subjects (
  id text primary key,
  name text not null,
  folder text,
  description text,
  color text default 'violet',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists topics (
  id text not null,
  subject_id text references subjects(id) on delete cascade,
  name text not null,
  file_url text not null,
  pages integer default 1,
  display_order integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (subject_id, id)
);

create table if not exists sections (
  id text not null,
  subject_id text not null,
  topic_id text not null,
  name text not null,
  description text,
  display_order integer default 0,
  primary key (subject_id, topic_id, id),
  foreign key (subject_id, topic_id) references topics(subject_id, id) on delete cascade
);

create table if not exists questions (
  id uuid default gen_random_uuid() primary key,
  subject_id text not null,
  topic_id text not null,
  section_id text not null,
  question text not null,
  options jsonb not null, -- Array de 4 opciones: ["A", "B", "C", "D"]
  answer integer not null, -- Índice 0, 1, 2, 3
  explanation text,
  display_order integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  foreign key (subject_id, topic_id, section_id) references sections(subject_id, topic_id, id) on delete cascade
);

-- 2. Tablas de progreso del estudiante (opcional para usuarios autenticados)
create table if not exists quiz_scores (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  subject text not null,
  section text not null,
  score integer not null,
  total integer not null,
  percentage integer not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists student_profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  name text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Habilitar Row Level Security (RLS)
alter table subjects enable row level security;
alter table topics enable row level security;
alter table sections enable row level security;
alter table questions enable row level security;
alter table quiz_scores enable row level security;
alter table student_profiles enable row level security;

-- 4. Políticas de lectura pública para el contenido educativo
create policy "Lectura pública para subjects" on subjects for select using (true);
create policy "Lectura pública para topics" on topics for select using (true);
create policy "Lectura pública para sections" on sections for select using (true);
create policy "Lectura pública para questions" on questions for select using (true);

-- Políticas para puntuaciones y perfiles
create policy "Usuarios gestionan sus propias notas" on quiz_scores
  for all using (auth.uid() = user_id or user_id is null);

create policy "Usuarios gestionan su perfil" on student_profiles
  for all using (auth.uid() = id);

-- ==============================================================================
-- 5. Inserción de datos iniciales (Geografía Física - Tema 1)
-- ==============================================================================

insert into subjects (id, name, folder, description, color) values
  ('geografia-fisica', 'Geografía Física', 'temas/geografia_fisica', 'La configuración natural de la Tierra y las relaciones entre sus sistemas.', 'violet')
on conflict (id) do nothing;

insert into topics (id, subject_id, name, file_url, pages, display_order) values
  ('tema1', 'geografia-fisica', 'Tema 1 · Campo científico y elementos de la Tierra', 'temas/geografia_fisica/tema1.pdf', 3, 1)
on conflict (subject_id, id) do nothing;

insert into sections (id, subject_id, topic_id, name, description, display_order) values
  ('campo', 'geografia-fisica', 'tema1', 'Campo científico y evolución', 'Objeto de estudio, historia y figuras de la Geografía.', 1),
  ('metodo', 'geografia-fisica', 'tema1', 'Sistemas, método y datos', 'Teoría de sistemas, fuentes, variables y tratamiento de datos.', 2),
  ('tierra', 'geografia-fisica', 'tema1', 'La Tierra y sus movimientos', 'Sistema solar, forma terrestre, rotación, traslación y coordenadas.', 3),
  ('magnitudes', 'geografia-fisica', 'tema1', 'Magnitudes, escalas y diversidad', 'Órdenes espacio-temporales, geodiversidad y biodiversidad.', 4)
on conflict (subject_id, topic_id, id) do nothing;

-- Inserción de preguntas para Tema 1
insert into questions (subject_id, topic_id, section_id, question, options, answer, explanation, display_order) values
  ('geografia-fisica', 'tema1', 'campo', '¿Qué estudia la Geografía Física según los apuntes?', '["La configuración natural de la Tierra, cómo se forman y funcionan sus sistemas y la incidencia humana.", "Únicamente la descripción de fronteras y divisiones políticas.", "La composición química de los planetas fuera del sistema solar.", "Solo la distribución de la población y las actividades económicas."]'::jsonb, 0, 'Los apuntes describen la Geografía Física como el estudio de la configuración natural, la formación y el funcionamiento de los sistemas naturales, incluida la incidencia de las actividades humanas.', 1),
  ('geografia-fisica', 'tema1', 'campo', '¿Qué relación entre naturaleza y sociedad destaca el tema?', '["Los cambios de un elemento de la Tierra pueden influir en otros y esa relación se expresa en paisajes.", "La sociedad y la naturaleza funcionan como ámbitos aislados que no se afectan.", "El paisaje depende exclusivamente de procesos geológicos.", "Los elementos humanos transforman la naturaleza, pero nunca reciben su influencia."]'::jsonb, 0, 'La Tierra se presenta como una unidad o sistema: los cambios en un elemento generan cambios en otros, y la relación naturaleza-sociedad se manifiesta en paisajes.', 2),
  ('geografia-fisica', 'tema1', 'campo', '¿En qué año sitúan los apuntes la aparición de cátedras universitarias de Geografía?', '["1570", "1850", "1922", "1960"]'::jsonb, 1, 'El documento señala que la Geografía emerge como disciplina científica en el siglo XIX y que en 1850 aparecen cátedras de Geografía en las universidades.', 3),
  ('geografia-fisica', 'tema1', 'campo', '¿Qué institución nace en 1922, según el tema?', '["La Royal Geographical Society.", "La Unión Geográfica Internacional.", "La National Geographic Society.", "La primera cátedra de Geografía Física."]'::jsonb, 1, 'Los apuntes sitúan en 1922 el nacimiento de la Unión Geográfica Internacional.', 4),
  ('geografia-fisica', 'tema1', 'campo', '¿Qué obra de Alexander von Humboldt reúne conocimientos de su época sobre fenómenos terrestres y celestes?', '["Cosmos.", "Geographia.", "El primer atlas moderno.", "Teoría General de Sistemas."]'::jsonb, 0, 'Cosmos describe conocimientos de la época sobre fenómenos terrestres y celestes y presenta la naturaleza como un organismo en interacción continua.', 5),
  ('geografia-fisica', 'tema1', 'campo', '¿Quién publicó el primer atlas moderno mencionado en los apuntes y en qué año?', '["Claudio Ptolomeo, en 150 d. C.", "Abraham Ortelius, en 1570.", "Bernard Varenius, en 1850.", "Alexander von Humboldt, en 1922."]'::jsonb, 1, 'El documento menciona el primer atlas moderno publicado por Abraham Ortelius en 1570.', 6),
  ('geografia-fisica', 'tema1', 'campo', '¿Qué aportación cartográfica atribuye el tema a Eratóstenes?', '["Estableció el meridiano de Greenwich.", "Dividió el mundo con dos ejes perpendiculares y calculó la circunferencia terrestre.", "Creó la proyección de Mercator.", "Demostró que la Tierra gira alrededor del Sol."]'::jsonb, 1, 'Los apuntes atribuyen a Eratóstenes un mapa con dos ejes perpendiculares y el cálculo preciso de la circunferencia de la Tierra.', 7),
  ('geografia-fisica', 'tema1', 'campo', '¿Qué rasgo aparece en los mapas teológicos medievales descritos en el tema?', '["Jerusalén ocupaba el centro del mapa.", "El norte siempre aparecía arriba y el sur abajo.", "Representaban solo latitudes y longitudes exactas.", "Se basaban en imágenes de satélite."]'::jsonb, 0, 'En la Edad Media, el tema describe mapas de interpretación teológica con Jerusalén en el centro; algunos mapas islámicos estaban orientados al revés de lo habitual.', 8),
  ('geografia-fisica', 'tema1', 'campo', '¿Qué exploradora fue la primera mujer admitida en la Royal Geographical Society, según el documento?', '["Fanny Bullock.", "María de Bolós i Capdevila.", "Isabella Bird.", "Eliza Ruhamah Scidmore."]'::jsonb, 2, 'Los apuntes identifican a Isabella Bird (1831–1904) como la primera mujer admitida en la Royal Geographical Society.', 9),
  ('geografia-fisica', 'tema1', 'metodo', '¿Qué define a un sistema en la Teoría General de Sistemas presentada en el tema?', '["Un conjunto de elementos interconectados cuyas propiedades resultan de las interacciones.", "Una lista de elementos independientes que no intercambian información.", "Un espacio delimitado únicamente por fronteras políticas.", "Un método estadístico basado solo en promedios."]'::jsonb, 0, 'Los apuntes definen un sistema como un conjunto de elementos que funcionan interconectados; sus propiedades resultan de las interacciones de sus componentes.', 10),
  ('geografia-fisica', 'tema1', 'metodo', '¿Cuál es la diferencia correcta entre un sistema abierto y uno cerrado?', '["El abierto intercambia masa y energía; el cerrado intercambia energía, pero no masa.", "El abierto solo intercambia energía; el cerrado no intercambia nada.", "El abierto no tiene entorno; el cerrado intercambia masa y energía.", "Ambos intercambian masa y energía del mismo modo."]'::jsonb, 0, 'El tema distingue sistemas abiertos (intercambian masa y energía), cerrados (intercambian energía, no masa) y aislados (no intercambian ni masa ni energía).', 11),
  ('geografia-fisica', 'tema1', 'metodo', '¿Qué es un sistema aislado según los apuntes?', '["Uno que intercambia masa, pero no energía.", "Uno que intercambia energía, pero no masa.", "Uno que no intercambia ni masa ni energía con su entorno.", "Uno cuyas partes no interactúan entre sí."]'::jsonb, 2, 'Un sistema aislado no intercambia ni masa ni energía con su entorno.', 12),
  ('geografia-fisica', 'tema1', 'metodo', '¿Qué elementos componen los grandes sistemas naturales nombrados en el tema?', '["Litosfera, hidrosfera, atmósfera y biosfera.", "Troposfera, estratosfera, mesosfera y termosfera.", "Núcleo, manto, corteza y campo magnético.", "Población, economía, cultura y territorio."]'::jsonb, 0, 'Los apuntes relacionan rocas con la litosfera, agua con la hidrosfera, aire con la atmósfera y seres vivos con la biosfera.', 13),
  ('geografia-fisica', 'tema1', 'metodo', '¿Cuál de estos grupos contiene únicamente fuentes primarias de información citadas en el PDF?', '["Trabajo de campo, toponimia, cartografía e imágenes.", "Archivos, informes, anuarios y prensa.", "Novelas, archivos, anuarios y producciones audiovisuales.", "Informes, prensa, bibliografía y novelas."]'::jsonb, 0, 'El tema clasifica trabajo de campo, toponimia, bibliografía, cartografía e imágenes como fuentes primarias; archivos, informes, anuarios, novelas, prensa y audiovisuales aparecen como secundarias.', 14),
  ('geografia-fisica', 'tema1', 'metodo', '¿Cuál es el orden de etapas del método hipotético-deductivo que aparece en los apuntes?', '["Problema, hipótesis, desarrollo, deducción y testado.", "Hipótesis, testado, problema, conclusión y observación.", "Observación, publicación, encuesta, mapa y conclusión.", "Problema, deducción, hipótesis, muestreo y publicación."]'::jsonb, 0, 'El documento enumera: identificación del problema, planteamiento de hipótesis, desarrollo conceptual/inductivo/técnico, deducción de consecuencias y testado o confrontación.', 15),
  ('geografia-fisica', 'tema1', 'metodo', '¿Qué tipo de variable cuantitativa puede tomar valores intermedios infinitos entre dos enteros?', '["Discreta.", "Nominal.", "Ordinal.", "Continua."]'::jsonb, 3, 'Las variables cuantitativas continuas poseen infinitos valores intermedios; las discretas toman valores enteros.', 16),
  ('geografia-fisica', 'tema1', 'metodo', 'Una variable cualitativa cuyos datos siguen un orden se clasifica como…', '["Nominal.", "Ordinal.", "Discreta.", "Continua."]'::jsonb, 1, 'El tema distingue variables cualitativas nominales (sin orden) y ordinales (con orden).', 17),
  ('geografia-fisica', 'tema1', 'metodo', '¿Qué significa muestrear en el estudio geográfico descrito en el PDF?', '["Obtener información de una muestra representativa de una población.", "Medir siempre a todos los individuos de una población.", "Convertir una variable cualitativa en una cuantitativa.", "Representar cualquier dato mediante un mapa de isolíneas."]'::jsonb, 0, 'Cuando la información procede de una muestra representativa de una población, los apuntes lo denominan muestreo.', 18),
  ('geografia-fisica', 'tema1', 'metodo', '¿Cómo se expresa la frecuencia relativa?', '["En grados de latitud.", "En porcentajes.", "En kilómetros cuadrados.", "Mediante valores ordinales."]'::jsonb, 1, 'El tema indica que la frecuencia mide cuántas veces se repite un elemento o fenómeno y que la frecuencia relativa se expresa en porcentajes.', 19),
  ('geografia-fisica', 'tema1', 'tierra', '¿Qué planetas forman el grupo de los planetas rocosos según los apuntes?', '["Júpiter, Saturno, Urano y Neptuno.", "Mercurio, Venus, Tierra y Marte.", "Venus, Tierra, Júpiter y Saturno.", "Mercurio, Marte, Saturno y Neptuno."]'::jsonb, 1, 'El documento agrupa Mercurio, Venus, Tierra y Marte como planetas rocosos; Júpiter, Saturno, Urano y Neptuno son los exteriores o jovianos.', 20),
  ('geografia-fisica', 'tema1', 'tierra', '¿Qué edad y distancia aproximadas del Sol respecto a la Tierra indica el PDF?', '["4.500 millones de años y 150 millones de kilómetros.", "150 millones de años y 4.500 millones de kilómetros.", "4.500 años y 150.000 kilómetros.", "13.800 millones de años y 40.076 kilómetros."]'::jsonb, 0, 'Los apuntes dicen que el Sol tiene más de 4.500 millones de años y se encuentra a unos 150 millones de kilómetros de la Tierra.', 21),
  ('geografia-fisica', 'tema1', 'tierra', '¿Por qué describe el tema la forma de la Tierra como un geoide?', '["Porque es una esfera perfecta sin irregularidades.", "Porque es una esfera achatada en los polos por sus movimientos y las fuerzas físicas derivadas.", "Porque su superficie está formada únicamente por océanos.", "Porque la circunferencia polar es mayor que la ecuatorial."]'::jsonb, 1, 'El tema define el geoide como una esfera achatada en los polos y lo relaciona con los movimientos terrestres y las fuerzas físicas derivadas.', 22),
  ('geografia-fisica', 'tema1', 'tierra', '¿Qué movimiento terrestre dura aproximadamente 24 horas y causa la sucesión del día y la noche?', '["La traslación alrededor del Sol.", "La precesión del eje terrestre.", "La rotación sobre el eje terrestre.", "La órbita de la Luna."]'::jsonb, 2, 'La rotación es el giro de la Tierra sobre sí misma, dura 24 horas y es responsable de la sucesión del día y la noche.', 23),
  ('geografia-fisica', 'tema1', 'tierra', '¿En qué sentido gira la Tierra sobre sí misma, según los apuntes?', '["De este a oeste.", "De oeste a este.", "De norte a sur.", "En sentido horario alrededor del Sol."]'::jsonb, 1, 'El PDF describe la rotación terrestre de oeste a este, en sentido contrario a las agujas del reloj.', 24),
  ('geografia-fisica', 'tema1', 'tierra', '¿Qué proceso anual relaciona el tema con el movimiento de traslación?', '["La alternancia de las fases lunares.", "La sucesión de los solsticios y equinoccios.", "La sucesión diaria del día y la noche.", "La variación de la longitud de Greenwich."]'::jsonb, 1, 'La traslación es el giro de la Tierra alrededor del Sol en una órbita elíptica y el documento la asocia con solsticios y equinoccios.', 25),
  ('geografia-fisica', 'tema1', 'tierra', '¿Qué par de coordenadas se determina mediante paralelos y meridianos?', '["Altitud y profundidad.", "Latitud y longitud.", "Extensión y edad.", "Temperatura y presión."]'::jsonb, 1, 'Los paralelos permiten determinar la latitud y los meridianos la longitud; ambas se expresan como valores angulares.', 26),
  ('geografia-fisica', 'tema1', 'tierra', '¿Qué referencia establece el tema para la latitud de 0°?', '["El meridiano de Greenwich.", "El trópico de Cáncer.", "El ecuador.", "El círculo polar Ártico."]'::jsonb, 2, 'El paralelo del ecuador forma un ángulo de 0° con su plano y sirve como referencia de latitud.', 27),
  ('geografia-fisica', 'tema1', 'tierra', '¿Cuánto tarda el ciclo de fases de la Luna que describen los apuntes?', '["24 horas.", "365 días.", "29,5 días.", "88 días."]'::jsonb, 2, 'El documento indica que el ciclo de fases lunares dura unos 29,5 días.', 28),
  ('geografia-fisica', 'tema1', 'magnitudes', '¿Qué clasifican las magnitudes geográficas?', '["Elementos terrestres según dimensión, propiedades y extensión, con referencias espacio-temporales.", "Únicamente las especies según su número de individuos.", "Los datos de una encuesta según su frecuencia relativa.", "Solo los movimientos del sistema solar."]'::jsonb, 0, 'El tema dice que las magnitudes geográficas clasifican elementos de la Tierra por dimensión, propiedades y extensión, siguiendo secuencias espacio-temporales.', 29),
  ('geografia-fisica', 'tema1', 'magnitudes', '¿Cuál de estos ejemplos corresponde a una escala espacial de decenas de kilómetros del PDF?', '["Laderas, termas y lagunas.", "Deltas, sierras y mares interiores.", "Continentes, océanos y placas tectónicas.", "Sinclinales, páramos y colinas."]'::jsonb, 3, 'En la secuencia espacial, el tema ubica sinclinales, páramos, colinas y canales fluviales en el orden de decenas de kilómetros.', 30),
  ('geografia-fisica', 'tema1', 'magnitudes', '¿Qué ejemplo sitúan los apuntes en una escala temporal de horas a un día?', '["Movimientos de masa en laderas.", "Desplazamiento de células de alta o baja presión.", "Oscilación de mareas y formación de tornados.", "Colonización vegetal."]'::jsonb, 2, 'La escala de horas a día incluye oscilación de mareas, formación de tornados y erosión en surcos.', 31),
  ('geografia-fisica', 'tema1', 'magnitudes', '¿Para qué se utilizan las escalas en el estudio de los fenómenos terrestres?', '["Como patrón convencional para medir, organizar en niveles y representar elementos o fenómenos.", "Para sustituir el análisis de datos por observación informal.", "Para indicar únicamente la distancia al Sol.", "Para decidir si una fuente es primaria o secundaria."]'::jsonb, 0, 'Los apuntes presentan las escalas como patrones convencionales para medir, organizar en niveles y representar elementos y fenómenos naturales.', 32),
  ('geografia-fisica', 'tema1', 'magnitudes', '¿Qué estudia la escala granulométrica citada en el tema?', '["La intensidad de los terremotos.", "El tamaño del grano y la textura de la roca.", "La temperatura de fusión del hielo.", "La proporción entre el mapa y el territorio."]'::jsonb, 1, 'El PDF relaciona la escala granulométrica con el tamaño del grano y la textura de la roca.', 33),
  ('geografia-fisica', 'tema1', 'magnitudes', '¿Cuál es la diferencia principal entre geodiversidad y biodiversidad?', '["La geodiversidad abarca elementos abióticos; la biodiversidad, los organismos vivos.", "La geodiversidad estudia solo animales y la biodiversidad solo rocas.", "La geodiversidad mide la extensión y la biodiversidad mide la altitud.", "No hay diferencia: son dos nombres para los mismos elementos."]'::jsonb, 0, 'El tema define la geodiversidad como dominio de elementos abióticos y la biodiversidad como dominio de elementos bióticos.', 34),
  ('geografia-fisica', 'tema1', 'magnitudes', '¿Qué conjunto incluye elementos de la geodiversidad según los apuntes?', '["Especies, hábitats y microorganismos.", "Minerales, rocas, suelos, estructuras y formas de relieve.", "Población, muestra, mediana y frecuencia.", "Planetas, satélites, estrellas y galaxias."]'::jsonb, 1, 'La geodiversidad integra materiales del sustrato (minerales, rocas y suelos), estructuras sedimentarias o tectónicas, formas de relieve y sus interacciones.', 35),
  ('geografia-fisica', 'tema1', 'magnitudes', '¿Qué beneficio práctico atribuye el PDF al conocimiento de la diversidad terrestre?', '["Ayuda a prevenir riesgos, gestionar actividades y diseñar infraestructuras adecuadamente.", "Elimina todos los riesgos naturales.", "Permite prescindir de estudios ambientales.", "Sustituye la conservación de espacios naturales protegidos."]'::jsonb, 0, 'Los apuntes relacionan este conocimiento con prevención de riesgos, gestión responsable del turismo y otras actividades, diseño de infraestructuras y conservación.', 36);
