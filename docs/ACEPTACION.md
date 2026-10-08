# Criterios de aceptación (§80) y su evidencia

Estado al cierre de la Fase 10 (2026-10-07). «Prueba» = prueba automatizada en `tests/`; «En vivo» = verificado contra el Supabase de producción.

| Criterio | Cumple | Evidencia |
|---|---|---|
| Usuario puede realizar cursos | ✅ | Reproductor de lecciones con avance por página y por video (`phase2.test.ts`); en vivo, Juan y Ana terminaron IND-001 |
| Usuario puede presentar examen | ✅ | Motor de intentos con copia congelada (`phase3.test.ts`); en vivo, examen de 6 preguntas |
| Preguntas cerradas se califican automáticamente | ✅ | 7 tipos calificados en el servidor, incluido el crédito parcial (`phase3`) |
| Preguntas abiertas pueden calificarse manualmente | ✅ | Bandeja **Calificar**, historial de calificaciones (`phase3`, `phase9`) |
| Se calculan calificaciones correctamente | ✅ | Ponderación, política mejor/último/promedio (`phase3`); 95 % en la prueba de trazabilidad |
| Se controlan intentos | ✅ | Máximo, enfriamiento, intento extra con motivo (`phase3`, `phase4`) |
| Se controla tiempo | ✅ | Reloj del servidor + 30 s de gracia; job que cierra intentos vencidos (`phase3`) |
| Se controlan fechas límite | ✅ | Fechas fijas o relativas, prórrogas, vencidos, recordatorios configurables (`phase4`, `phase8`) |
| Se registra progreso | ✅ | `lesson_progress` y `recompute_enrollment` (`phase2`) |
| Se pueden asignar cursos | ✅ | Por persona o por regla con usuarios futuros (`phase4`) |
| Usuario puede ver sus cursos | ✅ | Inicio, Mis cursos, Certificados e Historial con versión (`phase9`) |
| Admin puede ver progreso | ✅ | Tableros, Cumplimiento por persona y ranking (`phase5`) |
| Admin puede ver cursos vencidos | ✅ | «Requiere atención», filtro de vencidos y reporte (`phase5`, `phase7`) |
| Admin puede ver calificaciones | ✅ | Reporte de calificaciones y de exámenes, trazabilidad (`phase7`, `phase9`) |
| Admin puede generar reportes | ✅ | 10 reportes en Excel, CSV y PDF, más el expediente (`phase7`) |
| Existe historial | ✅ | Bitácora con cadena de hash, historial del curso y del empleado (`phase1`, `phase9`) |
| Existe control de permisos | ✅ | Roles con alcance grupo/empresa/sucursal/departamento/equipo (`phase1`) |
| RLS funciona | ✅ | Todas las tablas con RLS, revisado en cada fase y como invariante global (`phase10`) |
| No existen accesos cruzados entre empresas | ✅ | RH de EA no ve TMC en ninguna pantalla ni en los 10 reportes (`phase5`, `phase7`, `phase9`) |
| Se pueden generar certificados | ✅ | Emisión automática, PDF con QR y verificación pública (`phase6`) |
| El sistema funciona en móvil | ✅ | Revisado a 375 px: sin desbordes en las pantallas principales (Fase 10) |
| El sistema tiene manejo de errores | ✅ | Mensajes en español por código, páginas de error y «no encontrado», nunca detalles técnicos |
| El sistema está preparado para producción | ✅* | Seguridad, respaldos probados, salud del sistema y carga (5 000 personas / 100 000 asignaciones). *Faltan los pasos del piloto que dependen del cliente: correo (Resend), MFA de administradores y usuarios reales |
