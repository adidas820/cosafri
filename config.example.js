/**
 * config.js
 * Configuración del entorno. Este archivo NO debe subirse a un repositorio público
 * si contiene claves de servicio (service_role). La anon key es pública y segura.
 *
 * Copia config.example.js → config.js y rellena tus valores.
 */
export const CONFIG = {
  supabase: {
    url: '',       // Ej: 'https://tuproyecto.supabase.co'
    anonKey: '',   // Tu anon (public) key de Supabase
    enabled: false // Cambiar a true para activar Supabase
  }
};
